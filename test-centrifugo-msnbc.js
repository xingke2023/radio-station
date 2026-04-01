const WebSocket = require('ws');

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJyYWRpby1jbGllbnQiLCJleHAiOjE3NjIyMzQ2NDQsImlhdCI6MTc2MTYyOTg0NH0.9iWITUfQu-SBH2wcmdCl4wA1TDVXJyKPDGTMoe-oLy0";
const WS_URL = "ws://localhost:8000/connection/websocket"; // 本地测试
const CHANNEL = "station:msnbc";

console.log('🔗 连接到 Centrifugo...\n');

const ws = new WebSocket(WS_URL);
let client_id = null;

ws.on('open', () => {
    console.log('✅ WebSocket 已连接');
    console.log('📤 发送 connect 命令...\n');

    // 1. 发送连接命令 (Centrifugo v6 bidirectional protocol)
    ws.send(JSON.stringify({
        id: 1,
        connect: {
            token: TOKEN
        }
    }));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());

        // 2. 处理连接响应
        if (msg.connect) {
            client_id = msg.connect.client;
            console.log('✅ Centrifugo 连接成功');
            console.log('   Client ID:', client_id);
            console.log('📤 发送 subscribe 命令...\n');

            // 3. 连接成功后订阅频道
            ws.send(JSON.stringify({
                id: 2,
                subscribe: {
                    channel: CHANNEL
                }
            }));
        }

        // 4. 处理订阅响应
        if (msg.subscribe) {
            console.log('✅ 订阅成功:', CHANNEL);
            console.log('⏳ 等待实时数据推送...\n');
        }

        // 5. 处理实时数据推送
        if (msg.push && msg.push.pub && msg.push.pub.data) {
            const pushData = msg.push.pub.data;

            if (pushData.event === 'started') {
                console.log('🎬 [Started]', pushData.message);
                if (pushData.keyName) {
                    console.log('   密钥:', pushData.keyName, '(' + pushData.region + ')');
                }
            } else if (pushData.event === 'recognizing') {
                console.log('🎤 [Recognizing]');
                console.log('   英文:', pushData.text || '(无)');
                console.log('   中文:', pushData.translations || '(无)');
            } else if (pushData.event === 'recognized') {
                console.log('✅ [Recognized]');
                console.log('   英文:', pushData.text || '(无)');
                console.log('   中文:', pushData.translations || '(无)');
            } else if (pushData.event === 'text') {
                console.log('📝 [Text]', pushData.text);
            } else if (pushData.event === 'translation') {
                console.log('🌐 [Translation]', pushData.translations);
            } else if (pushData.event === 'error') {
                console.log('❌ [Error]', pushData.message);
            } else if (pushData.event === 'canceled') {
                console.log('⚠️  [Canceled]', pushData.message);
            } else if (pushData.event === 'reconnecting') {
                console.log('🔄 [Reconnecting]', pushData.message);
            } else {
                console.log('📦 [' + pushData.event + ']', JSON.stringify(pushData, null, 2));
            }
        }
    } catch (err) {
        console.error('❌ 解析消息失败:', err.message);
        console.log('   原始数据:', data.toString());
    }
});

ws.on('error', (err) => {
    console.error('❌ WebSocket 错误:', err.message);
});

ws.on('close', () => {
    console.log('\n🔴 WebSocket 已关闭');
    process.exit(0);
});

// 60秒后自动关闭
setTimeout(() => {
    console.log('\n⏰ 60秒测试完成，关闭连接');
    ws.close();
}, 60000);
