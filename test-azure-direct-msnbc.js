/**
 * 直接测试 msnbc 流的 Azure 语音识别
 * 模拟 78-sse-22.js 的完整流程
 */
const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');

async function testDirectRecognition() {
    console.log('🔍 直接测试 msnbc 流的 Azure 语音识别...\n');

    try {
        // 1. 从数据库获取密钥
        const connection = await mysql.createConnection({
            host: '127.0.0.1',
            port: 8510,
            user: 'root',
            password: 'Uu8297636',
            database: 'radio'
        });

        const [rows] = await connection.execute(
            `SELECT subscription_key, region
             FROM azure_keys
             WHERE is_active = 1 AND quota_exceeded_count = 0
             AND region NOT IN ('eastus2')
             ORDER BY current_usage_count ASC
             LIMIT 1`
        );

        if (rows.length === 0) {
            console.error('❌ 未找到可用的 Azure 密钥');
            process.exit(1);
        }

        const { subscription_key, region } = rows[0];
        console.log(`✅ 使用密钥: 区域 ${region}\n`);

        await connection.end();

        // 2. 启动 ffmpeg 处理 msnbc 流
        const streamUrl = 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8';
        console.log('🎵 启动 ffmpeg 处理音频流...');
        console.log(`   URL: ${streamUrl}\n`);

        const ffmpegProcess = spawn('ffmpeg', [
            '-i', streamUrl,
            '-f', 's16le',
            '-ar', '16000',
            '-ac', '1',
            '-bufsize', '64k',
            '-max_muxing_queue_size', '1024',
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-timeout', '30000000',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        const pcmStream = ffmpegProcess.stdout;

        // 监听 ffmpeg 错误
        let ffmpegStarted = false;
        ffmpegProcess.stderr.on('data', (data) => {
            const str = data.toString();
            if (!ffmpegStarted && str.includes('Stream #0:0')) {
                console.log('✅ ffmpeg 已开始处理音频流\n');
                ffmpegStarted = true;
            }
        });

        // 3. 创建 Azure Speech 配置
        console.log('🔧 创建 Azure Speech Translation Config...');
        const translationConfig = sdk.SpeechTranslationConfig.fromSubscription(
            subscription_key,
            region
        );
        translationConfig.speechRecognitionLanguage = "en-US";
        translationConfig.addTargetLanguage("zh-CN");
        console.log('✅ Translation Config 已创建\n');

        // 4. 创建 PushAudioInputStream
        console.log('🎤 创建 PushAudioInputStream...');
        const pushStream = sdk.AudioInputStream.createPushStream();
        const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
        console.log('✅ Audio Stream 已创建\n');

        // 5. 连接 ffmpeg 输出到 pushStream
        let bytesWritten = 0;
        pcmStream.on('data', (chunk) => {
            try {
                pushStream.write(chunk);
                bytesWritten += chunk.length;
            } catch (err) {
                console.error('❌ 写入音频数据错误:', err.message);
            }
        });

        // 显示音频数据流动
        setInterval(() => {
            if (bytesWritten > 0) {
                console.log(`   音频数据: ${(bytesWritten / 1024).toFixed(1)} KB`);
                bytesWritten = 0;
            }
        }, 5000);

        // 6. 创建 TranslationRecognizer
        console.log('🔊 创建 TranslationRecognizer...');
        const recognizer = new sdk.TranslationRecognizer(translationConfig, audioConfig);
        console.log('✅ Recognizer 已创建\n');

        // 7. 设置事件监听器
        console.log('📡 设置事件监听器...\n');

        recognizer.sessionStarted = (s, e) => {
            console.log('🟢 [SessionStarted] Azure 会话已启动');
            console.log(`   Session ID: ${e.sessionId}`);
        };

        recognizer.recognizing = (s, e) => {
            if (e.result.text) {
                console.log('🎤 [Recognizing]');
                console.log(`   英文: ${e.result.text}`);
                const translation = e.result.translations.get("zh-CN");
                if (translation) {
                    console.log(`   中文: ${translation}`);
                }
            }
        };

        recognizer.recognized = (s, e) => {
            if (e.result.reason === sdk.ResultReason.TranslatedSpeech) {
                console.log('✅ [Recognized]');
                console.log(`   英文: ${e.result.text}`);
                const translation = e.result.translations.get("zh-CN");
                if (translation) {
                    console.log(`   中文: ${translation}`);
                }
            } else if (e.result.reason === sdk.ResultReason.NoMatch) {
                console.log('⚠️  [NoMatch] 未识别到语音');
            }
        };

        recognizer.canceled = (s, e) => {
            console.log('❌ [Canceled]');
            console.log(`   原因: ${sdk.CancellationReason[e.reason]}`);
            if (e.reason === sdk.CancellationReason.Error) {
                console.log(`   错误码: ${e.errorCode}`);
                console.log(`   错误详情: ${e.errorDetails}`);
            }
        };

        recognizer.sessionStopped = (s, e) => {
            console.log('🔴 [SessionStopped] Azure 会话已停止');
        };

        // 8. 启动连续识别
        console.log('▶️  启动连续识别...\n');
        recognizer.startContinuousRecognitionAsync(
            () => {
                console.log('✅ 连续识别已启动，等待语音输入...\n');
            },
            (err) => {
                console.error('❌ 启动识别失败:', err);
                ffmpegProcess.kill();
                pushStream.close();
                recognizer.close();
                process.exit(1);
            }
        );

        // 运行 60 秒后停止
        setTimeout(() => {
            console.log('\n⏰ 60秒测试完成，停止识别...');
            recognizer.stopContinuousRecognitionAsync(
                () => {
                    console.log('✅ 识别已停止');
                    ffmpegProcess.kill();
                    pushStream.close();
                    recognizer.close();
                    process.exit(0);
                },
                (err) => {
                    console.error('❌ 停止识别失败:', err);
                    ffmpegProcess.kill();
                    pushStream.close();
                    recognizer.close();
                    process.exit(1);
                }
            );
        }, 60000);

    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        process.exit(1);
    }
}

testDirectRecognition();
