const https = require('https');
const http = require('http');

const STATION_CODE = 'msnbc';

console.log('🎬 测试 SSE 连接（使用 token）...');
console.log('');

// 步骤1: 获取连接 token
console.log('步骤1: 获取连接 token...');
http.get(`http://localhost:8533/sse/connect?station_code=${STATION_CODE}`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const info = JSON.parse(data);
        console.log('✅ 获取连接信息成功');
        console.log('   频道:', info.channel);
        console.log('   Token:', info.token.substring(0, 50) + '...');
        console.log('');

        // 步骤2: 使用 token 连接 SSE
        console.log('步骤2: 使用 token 连接 SSE...');
        const connectData = JSON.stringify({ token: info.token });
        const url = `https://radio.xingke888.com/centrifugo/connection/uni_sse?cf_connect=${encodeURIComponent(connectData)}`;

        console.log('📡 SSE URL:', url);
        console.log('');

        let subtitleCount = 0;
        let messageCount = 0;
        let connected = false;
        let clientId = null;

        const req = https.get(url, (res) => {
            console.log('✅ SSE 连接已建立');
            console.log('   状态码:', res.statusCode);
            console.log('');

            let buffer = '';

            res.on('data', (chunk) => {
                buffer += chunk.toString();

                // 处理完整的消息
                const lines = buffer.split('\n\n');
                buffer = lines.pop();

                lines.forEach(line => {
                    if (!line.trim()) return;

                    messageCount++;

                    const match = line.match(/^data: (.+)$/m);
                    if (match) {
                        const data = match[1];

                        if (data === '{}') {
                            process.stdout.write('💓 ping\r');
                            return;
                        }

                        try {
                            const msg = JSON.parse(data);

                            if (msg.connect) {
                                connected = true;
                                clientId = msg.connect.client;
                                console.log('\n✅ Centrifugo 连接成功');
                                console.log('   Client ID:', clientId);
                                console.log('   订阅频道:', JSON.stringify(msg.connect.subs));

                                // 步骤3: 触发电台启动
                                console.log('\n步骤3: 触发电台启动...');
                                const postData = JSON.stringify({
                                    station_code: STATION_CODE,
                                    client_id: clientId
                                });

                                const options = {
                                    hostname: 'localhost',
                                    port: 8533,
                                    path: '/sse/subscribe',
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Content-Length': Buffer.byteLength(postData)
                                    }
                                };

                                const postReq = http.request(options, (startRes) => {
                                    let startData = '';
                                    startRes.on('data', chunk => startData += chunk);
                                    startRes.on('end', () => {
                                        const result = JSON.parse(startData);
                                        console.log('✅ 电台启动请求已发送:', result);
                                        console.log('\n⏳ 等待字幕数据...');
                                        console.log('=' .repeat(70));
                                    });
                                });

                                postReq.write(postData);
                                postReq.end();
                            }

                            if (msg.push && msg.push.pub && msg.push.pub.data) {
                                const pushData = msg.push.pub.data;

                                if (pushData.event === 'recognized') {
                                    subtitleCount++;
                                    console.log(`\n📺 [${subtitleCount}] 收到字幕 (${new Date().toISOString()}):`);
                                    console.log(`   英文: ${pushData.text}`);
                                    console.log(`   翻译: ${pushData.translations['zh-CN'] || pushData.translations}`);
                                }
                                else if (pushData.event === 'recognizing') {
                                    process.stdout.write(`🎤 识别中: ${pushData.text.substring(0, 50)}...\r`);
                                }
                                else if (pushData.event === 'started') {
                                    console.log(`\n📡 语音识别已启动`);
                                }
                                else {
                                    console.log(`\n📨 事件: ${pushData.event}`);
                                }
                            }
                        } catch (error) {
                            console.error('\n❌ 解析消息失败:', error.message);
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
    });
});
