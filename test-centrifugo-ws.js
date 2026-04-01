const WebSocket = require('ws');

console.log('连接到 Centrifugo WebSocket...');
const ws = new WebSocket('ws://localhost:8000/connection/websocket');

ws.on('open', function open() {
  console.log('✅ WebSocket 连接成功');
  
  // 发送 connect 命令
  console.log('发送 connect 命令...');
  ws.send(JSON.stringify({
    id: 1,
    connect: {}
  }));
});

ws.on('message', function incoming(data) {
  console.log('收到消息:', data.toString());
  const msg = JSON.parse(data.toString());
  
  // 如果是空消息（ping），回复 pong
  if (Object.keys(msg).length === 0) {
    console.log('收到 ping，发送 pong');
    ws.send(JSON.stringify({}));
    return;
  }
  
  // 如果是 connect 响应
  if (msg.connect) {
    console.log('✅ 连接成功, client_id:', msg.connect.client);
    
    // 发送 subscribe 命令
    console.log('发送 subscribe 命令到 station:msnbc...');
    ws.send(JSON.stringify({
      id: 2,
      subscribe: {
        channel: 'station:msnbc'
      }
    }));
  }
  
  // 如果是 subscribe 响应
  if (msg.subscribe) {
    console.log('✅ 订阅成功');
  }
  
  // 如果是推送消息
  if (msg.push && msg.push.pub && msg.push.pub.data) {
    const data = msg.push.pub.data;
    console.log('📨 收到推送:', data.event, data.text);
  }
});

ws.on('error', function error(err) {
  console.error('❌ WebSocket 错误:', err.message);
});

ws.on('close', function close() {
  console.log('WebSocket 连接已关闭');
  process.exit(0);
});

// 30秒后关闭
setTimeout(() => {
  console.log('测试完成，关闭连接');
  ws.close();
}, 30000);
