const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const keys = require('./keys');

var keyindex = 0;
var speechKey = keys[keyindex].key;
var region = keys[keyindex].zonename;

// 添加函数用于轮换密钥
function rotateKey() {
    keyindex = (keyindex + 1) % keys.length;
    speechKey = keys[keyindex].key;
    region = keys[keyindex].zonename;
    console.log(`已切换到新的密钥: 索引 ${keyindex}, 密钥 ${speechKey}, 区域 ${region}`);
    return { speechKey, region };
}

class AzureTranslationClient {
    constructor(speechKey, region, streamUrl) {
        // 配置 Azure Speech 服务
        this.speechKey = speechKey;
        this.region = region;
        this.speechConfig = sdk.SpeechTranslationConfig.fromSubscription(speechKey, region);
        
        // 设置识别语言
        this.speechConfig.speechRecognitionLanguage = "en-US";
        
        // 设置翻译目标语言（可以添加多个目标语言）
        this.speechConfig.addTargetLanguage("zh-CN");
        
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
        this.lastRecognizingText = "";  // 上一次发送的识别文本
        this.recognizingDebounceTimer = null;  // 防抖定时器
        this.recognizingDebounceMs = 200;  // 防抖时间(毫秒)
        this.pendingRecognizingEvent = null;  // 待发送的事件
        
        // 事件ID跟踪
        this.eventCounter = 0;  // 事件计数器，用于生成唯一ID
        
        // 存储最近发送的事件，用于防止重复
        this.recentEvents = [];
        this.maxRecentEvents = 100; // 存储最近100个事件
        
        // 存储所有已经识别的完整文本段落，用于新客户端连接时的历史记录
        this.recognizedTextSegments = [];
        this.maxTextSegments = 50; // 最多保存50个段落
    }

    // 生成唯一的事件ID
    generateEventId() {
        return `${Date.now()}-${++this.eventCounter}`;
    }

