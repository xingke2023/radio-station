# Centrifugo 客户端连接重要备忘

> **🔴 关键信息：所有客户端必须正确处理 Centrifugo 的应用层 ping/pong，否则连接会在 25-35 秒后断开！**

---

## 问题现象

客户端在订阅成功后约 **25-35 秒自动断开连接**，关闭代码：`3012: no pong`

---

## 根本原因

### Centrifugo 配置（服务器端）

```json
{
  "client": {
    "ping_interval": "25s",    // 每 25 秒发送 ping
    "pong_timeout": "10s"      // 等待 10 秒 pong 响应
  }
}
```

### 心跳机制

Centrifugo 使用 **双层心跳**：

1. **WebSocket 协议层 ping/pong**
   - 由浏览器/WebSocket 库自动处理
   - 不需要应用层代码

2. **应用层 ping/pong** ⚠️ **需要客户端代码处理**
   - 格式：空 JSON 对象 `{}`
   - Centrifugo 每 25 秒发送空消息
   - 客户端必须在 10 秒内响应空消息
   - 如果不响应，Centrifugo 会断开连接

### 时间线

```
t=0s    : 客户端连接并订阅成功
t=25s   : Centrifugo 发送 ping (空消息 {})
          客户端必须响应 {}
t=35s   : 如果未收到响应，Centrifugo 断开连接 (3012: no pong)
```

---

## 解决方案

### 1. 浏览器/JavaScript 客户端

```javascript
const ws = new WebSocket("wss://radio.xingke888.com/centrifugo/connection/websocket");

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  // ⚠️ 关键：处理 ping（空消息）
  if (Object.keys(msg).length === 0) {
    ws.send(JSON.stringify({}));  // 发送空对象作为 pong
    return;
  }

  // 处理连接响应
  if (msg.connect) {
    console.log('已连接:', msg.connect.client);
    ws.send(JSON.stringify({
      id: 2,
      subscribe: { channel: "station:msnbc" }
    }));
  }

  // 处理数据推送
  if (msg.push && msg.push.pub && msg.push.pub.data) {
    const data = msg.push.pub.data;
    console.log('收到数据:', data);
  }
};

ws.onopen = () => {
  // Centrifugo v5+ 需要 id 字段
  ws.send(JSON.stringify({
    id: 1,
    connect: {}  // insecure 模式不需要 token
  }));
};
```

### 2. Android/Kotlin 客户端 (OkHttp)

```kotlin
// ❌ 错误做法：设置 WebSocket ping
private val client = OkHttpClient.Builder()
    .pingInterval(25, TimeUnit.SECONDS)  // 会导致冲突！
    .build()

// ✅ 正确做法：不设置 pingInterval，响应应用层 ping
private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MINUTES)  // 无限读取超时
    .retryOnConnectionFailure(true)
    .build()

override fun onMessage(webSocket: WebSocket, text: String) {
    val msg = JSONObject(text)

    // ⚠️ 关键：处理 ping（空消息）
    if (msg.length() == 0) {
        webSocket.send("{}")  // 响应 pong
        return
    }

    // 处理其他消息
    when {
        msg.has("connect") -> {
            val clientId = msg.getJSONObject("connect").getString("client")
            // 订阅频道
            val subscribeMsg = JSONObject().apply {
                put("id", 2)
                put("subscribe", JSONObject().apply {
                    put("channel", "station:msnbc")
                })
            }
            webSocket.send(subscribeMsg.toString())
        }
        msg.has("push") -> {
            val data = msg.getJSONObject("push")
                .getJSONObject("pub")
                .getJSONObject("data")
            // 处理数据
        }
    }
}
```

### 3. iOS/Swift 客户端

```swift
func webSocket(_ webSocket: URLSessionWebSocket, didReceiveMessage message: URLSessionWebSocketTask.Message) {
    guard case .string(let text) = message else { return }

    if let data = text.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {

        // ⚠️ 关键：处理 ping（空消息）
        if json.isEmpty {
            let pong = "{}"
            webSocket.send(.string(pong)) { error in
                if let error = error {
                    print("发送 pong 失败: \(error)")
                }
            }
            return
        }

        // 处理其他消息
        if let connect = json["connect"] as? [String: Any] {
            // 连接成功
        }
        if let push = json["push"] as? [String: Any] {
            // 处理数据
        }
    }
}
```

