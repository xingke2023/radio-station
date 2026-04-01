const https = require('https');

const STATION_CODE = 'msnbc';

// 构建 SSE URL
const connectData = JSON.stringify({
    data: {
        station_code: STATION_CODE
    }
});

const url = `https://radio.xingke888.com/centrifugo/connection/uni_sse?cf_connect=${encodeURIComponent(connectData)}`;

console.log('🎬 测试 SSE 连接...');
console.log('📡 URL:', url);
console.log('');

let subtitleCount = 0;
let messageCount = 0;

const req = https.get(url, (res) => {
    console.log('✅ SSE 连接已建立');
    console.log('   状态码:', res.statusCode);
    console.log('   Content-Type:', res.headers['content-type']);
    console.log('');

    let buffer = '';

    res.on('data', (chunk) => {
        buffer += chunk.toString();

        // 处理完整的消息（以两个换行符分隔）
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // 保留不完整的部分

        lines.forEach(line => {
            if (!line.trim()) return;

            messageCount++;

            // SSE 格式: data: {...}
            const match = line.match(/^data: (.+)$/m);
            if (match) {
                const data = match[1];

                // 处理 ping（空对象）
                if (data === '{}') {
                    process.stdout.write('💓 ping\r');
                    return;
                }

                try {
                    const msg = JSON.parse(data);

                    // 处理连接响应
                    if (msg.connect) {
                        console.log('\n✅ Centrifugo 连接成功');
                        console.log('   Client ID:', msg.connect.client);
                        console.log('   Version:', msg.connect.version);
                        console.log('   订阅频道:', JSON.stringify(msg.connect.subs));
                        console.log('\n⏳ 等待字幕数据...');
                        console.log('=' .repeat(70));
                    }

                    // 处理推送消息
                    if (msg.push && msg.push.pub && msg.push.pub.data) {
                        const pushData = msg.push.pub.data;

                        if (pushData.event === 'recognized') {
                            subtitleCount++;
                            console.log(`\n📺 [${subtitleCount}] 收到字幕 (${new Date().toISOString()}):`);
                            console.log(`   英文: ${pushData.text}`);
                            console.log(`   翻译: ${pushData.translations['zh-CN'] || pushData.translations}`);
                            console.log(`   偏移: ${pushData.offset}ms, 时长: ${pushData.duration}ms`);
                        }
                        else if (pushData.event === 'recognizing') {
                            process.stdout.write(`🎤 识别中: ${pushData.text.substring(0, 50)}...\r`);
                        }
                        else if (pushData.event === 'started') {
                            console.log(`\n📡 事件: ${pushData.event} - 开始语音识别`);
                        }
                        else {
                            console.log(`\n📨 收到事件: ${pushData.event}`, pushData.message || '');
                        }
                    }
                } catch (error) {
                    console.error('\n❌ 解析消息失败:', error.message);
                    console.error('   原始数据:', data);
                }
            }
        });
    });

    res.on('end', () => {
        console.log('\n\n🔌 SSE 连接已关闭');
        console.log(`📊 统计: 共收到 ${messageCount} 条消息, ${subtitleCount} 条字幕`);
    });
});

req.on('error', (error) => {
    console.error('❌ 连接错误:', error.message);
});

// 60秒后自动关闭
setTimeout(() => {
    console.log('\n\n⏱️ 测试时间到（60秒），关闭连接...');
    req.destroy();
    setTimeout(() => {
        console.log(`\n📊 测试结果:`);
        console.log(`   共收到消息: ${messageCount} 条`);
        console.log(`   共收到字幕: ${subtitleCount} 条`);
        if (subtitleCount > 0) {
            console.log(`   ✅ 测试成功！SSE 字幕系统正常工作`);
        } else {
            console.log(`   ❌ 测试失败：未收到任何字幕`);
        }
        process.exit(0);
    }, 1000);
}, 60000);
