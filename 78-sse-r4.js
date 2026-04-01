const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const keys = require('./keys');

var keyindex = 0;
var speechKey = keys[keyindex].key;
var region = keys[keyindex].zonename;

// Function to rotate to the next key
function rotateToNextKey() {
    keyindex = (keyindex + 1) % keys.length;
    speechKey = keys[keyindex].key;
    region = keys[keyindex].zonename;
    console.log(`Rotating to next key: Speech Key: ${speechKey}, Region: ${region}`);
    return { speechKey, region };
}

class AzureSpeechClient {
    constructor(speechKey, region, streamUrl) {
        // 配置 Azure Speech 服务
        this.speechKey = speechKey;
        this.region = region;
        this.speechConfig = sdk.SpeechConfig.fromSubscription(speechKey, region);
        this.speechConfig.speechRecognitionLanguage = "zh-HK";  // 设置语言，例如中文
        this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, "Semantic");
        this.endTag = false;
        this.streamUrl = streamUrl;

        // 用于存储连续文本
        this.continuousText = "";
        this.currentText = "";  // 用于实时显示的中间结果
        
        // SSE客户端列表
        this.clients = [];
        
        // 识别状态
        this.isRecognizing = false;
        
        // 重试控制
        this.maxRetries = 5;
        this.currentRetries = 0;
        this.retryDelay = 3000; // 3秒
        this.reconnecting = false;
        this.reconnectionTimeout = null;
        
        // 消息去重
        this.lastRecognizingId = null;
        this.lastRecognizedId = null;
        
