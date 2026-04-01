const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const RadioDatabase = require('./database/RadioDatabase');
const AzureKeyManager = require('./database/AzureKeyManager');
const ToJyutping = require('to-jyutping');  // 用于粤语转粤拼

// 注意：不再使用 keys.js 文件，改为从数据库读取密钥
// const keys = require('./keys');

class AzureTranslationClient {
    constructor(speechKey, region, streamUrl, language = "en-US", targetLanguages = ["zh-CN", "ja-JP"]) {
        // 配置 Azure Speech 服务
        this.speechKey = speechKey;
        this.region = region;
        this.speechConfig = sdk.SpeechTranslationConfig.fromSubscription(speechKey, region);

        // 保存语言配置（用于密钥切换时重建 SpeechConfig）
        this.language = language;
        this.targetLanguages = Array.isArray(targetLanguages) ? targetLanguages : [targetLanguages];

        // 设置识别语言（从数据库读取）
        this.speechConfig.speechRecognitionLanguage = this.language;

        // 设置翻译目标语言（可以添加多个目标语言）
        this.targetLanguages.forEach(lang => {
            this.speechConfig.addTargetLanguage(lang);
        });
        
        this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, "Semantic");
        this.endTag = false;
        this.streamUrl = streamUrl;

        // 用于存储连续文本
        this.continuousText = "";
        this.currentText = "";  // 用于实时显示的中间结果
        this.translations = {}; // 存储各语言的翻译
        this.sourceText = "";
        this.translatedText = "";
        
        // SSE客户端列表 - 使用Map存储，包含客户端上次接收的事件ID
        this.clients = new Map();
        
        // 识别状态
        this.isRecognizing = false;
        
        // 重试控制
        this.maxRetries = 5;
        this.currentRetries = 0;
        this.retryDelay = 3000; // 3秒
        this.reconnecting = false;

        // 添加事件去重和防抖相关属性
        this.lastRecognizingText = "";  // 上一次发送的识别中间文本
        this.recognizingDebounceTimer = null;  // 防抖定时器
        this.recognizingDebounceMs = 300;  // 防抖时间(毫秒)
        this.pendingRecognizingEvent = null;  // 待发送的事件

        // 最终识别结果去重
        this.lastRecognizedText = "";  // 上一次识别的最终文本
        this.lastRecognizedTranslations = "";  // 上一次识别的所有翻译（JSON字符串）

        // 事件ID跟踪
        this.eventCounter = 0;  // 事件计数器，用于生成唯一ID
        
        // 存储最近发送的事件，用于防止重复
        this.recentEvents = [];
        this.maxRecentEvents = 20; // 存储最近20个事件
        
        // 存储所有已经识别的完整文本段落，用于新客户端连接时的历史记录
        this.recognizedTextSegments = [];
        this.maxTextSegments = 0; // 不保存历史记录，节约内存

        // 限制最大客户端连接数
        this.maxClients = 50; // 每个电台最多50个客户端

        // 批量发送配置
        this.batchSize = 10; // 每批处理10个客户端
        this.batchDelayMs = 0; // 批次间延迟（0表示使用setImmediate）

        // 性能监控
        this.performanceStats = {
            totalEventsSent: 0,
            totalSendErrors: 0,
            avgSendTimeMs: 0,
            lastReportTime: Date.now()
        };

