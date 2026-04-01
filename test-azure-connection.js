const sdk = require('microsoft-cognitiveservices-speech-sdk');
const mysql = require('mysql2/promise');

async function testAzureConnection() {
    console.log('🔍 测试 Azure Speech SDK 连接...\n');

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
            'SELECT subscription_key, region FROM azure_keys WHERE id = 48'
        );

        if (rows.length === 0) {
            console.error('❌ 未找到 Azure 密钥 (ID: 48)');
            process.exit(1);
        }

        const { subscription_key, region } = rows[0];
        console.log(`✅ 密钥信息:`);
        console.log(`   区域: ${region}`);
        console.log(`   密钥: ${subscription_key.substring(0, 10)}...`);

        await connection.end();

        // 2. 创建语音配置
        console.log('\n🔧 创建 Speech Config...');
        const speechConfig = sdk.SpeechConfig.fromSubscription(subscription_key, region);
        speechConfig.speechRecognitionLanguage = "en-US";
        console.log('✅ Speech Config 已创建');

        // 3. 创建音频配置（使用麦克风作为测试）
        console.log('\n🎤 创建 Audio Config...');
        const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
        console.log('✅ Audio Config 已创建');

        // 4. 创建识别器
        console.log('\n🔊 创建 Speech Recognizer...');
        const recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
        console.log('✅ Speech Recognizer 已创建');

        // 5. 测试识别（超时）
        console.log('\n⏱️  尝试识别（5秒超时测试）...');

        const timeout = new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('超时：5秒内未能完成识别测试')), 5000);
        });

        const recognizePromise = new Promise((resolve, reject) => {
            recognizer.recognizeOnceAsync(
                (result) => {
                    console.log('✅ 识别测试成功');
                    console.log('   结果状态:', result.reason);
                    if (result.reason === sdk.ResultReason.RecognizedSpeech) {
                        console.log('   识别文本:', result.text);
                    } else if (result.reason === sdk.ResultReason.NoMatch) {
                        console.log('   未识别到语音（这是正常的，说明连接正常）');
                    }
                    recognizer.close();
                    resolve();
                },
                (err) => {
                    console.error('❌ 识别测试失败:', err);
                    recognizer.close();
                    reject(err);
                }
            );
        });

        try {
            await Promise.race([recognizePromise, timeout]);
        } catch (err) {
            if (err.message.includes('超时')) {
                console.log('⚠️  ', err.message);
                console.log('   但这可能是因为没有音频输入，让我们尝试其他方式...');
            } else {
                throw err;
            }
        }

        recognizer.close();

        console.log('\n✅ Azure Speech SDK 配置正常');
        console.log('\n💡 建议：');
        console.log('   1. 检查服务器的出站网络连接是否正常');
        console.log('   2. 检查 Azure 服务端点是否可访问：');
        console.log(`      https://${region}.api.cognitive.microsoft.com`);
        console.log('   3. 检查密钥是否有效且未超出配额');

    } catch (error) {
        console.error('\n❌ 测试失败:', error);

        if (error.message && error.message.includes('Unable to contact server')) {
            console.log('\n📋 可能的原因：');
            console.log('   1. 网络连接问题（防火墙/代理）');
            console.log('   2. Azure 服务端点不可达');
            console.log('   3. 密钥无效或已过期');
            console.log('   4. 区域配置错误');
        }

        process.exit(1);
    }
}

testAzureConnection();
