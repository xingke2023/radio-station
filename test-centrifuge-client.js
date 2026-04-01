const { Centrifuge } = require('centrifuge');

const STATION_CODE = 'msnbc';
const WS_URL = 'wss://radio.xingke888.com/centrifugo/connection/websocket';

console.log('🎬 测试 Centrifuge 客户端连接...\n');
console.log(`URL: ${WS_URL}`);
console.log(`Station: ${STATION_CODE}\n`);

// 创建 Centrifuge 客户端
const centrifuge = new Centrifuge(WS_URL, {
    debug: true
});

// 连接事件
centrifuge.on('connected', (ctx) => {
    console.log('\n✅ Centrifuge 连接成功');
    console.log('   Client ID:', ctx.client);
    console.log('   Transport:', ctx.transport);

    // 订阅频道
    const sub = centrifuge.newSubscription(`station:${STATION_CODE}`);

    sub.on('publication', (ctx) => {
        const data = ctx.data;

        if (data.event === 'recognized') {
            console.log(`\n📺 收到字幕: ${data.text}`);
            if (data.translations) {
                console.log(`   翻译: ${data.translations}`);
            }
        } else if (data.event === 'recognizing') {
            console.log(`🎤 识别中: ${data.text}`);
        } else if (data.event === 'started') {
            console.log(`🚀 语音识别已启动`);
        } else {
            console.log(`📡 事件: ${data.event}`, data);
        }
    });

    sub.on('subscribed', (ctx) => {
        console.log('\n✅ 频道订阅成功');
        console.log('   Channel: station:' + STATION_CODE);
        console.log('\n⏳ 等待字幕数据...');
    });

    sub.on('subscribing', (ctx) => {
        console.log('📤 正在订阅频道...');
    });

    sub.on('error', (ctx) => {
        console.error('❌ 订阅错误:', ctx);
    });

    sub.subscribe();
});

centrifuge.on('connecting', (ctx) => {
    console.log('📡 正在连接...');
});

centrifuge.on('disconnected', (ctx) => {
    console.log('\n🔌 连接已断开');
    console.log('   Code:', ctx.code);
    console.log('   Reason:', ctx.reason);
});

centrifuge.on('error', (ctx) => {
    console.error('\n❌ Centrifuge 错误:', ctx);
});

// 开始连接
console.log('开始连接...');
centrifuge.connect();

// 30秒后关闭
setTimeout(() => {
    console.log('\n\n⏱️ 测试结束');
    centrifuge.disconnect();
    process.exit(0);
}, 30000);