        // Centrifugo 配置
        this.centrifugoUrl = 'http://localhost:8000/api/publish';
        this.centrifugoApiKey = 'radio-api-key-2025';
        this.useCentrifugo = true;  // 启用 Centrifugo
    }

    // 启动客户端连接数监控
    startClientMonitor() {
        // 清除之前的监控
        if (this.clientMonitorInterval) {
            clearInterval(this.clientMonitorInterval);
        }

        // 每60秒打印一次连接客户数（优化：减少日志输出频率）
        this.clientMonitorInterval = setInterval(() => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] 当前连接客户数: ${this.clients.size}/${this.maxClients}`);
        }, 60000);
    }

    // 生成唯一的事件ID
    generateEventId() {
        return `${Date.now()}-${++this.eventCounter}`;
    }

    // 添加SSE客户端
    addClient(client, lastEventId = null) {
        // 检查是否超过最大客户端数限制
        if (this.clients.size >= this.maxClients) {
            console.warn(`⚠️ 电台 ${this.stationCode} 已达到最大客户端数限制 (${this.maxClients})，拒绝新连接`);
            const errorEventId = this.generateEventId();
            client.write(`event: error\nid: ${errorEventId}\ndata: ${JSON.stringify({
                id: errorEventId,
                message: '电台连接数已达上限，请稍后重试',
                maxClients: this.maxClients,
                timestamp: new Date().toISOString()
            })}\n\n`);
            client.end();
            return false;
        }

        // 将客户端及其上次接收的事件ID存储在Map中
        this.clients.set(client, { lastEventId });
        console.log(`客户端已连接，当前连接数: ${this.clients.size}/${this.maxClients}，上次事件ID: ${lastEventId || 'none'}`);

        // 向新客户端发送历史记录
        if (this.recognizedTextSegments.length > 0) {
            // 发送历史记录事件
            this.sendEventToClient(client, 'history', {
                segments: this.recognizedTextSegments,
                timestamp: new Date().toISOString()
            });
        }
        
        // 监听客户端断开连接
        client.on('close', () => {
            this.clients.delete(client);
            console.log(`客户端已断开，当前连接数: ${this.clients.size}`);
            
            // 如果没有客户端连接，停止识别
            if (this.clients.size === 0 && this.isRecognizing) {
                console.log("没有客户端连接，停止语音识别...");
                this.stopRecognition();
            }
        });
        
        // 如果这是第一个客户端且识别未启动，开始识别
        if (this.clients.size === 1 && !this.isRecognizing) {
            console.log("有客户端连接，开始语音识别和翻译...");
            this.startRecognition();
        }
    }

    // 检查事件是否已经发送给客户端
    hasClientReceivedEvent(client, eventId) {
        const clientInfo = this.clients.get(client);
        if (!clientInfo || !clientInfo.lastEventId) return false;
        
        // 如果客户端的上次事件ID等于或大于当前事件ID，表示已接收
        // 这需要事件ID可以进行时间比较，因此使用时间戳作为ID前缀
        return clientInfo.lastEventId >= eventId;
    }

    // 更新客户端的上次接收事件ID
    updateClientLastEventId(client, eventId) {
        if (this.clients.has(client)) {
            const clientInfo = this.clients.get(client);
            clientInfo.lastEventId = eventId;
            this.clients.set(client, clientInfo);
        }
    }

    // 判断事件是否为重复事件
    isDuplicateEvent(eventData) {
        // 检查事件是否在最近事件列表中
        return this.recentEvents.some(event => 
            event.type === eventData.type && 
            event.data.id === eventData.data.id
        );
    }

    // 记录发送的事件
    recordEvent(type, data) {
        const eventRecord = { type, data, timestamp: Date.now() };
        
        // 添加到最近事件列表
        this.recentEvents.push(eventRecord);
        
        // 如果超过最大数量，移除最早的事件
        if (this.recentEvents.length > this.maxRecentEvents) {
            this.recentEvents.shift();
        }
    }

    // 向所有客户端发送SSE事件（Centrifugo 版本）
    async sendEvent(eventName, data) {
        // 确保数据有一个唯一的ID
        if (!data.id) {
            data.id = this.generateEventId();
        }

        // 检查是否为重复事件
        const eventData = { type: eventName, data };
        if (this.isDuplicateEvent(eventData)) {
            console.log(`跳过重复事件: ${eventName} ID: ${data.id}`);
            return;
        }

        // 记录此次发送的事件
        this.recordEvent(eventName, data);

        // 如果启用 Centrifugo，发布到 Centrifugo
        if (this.useCentrifugo && this.stationCode) {
            const startTime = Date.now();

            // console.log(`📤 [Centrifugo] 发布事件 ${eventName} 到频道 station:${this.stationCode}`);

            try {
                const response = await axios.post(this.centrifugoUrl, {
                    channel: `station:${this.stationCode}`,
                    data: {
                        event: eventName,
                        ...data
                    }
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `apikey ${this.centrifugoApiKey}`
                    },
                    timeout: 5000  // 5秒超时
                });

                // console.log(`✅ [Centrifugo] 发布成功:`, response.data);

                // 更新性能统计
                const sendTime = Date.now() - startTime;
                this.performanceStats.totalEventsSent++;
                this.performanceStats.avgSendTimeMs =
                    (this.performanceStats.avgSendTimeMs * 0.9) + (sendTime * 0.1);

                // 性能告警
                if (sendTime > 100) {
                    console.warn(`⚠️ Centrifugo 发布耗时过长: ${sendTime}ms`);
                }

                // 定期报告性能统计（每60秒）
                const now = Date.now();
                if (now - this.performanceStats.lastReportTime > 60000) {
                    // console.log(`📊 [Centrifugo] 性能统计 - 已发送: ${this.performanceStats.totalEventsSent}, 错误: ${this.performanceStats.totalSendErrors}, 平均耗时: ${this.performanceStats.avgSendTimeMs.toFixed(2)}ms`);
                    this.performanceStats.lastReportTime = now;
                }

            } catch (error) {
                console.error(`❌ [Centrifugo] 发布失败:`, error.message);
                if (error.response) {
                    console.error(`   响应状态: ${error.response.status}`);
                    console.error(`   响应数据:`, error.response.data);
                }
                this.performanceStats.totalSendErrors++;
            }
        } else {
            // 回退到直接客户端发送（如果有客户端连接）
            if (this.clients && this.clients.size > 0) {
                const eventDataStr = JSON.stringify(data);
                const eventString = `event: ${eventName}\nid: ${data.id}\ndata: ${eventDataStr}\n\n`;
                const startTime = Date.now();
                const clientsArray = Array.from(this.clients.entries());
                this.sendEventBatched(clientsArray, eventString, data.id, startTime);
            }
        }
    }

    // 批量发送事件到客户端（异步，不阻塞）
    async sendEventBatched(clientsArray, eventString, eventId, startTime) {
        let successCount = 0;
        let errorCount = 0;

        // 分批处理客户端
        for (let i = 0; i < clientsArray.length; i += this.batchSize) {
            const batch = clientsArray.slice(i, i + this.batchSize);

            // 使用 setImmediate 让出事件循环，避免阻塞
            await new Promise(resolve => {
                setImmediate(() => {
                    // 批量发送
                    for (const [client, clientInfo] of batch) {
                        try {
                            // 检查客户端是否已经接收过此事件
                            if (!this.hasClientReceivedEvent(client, eventId)) {
                                // 使用 writable.write() 的回调来处理背压
                                const canContinue = client.write(eventString, (err) => {
                                    if (err) {
                                        console.error(`写入客户端失败: ${err.message}`);
                                        this.clients.delete(client);
                                        errorCount++;
                                    }
                                });

                                if (!canContinue) {
                                    // 发生背压，但不阻塞（SSE 特性）
                                    console.warn(`⚠️ 客户端写入背压`);
                                }

                                // 更新客户端的上次事件ID
                                this.updateClientLastEventId(client, eventId);
                                successCount++;
                            }
                        } catch (e) {
                            console.error(`向客户端发送事件失败: ${e.message}`);
                            this.clients.delete(client);
                            errorCount++;
                        }
                    }
                    resolve();
                });
            });

            // 批次之间可选延迟
            if (this.batchDelayMs > 0 && i + this.batchSize < clientsArray.length) {
                await new Promise(resolve => setTimeout(resolve, this.batchDelayMs));
            }
        }

        // 更新性能统计
        const sendTime = Date.now() - startTime;
        this.performanceStats.totalEventsSent++;
        this.performanceStats.totalSendErrors += errorCount;
        this.performanceStats.avgSendTimeMs =
            (this.performanceStats.avgSendTimeMs * 0.9) + (sendTime * 0.1);

        // 性能告警
        if (sendTime > 100) {
            console.warn(`⚠️ 事件发送耗时过长: ${sendTime}ms, 客户端数: ${clientsArray.length}, 成功: ${successCount}, 失败: ${errorCount}`);
        }

        // 定期报告性能统计（每60秒）
        const now = Date.now();
        if (now - this.performanceStats.lastReportTime > 60000) {
            console.log(`📊 性能统计 - 已发送: ${this.performanceStats.totalEventsSent}, 错误: ${this.performanceStats.totalSendErrors}, 平均耗时: ${this.performanceStats.avgSendTimeMs.toFixed(2)}ms`);
            this.performanceStats.lastReportTime = now;
        }

        // 使用 Centrifugo 时不需要检查客户端数量
        // 只有在不使用 Centrifugo 时才检查客户端数量
        if (!this.useCentrifugo && this.clients.size === 0 && this.isRecognizing) {
            console.log("所有客户端已断开，停止语音识别和翻译...");
            this.stopRecognition();
        }
    }
    
    // 向特定客户端发送SSE事件
    sendEventToClient(client, eventName, data) {
        // 确保数据有一个唯一的ID
        if (!data.id) {
            data.id = this.generateEventId();
        }
        
        // 检查客户端是否已经接收过此事件
        if (this.hasClientReceivedEvent(client, data.id)) {
            console.log(`跳过向客户端发送已接收的事件: ${eventName} ID: ${data.id}`);
            return;
        }
        
        const eventDataStr = JSON.stringify(data);
        const eventString = `event: ${eventName}\nid: ${data.id}\ndata: ${eventDataStr}\n\n`;
        
        try {
            client.write(eventString);
            // 更新客户端的上次事件ID
            this.updateClientLastEventId(client, data.id);
        } catch (e) {
            console.error(`向客户端发送事件失败: ${e.message}`);
            this.clients.delete(client);
        }
    }

    streamToPcm(streamUrl) {
        // 使用 ffmpeg 将音频流转换为 PCM 格式
        const ffmpegProcess = spawn('ffmpeg', [
            '-i', streamUrl,
            '-f', 's16le',
            '-ar', '16000',
            '-ac', '1',
            // 优化缓冲区和队列大小，减少内存占用
            '-bufsize', '64k',
            '-max_muxing_queue_size', '1024',
            // 添加重连选项
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-timeout', '30000000',  // 延长超时时间
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        // 错误处理 - 屏蔽 ffmpeg stderr 日志（太多了）
        ffmpegProcess.stderr.on('data', (data) => {
            // 只记录真正的错误，忽略正常的进度信息
            const message = data.toString();
            if (message.includes('error') || message.includes('Error') || message.includes('failed')) {
                console.error(`ffmpeg 错误: ${message}`);
            }
            // 注释掉以屏蔽所有 ffmpeg stderr 输出
            // console.log(`ffmpeg stderr: ${data}`);
        });

        // 保存进程引用以便后续清理
        this.ffmpegProcess = ffmpegProcess;

        return ffmpegProcess.stdout;
    }

    // 开始语音识别和翻译
    startRecognition() {
        // 使用 Centrifugo 时不需要检查客户端数量
        if (this.isRecognizing) {
            return;
        }

        // 如果没有使用 Centrifugo 且没有客户端，不启动
        if (!this.useCentrifugo && this.clients.size === 0) {
            return;
        }

        this.isRecognizing = true;

        try {
            console.log(`使用密钥: ${this.keyName}, 区域: ${this.region}`);

            const pcmStream = this.streamToPcm(this.streamUrl);
            
            // 创建 PushAudioInputStream 用于推送音频数据
            const pushStream = sdk.AudioInputStream.createPushStream();
            const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
            
            // 创建翻译识别器
            this.translationRecognizer = new sdk.TranslationRecognizer(this.speechConfig, audioConfig);

            // 连接事件处理
            this.translationRecognizer.sessionStarted = (s, e) => {
                console.log(`✅ [SessionStarted] Azure 会话已启动, Session ID: ${e.sessionId}`);
            };
            this.translationRecognizer.recognizing = (s, e) => this.onRecognizing(e);
            this.translationRecognizer.recognized = (s, e) => this.onRecognized(e);
            this.translationRecognizer.sessionStopped = (s, e) => this.onStopped(e);
            this.translationRecognizer.canceled = (s, e) => this.onCanceled(e);

            // 开始连续识别
            this.translationRecognizer.startContinuousRecognitionAsync(() => {
                console.log(`开始连续识别和翻译... (密钥: ${this.keyName}, 区域: ${this.region})`);
                // 发送开始识别事件
                this.sendEvent('started', {
                    message: '开始语音识别和翻译',
                    keyName: this.keyName,
                    region: this.region,
                    timestamp: new Date().toISOString()
                });

                // 重置重试计数和密钥切换计数（识别成功启动后重置）
                this.currentRetries = 0;
                this.keySwitchAttempts = 0;
            }, async (err) => {
                console.error(`❌ 识别启动失败: ${err}`);

                // 检查是否是配额错误
                const isQuotaError = err && (err.includes("Quota exceeded") || err.includes("Authentication failed"));

                if (isQuotaError) {
                    console.warn(`⚠️ 检测到配额错误，密钥 ${this.keyName} (ID: ${this.keyId})`);
                    // 记录配额超限
                    if (this.keyManager && this.keyId) {
                        await this.keyManager.recordQuotaExceeded(this.keyId);
                    }
                } else {
                    console.warn(`⚠️ 检测到识别错误，密钥 ${this.keyName} (ID: ${this.keyId})`);
                }

                // 发送错误事件
                this.sendEvent('recognitionError', {
                    message: `识别启动失败: ${err}`,
                    keyId: this.keyId,
                    keyName: this.keyName,
                    region: this.region,
                    isQuotaError: isQuotaError,
                    timestamp: new Date().toISOString()
                });

                // 所有识别错误都尝试切换到下一个可用密钥
                console.log(`🔄 识别失败，尝试切换到下一个可用密钥...`);
                await this.switchToNextKey();
            });

            this.pcmStream = pcmStream;
            this.pushStream = pushStream;
            
            // 设置数据接收超时检测
            this.setupDataTimeoutCheck();
            
            // 设置最后接收数据的时间戳
            this.lastDataTimestamp = Date.now();
            
            // 添加数据处理的稳健性
            let audioDataCount = 0;
            let lastAudioLogTime = Date.now();
            pcmStream.on('data', (chunk) => {
                try {
                    // 使用 Centrifugo 时不需要检查客户端数量
                    // 只要识别正在进行就推送音频数据
                    if (this.isRecognizing && (this.useCentrifugo || this.clients.size > 0)) {
                        pushStream.write(chunk);
                        // 更新最后接收数据的时间戳
                        this.lastDataTimestamp = Date.now();
                        audioDataCount += chunk.length;

                        // 每5秒记录一次音频数据量
                        const now = Date.now();
                        if (now - lastAudioLogTime > 5000) {
                            console.log(`📊 音频数据流动: ${(audioDataCount / 1024).toFixed(1)} KB (最近5秒)`);
                            audioDataCount = 0;
                            lastAudioLogTime = now;
                        }
                    }
                } catch (err) {
                    console.error(`处理音频数据错误: ${err}`);
                    this.sendEvent('error', {
                        message: `处理音频数据错误: ${err}`,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            pcmStream.on('end', () => {
                console.log("音频流已结束");
                // 发送流结束事件
                this.sendEvent('streamEnded', {
                    message: '音频流已结束',
                    timestamp: new Date().toISOString()
                });
                this.handleReconnection("音频流已结束");
            });

            pcmStream.on('error', (err) => {
                console.error(`流处理错误: ${err}`);
                // 发送流错误事件
                this.sendEvent('streamError', {
                    message: `流处理错误: ${err}`,
                    timestamp: new Date().toISOString()
                });
                this.handleReconnection("流处理错误");
            });
            
            // 添加心跳检测，确保流仍然活跃
            this.startHeartbeat();
            
        } catch (e) {
            console.error(`流处理异常: ${e}`);
            this.sendEvent('error', {
                message: `流处理异常: ${e}`,
                timestamp: new Date().toISOString()
            });
            this.handleReconnection("流处理异常");
        }
    }
    
    // 设置数据接收超时检测
    setupDataTimeoutCheck() {
        // 清除之前的超时检测
        if (this.dataTimeoutCheck) {
            clearInterval(this.dataTimeoutCheck);
        }

        // 每30秒检查一次是否接收到数据（优化：减少检查频率）
        this.dataTimeoutCheck = setInterval(() => {
            if (this.isRecognizing && !this.reconnecting) {
                const now = Date.now();
                // 如果超过60秒没有收到数据，认为流已经断开（优化：增加超时时间）
                if (now - this.lastDataTimestamp > 60000) {
                    console.log("数据接收超时，准备重连...");
                    this.sendEvent('warning', {
                        message: '数据接收超时，准备重连...',
                        timestamp: new Date().toISOString()
                    });
                    this.handleReconnection("数据接收超时");
                }
            }
        }, 30000);
    }
    
    // 启动心跳检测
    startHeartbeat() {
        // 清除之前的心跳
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        // 每60秒发送一次心跳，保持连接活跃（优化：减少心跳频率）
        this.heartbeatInterval = setInterval(() => {
            // 使用 Centrifugo 时不需要检查客户端数量
            if (this.isRecognizing && (this.useCentrifugo || this.clients.size > 0)) {
                this.sendEvent('heartbeat', {
                    timestamp: new Date().toISOString()
                });
            }
        }, 60000);
    }
    
    // 处理重连
    handleReconnection(reason) {
        // 使用 Centrifugo 时不需要检查客户端数量
        if (this.reconnecting || (!this.useCentrifugo && this.clients.size === 0)) {
            return;
        }

        this.reconnecting = true;

        // 停止当前识别但不清除客户端
        this.stopRecognitionInternal();

        if (this.currentRetries < this.maxRetries) {
            this.currentRetries++;

            const delay = this.retryDelay * this.currentRetries;

            console.log(`准备重新连接 (${this.currentRetries}/${this.maxRetries})，原因: ${reason}，延迟: ${delay}ms`);

            this.sendEvent('reconnecting', {
                message: `准备重新连接 (${this.currentRetries}/${this.maxRetries})，${delay/1000}秒后重试...`,
                reason: reason,
                timestamp: new Date().toISOString()
            });

            setTimeout(() => {
                // 使用 Centrifugo 时不需要检查客户端数量
                if (this.useCentrifugo || this.clients.size > 0) {
                    console.log(`尝试重新连接 (${this.currentRetries}/${this.maxRetries})...`);
                    this.reconnecting = false;
                    this.startRecognition();
                } else {
                    console.log('没有客户端连接，取消重连');
                    this.reconnecting = false;
                }
            }, delay);
        } else {
            console.log(`重试次数已达上限 (${this.maxRetries})，停止重试`);
            this.sendEvent('reconnectFailed', {
                message: `重试次数已达上限 (${this.maxRetries})，停止重试`,
                timestamp: new Date().toISOString()
            });
            this.reconnecting = false;
            this.currentRetries = 0;
        }
    }
    
    // 仅停止识别，不清除客户端
    stopRecognitionInternal() {
        if (!this.isRecognizing) {
            return;
        }
        
        this.isRecognizing = false;
        
        if (this.translationRecognizer) {
            try {
                this.translationRecognizer.stopContinuousRecognitionAsync(() => {
                    console.log("语音识别和翻译已停止");
                }, (err) => {
                    console.error(`停止识别错误: ${err}`);
                });
            } catch (e) {
                console.error(`停止识别异常: ${e}`);
            }
        }
        
        if (this.pushStream) {
            try {
                this.pushStream.close();
            } catch (e) {
                console.error(`关闭推送流错误: ${e}`);
            }
        }
        
        if (this.pcmStream) {
            try {
                this.pcmStream.destroy();
            } catch (e) {
                console.error(`关闭PCM流错误: ${e}`);
            }
        }

        // 杀死 ffmpeg 进程
        if (this.ffmpegProcess) {
            try {
                console.log(`正在终止 ffmpeg 进程 (PID: ${this.ffmpegProcess.pid})...`);
                this.ffmpegProcess.kill('SIGKILL');
                this.ffmpegProcess = null;
            } catch (e) {
                console.error(`终止 ffmpeg 进程错误: ${e}`);
            }
        }

        // 清除定时器
        if (this.dataTimeoutCheck) {
            clearInterval(this.dataTimeoutCheck);
            this.dataTimeoutCheck = null;
        }
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        // 清除防抖定时器
        if (this.recognizingDebounceTimer) {
            clearTimeout(this.recognizingDebounceTimer);
            this.recognizingDebounceTimer = null;
        }
        this.pendingRecognizingEvent = null;
    }
    
    // 停止语音识别
    stopRecognition() {
        this.stopRecognitionInternal();
        
        // 发送停止事件
        this.sendEvent('stopped', {
            message: '语音识别和翻译已停止',
            fullText: this.continuousText,
            translations: this.translations,
            timestamp: new Date().toISOString()
        });
    }

    // 改进的 onRecognizing 方法，使用防抖处理
    // 注意：为提高性能，已禁用 recognizing 事件的发送，只发送 recognized 最终结果
    onRecognizing(evt) {
        // 如果未处于识别状态，忽略事件
        // 注意：使用 Centrifugo 时，clients.size 为 0 是正常的
        if (!this.isRecognizing) {
            return;
        }

        // 如果不使用 Centrifugo 且没有客户端，忽略事件
        if (!this.useCentrifugo && this.clients.size === 0) {
            return;
        }

        // 处理中间结果，动态更新单行字幕
        if (evt.result.text) {
            this.currentText = evt.result.text;

            // 获取翻译结果 - 动态获取所有目标语言的翻译
            const result = evt.result;
            let sourceText = result.text;

            // 如果源语言是粤语（zh-HK），将汉字转换为粤拼
            if (this.language === "zh-HK") {
                sourceText = ToJyutping.getJyutping(sourceText);
            }

            // 动态构建翻译对象
            const translations = {};
            if (result.translations) {
                this.targetLanguages.forEach(lang => {
                    translations[lang] = result.translations.get(lang) || null;
                });
            }

            this.currentSourceText = sourceText;
            this.currentTranslatedText = translations;

            // 获取时间信息 (offset 和 duration 单位是 100ns ticks)
            const offsetTicks = result.offset || 0;
            const durationTicks = result.duration || 0;

            // 转换为毫秒 (1 tick = 100ns = 0.0001ms)
            const offsetMs = offsetTicks / 10000;
            const durationMs = durationTicks / 10000;

            // console.log(`🎤 [Recognizing] ${sourceText} (offset: ${offsetMs}ms, duration: ${durationMs}ms)`);

            // ⚠️ 为提高性能，已禁用 recognizing 中间结果的发送
            // 只在 onRecognized 中发送最终识别结果
            /*
            this.sendEvent('recognizing', {
                text: this.currentSourceText,
                translations: this.currentTranslatedText,
                offset: offsetMs,          // 语音开始时间（毫秒）
                duration: durationMs,       // 语音持续时长（毫秒）
                timestamp: new Date().toISOString()
            });
            */
        }
    }

    onRecognized(evt) {
        // 如果未处于识别状态，忽略事件
        // 注意：使用 Centrifugo 时，clients.size 为 0 是正常的
        if (!this.isRecognizing) {
            return;
        }

        // 如果不使用 Centrifugo 且没有客户端，忽略事件
        if (!this.useCentrifugo && this.clients.size === 0) {
            return;
        }

        // 处理最终识别结果，追加到完整文本
        if (evt.result.text) {
            // 处理翻译结果 - 动态获取所有目标语言的翻译
            const result = evt.result;
            let sourceText = result.text;

            // 如果源语言是粤语（zh-HK），将汉字转换为粤拼
            if (this.language === "zh-HK") {
                sourceText = ToJyutping.getJyutping(sourceText);
            }

            // 动态构建翻译对象
            const translations = {};
            if (result.translations) {
                this.targetLanguages.forEach(lang => {
                    translations[lang] = result.translations.get(lang) || null;
                });
            }

            // 获取时间信息 (offset 和 duration 单位是 100ns ticks)
            const offsetTicks = result.offset;
            const durationTicks = result.duration;

            // 转换为毫秒 (1 tick = 100ns = 0.0001ms)
            const offsetMs = offsetTicks / 10000;
            const durationMs = durationTicks / 10000;

            // 内容去重：检查是否与上次识别的内容相同（包括所有翻译）
            const translationsStr = JSON.stringify(translations);
            if (this.lastRecognizedText === sourceText &&
                this.lastRecognizedTranslations === translationsStr) {
                console.log(`跳过重复的识别结果: ${sourceText}`);
                return;
            }

            // 保存最后识别的内容用于去重
            this.lastRecognizedText = sourceText;
            this.lastRecognizedTranslations = translationsStr;

            this.continuousText = "<div>" + evt.result.text + "</div>";
            this.currentText = "";  // 清空中间结果
            this.lastRecognizingText = ""; // 重置最后识别的文本，以便下一轮识别

            // 更新源语言和翻译文本
            this.sourceText += sourceText + "\n";
            // 只保存第一个翻译语言的文本（向后兼容）
            if (this.targetLanguages.length > 0) {
                const firstTargetLang = this.targetLanguages[0];
                this.translatedText += (translations[firstTargetLang] || "") + "\n";
            }

            // 存储识别到的文本段落（包含时间戳信息）
            const textSegment = {
                id: this.generateEventId(),
                text: sourceText,
                translations: translations,
                offset: offsetMs,
                duration: durationMs,
                timestamp: new Date().toISOString()
            };

            // 添加到已识别段落列表
            this.recognizedTextSegments.push(textSegment);

            // 如果超过最大数量，移除最早的段落
            if (this.recognizedTextSegments.length > this.maxTextSegments) {
                this.recognizedTextSegments.shift();
            }

            // console.log(`✅ [Recognized] ${sourceText} -> ${JSON.stringify(translations)} (offset: ${offsetMs}ms, duration: ${durationMs}ms)`);

            // 发送最终识别结果事件（包含时间戳信息）
            this.sendEvent('recognized', {
                text: sourceText,
                translations: translations,
                offset: offsetMs,          // 语音开始时间（毫秒）
                duration: durationMs,       // 语音持续时长（毫秒）
                timestamp: new Date().toISOString()
            });
        }
    }

    onStopped(evt) {
        // Recognition session stopped
        console.log("\n识别会话已停止");
        this.isRecognizing = false;
        
        // If clients are still connected, attempt reconnection
        if (this.clients.size > 0 && !this.reconnecting) {
            console.log("会话停止但客户端仍连接，尝试重新连接...");
            this.handleReconnection('会话意外停止');
        } else if (!this.reconnecting) {
            // Send stopped event only if not reconnecting
            this.sendEvent('stopped', {
                message: '识别会话已停止',
                fullText: this.continuousText,
                translations: this.translations,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    async onCanceled(evt) {
        console.log(`❌ 识别已取消，原因: ${evt.errorDetails}`);

        // 如果正在重连，跳过处理
        if (this.reconnecting) {
            return;
        }

        // 检查是否是配额错误
        const isQuotaError = evt.errorDetails && (evt.errorDetails.includes("Quota exceeded") || evt.errorDetails.includes("Authentication failed"));

        if (isQuotaError) {
            console.warn(`⚠️ 识别取消 - 检测到配额错误，密钥 ${this.keyName} (ID: ${this.keyId})`);
            // 记录配额超限
            if (this.keyManager && this.keyId) {
                await this.keyManager.recordQuotaExceeded(this.keyId);
            }
        } else {
            console.warn(`⚠️ 识别取消 - 检测到错误，密钥 ${this.keyName} (ID: ${this.keyId})`);
        }

        // 发送错误事件
        this.sendEvent('recognitionCanceled', {
            message: `识别已取消: ${evt.errorDetails}`,
            keyId: this.keyId,
            keyName: this.keyName,
            region: this.region,
            isQuotaError: isQuotaError,
            errorDetails: evt.errorDetails,
            timestamp: new Date().toISOString()
        });

        // 所有取消事件都尝试切换到下一个可用密钥
        console.log(`🔄 识别被取消，尝试切换到下一个可用密钥...`);
        await this.switchToNextKey();
    }

    // 切换到下一个可用密钥并重启识别
    async switchToNextKey() {
        try {
            // 初始化密钥切换尝试计数器
            if (!this.keySwitchAttempts) {
                this.keySwitchAttempts = 0;
            }

            // 最多尝试切换5次密钥
            const MAX_KEY_SWITCH_ATTEMPTS = 5;
            if (this.keySwitchAttempts >= MAX_KEY_SWITCH_ATTEMPTS) {
                console.error(`❌ 已达到最大密钥切换次数 (${MAX_KEY_SWITCH_ATTEMPTS})，停止尝试`);
                this.sendEvent('allKeysFailed', {
                    message: `所有密钥都失败了，已尝试 ${this.keySwitchAttempts} 次`,
                    stationCode: this.stationCode,
                    timestamp: new Date().toISOString()
                });
                this.isRecognizing = false;
                this.keySwitchAttempts = 0; // 重置计数器
                return;
            }

            this.keySwitchAttempts++;
            console.log(`🔄 密钥切换尝试 ${this.keySwitchAttempts}/${MAX_KEY_SWITCH_ATTEMPTS}`);

            // 停止当前识别
            this.stopRecognitionInternal();

            // 记录旧密钥信息
            const oldKeyId = this.keyId;
            const oldKeyName = this.keyName;

            // 释放当前密钥
            if (this.keyManager && this.stationCode && this.keyId) {
                await this.keyManager.releaseKey(this.stationCode);
                console.log(`   🔓 已释放旧密钥: ${oldKeyName}`);
            }

            // 分配新密钥
            if (this.keyManager && this.stationCode) {
                const newKeyInfo = await this.keyManager.allocateKey(this.stationCode);

                // 更新实例的密钥信息
                this.speechKey = newKeyInfo.subscriptionKey;
                this.region = newKeyInfo.region;
                this.keyId = newKeyInfo.id;
                this.keyName = newKeyInfo.keyName;

                // 重新创建 SpeechConfig（使用保存的语言配置）
                this.speechConfig = sdk.SpeechTranslationConfig.fromSubscription(
                    this.speechKey,
                    this.region
                );
                this.speechConfig.speechRecognitionLanguage = this.language;
                this.targetLanguages.forEach(lang => {
                    this.speechConfig.addTargetLanguage(lang);
                });
                this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, "Semantic");

                console.log(`✅ 已切换到新密钥: ${this.keyName} (${this.region})`);

                // 发送密钥切换事件
                this.sendEvent('keySwitched', {
                    message: `已切换到新密钥: ${this.keyName}`,
                    oldKeyId: oldKeyId,
                    oldKeyName: oldKeyName,
                    newKeyId: newKeyInfo.id,
                    newKeyName: newKeyInfo.keyName,
                    newRegion: newKeyInfo.region,
                    attemptNumber: this.keySwitchAttempts,
                    timestamp: new Date().toISOString()
                });

                // 延迟2秒后重启识别
                setTimeout(() => {
                    if (this.useCentrifugo || this.clients.size > 0) {
                        console.log(`🔄 使用新密钥重启识别...`);
                        this.startRecognition();
                    } else {
                        console.log(`⚠️ 没有客户端连接，跳过重启识别`);
                        this.isRecognizing = false;
                    }
                }, 2000);
            }
        } catch (error) {
            console.error(`❌ 切换密钥失败: ${error.message}`);

            // 发送密钥切换失败事件
            this.sendEvent('keySwitchFailed', {
                message: `切换密钥失败: ${error.message}`,
                error: error.message,
                attemptNumber: this.keySwitchAttempts,
                timestamp: new Date().toISOString()
            });

            // 如果切换失败，重置状态并等待
            this.isRecognizing = false;
            this.keySwitchAttempts = 0;
        }
    }

    close() {
        this.stopRecognition();
        this.endTag = true;
        console.log("连接已关闭");

        // 发送关闭连接事件
        this.sendEvent('closed', {
            message: '服务已关闭',
            timestamp: new Date().toISOString()
        });
    }
}

// 电台实例管理器
class RadioStationManager {
    constructor(database, keyManager) {
        // 存储所有电台实例，key 为 station_code
        this.stations = new Map();

        // 数据库实例
        this.db = database;

        // Azure 密钥管理器
        this.keyManager = keyManager;

        // 电台列表缓存
        this.radioList = [];
    }

    // 从数据库加载电台列表
    async loadRadioList() {
        try {
            const radios = await this.db.getAllRadios(true);
            this.radioList = radios.map(radio => ({
                id: radio.station_code,
                name: radio.station_name,
                subtitle: radio.station_subtitle,
                url: radio.stream_url,
                language: radio.language,
                targetLanguage: radio.target_language
            }));
            console.log(`📻 已从数据库加载 ${this.radioList.length} 个电台`);
            return this.radioList;
        } catch (error) {
            console.error('加载电台列表失败:', error.message);
            return [];
        }
    }

    // 获取或创建电台实例
    async getOrCreateStation(stationCode, streamUrl, language = "en-US", targetLanguages = ["zh-CN", "ja-JP"]) {
        if (!stationCode) {
            throw new Error('stationCode 不能为空');
        }
        if (!streamUrl) {
            throw new Error('streamUrl 不能为空');
        }

        // 使用 station_code 作为 key，如果实例已存在，直接返回
        if (this.stations.has(stationCode)) {
            const station = this.stations.get(stationCode);
            console.log(`复用现有电台实例: ${stationCode}, 当前客户端数: ${station.clients.size}`);

            // 如果 stream_url 发生变化，更新实例的 streamUrl
            if (station.streamUrl !== streamUrl) {
                console.log(`检测到电台 ${stationCode} 的 stream_url 已变化，将在下次重启时生效`);
                // 注意：不立即更新，避免影响现有连接
            }

            // 更新数据库连接数
            await this.db.incrementClientCount(stationCode);

            return station;
        }

        // 创建新实例 - 需要分配 Azure 密钥
        console.log(`创建新电台实例: ${stationCode}, stream_url: ${streamUrl}, language: ${language}, targetLanguages: ${targetLanguages}`);

        // 从 AzureKeyManager 分配密钥
        const keyInfo = await this.keyManager.allocateKey(stationCode);

        // 使用分配的密钥创建实例（传递语言配置）
        const station = new AzureTranslationClient(keyInfo.subscriptionKey, keyInfo.region, streamUrl, language, targetLanguages);
        station.stationCode = stationCode; // 保存 station_code 到实例
        station.keyId = keyInfo.id; // 保存密钥ID
        station.keyName = keyInfo.keyName; // 保存密钥名称
        station.keyManager = this.keyManager; // 保存密钥管理器引用
        this.stations.set(stationCode, station);

        // 更新数据库状态
        await this.db.incrementClientCount(stationCode);
        await this.db.setRecognitionStatus(stationCode, true);

        return station;
    }

    // 检查是否需要清理空闲的电台实例
    async cleanupStation(stationCode) {
        if (this.stations.has(stationCode)) {
            const station = this.stations.get(stationCode);

            // 减少数据库中的连接数
            await this.db.decrementClientCount(stationCode);

            // 如果没有客户端连接了，关闭并删除实例
            if (station.clients.size === 0) {
                console.log(`电台实例无客户端连接，清理资源: ${stationCode}`);
                station.close();
                this.stations.delete(stationCode);

                // 释放 Azure 密钥
                await this.keyManager.releaseKey(stationCode);

                // 更新数据库状态
                await this.db.updateStationStatus(stationCode, 0, false);
            }
        }
    }

    // 获取所有活跃的电台信息
    getActiveStations() {
        const active = [];
        for (const [stationCode, station] of this.stations.entries()) {
            // 使用 Centrifugo 时，从 channelConnections 获取客户端数
            let clientCount = 0;
            if (this.channelConnections) {
                const channel = `station:${stationCode}`;
                const connections = this.channelConnections.get(channel);
                clientCount = connections ? connections.size : 0;
            } else {
                // 回退到 station.clients（兼容非 Centrifugo 模式）
                clientCount = station.clients ? station.clients.size : 0;
            }

            active.push({
                stationCode: stationCode,
                streamUrl: station.streamUrl,
                clients: clientCount,
                isRecognizing: station.isRecognizing
            });
        }
        return active;
    }

    // 获取预定义电台列表
    getRadioList() {
        return this.radioList;
    }
}

// 创建SSE服务
function createSseServer(stationManager, port = 3000) {
    const app = express();

    // 启用CORS
    app.use(cors());

    // 解析 JSON 请求体
    app.use(express.json());

    // SSE端点 - 返回 Centrifugo 连接信息
    app.get('/events', async (req, res) => {
        // 获取电台代码（从查询参数）
        const stationCode = req.query.station_code;

        if (!stationCode) {
            res.status(400).json({
                error: '缺少 station_code 参数',
                message: '请在 URL 中添加 ?station_code=<电台代码> 参数',
                example: '/events?station_code=msnbc'
            });
            return;
        }

        try {
            // 从数据库查询电台信息
            const radioInfo = await stationManager.db.getRadioByCode(stationCode);

            if (!radioInfo) {
                res.status(404).json({
                    error: '电台不存在',
                    message: `未找到电台代码: ${stationCode}`
                });
                return;
            }

            // 检查电台是否有 stream_url
            if (!radioInfo.stream_url) {
                res.status(400).json({
                    error: '电台流地址未配置',
                    message: `电台 ${stationCode} 没有配置 stream_url`
                });
                return;
            }

            const streamUrl = radioInfo.stream_url;

            // 注意：不再在这里启动识别，改为等待客户端订阅时通过 Webhook 启动
            // 这样可以节省 Azure 费用 - 只在有用户连接时才启动识别

            // 生成 Centrifugo 连接令牌（用于 WebSocket bidirectional）
            // 最简单的token - 依靠 Centrifugo insecure 模式允许所有订阅
            const centrifugoSecret = 'my-secret-key-change-this';
            const connectionToken = jwt.sign({
                sub: 'radio-client',  // 用户ID
                exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)  // 7天过期
            }, centrifugoSecret);

            // 返回 Centrifugo 连接信息（使用 WebSocket bidirectional）
            res.json({
                success: true,
                message: '请使用 Centrifugo WebSocket 连接（推荐）',
                centrifugo: {
                    // WebSocket 连接 URL - 推荐使用
                    ws_url: `wss://radio.xingke888.com/centrifugo/connection/websocket`,
                    // 频道名称
                    channel: `station:${stationCode}`,
                    // 连接令牌（包含频道权限）
                    token: connectionToken,
                    // 电台信息
                    station: {
                        code: stationCode,
                        name: radioInfo.station_name,
                        subtitle: radioInfo.station_subtitle
                    }
                },
                // 使用说明
                instructions: {
                    description: '使用 WebSocket bidirectional 连接到实时字幕流',
                    step1: '连接 WebSocket 并发送 connect 命令',
                    step2: '收到连接确认后，发送 subscribe 命令订阅频道',
                    step3: '监听 push 消息接收实时事件',
                    example: `
// 完整示例代码（Centrifugo v6 WebSocket bidirectional）
const ws = new WebSocket("wss://radio.xingke888.com/centrifugo/connection/websocket");
let client_id = null;

ws.onopen = () => {
  // 1. 发送连接命令（insecure 模式不需要 token）
  ws.send(JSON.stringify({
    id: 1,
    connect: {}
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  // ⚠️ 重要：处理 Centrifugo ping（空消息），必须响应 pong
  if (Object.keys(msg).length === 0) {
    ws.send(JSON.stringify({}));  // 发送空对象作为 pong
    return;
  }

  // 2. 处理连接响应
  if (msg.connect) {
    client_id = msg.connect.client;
    console.log('✅ 连接成功, client_id:', client_id);

    // 3. 连接成功后订阅频道
    ws.send(JSON.stringify({
      id: 2,
      subscribe: {
        channel: "station:${stationCode}"
      }
    }));
  }

  // 4. 处理订阅响应
  if (msg.subscribe) {
    console.log('✅ 订阅成功');
  }

  // 5. 处理实时数据推送
  if (msg.push && msg.push.pub && msg.push.pub.data) {
    const data = msg.push.pub.data;
    if (data.event === 'recognized') {
      console.log('英文:', data.text);
      console.log('中文:', data.translations);
    }
  }
};`
                }
            });

        } catch (error) {
            console.error(`获取电台信息失败: ${error.message}`);
            res.status(500).json({
                error: '获取电台信息失败',
                message: error.message
            });
        }
    });

    // Centrifugo 订阅 Webhook - 客户端订阅频道时触发
    app.post('/centrifugo/subscribe', async (req, res) => {
        const { channel, client } = req.body;
        const timestamp = new Date().toISOString();
        const clientShort = client.substring(0, 8); // 显示前8位便于识别

        // 立即输出连接日志
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🟢🟢🟢 [${timestamp}] 客户端连接`);
        console.log(`   📱 Client ID: ${client}`);
        console.log(`   📡 Channel: ${channel}`);

        try {
            // 解析频道名称，获取电台代码
            const stationCode = channel.replace('station:', '');

            // 初始化频道连接跟踪
            if (!stationManager.channelConnections) {
                stationManager.channelConnections = new Map();
            }

            if (!stationManager.channelConnections.has(channel)) {
                stationManager.channelConnections.set(channel, new Set());
            }

            const connections = stationManager.channelConnections.get(channel);
            const wasEmpty = connections.size === 0;

            // 添加客户端
            connections.add(client);

            console.log(`   ✅ 添加成功 - 当前频道连接数: ${connections.size}`);

            // 如果这是第一个连接，启动语音识别
            if (wasEmpty && connections.size === 1) {
                console.log(`   🚀 这是首个连接，准备启动语音识别...`);

                // 从数据库获取电台信息
                const radioInfo = await stationManager.db.getRadioByCode(stationCode);

                if (radioInfo && radioInfo.stream_url) {
                    // 解析目标语言（支持逗号分隔的多语言）
                    const targetLanguages = radioInfo.target_language
                        ? radioInfo.target_language.split(',').map(lang => lang.trim())
                        : ["zh-CN", "ja-JP"];

                    // 获取或创建电台实例（传递语言配置）
                    const station = await stationManager.getOrCreateStation(
                        stationCode,
                        radioInfo.stream_url,
                        radioInfo.language || "en-US",
                        targetLanguages
                    );

                    // 启动识别
                    if (!station.isRecognizing) {
                        station.startRecognition();
                        console.log(`   ✅ 语音识别已启动\n`);
                    } else {
                        console.log(`   ⚠️ 语音识别已在运行\n`);
                    }
                } else {
                    console.error(`   ❌ 电台信息不存在或缺少stream_url`);
                }
            } else {
                console.log(`   ℹ️  语音识别已运行中，无需重新启动`);
            }

            console.log(`${'='.repeat(70)}\n`);

            // 返回成功响应（允许订阅）
            res.json({ result: {} });

        } catch (error) {
            console.error(`\n❌ [${timestamp}] 处理订阅事件失败`);
            console.error(`   错误: ${error.message}\n`);
            res.status(500).json({ error: { code: 500, message: error.message } });
        }
    });

    // Centrifugo 取消订阅 Webhook - 客户端断开或取消订阅时触发
    app.post('/centrifugo/unsubscribe', async (req, res) => {
        const { channel, client } = req.body;
        const timestamp = new Date().toISOString();

        // 立即输出断开日志
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🔴🔴🔴 [${timestamp}] 客户端断开连接`);
        console.log(`   📱 Client ID: ${client}`);
        console.log(`   📡 Channel: ${channel}`);

        try {
            if (!stationManager.channelConnections || !stationManager.channelConnections.has(channel)) {
                console.log(`   ⚠️ 频道连接跟踪不存在\n`);
                return res.json({ result: {} });
            }

            const connections = stationManager.channelConnections.get(channel);
            connections.delete(client);

            console.log(`   ✅ 移除成功 - 当前频道剩余连接数: ${connections.size}`);

            // 如果没有连接了，停止语音识别
            if (connections.size === 0) {
                const stationCode = channel.replace('station:', '');
                console.log(`   🛑 无客户端连接，准备停止语音识别...`);

                if (stationManager.stations.has(stationCode)) {
                    const station = stationManager.stations.get(stationCode);

                    // 停止识别
                    if (station.isRecognizing) {
                        station.stopRecognition();
                        console.log(`   ✅ 语音识别已停止`);
                    }

                    // 清理资源
                    station.close();
                    stationManager.stations.delete(stationCode);

                    // 释放 Azure 密钥
                    if (station.keyManager && station.keyId) {
                        await station.keyManager.releaseKey(stationCode);
                        console.log(`   🔑 Azure 密钥已释放`);
                    }

                    // 更新数据库状态
                    await stationManager.db.updateStationStatus(stationCode, 0, false);

                    console.log(`   ✅ 所有资源已清理完成`);
                }

                // 清理频道连接跟踪
                stationManager.channelConnections.delete(channel);
            } else {
                console.log(`   ℹ️  还有其他客户端在线，继续识别`);
            }

            console.log(`${'='.repeat(70)}\n`);

            // 返回成功响应
            res.json({ result: {} });

        } catch (error) {
            console.error(`\n❌ [${timestamp}] 处理取消订阅事件失败`);
            console.error(`   错误: ${error.message}\n`);
            res.status(500).json({ error: { code: 500, message: error.message } });
        }
    });

    // Centrifugo 断开连接 Webhook - 客户端断开连接时触发（适用于 Centrifugo v5+）
    app.post('/centrifugo/disconnect', async (req, res) => {
        const { client, channels } = req.body;
        const timestamp = new Date().toISOString();

        // 立即输出断开日志
        console.log(`\n${'='.repeat(70)}`);
        console.log(`🔴🔴🔴 [${timestamp}] 客户端断开连接 (disconnect event)`);
        console.log(`   📱 Client ID: ${client}`);
        console.log(`   📡 Channels: ${JSON.stringify(channels)}`);

        try {
            // 处理客户端订阅的所有频道
            if (channels && channels.length > 0) {
                for (const channel of channels) {
                    if (!stationManager.channelConnections || !stationManager.channelConnections.has(channel)) {
                        console.log(`   ⚠️ 频道 ${channel} 连接跟踪不存在`);
                        continue;
                    }

                    const connections = stationManager.channelConnections.get(channel);
                    connections.delete(client);

                    console.log(`   ✅ 从频道 ${channel} 移除 - 剩余连接数: ${connections.size}`);

                    // 如果没有连接了，停止语音识别
                    if (connections.size === 0) {
                        const stationCode = channel.replace('station:', '');
                        console.log(`   🛑 频道 ${channel} 无客户端，准备停止语音识别...`);

                        if (stationManager.stations.has(stationCode)) {
                            const station = stationManager.stations.get(stationCode);

                            // 停止识别
                            if (station.isRecognizing) {
                                station.stopRecognition();
                                console.log(`   ✅ 语音识别已停止`);
                            }

                            // 清理资源
                            station.close();
                            stationManager.stations.delete(stationCode);

                            // 释放 Azure 密钥
                            if (station.keyManager && station.keyId) {
                                await station.keyManager.releaseKey(stationCode);
                                console.log(`   🔑 Azure 密钥已释放`);
                            }

                            // 更新数据库状态
                            await stationManager.db.updateStationStatus(stationCode, 0, false);

                            console.log(`   ✅ 频道 ${channel} 资源已清理完成`);
                        }

                        // 清理频道连接跟踪
                        stationManager.channelConnections.delete(channel);
                    }
                }
            }

            console.log(`${'='.repeat(70)}\n`);

            // 返回成功响应
            res.json({ result: {} });

        } catch (error) {
            console.error(`\n❌ [${timestamp}] 处理断开连接事件失败`);
            console.error(`   错误: ${error.message}\n`);
            res.status(500).json({ error: { code: 500, message: error.message } });
        }
    });

    // 获取预定义电台列表
    app.get('/api/radios', async (req, res) => {
        try {
            // 重新从数据库加载最新列表
            await stationManager.loadRadioList();

            res.json({
                success: true,
                radios: stationManager.getRadioList()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取当前活跃的电台实例（内存中的运行状态）
    app.get('/api/stations', (req, res) => {
        res.json({
            success: true,
            stations: stationManager.getActiveStations(),
            totalStations: stationManager.stations.size
        });
    });

    // 获取数据库中的电台状态
    app.get('/api/radios/status', async (req, res) => {
        try {
            const radios = await stationManager.db.getAllRadios(true);
            const statistics = await stationManager.db.getStatistics();

            res.json({
                success: true,
                radios: radios,
                statistics: statistics
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 客户端心跳 API - 官方推荐的断线检测方案
    // 参考：https://centrifugal.dev/docs/server/proxy#why-centrifugo-does-not-have-disconnect-hooks
    app.post('/api/client/heartbeat', (req, res) => {
        const { client_id, channel } = req.body;

        if (!client_id || !channel) {
            return res.status(400).json({
                success: false,
                error: 'client_id and channel are required'
            });
        }

        const timestamp = Date.now();

        // 更新客户端最后活跃时间
        const connections = stationManager.channelConnections.get(channel);
        if (connections && connections.has(client_id)) {
            // 存储心跳时间戳到 Map（以 clientId 为键）
            if (!stationManager.clientHeartbeats) {
                stationManager.clientHeartbeats = new Map();
            }
            stationManager.clientHeartbeats.set(`${channel}:${client_id}`, timestamp);

            res.json({
                success: true,
                timestamp: timestamp,
                message: 'Heartbeat received'
            });
        } else {
            // 客户端不在连接列表中
            res.status(404).json({
                success: false,
                error: 'Client not found in channel',
                reconnect: true  // 提示客户端重新连接
            });
        }
    });

    // 添加新电台
    app.post('/api/radios', async (req, res) => {
        try {
            const { station_code, station_name, station_subtitle, stream_url, language, target_language } = req.body;

            if (!station_code || !station_name || !stream_url) {
                return res.status(400).json({
                    success: false,
                    error: '缺少必填字段：station_code, station_name, stream_url'
                });
            }

            const radioId = await stationManager.db.addRadio({
                station_code,
                station_name,
                station_subtitle,
                stream_url,
                language,
                target_language
            });

            // 重新加载电台列表
            await stationManager.loadRadioList();

            res.json({
                success: true,
                message: '电台添加成功',
                radioId: radioId
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 更新电台信息
    app.put('/api/radios/:stationCode', async (req, res) => {
        try {
            const { stationCode } = req.params;
            const updates = req.body;

            const affectedRows = await stationManager.db.updateRadio(stationCode, updates);

            if (affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: '电台不存在或未更新'
                });
            }

            // 重新加载电台列表
            await stationManager.loadRadioList();

            res.json({
                success: true,
                message: '电台更新成功',
                affectedRows: affectedRows
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 删除电台（软删除）
    app.delete('/api/radios/:stationCode', async (req, res) => {
        try {
            const { stationCode } = req.params;

            const affectedRows = await stationManager.db.deleteRadio(stationCode);

            if (affectedRows === 0) {
                return res.status(404).json({
                    success: false,
                    error: '电台不存在'
                });
            }

            // 重新加载电台列表
            await stationManager.loadRadioList();

            res.json({
                success: true,
                message: '电台删除成功',
                affectedRows: affectedRows
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取统计信息
    app.get('/api/statistics', async (req, res) => {
        try {
            const statistics = await stationManager.db.getStatistics();
            const activeStations = stationManager.getActiveStations();

            res.json({
                success: true,
                database: statistics,
                runtime: {
                    activeInstances: stationManager.stations.size,
                    stations: activeStations
                }
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 获取 Azure 密钥使用统计
    app.get('/api/keys', async (req, res) => {
        try {
            const keyStats = await stationManager.keyManager.getKeyStatistics();

            res.json({
                success: true,
                keys: keyStats
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // 启动服务器
    app.listen(port, () => {
        console.log(`\n✅ SSE服务器已启动，监听端口 ${port}`);
        console.log(`\n📡 API 端点:`);
        console.log(`  连接电台: GET /events?station_code=<电台代码>`);
        console.log(`  示例: GET /events?station_code=msnbc`);
        console.log(`  电台列表: GET /api/radios`);
        console.log(`  活跃实例: GET /api/stations`);
        console.log(`  密钥统计: GET /api/keys`);
        console.log(`  综合统计: GET /api/statistics\n`);
    });

    // 定期清理过期连接 - 使用 Centrifugo API 检测实际在线客户端
    // Centrifugo 的 ping_interval=25s + pong_timeout=10s = 35秒会断开死连接
    // 我们每40秒检查一次，确保有足够时间让 Centrifugo 清理死连接
    const CLEANUP_INTERVAL = 40000;  // 40 秒检查一次

    setInterval(async () => {
        if (!stationManager.channelConnections) {
            return;
        }

        // 遍历所有已跟踪的频道
        for (const [channel, connections] of stationManager.channelConnections.entries()) {
            if (connections.size === 0) continue;

            try {
                // 调用 Centrifugo API 查询频道信息
                const response = await axios.post('http://localhost:8000/api/channels', {
                    pattern: channel  // 查询特定频道
                }, {
                    headers: {
                        'Authorization': `apikey radio-api-key-2025`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                });

                // 获取 Centrifugo 报告的实际订阅者数量
                let actualNumSubscribers = 0;
                if (response.data && response.data.result && response.data.result.channels) {
                    // channels 是一个对象，不是数组
                    const channelInfo = response.data.result.channels[channel];
                    if (channelInfo) {
                        actualNumSubscribers = channelInfo.num_clients || 0;
                    }
                }

                // 如果我们记录的数量与实际数量不一致，进行同步
                const ourCount = connections.size;
                if (ourCount !== actualNumSubscribers) {
                    console.log(`\n🔄 检测到连接数不一致 (频道: ${channel})`);
                    console.log(`   📊 我们的记录: ${ourCount} 个客户端`);
                    console.log(`   📊 Centrifugo 实际: ${actualNumSubscribers} 个客户端`);

                    // 如果 Centrifugo 显示0个客户端，清空我们的记录
                    if (actualNumSubscribers === 0 && ourCount > 0) {
                        console.log(`   🧹 清空所有已断开的客户端连接`);
                        connections.clear();
                        console.log(`   ✅ 清理完成 - 当前频道剩余连接数: 0`);

                        // 停止识别并清理资源
                        const stationCode = channel.replace('station:', '');
                        console.log(`   🛑 频道无客户端，准备停止语音识别...`);

                        const station = stationManager.stations.get(stationCode);
                        if (station && station.isRecognizing) {
                            station.stopRecognition();
                            console.log(`   ✅ 语音识别已停止`);

                            // 释放密钥
                            if (station.keyManager && station.keyId) {
                                await station.keyManager.releaseKey(stationCode);
                                console.log(`   🔑 Azure 密钥已释放`);
                            }

                            // 删除电台实例
                            stationManager.stations.delete(stationCode);
                            console.log(`   ✅ 所有资源已清理完成`);
                        }

                        // 清理频道跟踪
                        stationManager.channelConnections.delete(channel);
                    }
                    // 注意：如果实际数量大于0但小于我们的记录，暂不处理
                    // 因为我们无法确定哪些客户端已断开（需要 presence API）
                }

            } catch (error) {
                // 如果 Centrifugo API 调用失败，不做处理（保持原有连接状态）
                if (error.code !== 'ECONNREFUSED') {
                    console.error(`⚠️ 查询频道 ${channel} presence 失败: ${error.message}`);
                }
            }
        }
    }, CLEANUP_INTERVAL);

    // 备用方案：基于心跳的清理（如果客户端实现了心跳）
    const HEARTBEAT_TIMEOUT = 60000; // 60 秒

    setInterval(() => {
        if (!stationManager.clientHeartbeats || !stationManager.channelConnections) {
            return;
        }

        const now = Date.now();
        const expiredClients = [];

        // 检查所有心跳记录
        for (const [key, lastHeartbeat] of stationManager.clientHeartbeats.entries()) {
            if (now - lastHeartbeat > HEARTBEAT_TIMEOUT) {
                expiredClients.push(key);
            }
        }

        // 清理过期连接
        for (const key of expiredClients) {
            // key 格式: "station:msnbc:client-id"
            // 需要分离出 channel (station:msnbc) 和 clientId
            const lastColonIndex = key.lastIndexOf(':');
            const channel = key.substring(0, lastColonIndex);  // "station:msnbc"
            const clientId = key.substring(lastColonIndex + 1);  // "client-id"
            const connections = stationManager.channelConnections.get(channel);

            if (connections && connections.has(clientId)) {
                const timestamp = new Date().toISOString();
                const lastHeartbeat = stationManager.clientHeartbeats.get(key);

                console.log(`\n${'='.repeat(70)}`);
                console.log(`⏱️⏱️⏱️ [${timestamp}] 检测到客户端超时断开`);
                console.log(`   📱 Client ID: ${clientId}`);
                console.log(`   📡 Channel: ${channel}`);
                console.log(`   ⏰ 最后心跳: ${new Date(lastHeartbeat).toISOString()}`);
                console.log(`   ⏳ 超时时长: ${Math.floor((now - lastHeartbeat) / 1000)} 秒`);

                // 移除客户端
                connections.delete(clientId);
                console.log(`   ✅ 已移除 - 当前频道剩余连接数: ${connections.size}`);

                // 如果没有客户端了，停止识别
                if (connections.size === 0) {
                    console.log(`   🛑 无客户端连接，准备停止语音识别...`);

                    // channel 格式: "station:msnbc" -> stationCode: "msnbc"
                    const stationCode = channel.replace('station:', '');
                    const station = stationManager.stations.get(stationCode);

                    if (station) {
                        station.stopRecognition();
                        console.log(`   ✅ 语音识别已停止`);

                        // 释放密钥
                        if (station.keyManager && station.keyId) {
                            station.keyManager.releaseKey(stationCode).then(() => {
                                console.log(`   🔑 Azure 密钥已释放`);
                            }).catch(err => {
                                console.error(`   ❌ 释放密钥失败: ${err.message}`);
                            });
                        }

                        // 删除电台实例
                        stationManager.stations.delete(stationCode);
                        console.log(`   ✅ 所有资源已清理完成`);
                    } else {
                        console.log(`   ⚠️  电台实例不存在，可能已被清理`);
                    }
                } else {
                    console.log(`   ℹ️  还有 ${connections.size} 个客户端在线，继续识别`);
                }

                console.log(`${'='.repeat(70)}\n`);
            }

            // 删除心跳记录
            stationManager.clientHeartbeats.delete(key);
        }

        if (expiredClients.length > 0) {
            console.log(`🧹 清理完成: 共移除 ${expiredClients.length} 个过期连接`);
        }
    }, CLEANUP_INTERVAL);
}

// 主函数
async function main() {
    const serverPort = 8533;           // SSE服务器端口

    console.log('🚀 多电台实例管理系统启动中...');

    // 初始化数据库
    const db = new RadioDatabase({
        host: 'localhost',
        port: 8510,
        user: 'root',
        password: 'Uu8297636',
        database: 'radio'
    });

    try {
        await db.init();

        // 初始化 Azure 密钥管理器
        const keyManager = new AzureKeyManager(db);
        console.log('🔑 Azure 密钥管理器已初始化');

        // 重置所有电台状态（服务器启动时）
        await db.resetAllStationStatus();

        // 重置所有密钥的使用计数
        await keyManager.resetAllUsageCounts();

        // 显示可用的密钥信息
        const keyStats = await keyManager.getKeyStatistics();
        console.log(`📊 可用 Azure 密钥: ${keyStats.filter(k => k.is_active).length} 个`);
        keyStats.filter(k => k.is_active).forEach(key => {
            console.log(`   - ${key.key_name} (${key.region}): 最大并发 ${key.max_concurrent_stations}`);
        });

        // 创建电台管理器
        const stationManager = new RadioStationManager(db, keyManager);

        // 从数据库加载电台列表
        await stationManager.loadRadioList();

        // 创建并启动SSE服务器
        createSseServer(stationManager, serverPort);

        // 启动全局监控，显示所有电台的连接状态
        setInterval(() => {
            const stations = stationManager.getActiveStations();
            if (stations.length > 0) {
                const timestamp = new Date().toISOString();
                console.log(`[${timestamp}] 活跃电台数: ${stations.length}`);
                stations.forEach((station, index) => {
                    console.log(`  电台 ${index + 1}: ${station.stationCode} (${station.streamUrl.substring(0, 40)}...) | 客户端数: ${station.clients} | 识别中: ${station.isRecognizing}`);
                });
            }
        }, 15000); // 每15秒打印一次

        // 处理程序退出
        process.on('SIGINT', async () => {
            console.log('\n接收到退出信号，正在关闭所有电台实例...');

            // 关闭所有电台实例
            for (const [stationCode, station] of stationManager.stations.entries()) {
                console.log(`关闭电台: ${stationCode}`);
                station.close();
            }

            // 重置数据库状态
            await db.resetAllStationStatus();

            // 关闭数据库连接
            await db.close();

            // 给一些时间让事件发送到客户端
            setTimeout(() => {
                console.log('所有电台已关闭，程序退出');
                process.exit(0);
            }, 1000);
        });

    } catch (error) {
        console.error('启动失败:', error.message);
        process.exit(1);
    }
}

// 执行主程序
main().catch(err => {
    console.error(`程序执行错误: ${err}`);
    process.exit(1);
});