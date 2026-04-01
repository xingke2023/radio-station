const sdk = require('microsoft-cognitiveservices-speech-sdk');
const mysql = require('mysql2/promise');
const { PassThrough } = require('stream');

async function testDetailedConnection() {
    console.log('🔍 详细测试 Azure Speech SDK 连接...\n');

    try {
        // 1. 从数据库获取密钥
        const connection = await mysql.createConnection({
            host: '127.0.0.1',
            port: 8510,
            user: 'root',
            password: 'Uu8297636',
            database: 'radio'
        });

        // 测试多个可用密钥
        const [rows] = await connection.execute(
            `SELECT id, key_name, subscription_key, region
             FROM azure_keys
             WHERE is_active = 1 AND quota_exceeded_count = 0
             AND region NOT IN ('eastus2')
             ORDER BY current_usage_count ASC
             LIMIT 3`
        );

        if (rows.length === 0) {
            console.error('❌ 未找到可用的 Azure 密钥');
            process.exit(1);
        }

        await connection.end();

        console.log(`找到 ${rows.length} 个可用密钥，逐个测试:\n`);

        for (const keyInfo of rows) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`测试密钥: ${keyInfo.key_name} (${keyInfo.region})`);
            console.log(`${'='.repeat(60)}`);

            const { subscription_key, region } = keyInfo;

            try {
                // 创建音频流配置
                const pushStream = sdk.AudioInputStream.createPushStream();
                const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

                // 创建翻译配置
                console.log('\n1️⃣ 创建 SpeechTranslationConfig...');
                const translationConfig = sdk.SpeechTranslationConfig.fromSubscription(
                    subscription_key,
                    region
                );
                translationConfig.speechRecognitionLanguage = "en-US";
                translationConfig.addTargetLanguage("zh-CN");
                console.log('   ✅ 配置已创建');

                // 创建翻译识别器
                console.log('\n2️⃣ 创建 TranslationRecognizer...');
                const recognizer = new sdk.TranslationRecognizer(translationConfig, audioConfig);
                console.log('   ✅ 识别器已创建');

                // 监听所有事件
                recognizer.recognizing = (s, e) => {
                    console.log(`   🎤 [Recognizing] ${e.result.text}`);
                };

                recognizer.recognized = (s, e) => {
                    if (e.result.reason === sdk.ResultReason.TranslatedSpeech) {
                        console.log(`   ✅ [Recognized] ${e.result.text}`);
                        const translation = e.result.translations.get("zh-CN");
                        console.log(`   📝 [Translation] ${translation}`);
                    }
                };

                recognizer.canceled = (s, e) => {
                    console.log(`   ❌ [Canceled] 原因: ${sdk.CancellationReason[e.reason]}`);
                    if (e.reason === sdk.CancellationReason.Error) {
                        console.log(`   ⚠️  错误码: ${e.errorCode}`);
                        console.log(`   ⚠️  错误详情: ${e.errorDetails}`);
                    }
                };

                recognizer.sessionStarted = (s, e) => {
                    console.log('   🟢 [SessionStarted] 会话已启动');
                };

                recognizer.sessionStopped = (s, e) => {
                    console.log('   🔴 [SessionStopped] 会话已停止');
                };

                // 启动连续识别
                console.log('\n3️⃣ 启动连续识别...');
                recognizer.startContinuousRecognitionAsync(
                    () => {
                        console.log('   ✅ 识别已启动，等待会话建立...\n');

                        // 发送一些测试数据
                        console.log('4️⃣ 发送测试音频数据...');
                        const silenceBuffer = Buffer.alloc(3200, 0); // 100ms 静音 (16kHz, 16bit, mono)

                        for (let i = 0; i < 10; i++) {
                            pushStream.write(silenceBuffer);
                        }

                        console.log('   ✅ 已发送 1 秒静音数据');

                        // 等待 10 秒看是否有响应
                        setTimeout(() => {
                            console.log('\n5️⃣ 停止识别...');
                            recognizer.stopContinuousRecognitionAsync(
                                () => {
                                    console.log('   ✅ 识别已停止');
                                    pushStream.close();
                                    recognizer.close();
                                },
                                (err) => {
                                    console.error('   ❌ 停止识别失败:', err);
                                    pushStream.close();
                                    recognizer.close();
                                }
                            );
                        }, 10000);
                    },
                    (err) => {
                        console.error('   ❌ 启动识别失败:', err);
                        console.error('   错误详情:', err.toString());
                        pushStream.close();
                        recognizer.close();
                    }
                );

                // 等待测试完成
                await new Promise(resolve => setTimeout(resolve, 12000));

            } catch (error) {
                console.error(`\n❌ 测试密钥 ${keyInfo.key_name} 时出错:`, error.message);
            }
        }

        console.log('\n\n' + '='.repeat(60));
        console.log('测试完成');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ 测试失败:', error);
        process.exit(1);
    }
}

testDetailedConnection().then(() => {
    console.log('\n✅ 所有测试完成');
    process.exit(0);
});
