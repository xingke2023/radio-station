// 测试远程客户端连接（模拟安卓客户端）
const WebSocket = require('ws');

console.log('🧪 测试远程客户端连接（模拟安卓）\n');

// 使用 WSS 协议连接到远程服务器
const wsUrl = 'wss://radio.xingke888.com/centrifugo/connection/websocket';
console.log(`📡 连接地址: ${wsUrl}\n`);

const ws = new WebSocket(wsUrl, {
    rejectUnauthorized: false, // 开发环境可以忽略证书验证
    headers: {
        'User-Agent': 'Android-Radio-App/1.0'
    }
});

let clientId = null;
let connected = false;
let subscribed = false;

ws.on('open', () => {
    console.log('✅ WebSocket 连接已建立');
    connected = true;

    // 发送 connect 命令
    console.log('📤 发送 connect 命令...');
    ws.send(JSON.stringify({
        id: 1,
        connect: {}
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

    // 处理 connect 响应
    if (msg.connect) {
        clientId = msg.connect.client;
        console.log(`✅ 连接成功!`);
        console.log(`   Client ID: ${clientId}`);
        console.log(`   Version: ${msg.connect.version}`);
        console.log(`   Ping interval: ${msg.connect.ping}s\n`);

        // 订阅频道
        console.log('📤 订阅频道: station:msnbc');
        ws.send(JSON.stringify({
            id: 2,
            subscribe: {
                channel: 'station:msnbc'
            }
        }));
    }

    // 处理 subscribe 响应
    if (msg.subscribe) {
        subscribed = true;
        console.log('✅ 订阅成功!\n');
        console.log('⏳ 等待接收实时字幕数据...\n');
    }

    // 处理数据推送
    if (msg.push && msg.push.pub && msg.push.pub.data) {
        const data = msg.push.pub.data;

        if (data.event === 'started') {
            console.log('🎬 语音识别已启动');
        } else if (data.event === 'recognizing') {
            // 只显示部分中间结果，避免日志过多
            if (Math.random() < 0.3) {
                console.log(`🎤 [识别中] ${data.text.substring(0, 50)}...`);
            }
        } else if (data.event === 'recognized') {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('✅ [最终结果]');
            console.log(`   英文: ${data.text}`);
            console.log(`   中文: ${data.translations}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        } else if (data.event === 'heartbeat') {
            console.log('💓 收到服务器心跳');
        } else if (data.event === 'error') {
            console.error('❌ 错误:', data.message);
        }
    }
});

ws.on('error', (error) => {
    console.error('\n❌ WebSocket 错误:');
    console.error(`   ${error.message}`);

    if (!connected) {
        console.error('\n可能的原因:');
        console.error('   1. 网络连接问题');
        console.error('   2. Nginx 反向代理配置错误');
        console.error('   3. Centrifugo 服务未运行');
        console.error('   4. SSL 证书问题');
    }
});

ws.on('close', (code, reason) => {
    console.log('\n🔴 WebSocket 连接已关闭');
    console.log(`   Code: ${code}`);
    console.log(`   Reason: ${reason || 'N/A'}`);

    if (!connected) {
        console.error('\n⚠️ 连接失败 - 从未成功建立连接');
    } else if (!subscribed) {
        console.error('\n⚠️ 订阅失败 - 连接成功但无法订阅频道');
    }

    process.exit(code === 1000 ? 0 : 1);
});

// 超时保护
setTimeout(() => {
    if (!connected) {
        console.error('\n⏱️ 连接超时 (30秒)');
        ws.close();
    } else if (!subscribed) {
        console.error('\n⏱️ 订阅超时 (30秒)');
        ws.close();
    } else {
        console.log('\n✅ 测试成功! 连接正常工作 30 秒后自动关闭');
        ws.close();
    }
}, 30000);

// 处理进程退出
process.on('SIGINT', () => {
    console.log('\n\n⏸️ 用户中断，关闭连接...');
    ws.close();
    process.exit(0);
});
