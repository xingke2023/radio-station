const WebSocket = require('ws');

const ws = new WebSocket("wss://radio.xingke888.com/centrifugo/connection/websocket");
let client_id = null;
let messageCount = 0;
let subtitleCount = 0;

console.log('🔌 正在连接到 Centrifugo WebSocket...');

ws.on('open', () => {
    console.log('✅ WebSocket 已连接');
    // 发送连接命令
    ws.send(JSON.stringify({
        id: 1,
        connect: {}
    }));
    console.log('📤 已发送 connect 命令');
});

ws.on('message', (data) => {
    messageCount++;
    const msg = JSON.parse(data.toString());

    // 处理 Centrifugo ping（空消息）
    if (Object.keys(msg).length === 0) {
        ws.send(JSON.stringify({}));  // 发送空对象作为 pong
        return;
    }

    // 处理连接响应
    if (msg.connect) {
        client_id = msg.connect.client;
        console.log('✅ 连接成功, client_id:', client_id);

        // 订阅 msnbc 频道
        ws.send(JSON.stringify({
            id: 2,
            subscribe: {
                channel: "station:msnbc"
            }
        }));
        console.log('📤 已发送 subscribe 命令订阅 station:msnbc');
    }

    // 处理订阅响应
    if (msg.subscribe) {
        console.log('✅ 订阅成功');
        console.log('⏳ 等待字幕数据...');
    }

    // 处理实时数据推送
    if (msg.push && msg.push.pub && msg.push.pub.data) {
        const data = msg.push.pub.data;
        subtitleCount++;

        if (data.event === 'recognized') {
            console.log(`\n📺 [${subtitleCount}] 收到字幕 (${new Date().toISOString()}):`);
            console.log(`   英文: ${data.text}`);
            console.log(`   翻译: ${data.translations}`);
            console.log(`   偏移: ${data.offset}ms, 时长: ${data.duration}ms`);
        } else if (data.event === 'recognizing') {
            console.log(`🎤 识别中: ${data.text} (offset: ${data.offset}ms)`);
        } else {
            console.log(`📨 收到事件: ${data.event}`);
        }
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket 错误:', error.message);
});

ws.on('close', () => {
    console.log(`\n🔌 WebSocket 已关闭`);
    console.log(`📊 统计: 共收到 ${messageCount} 条消息, ${subtitleCount} 条字幕`);
});

// 30秒后自动关闭
setTimeout(() => {
    console.log('\n⏱️ 测试时间到，关闭连接...');
    ws.close();
    process.exit(0);
}, 30000);
