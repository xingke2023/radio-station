// 测试 Centrifugo WebSocket 连接
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8000/connection/websocket';

console.log('🔍 测试 Centrifugo WebSocket 连接...');
console.log(`连接地址: ${WS_URL}\n`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
    console.log('✅ WebSocket 连接成功!');

    // 发送 Centrifugo connect 命令
    console.log('发送 connect 命令...');
    ws.send(JSON.stringify({
        id: 1,
        connect: {}
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // 处理 ping
    if (Object.keys(msg).length === 0) {
        console.log('📡 收到 ping, 发送 pong');
        ws.send(JSON.stringify({}));
        return;
    }

    console.log('📥 收到消息:', JSON.stringify(msg, null, 2));

    // 处理 connect 响应
    if (msg.connect) {
        console.log(`✅ Centrifugo 连接成功! Client ID: ${msg.connect.client}`);

        // 订阅频道
        console.log('尝试订阅频道 station:cnnnews...');
        ws.send(JSON.stringify({
            id: 2,
            subscribe: {
                channel: 'station:cnnnews'
            }
        }));
    }

    // 处理 subscribe 响应
    if (msg.subscribe) {
        console.log('✅ 订阅成功!');
        console.log('\n========== 连接测试完成 ==========');
        console.log('✅ WebSocket 连接正常');
        console.log('✅ Centrifugo 认证正常');
        console.log('✅ 频道订阅正常');
        console.log('\n监听实时数据中（30秒）...\n');

        // 30秒后关闭
        setTimeout(() => {
            console.log('测试完成，关闭连接');
            ws.close();
            process.exit(0);
        }, 30000);
    }

    // 处理实时数据推送
    if (msg.push && msg.push.pub && msg.push.pub.data) {
        const data = msg.push.pub.data;
        console.log(`\n📺 收到字幕事件: ${data.event}`);
        if (data.event === 'recognized') {
            console.log(`   英文: ${data.text}`);
            console.log(`   中文: ${data.translations}`);
            console.log(`   时间戳: offset=${data.offset}ms, duration=${data.duration}ms\n`);
        }
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error.message);
    process.exit(1);
});

ws.on('close', (code, reason) => {
    console.log(`WebSocket 连接关闭 (code: ${code}, reason: ${reason})`);
    process.exit(0);
});

// 超时保护
setTimeout(() => {
    console.error('❌ 连接超时（60秒）');
    ws.close();
    process.exit(1);
}, 60000);