---

## 协议规范

### Centrifugo v5+ WebSocket 协议

1. **连接命令**
```json
{
  "id": 1,
  "connect": {}
}
```

2. **订阅命令**
```json
{
  "id": 2,
  "subscribe": {
    "channel": "station:msnbc"
  }
}
```

3. **Ping 消息**（服务器 → 客户端）
```json
{}
```

4. **Pong 响应**（客户端 → 服务器）
```json
{}
```

5. **数据推送**（服务器 → 客户端）
```json
{
  "push": {
    "channel": "station:msnbc",
    "pub": {
      "data": {
        "event": "recognized",
        "text": "Hello",
        "translations": "你好"
      }
    }
  }
}
```

---

## 测试验证

### 验证清单

- [ ] 连接能保持 **60 秒以上**不断开
- [ ] 在日志中能看到 **ping/pong** 交互
- [ ] 持续接收数据推送
- [ ] 没有 `3012: no pong` 错误

### 测试脚本（Node.js）

```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8000/connection/websocket');

ws.on('open', () => {
    console.log('✅ 已连接');
    ws.send(JSON.stringify({ id: 1, connect: {} }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    // 处理 ping
    if (Object.keys(msg).length === 0) {
        console.log('🏓 收到 ping, 发送 pong');
        ws.send(JSON.stringify({}));
        return;
    }

    // 连接成功后订阅
    if (msg.connect) {
        console.log('✅ 连接成功:', msg.connect.client);
        ws.send(JSON.stringify({
            id: 2,
            subscribe: { channel: "station:msnbc" }
        }));
    }

    // 订阅成功
    if (msg.subscribe) {
        console.log('✅ 订阅成功');
    }

    // 接收数据
    if (msg.push) {
        console.log('📥 收到数据:', msg.push.pub.data.event);
    }
});

ws.on('close', (code, reason) => {
    console.log(`❌ 断开连接: ${code} - ${reason}`);
});
```

运行后应该保持连接超过 60 秒，并看到定期的 ping/pong 日志。

---

## 常见错误

### ❌ 错误 1：忽略空消息

```javascript
// 错误：跳过空消息
if (Object.keys(msg).length === 0) {
    return;  // ❌ 没有响应 pong，会导致断开
}
```

### ❌ 错误 2：设置 WebSocket ping

```kotlin
// 错误：OkHttp 的 WebSocket ping 与 Centrifugo 冲突
.pingInterval(25, TimeUnit.SECONDS)  // ❌ 不要设置
```

### ❌ 错误 3：协议格式错误

```javascript
// 错误：Centrifugo v5+ 需要 id 字段
ws.send(JSON.stringify({
    connect: { token: "..." }  // ❌ 缺少 id 字段
}));

// 正确
ws.send(JSON.stringify({
    id: 1,  // ✅ 必须有 id
    connect: {}
}));
```

---

## 相关文档

- [android-ping-fix.md](./android-ping-fix.md) - Android 客户端详细解决方案
- [78-sse-22.js](./78-sse-22.js:1169-1218) - 服务器端返回的客户端示例代码
- [Centrifugo 官方文档](https://centrifugal.dev/docs/transports/websocket)

---

## 更新记录

- **2025-10-28**: 创建备忘文档，记录 ping/pong 机制和解决方案
- 问题排查过程：客户端断开 → 发现 `3012: no pong` → 分析 Centrifugo 配置 → 识别空消息为 ping → 添加 pong 响应 → 测试验证成功

---

## 紧急提示

**如果你在开发新的客户端，第一件事就是实现 ping/pong 处理！**

```
1. 检测空消息 {}
2. 立即响应空消息 {}
3. 不要设置额外的 WebSocket ping
```

**这是确保连接稳定的最关键因素！**
