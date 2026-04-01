// 测试 Centrifugo subscribe webhook 是否工作
const WebSocket = require('ws');

console.log('🧪 测试 Centrifugo subscribe proxy...\n');

// 1. 连接到 Centrifugo WebSocket
const ws = new WebSocket('ws://localhost:8000/connection/websocket');

ws.on('open', () => {
    console.log('✅ WebSocket 连接已建立');

    // 2. 发送 connect 命令
    console.log('📤 发送 connect 命令...');
    ws.send(JSON.stringify({
        id: 1,
        connect: {}
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('📩 收到消息:', JSON.stringify(msg, null, 2));

    // 处理 ping
    if (Object.keys(msg).length === 0) {
        console.log('💓 收到 ping，发送 pong');
        ws.send(JSON.stringify({}));
        return;
    }

    // 处理 connect 响应
    if (msg.connect) {
        console.log('✅ 连接成功, client_id:', msg.connect.client);

        // 3. 订阅频道 - 这应该触发 subscribe webhook
        console.log('📤 发送 subscribe 命令到 station:msnbc...');
        console.log('⏳ 等待服务器调用 subscribe webhook...\n');

        ws.send(JSON.stringify({
            id: 2,
            subscribe: {
                channel: 'station:msnbc'
            }
        }));
    }

    // 处理 subscribe 响应
    if (msg.subscribe) {
        console.log('✅ 订阅成功!');
        console.log('📊 请检查服务器日志，应该看到:');
        console.log('   🟢🟢🟢 客户端连接');
        console.log('   🚀 这是首个连接，准备启动语音识别...');
        console.log('   ✅ 语音识别已启动\n');

        // 等待一会再关闭
        setTimeout(() => {
            console.log('🔄 测试完成，关闭连接...');
            ws.close();
        }, 3000);
    }

    // 处理数据推送
    if (msg.push && msg.push.pub && msg.push.pub.data) {
        const data = msg.push.pub.data;
        console.log('📥 收到推送数据:', data.event);
        if (data.event === 'recognized') {
            console.log('   英文:', data.text);
            console.log('   中文:', data.translations);
        }
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error.message);
});

ws.on('close', () => {
    console.log('🔴 WebSocket 连接已关闭');
    process.exit(0);
});

// 超时保护
setTimeout(() => {
    console.log('⏱️ 测试超时，退出...');
    ws.close();
    process.exit(1);
}, 30000);