        console.log(`Current Speech Key: ${speechKey}, Region: ${region}`);
    }

    // 添加SSE客户端
    addClient(client) {
        this.clients.push(client);
        console.log(`客户端已连接，当前连接数: ${this.clients.length}`);
        
        // 立即发送当前状态给新客户端
        if (this.continuousText) {
            this.sendEventToClient(client, 'recognized', {
                text: this.continuousText,
                timestamp: new Date().toISOString()
            });
        }
        
        // 监听客户端断开连接
        client.on('close', () => {
            this.clients = this.clients.filter(c => c !== client);
            console.log(`客户端已断开，当前连接数: ${this.clients.length}`);
            
            // 如果没有客户端连接，停止识别
            if (this.clients.length === 0 && this.isRecognizing) {
                console.log("没有客户端连接，停止语音识别...");
                this.stopRecognition();
            }
        });
        
        // 如果这是第一个客户端且识别未启动，开始识别
        if (this.clients.length === 1 && !this.isRecognizing) {
            console.log("有客户端连接，开始语音识别...");
            this.startRecognition();
        }
    }

    // 向所有客户端发送SSE事件
    sendEvent(eventName, data) {
        // 如果没有客户端，不发送事件
        if (this.clients.length === 0) {
            return;
        }
        
        const eventData = JSON.stringify(data);
        const eventString = `event: ${eventName}\ndata: ${eventData}\n\n`;
        
        // 移除已关闭的客户端并发送事件
        this.clients = this.clients.filter(client => {
            try {
                client.write(eventString);
                return true;
            } catch (e) {
                console.error(`向客户端发送事件失败: ${e.message}`);
                return false;
            }
        });
        
        // 检查客户端数量，如果变为0，停止识别
        if (this.clients.length === 0 && this.isRecognizing) {
            console.log("所有客户端已断开，停止语音识别...");
            this.stopRecognition();
        }
    }
    
    // 向特定客户端发送SSE事件
    sendEventToClient(client, eventName, data) {
        const eventData = JSON.stringify(data);
        const eventString = `event: ${eventName}\ndata: ${eventData}\n\n`;
        
        try {
            client.write(eventString);
        } catch (e) {
            console.error(`向客户端发送事件失败: ${e.message}`);
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

    // 创建新的语音识别器
    createNewRecognizer() {
        return new Promise((resolve, reject) => {
            try {
                const pcmStream = this.streamToPcm(this.streamUrl);
                
                // 创建 PushAudioInputStream 用于推送音频数据
                const pushStream = sdk.AudioInputStream.createPushStream();
                const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
                
                // Use the current keys
                this.speechConfig = sdk.SpeechConfig.fromSubscription(this.speechKey, this.region);
                this.speechConfig.speechRecognitionLanguage = "zh-HK";
                this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, "Semantic");
                
                this.speechRecognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);

                // 连接事件处理
                this.speechRecognizer.recognizing = (s, e) => this.onRecognizing(e);
                this.speechRecognizer.recognized = (s, e) => this.onRecognized(e);
                this.speechRecognizer.sessionStopped = (s, e) => this.onStopped(e);
                this.speechRecognizer.canceled = (s, e) => this.onCanceled(e);

                this.pcmStream = pcmStream;
                this.pushStream = pushStream;
                
                // 设置数据接收超时检测
                this.setupDataTimeoutCheck();
                
                // 设置最后接收数据的时间戳
                this.lastDataTimestamp = Date.now();
                
                // 添加数据处理的稳健性
                pcmStream.on('data', (chunk) => {
                    try {
                        if (this.isRecognizing && this.clients.length > 0) {
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
                
                resolve();
            } catch (e) {
                console.error(`创建识别器异常: ${e}`);
                reject(e);
            }
        });
    }

    // 开始语音识别
    async startRecognition() {
        if (this.isRecognizing || this.clients.length === 0) {
            return;
        }
        
        try {
            // 确保之前的识别器已完全清理
            if (this.speechRecognizer) {
                await this.cleanupRecognizer();
            }
            
            // 重置消息去重标识
            this.lastRecognizingId = null;
            this.lastRecognizedId = null;
            
            await this.createNewRecognizer();
            
            // 开始连续识别
            this.isRecognizing = true;
            this.speechRecognizer.startContinuousRecognitionAsync(() => {
                console.log("开始连续识别...");
                // 发送开始识别事件
                this.sendEvent('started', {
                    message: '开始语音识别',
                    timestamp: new Date().toISOString()
                });
                
                // 重置重试计数
                this.currentRetries = 0;
                
                // 启动心跳检测
                this.startHeartbeat();
            }, (err) => {
                console.error(`识别错误: ${err}`);
                
                // Check for quota error and rotate key if needed
                if (err && (err.includes("Quota exceeded") || err.includes("authorization"))) {
                    console.log("Quota exceeded or authorization error, rotating to next key...");
                    const { speechKey: newKey, region: newRegion } = rotateToNextKey();
                    this.speechKey = newKey;
                    this.region = newRegion;
                    
                    this.sendEvent('keyRotated', {
                        message: `Key rotated to: ${this.region}`,
                        timestamp: new Date().toISOString()
                    });
                }
                
                // 发送错误事件
                this.sendEvent('error', {
                    message: `识别错误: ${err}`,
                    timestamp: new Date().toISOString()
                });
                this.handleReconnection("识别启动失败");
            });
        } catch (e) {
            console.error(`流处理异常: ${e}`);
            this.sendEvent('error', {
                message: `流处理异常: ${e}`,
                timestamp: new Date().toISOString()
            });
            this.handleReconnection("流处理异常");
        }
    }
    
    // 清理当前识别器
    cleanupRecognizer() {
        return new Promise((resolve) => {
            try {
                if (!this.speechRecognizer) {
                    resolve();
                    return;
                }
                
                // 移除所有事件处理器
                this.speechRecognizer.recognizing = null;
                this.speechRecognizer.recognized = null;
                this.speechRecognizer.sessionStopped = null;
                this.speechRecognizer.canceled = null;
                
                // 停止并关闭识别器
                this.speechRecognizer.stopContinuousRecognitionAsync(
                    () => {
                        try {
                            this.speechRecognizer.close();
                        } catch (e) {
                            console.error(`关闭识别器错误: ${e}`);
                        } finally {
                            this.speechRecognizer = null;
                            setTimeout(resolve, 500); // 给一点时间确保完全清理
                        }
                    },
                    (err) => {
                        console.error(`停止识别错误: ${err}`);
                        try {
                            this.speechRecognizer.close();
                        } catch (e) {
                            console.error(`关闭识别器错误: ${e}`);
                        } finally {
                            this.speechRecognizer = null;
                            setTimeout(resolve, 500);
                        }
                    }
                );
            } catch (e) {
                console.error(`清理识别器异常: ${e}`);
                this.speechRecognizer = null;
                setTimeout(resolve, 500);
            }
        });
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
            if (this.isRecognizing && this.clients.length > 0) {
                this.sendEvent('heartbeat', {
                    timestamp: new Date().toISOString()
                });
            }
        }, 30000);
    }
    
    // 处理重连
    async handleReconnection(reason) {
        if (this.reconnecting || this.clients.length === 0) {
            return;
        }
        
        this.reconnecting = true;
        
        // 清除任何挂起的重连尝试
        if (this.reconnectionTimeout) {
            clearTimeout(this.reconnectionTimeout);
            this.reconnectionTimeout = null;
        }
        
        // 停止当前识别但不清除客户端
        await this.stopRecognitionInternal();
        
        if (this.currentRetries < this.maxRetries) {
            this.currentRetries++;
            
            const delay = this.retryDelay * this.currentRetries;
            
            console.log(`准备重新连接 (${this.currentRetries}/${this.maxRetries})，原因: ${reason}，延迟: ${delay}ms`);
            
            this.sendEvent('reconnecting', {
                message: `准备重新连接 (${this.currentRetries}/${this.maxRetries})，${delay/1000}秒后重试...`,
                reason: reason,
                timestamp: new Date().toISOString()
            });
            
            this.reconnectionTimeout = setTimeout(async () => {
                if (this.clients.length > 0) {
                    console.log(`尝试重新连接 (${this.currentRetries}/${this.maxRetries})...`);
                    this.reconnecting = false;
                    this.reconnectionTimeout = null;
                    await this.startRecognition();
                } else {
                    console.log('没有客户端连接，取消重连');
                    this.reconnecting = false;
                    this.reconnectionTimeout = null;
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
    async stopRecognitionInternal() {
        if (!this.isRecognizing) {
            return;
        }
        
        this.isRecognizing = false;
        
        await this.cleanupRecognizer();
        
        if (this.pushStream) {
            try {
                this.pushStream.close();
                this.pushStream = null;
            } catch (e) {
                console.error(`关闭推送流错误: ${e}`);
            }
        }
        
        if (this.pcmStream) {
            try {
                this.pcmStream.destroy();
                this.pcmStream = null;
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
        
        // 返回一个延迟确保完全停止
        return new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // 停止语音识别
    async stopRecognition() {
        await this.stopRecognitionInternal();
        
        // 发送停止事件
        this.sendEvent('stopped', {
            message: '语音识别已停止',
            fullText: this.continuousText,
            timestamp: new Date().toISOString()
        });
    }

    onRecognizing(evt) {
        // 如果没有客户端或未处于识别状态，忽略事件
        if (this.clients.length === 0 || !this.isRecognizing) {
            return;
        }
        
        // 处理中间结果，动态更新单行字幕
        if (evt.result.text) {
            // 消息去重检查
            const messageId = `${Date.now()}-${evt.result.text}`;
            if (messageId === this.lastRecognizingId) {
                return; // 跳过重复消息
            }
            this.lastRecognizingId = messageId;
            
            this.currentText = evt.result.text;
            
            // 发送中间识别结果事件
            this.sendEvent('recognizing', {
                text: this.currentText,
                fullText: this.continuousText + this.currentText,
                timestamp: new Date().toISOString()
            });
        }
    }

    onRecognized(evt) {
        // 如果没有客户端或未处于识别状态，忽略事件
        if (this.clients.length === 0 || !this.isRecognizing) {
            return;
        }
        
        // 处理最终识别结果，追加到完整文本
        if (evt.result.text) {
            // 消息去重检查
            const messageId = `${Date.now()}-${evt.result.text}`;
            if (messageId === this.lastRecognizedId) {
                return; // 跳过重复消息
            }
            this.lastRecognizedId = messageId;
            
            this.continuousText += "<div>" + evt.result.text + "</div>";
            this.currentText = "";  // 清空中间结果
            if (this.continuousText.length > 500) {
                this.continuousText = this.continuousText.slice(-500);
            }
            
            // 发送最终识别结果事件
            this.sendEvent('recognized', {
                text: evt.result.text,
                fullText: this.continuousText,
                timestamp: new Date().toISOString()
            });
        }
    }

    onStopped(evt) {
        // Recognition session stopped
        console.log("\n识别会话已停止");
        this.isRecognizing = false;
        
        // If clients are still connected, attempt reconnection
        if (this.clients.length > 0 && !this.reconnecting) {
            console.log("会话停止但客户端仍连接，尝试重新连接...");
            this.handleReconnection('会话意外停止');
        } else if (!this.reconnecting) {
            // Send stopped event only if not reconnecting
            this.sendEvent('stopped', {
                message: '识别会话已停止',
                fullText: this.continuousText,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    onCanceled(evt) {
        console.log(`识别已取消，原因: ${evt.errorDetails}`);
        
        // Check for quota error and rotate key if needed
        if (evt.errorDetails && (evt.errorDetails.includes("Quota exceeded") || evt.errorDetails.includes("authorization"))) {
            console.log("Quota exceeded or authorization error, rotating to next key...");
            const { speechKey: newKey, region: newRegion } = rotateToNextKey();
            this.speechKey = newKey;
            this.region = newRegion;
            
            this.sendEvent('keyRotated', {
                message: `Key rotated to: ${this.region}`,
                timestamp: new Date().toISOString()
            });
        }
        
        // 如果不是正在重连，处理重连
        if (!this.reconnecting) {
            this.sendEvent('canceled', {
                message: `识别已取消，原因: ${evt.errorDetails}`,
                timestamp: new Date().toISOString()
            });
            this.handleReconnection(`识别取消: ${evt.errorDetails}`);
        }
    }

    async close() {
        await this.stopRecognition();
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
    
    // 提供静态文件
    app.use(express.static('public'));
    
    // SSE端点
    app.get('/events', (req, res) => {
        // 设置SSE头部
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        
        // 发送初始连接成功消息
        res.write(`data: ${JSON.stringify({message: '连接成功'})}\n\n`);
        
        // 将客户端添加到语音识别客户端
        client.addClient(res);
    });
    
    // 简单的HTML客户端页面
    app.get('/', (req, res) => {
        res.send('');
    });
    
    // Add an endpoint to get current key info
    app.get('/key-info', (req, res) => {
        res.json({
            keyIndex: keyindex,
            speechKey: speechKey.substring(0, 5) + '...',  // Only show part of the key for security
            region: region,
            totalKeys: keys.length
        });
    });
    
    // Add an endpoint to manually rotate keys
    app.get('/rotate-key', (req, res) => {
        const { speechKey: newKey, region: newRegion } = rotateToNextKey();
        client.speechKey = newKey;
        client.region = newRegion;
        
        res.json({
            message: 'Key rotated successfully',
            keyIndex: keyindex,
            region: region
        });
    });
    
    // 启动服务器
    app.listen(port, () => {
        console.log(`SSE服务器已启动，监听端口 ${port}`);
        console.log(`访问 http://localhost:${port} 查看实时语音识别结果`);
        console.log(`当前使用的 Speech Key: ${speechKey.substring(0, 5)}... Region: ${region}`);
    });
}

// 主函数
async function main() {
    // 输出当前使用的 key 信息
    console.log(`Starting with Speech Key: ${speechKey.substring(0, 5)}... Region: ${region}`);
    
    const streamUrl = "https://stm.rthk.hk/radio4";
    const serverPort = 8624;           // SSE服务器端口

    const client = new AzureSpeechClient(speechKey, region, streamUrl);
    
    // 创建并启动SSE服务器
    createSseServer(client, serverPort);
    
    // 处理程序退出
    process.on('SIGINT', async () => {
        console.log('接收到退出信号，正在关闭...');
        await client.close();
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