    // 添加SSE客户端
    addClient(client, lastEventId = null) {
        // 将客户端及其上次接收的事件ID存储在Map中
        this.clients.set(client, { lastEventId });
        console.log(`客户端已连接，当前连接数: ${this.clients.size}，上次事件ID: ${lastEventId || 'none'}`);
        
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

    // 向所有客户端发送SSE事件
    sendEvent(eventName, data) {
        // 如果没有客户端，不发送事件
        if (this.clients.size === 0) {
            return;
        }

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
        
        const eventDataStr = JSON.stringify(data);
        const eventString = `event: ${eventName}\nid: ${data.id}\ndata: ${eventDataStr}\n\n`;
        
        // 移除已关闭的客户端并发送事件
        for (const [client, clientInfo] of this.clients.entries()) {
            try {
                // 检查客户端是否已经接收过此事件
                if (!this.hasClientReceivedEvent(client, data.id)) {
                    client.write(eventString);
                    // 更新客户端的上次事件ID
                    this.updateClientLastEventId(client, data.id);
                }
            } catch (e) {
                console.error(`向客户端发送事件失败: ${e.message}`);
                this.clients.delete(client);
            }
        }
        
        // 检查客户端数量，如果变为0，停止识别
        if (this.clients.size === 0 && this.isRecognizing) {
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
        const process = spawn('ffmpeg', [
            '-i', streamUrl,
            '-f', 's16le',
            '-ar', '16000',
            '-ac', '1',
            // 添加重连选项
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-timeout', '30000000',  // 延长超时时间
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        // 错误处理
        process.stderr.on('data', (data) => {
            console.log(`ffmpeg stderr: ${data}`);
        });

        return process.stdout;
    }

    // 更新密钥和区域
    updateCredentials(newKey, newRegion) {
        this.speechKey = newKey;
        this.region = newRegion;
        // 重新配置语音配置
        this.speechConfig = sdk.SpeechTranslationConfig.fromSubscription(newKey, newRegion);
        this.speechConfig.speechRecognitionLanguage = "en-US";
        this.speechConfig.addTargetLanguage("zh-CN");
        this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, "Semantic");
        
        console.log(`已更新凭据: 密钥 ${newKey}, 区域 ${newRegion}`);
    }

    // 开始语音识别和翻译
    startRecognition() {
        if (this.isRecognizing || this.clients.size === 0) {
            return;
        }
        
        this.isRecognizing = true;
        
        try {
            console.log(`使用密钥: ${this.speechKey}, 区域: ${this.region}`);
            
            const pcmStream = this.streamToPcm(this.streamUrl);
            
            // 创建 PushAudioInputStream 用于推送音频数据
            const pushStream = sdk.AudioInputStream.createPushStream();
            const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
            
            // 创建翻译识别器
            this.translationRecognizer = new sdk.TranslationRecognizer(this.speechConfig, audioConfig);

            // 连接事件处理
            this.translationRecognizer.recognizing = (s, e) => this.onRecognizing(e);
            this.translationRecognizer.recognized = (s, e) => this.onRecognized(e);
            this.translationRecognizer.sessionStopped = (s, e) => this.onStopped(e);
            this.translationRecognizer.canceled = (s, e) => this.onCanceled(e);

            // 开始连续识别
            this.translationRecognizer.startContinuousRecognitionAsync(() => {
                console.log("开始连续识别和翻译...");
                // 发送开始识别事件
                this.sendEvent('started', {
                    message: '开始语音识别和翻译',
                    timestamp: new Date().toISOString()
                });
                
                // 重置重试计数
                this.currentRetries = 0;
            }, (err) => {
                console.error(`识别错误: ${err}`);
                // 检查是否是配额错误
                if (err && (err.includes("Quota exceeded") || err.includes("Authentication failed"))) {
                    console.log("检测到配额错误，切换到下一个密钥...");
                    const { speechKey: newKey, region: newRegion } = rotateKey();
                    this.sendEvent('keyRotated', {
                        message: `已切换到新的密钥: 索引 ${keyindex}, 区域 ${newRegion}`,
                        timestamp: new Date().toISOString()
                    });
                    
                    // 更新客户端凭据
                    this.updateCredentials(newKey, newRegion);
                    
                    // 稍微延迟后重试
                    setTimeout(() => {
                        this.isRecognizing = false;
                        this.startRecognition();
                    }, 1000);
                } else {
                    // 发送错误事件
                    this.sendEvent('error', {
                        message: `识别错误: ${err}`,
                        timestamp: new Date().toISOString()
                    });
                    this.handleReconnection("识别启动失败");
                }
            });

            this.pcmStream = pcmStream;
            this.pushStream = pushStream;
            
            // 设置数据接收超时检测
            this.setupDataTimeoutCheck();
            
            // 设置最后接收数据的时间戳
            this.lastDataTimestamp = Date.now();
            
            // 添加数据处理的稳健性
            pcmStream.on('data', (chunk) => {
                try {
                    if (this.isRecognizing && this.clients.size > 0) {
                        pushStream.write(chunk);
                        // 更新最后接收数据的时间戳
                        this.lastDataTimestamp = Date.now();
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
        
        // 每15秒检查一次是否接收到数据
        this.dataTimeoutCheck = setInterval(() => {
            if (this.isRecognizing && !this.reconnecting) {
                const now = Date.now();
                // 如果超过30秒没有收到数据，认为流已经断开
                if (now - this.lastDataTimestamp > 30000) {
                    console.log("数据接收超时，准备重连...");
                    this.sendEvent('warning', {
                        message: '数据接收超时，准备重连...',
                        timestamp: new Date().toISOString()
                    });
                    this.handleReconnection("数据接收超时");
                }
            }
        }, 15000);
    }
    
    // 启动心跳检测
    startHeartbeat() {
        // 清除之前的心跳
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        
        // 每30秒发送一次心跳，保持连接活跃
        this.heartbeatInterval = setInterval(() => {
            if (this.isRecognizing && this.clients.size > 0) {
                this.sendEvent('heartbeat', {
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000);
    }
    
    // 处理重连
    handleReconnection(reason) {
        if (this.reconnecting || this.clients.size === 0) {
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
                if (this.clients.size > 0) {
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
    onRecognizing(evt) {
        // 如果没有客户端或未处于识别状态，忽略事件
        if (this.clients.size === 0 || !this.isRecognizing) {
            return;
        }
        
        // 处理中间结果，动态更新单行字幕
        if (evt.result.text) {
            this.currentText = evt.result.text;
            
            // 获取翻译结果
            const result = evt.result;
            console.log(`当前识别文本: ${this.currentText}`);
            const privJsonText = result.privJson ? JSON.parse(result.privJson).Text : null;
            const translationsText = result.privJson ? 
                JSON.parse(result.privJson).Translation.Translations[0].DisplayText : null;

            this.currentSourceText = privJsonText;
            this.currentTranslatedText = translationsText;
            console.log(`当前识别文本: ${this.currentTranslatedText}`);
            
            this.sendEvent('recognizing', {
                text: this.currentSourceText,
                translations: this.currentTranslatedText,
                timestamp: new Date().toISOString()
            });
        }
    }

    onRecognized(evt) {
        // 如果没有客户端或未处于识别状态，忽略事件
        if (this.clients.size === 0 || !this.isRecognizing) {
            return;
        }
        
        // 处理最终识别结果，追加到完整文本
        if (evt.result.text) {
            this.continuousText = "<div>" + evt.result.text + "</div>";
            this.currentText = "";  // 清空中间结果
            this.lastRecognizingText = ""; // 重置最后识别的文本，以便下一轮识别
            
            // 处理翻译结果
            const result = evt.result;
            // 方法1：直接从对象属性访问
            const privJsonText = result.privJson ? JSON.parse(result.privJson).Text : null;
            const translationsText = result.privJson ? 
                JSON.parse(result.privJson).Translation.Translations[0].Text : null;

            // 更新源语言和翻译文本
            this.sourceText += privJsonText + "\n";
            this.translatedText += translationsText + "\n";
            
            // 存储识别到的文本段落
            const textSegment = {
                id: this.generateEventId(),
                text: privJsonText,
                translation: translationsText,
                timestamp: new Date().toISOString()
            };
            
            // 添加到已识别段落列表
            this.recognizedTextSegments.push(textSegment);
            
            // 如果超过最大数量，移除最早的段落
            if (this.recognizedTextSegments.length > this.maxTextSegments) {
                this.recognizedTextSegments.shift();
            }
            
            // 发送最终识别结果事件
            this.sendEvent('recognized', {
                text: evt.result.text,
                translations: translationsText,
                fullText: privJsonText + "\n" + translationsText, // 组合文本
                fullTranslations: '',
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
    
    onCanceled(evt) {
        console.log(`识别已取消，原因: ${evt.errorDetails}`);
        
        // 检查是否是配额错误
        if (evt.errorDetails && (evt.errorDetails.includes("Quota exceeded") || evt.errorDetails.includes("Authentication failed"))) {
            console.log("检测到配额错误，切换到下一个密钥...");
            const { speechKey: newKey, region: newRegion } = rotateKey();
            this.sendEvent('keyRotated', {
                message: `已切换到新的密钥: 索引 ${keyindex}, 区域 ${newRegion}`,
                timestamp: new Date().toISOString()
            });
            
            // 更新客户端凭据
            this.updateCredentials(newKey, newRegion);
            
            // 停止当前识别
            this.stopRecognitionInternal();
            
            // 稍微延迟后重试
            setTimeout(() => {
                if (this.clients.size > 0) {
                    this.startRecognition();
                }
            }, 2000);
        } else if (!this.reconnecting) {
            this.sendEvent('canceled', {
                message: `识别已取消，原因: ${evt.errorDetails}`,
                timestamp: new Date().toISOString()
            });
            this.handleReconnection(`识别取消: ${evt.errorDetails}`);
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

// 创建SSE服务
function createSseServer(client, port = 3000) {
    const app = express();
    
    // 启用CORS
    app.use(cors());
    
    // SSE端点
    app.get('/events', (req, res) => {
        // 设置SSE头部
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        
        // 获取客户端的Last-Event-ID
        const lastEventId = req.headers['last-event-id'] || null;
        
        // 发送初始连接成功消息
        const connectedEventId = Date.now() + '-0';
        res.write(`event: connected\nid: ${connectedEventId}\ndata: ${JSON.stringify({message: '连接成功', id: connectedEventId})}\n\n`);
        
        // 将客户端添加到语音识别客户端，并传递上次事件ID
        client.addClient(res, lastEventId);
    });
    
    // 启动服务器
    app.listen(port, () => {
        console.log(`SSE服务器已启动，监听端口 ${port}`);
        console.log(`当前使用的密钥: ${speechKey}, 区域: ${region}`);
    });
}

// 主函数
async function main() {
    const streamUrl = "http://war.str3am.com:7180/live";
    const serverPort = 8532;           // SSE服务器端口

    console.log(`初始化使用密钥索引: ${keyindex}, 密钥: ${speechKey}, 区域: ${region}`);
    const client = new AzureTranslationClient(speechKey, region, streamUrl);
    
    // 创建并启动SSE服务器
    createSseServer(client, serverPort);
    
    // 处理程序退出
    process.on('SIGINT', () => {
        console.log('接收到退出信号，正在关闭...');
        client.close();
        // 给一些时间让事件发送到客户端
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    });
}

// 执行主程序
main().catch(err => {
    console.error(`程序执行错误: ${err}`);
    process.exit(1);
});
