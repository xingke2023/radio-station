const WebSocket = require('ws');

const STATION_CODE = 'msnbc';
const WS_URL = 'wss://radio.xingke888.com/centrifugo/connection/websocket';

console.log('🎬 测试 WebSocket 连接...\n');
console.log(`URL: ${WS_URL}\n`);

const ws = new WebSocket(WS_URL, {
    headers: {
        'Origin': 'https://us.xingke888.com'
    }
});

ws.on('open', function() {
    console.log('✅ WebSocket 连接已建立\n');

    // 发送连接消息（insecure 模式不需要 token）
    const connectMsg = {
        connect: {}
    };

    console.log('📤 发送连接消息:', JSON.stringify(connectMsg));
    ws.send(JSON.stringify(connectMsg));
});

ws.on('message', function(data) {
    console.log('📥 收到消息:', data.toString());

    try {
        const msg = JSON.parse(data.toString());

        if (msg.connect) {
            console.log('\n✅ Centrifugo 连接成功');
            console.log('   Client ID:', msg.connect.client);

            // 订阅频道
            const subscribeMsg = {
                subscribe: {
                    channel: `station:${STATION_CODE}`
                }
            };

            console.log('\n📤 发送订阅消息:', JSON.stringify(subscribeMsg));
            ws.send(JSON.stringify(subscribeMsg));
        }

        if (msg.subscribe) {
            console.log('\n✅ 频道订阅成功');
            console.log('   Channel:', `station:${STATION_CODE}`);
            console.log('\n⏳ 等待字幕数据...');
        }

        if (msg.push) {
            const data = msg.push.data;
            if (data && data.event === 'recognized') {
                console.log(`\n📺 收到字幕: ${data.text}`);
                console.log(`   翻译: ${data.translations}`);
            }
        }
    } catch (error) {
        console.error('❌ 解析消息失败:', error.message);
    }
});

ws.on('error', function(error) {
    console.error('❌ WebSocket 错误:', error.message);
});

ws.on('close', function(code, reason) {
    console.log(`\n🔌 WebSocket 连接已关闭 (code: ${code}, reason: ${reason})`);
});

// 30秒后关闭
setTimeout(() => {
    console.log('\n⏱️ 测试结束');
    ws.close();
    process.exit(0);
}, 30000);
