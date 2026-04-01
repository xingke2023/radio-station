const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const centrifugoSecret = 'my-secret-key-change-this';
const stationCode = 'msnbc';
const heartbeatInterval = 30000; // 30 秒发送一次心跳

// 生成连接令牌
const connectionToken = jwt.sign({
    sub: 'radio-client',
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
}, centrifugoSecret);

console.log('🔗 连接到 Centrifugo...');
console.log('Token:', connectionToken);

const ws = new WebSocket('ws://localhost:8000/connection/websocket');
let clientId = null;
let startTime = Date.now();
let heartbeatTimer = null;

ws.on('open', () => {
    console.log('✅ WebSocket 连接已建立');

    // Centrifugo v5+ 协议格式：需要 id 字段
    const connectMsg = {
        id: 1,
        connect: {}
    };
    console.log('📤 发送 connect 命令:', JSON.stringify(connectMsg));
    ws.send(JSON.stringify(connectMsg));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // 跳过空消息，但先检查是否是 ping
    if (Object.keys(msg).length === 0) {
        console.log(`\n[${elapsed}s] 🏓 收到空消息 (可能是 ping), 发送空对象作为 pong...`);
        ws.send(JSON.stringify({}));
        return;
    }

    console.log(`\n[${elapsed}s] 📨 收到消息:`, JSON.stringify(msg, null, 2));

    // 处理连接响应
    if (msg.connect) {
        clientId = msg.connect.client;
        console.log(`✅ [${elapsed}s] 连接成功, client_id: ${clientId}`);

        // 订阅频道（Centrifugo v5+ 需要 id 字段）
        const subscribeMsg = {
            id: 2,
            subscribe: {
                channel: `station:${stationCode}`
            }
        };
        console.log(`📤 [${elapsed}s] 发送 subscribe 命令:`, JSON.stringify(subscribeMsg));
        ws.send(JSON.stringify(subscribeMsg));
    }

    // 处理订阅响应
    if (msg.subscribe) {
        console.log(`✅ [${elapsed}s] 订阅成功`);

        // 订阅成功后，开始发送心跳
        if (!heartbeatTimer) {
            startHeartbeat();
        }
    }

    // 处理推送消息
    if (msg.push && msg.push.data) {
        const event = msg.push.data.event;
        console.log(`📥 [${elapsed}s] 收到事件: ${event}`);

        if (event === 'recognized') {
            console.log(`   英文: ${msg.push.data.text}`);
            console.log(`   中文: ${msg.push.data.translations}`);
        }
    }
});

ws.on('ping', (data) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🏓 [${elapsed}s] 收到 ping`);
});

ws.on('pong', (data) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`🏓 [${elapsed}s] 收到 pong`);
});

ws.on('close', (code, reason) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n❌ [${elapsed}s] WebSocket 连接已关闭`);
    console.log(`   关闭代码: ${code}`);
    console.log(`   关闭原因: ${reason.toString() || '无'}`);

    // 停止心跳
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    process.exit(0);
});

ws.on('error', (error) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ [${elapsed}s] WebSocket 错误:`, error.message);
});

// 定期输出连接状态
setInterval(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  [${elapsed}s] 连接状态: ${ws.readyState === WebSocket.OPEN ? '已连接' : '已断开'}`);
}, 30000);

// 心跳发送函数
function startHeartbeat() {
    console.log(`\n💓 开始发送心跳 (间隔 ${heartbeatInterval / 1000} 秒)...`);

    heartbeatTimer = setInterval(async () => {
        if (!clientId) {
            console.log('⚠️  客户端 ID 未设置，跳过心跳');
            return;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        try {
            const response = await axios.post('http://localhost:8533/api/client/heartbeat', {
                client_id: clientId,
                channel: `station:${stationCode}`
            });

            if (response.data.success) {
                console.log(`💓 [${elapsed}s] 心跳已发送 - 服务器时间: ${new Date(response.data.timestamp).toISOString()}`);
            } else {
                console.log(`⚠️  [${elapsed}s] 心跳失败: ${response.data.error}`);
                if (response.data.reconnect) {
                    console.log('🔄 服务器建议重新连接');
                }
            }
        } catch (error) {
            console.error(`❌ [${elapsed}s] 发送心跳失败: ${error.message}`);
        }
    }, heartbeatInterval);
}

// 捕获退出信号
process.on('SIGINT', () => {
    console.log('\n\n🛑 收到退出信号，关闭连接...');

    // 停止心跳
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    ws.close(1000, '客户端主动关闭');
});

console.log('\n按 Ctrl+C 退出\n');
