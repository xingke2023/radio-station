const WebSocket = require('ws');
const axios = require('axios');

const STATION_CODE = 'msnbc';
const API_URL = 'http://localhost:8533';
const WS_URL = 'wss://radio.xingke888.com/centrifugo/connection/websocket';

let subtitleCount = 0;
let ws = null;

console.log('🎬 开始完整测试流程...\n');

// 步骤1: 先调用 /events 端点获取连接信息（模拟浏览器行为）
console.log(`步骤1: 调用 GET ${API_URL}/events?station_code=${STATION_CODE}`);
axios.get(`${API_URL}/events`, {
    params: { station_code: STATION_CODE }
})
.then(response => {
    console.log('✅ 获取连接信息成功');
    console.log('   频道:', response.data.centrifugo.channel);
    console.log('   电台:', response.data.centrifugo.station.name);

    // 步骤2: 延迟1秒后连接 WebSocket
    console.log('\n步骤2: 延迟1秒后连接 Centrifugo WebSocket...');
    setTimeout(() => {
        connectWebSocket();
    }, 1000);
})
.catch(error => {
    console.error('❌ 获取连接信息失败:', error.message);
    process.exit(1);
});

function connectWebSocket() {
    console.log(`\n步骤3: 连接 WebSocket: ${WS_URL}`);
    ws = new WebSocket(WS_URL);

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
        const msg = JSON.parse(data.toString());

        // 处理 Centrifugo ping（空消息）
        if (Object.keys(msg).length === 0) {
            ws.send(JSON.stringify({}));
            return;
        }

        // 处理连接响应
        if (msg.connect) {
            const client_id = msg.connect.client;
            console.log('✅ 连接成功, client_id:', client_id);

            // 订阅频道
            console.log(`\n步骤4: 订阅频道 station:${STATION_CODE}`);
            ws.send(JSON.stringify({
                id: 2,
                subscribe: {
                    channel: `station:${STATION_CODE}`
                }
            }));
            console.log('📤 已发送 subscribe 命令');
        }

        // 处理订阅响应
        if (msg.subscribe) {
            console.log('✅ 订阅成功');
            console.log('\n步骤5: 等待字幕数据...');
            console.log('=' .repeat(70));
        }

        // 处理实时数据推送
        if (msg.push && msg.push.pub && msg.push.pub.data) {
            const data = msg.push.pub.data;

            if (data.event === 'recognized') {
                subtitleCount++;
                console.log(`\n📺 [${subtitleCount}] 收到字幕 (${new Date().toISOString()}):`);
                console.log(`   英文: ${data.text}`);
                console.log(`   翻译: ${data.translations}`);
                console.log(`   偏移: ${data.offset}ms, 时长: ${data.duration}ms`);
            } else if (data.event === 'recognizing') {
                process.stdout.write(`🎤 识别中: ${data.text.substring(0, 50)}...\r`);
            } else if (data.event === 'connected' || data.event === 'starting') {
                console.log(`\n📡 事件: ${data.event} - ${data.message || ''}`);
            } else {
                console.log(`\n📨 收到事件: ${data.event}`, data.message || '');
            }
        }
    });

    ws.on('error', (error) => {
        console.error('\n❌ WebSocket 错误:', error.message);
    });

    ws.on('close', () => {
        console.log(`\n🔌 WebSocket 已关闭`);
        console.log(`\n📊 测试结果:`);
        console.log(`   共收到字幕: ${subtitleCount} 条`);
        if (subtitleCount > 0) {
            console.log(`   ✅ 测试成功！字幕系统正常工作`);
        } else {
            console.log(`   ❌ 测试失败：未收到任何字幕`);
        }
    });
}

// 60秒后自动关闭
setTimeout(() => {
    console.log('\n\n⏱️ 测试时间到（60秒），关闭连接...');
    if (ws) {
        ws.close();
    }
    setTimeout(() => process.exit(0), 1000);
}, 60000);
