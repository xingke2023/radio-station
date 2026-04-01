// 测试带 token 的连接
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

console.log('🧪 测试带 token 的 WebSocket 连接\n');

// 生成连接 token
const centrifugoSecret = 'my-secret-key-change-this';
const connectionToken = jwt.sign({
    sub: 'android-client',  // 用户ID
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)  // 7天过期
}, centrifugoSecret);

console.log(`🔑 Token 已生成: ${connectionToken.substring(0, 30)}...\n`);

const wsUrl = 'wss://radio.xingke888.com/centrifugo/connection/websocket';
console.log(`📡 连接地址: ${wsUrl}\n`);

const ws = new WebSocket(wsUrl, {
    rejectUnauthorized: false
});

let clientId = null;
let connected = false;
let subscribed = false;

ws.on('open', () => {
    console.log('✅ WebSocket 连接已建立');
    connected = true;

    // 发送 connect 命令（带 token）
    console.log('📤 发送 connect 命令（带 token）...');
    ws.send(JSON.stringify({
        id: 1,
        connect: {
            token: connectionToken
        }
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // 处理 ping
    if (Object.keys(msg).length === 0) {
        console.log('💓 收到 ping，发送 pong');
        ws.send(JSON.stringify({}));
        return;
    }

    // 打印原始消息以便调试
    console.log('📩 收到消息:', JSON.stringify(msg, null, 2));

    // 处理 connect 响应
    if (msg.connect) {
        clientId = msg.connect.client;
        console.log(`✅ 连接成功!`);
        console.log(`   Client ID: ${clientId}`);
        console.log(`   Version: ${msg.connect.version}\n`);

        // 订阅频道
        console.log('📤 订阅频道: station:msnbc');
        console.log('   ⚠️ 此时应该触发 subscribe proxy webhook\n');
        ws.send(JSON.stringify({
            id: 2,
            subscribe: {
                channel: 'station:msnbc'
            }
        }));
    }

    // 处理错误
    if (msg.error) {
        console.error('❌ 错误:', msg.error);
    }

    // 处理 subscribe 响应
    if (msg.subscribe) {
        subscribed = true;
        console.log('✅ 订阅成功!\n');
        console.log('⏳ 等待接收实时字幕数据...\n');
        console.log('📋 检查服务器日志应该看到:');
        console.log('   🟢🟢🟢 客户端连接');
        console.log('   🚀 这是首个连接，准备启动语音识别...\n');
    }

    // 处理数据推送
    if (msg.push && msg.push.pub && msg.push.pub.data) {
        const data = msg.push.pub.data;

        if (data.event === 'started') {
            console.log('🎬 语音识别已启动');
        } else if (data.event === 'recognizing') {
            console.log(`🎤 [识别中] ${data.text.substring(0, 50)}...`);
        } else if (data.event === 'recognized') {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ [最终结果]');
            console.log(`   英文: ${data.text}`);
            console.log(`   中文: ${data.translations}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
    }
});

ws.on('error', (error) => {
    console.error('\n❌ WebSocket 错误:', error.message);
});

ws.on('close', (code, reason) => {
    console.log('\n🔴 WebSocket 连接已关闭');
    console.log(`   Code: ${code}`);
    console.log(`   Reason: ${reason || 'N/A'}`);
    process.exit(code === 1000 ? 0 : 1);
});

// 超时保护
setTimeout(() => {
    if (!subscribed) {
        console.error('\n⏱️ 测试超时 - 未收到字幕数据');
        console.error('   可能原因: subscribe proxy 未被调用');
    } else {
        console.log('\n✅ 测试完成');
    }
    ws.close();
}, 30000);
