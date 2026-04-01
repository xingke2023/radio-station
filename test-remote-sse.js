const https = require('https');
const http = require('http');

const STATION_CODE = 'msnbc';

console.log('🎬 测试远程 SSE 连接...\n');

// 步骤1: 通过 HTTPS 获取连接 token
console.log('步骤1: 获取连接 token (通过 NGINX)...');
const connectUrl = `https://radio.xingke888.com/sse8/sse/connect?station_code=${STATION_CODE}`;
console.log(`URL: ${connectUrl}\n`);

https.get(connectUrl, (res) => {
    console.log(`HTTP 状态: ${res.statusCode} ${res.statusMessage}`);
    console.log(`Headers:`, res.headers);

    if (res.statusCode !== 200) {
        console.log('\n❌ 获取 token 失败');
        res.on('data', chunk => process.stdout.write(chunk));
        res.on('end', () => process.exit(1));
        return;
    }

    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const info = JSON.parse(data);
            console.log('\n✅ 获取连接信息成功');
            console.log('   频道:', info.channel);
            console.log('   Token:', info.token.substring(0, 50) + '...');
            console.log('');

            // 步骤2: 使用 token 连接 SSE
            console.log('步骤2: 连接 SSE (通过 NGINX)...');
            const connectData = JSON.stringify({ token: info.token });
            const sseUrl = `https://radio.xingke888.com/centrifugo/connection/uni_sse?cf_connect=${encodeURIComponent(connectData)}`;
            console.log(`SSE URL: ${sseUrl.substring(0, 100)}...`);
            console.log('');

            let subtitleCount = 0;
            let messageCount = 0;
            let clientId = null;

            const req = https.get(sseUrl, (res) => {
                console.log('✅ SSE 连接已建立');
                console.log('   状态码:', res.statusCode);
                console.log('   Content-Type:', res.headers['content-type']);
                console.log('');

                let buffer = '';

                res.on('data', (chunk) => {
                    buffer += chunk.toString();

                    const lines = buffer.split('\n\n');
                    buffer = lines.pop();

                    lines.forEach(line => {
                        if (!line.trim()) return;

                        messageCount++;

                        const match = line.match(/^data: (.+)$/m);
                        if (match) {
                            const msgData = match[1];

                            if (msgData === '{}') {
                                process.stdout.write(`💓 ping (消息 #${messageCount})\r`);
                                return;
                            }

                            try {
                                const msg = JSON.parse(msgData);

                                if (msg.connect) {
                                    clientId = msg.connect.client;
                                    console.log('\n✅ Centrifugo 连接成功');
                                    console.log('   Client ID:', clientId);
                                    console.log('   订阅频道:', JSON.stringify(msg.connect.subs));

                                    // 步骤3: 调用订阅端点启动电台
                                    console.log('\n步骤3: 调用订阅端点启动电台...');
                                    const postData = JSON.stringify({
                                        station_code: STATION_CODE,
                                        client_id: clientId
                                    });

                                    const postReq = https.request('https://radio.xingke888.com/sse8/sse/subscribe', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Content-Length': Buffer.byteLength(postData)
                                        }
                                    }, (subRes) => {
                                        let subData = '';
                                        subRes.on('data', chunk => subData += chunk);
                                        subRes.on('end', () => {
                                            const result = JSON.parse(subData);
                                            console.log('✅ 电台启动:', result.message);
                                            console.log('\n⏳ 等待字幕数据...');
                                            console.log('=' .repeat(70));
                                        });
                                    });

                                    postReq.on('error', (err) => {
                                        console.error('❌ 调用订阅端点失败:', err.message);
                                    });

                                    postReq.write(postData);
                                    postReq.end();
                                }

                                if (msg.push && msg.push.pub && msg.push.pub.data) {
                                    const pushData = msg.push.pub.data;

                                    if (pushData.event === 'recognized') {
                                        subtitleCount++;
                                        console.log(`\n📺 [${subtitleCount}] 收到字幕:`);
                                        console.log(`   ${pushData.text}`);
                                    } else if (pushData.event === 'started') {
                                        console.log(`\n🚀 语音识别已启动`);
                                    } else {
                                        console.log(`\n📡 事件: ${pushData.event}`);
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
                    console.log(`📊 统计: 共 ${messageCount} 条消息, ${subtitleCount} 条字幕`);
                });
            });

            req.on('error', (error) => {
                console.error('❌ SSE 连接错误:', error.message);
            });

            // 60秒后关闭
            setTimeout(() => {
                console.log('\n\n⏱️ 测试结束');
                req.destroy();
                setTimeout(() => {
                    console.log(`\n📊 最终统计:`);
                    console.log(`   共收到消息: ${messageCount} 条`);
                    console.log(`   共收到字幕: ${subtitleCount} 条`);
                    if (subtitleCount > 0) {
                        console.log(`   ✅ 测试成功！`);
                    } else {
                        console.log(`   ⚠️  未收到字幕（可能当前无语音内容）`);
                    }
                    process.exit(0);
                }, 1000);
            }, 60000);

        } catch (error) {
            console.error('❌ 解析响应失败:', error.message);
            console.error('响应内容:', data);
            process.exit(1);
        }
    });
}).on('error', (error) => {
    console.error('❌ HTTPS 请求错误:', error.message);
    process.exit(1);
});
