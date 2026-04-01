# 客户端断线检测解决方案

## 问题背景

用户报告了一个关键问题：**"客户端断开，服务端并不知道"**

这是因为：
1. Centrifugo v6 **不支持 disconnect hooks**（官方设计决策）
2. 服务器无法检测到客户端的异常断开（网络中断、浏览器崩溃等）
3. 只能检测到正常的 unsubscribe 事件

## 官方说明

根据 Centrifugo 官方文档：https://centrifugal.dev/docs/server/proxy#why-centrifugo-does-not-have-disconnect-hooks

**为什么 Centrifugo 不支持 disconnect hooks：**

1. **节点意外宕机**：Centrifugo 节点崩溃时无法发送 disconnect 事件，导致状态不一致
2. **大规模并发问题**：百万级连接同时重连时会产生海量 disconnect 事件，可能造成系统过载
3. **竞态条件**：disconnect 事件可能在客户端已重连后才被处理，导致状态错误

**官方推荐的解决方案：**

> 使用**心跳 + 定期清理**模式：客户端定期 ping 后端更新状态，后端定期清理超时未更新的连接

**Centrifugo PRO 解决方案：**

Centrifugo PRO 版本通过 **Channel State Events** 功能解决了这个问题。

## 我们的实现方案

基于 Centrifugo 官方推荐，我们实现了以下解决方案：

### 架构概述

```
┌─────────────┐      心跳 HTTP POST      ┌──────────────┐
│   客户端     │ ──────────────────────> │  Node.js 后端 │
│             │    每 30 秒一次          │              │
│  (Browser)  │                          │ 78-sse-22.js │
│             │ <────────────────────── │              │
└─────────────┘  WebSocket 数据推送      └──────────────┘
                                               │
                                               │ 每 30 秒检查
                                               ↓
                                         清理超过 60 秒
                                         未心跳的客户端
```

### 核心组件

#### 1. 客户端心跳 API

**端点**: `POST /api/client/heartbeat`

**请求体**:
```json
{
  "client_id": "客户端唯一 ID",
  "channel": "station:msnbc"
}
```

**响应**:
```json
{
  "success": true,
  "timestamp": 1761647104428,
  "message": "Heartbeat received"
}
```

**如果客户端不存在**:
```json
{
  "success": false,
  "error": "Client not found in channel",
  "reconnect": true
}
```

**代码位置**: 78-sse-22.js:1492-1526

#### 2. 连接状态管理

使用内存 Map 存储每个客户端的最后心跳时间：

```javascript
stationManager.clientHeartbeats = new Map();
// 键格式: "station:msnbc:client-id-123"
// 值: timestamp (毫秒)
```

**代码位置**: 78-sse-22.js:1508-1511

#### 3. 定期清理任务

每 30 秒执行一次，检查并清理超过 60 秒未发送心跳的客户端。

**配置参数**:
- `HEARTBEAT_TIMEOUT = 60000` (60 秒)
- `CLEANUP_INTERVAL = 30000` (30 秒检查一次)

**清理逻辑**:
1. 遍历所有心跳记录
2. 找出超过 60 秒未心跳的客户端
3. 从连接列表中移除这些客户端
4. 如果某个频道没有客户端了，停止该频道的语音识别并释放资源

**代码位置**: 78-sse-22.js:1677-1756

**日志输出示例**:
```
======================================================================
⏱️⏱️⏱️ [2025-10-28T10:30:00.000Z] 检测到客户端超时断开
   📱 Client ID: timeout-test-client
   📡 Channel: station:msnbc
   ⏰ 最后心跳: 2025-10-28T10:28:00.000Z
   ⏳ 超时时长: 120 秒
   ✅ 已移除 - 当前频道剩余连接数: 0
   🛑 无客户端连接，准备停止语音识别...
   ✅ 语音识别已停止
   🔑 Azure 密钥已释放
   ✅ 所有资源已清理完成
======================================================================
```

### 客户端实现

#### JavaScript / 浏览器

```javascript
const ws = new WebSocket('wss://radio.xingke888.com/centrifugo/connection/websocket');
let clientId = null;
let heartbeatTimer = null;

ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // 处理 Centrifugo ping（必须响应！）
    if (Object.keys(msg).length === 0) {
        ws.send(JSON.stringify({}));
        return;
    }

    // 处理连接响应
    if (msg.connect) {
        clientId = msg.connect.client;
        startHeartbeat();  // 开始发送心跳
    }

    // 处理数据...
};

function startHeartbeat() {
    heartbeatTimer = setInterval(async () => {
        try {
            const response = await fetch('https://radio.xingke888.com/api/client/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: clientId,
                    channel: 'station:msnbc'
                })
            });

            const data = await response.json();
            if (data.reconnect) {
                // 服务器建议重新连接
                ws.close();
                location.reload();
            }
        } catch (error) {
            console.error('心跳失败:', error);
        }
    }, 30000);  // 30 秒
}

ws.onclose = () => {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }
};
```

#### Android (Kotlin)

```kotlin
class RadioClient {
    private var clientId: String? = null
    private var heartbeatJob: Job? = null

    fun onConnected(client: String) {
        clientId = client
        startHeartbeat()
    }

    private fun startHeartbeat() {
        heartbeatJob = CoroutineScope(Dispatchers.IO).launch {
            while (isActive) {
                delay(30000)  // 30 秒

                try {
                    val response = httpClient.post("https://radio.xingke888.com/api/client/heartbeat") {
                        contentType(ContentType.Application.Json)
                        setBody(mapOf(
                            "client_id" to clientId,
                            "channel" to "station:msnbc"
                        ))
                    }

                    val data = response.body<HeartbeatResponse>()
                    if (data.reconnect == true) {
                        // 重新连接
                        reconnect()
                    }
                } catch (e: Exception) {
                    Log.e("RadioClient", "心跳失败", e)
                }
            }
        }
    }

    fun onDisconnected() {
        heartbeatJob?.cancel()
    }
}
```

#### iOS (Swift)

```swift
class RadioClient {
    private var clientId: String?
    private var heartbeatTimer: Timer?

    func onConnected(client: String) {
        clientId = client
        startHeartbeat()
    }

    func startHeartbeat() {
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
            self?.sendHeartbeat()
        }
    }

    func sendHeartbeat() {
        guard let clientId = clientId else { return }

        let url = URL(string: "https://radio.xingke888.com/api/client/heartbeat")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = [
            "client_id": clientId,
            "channel": "station:msnbc"
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               json["reconnect"] as? Bool == true {
                // 重新连接
                self.reconnect()
            }
        }.resume()
    }

    func onDisconnected() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }
}
```

## 测试

### 测试脚本

已包含在 `test-client-disconnect.js` 中：

```bash
node test-client-disconnect.js
```

测试脚本会：
1. 连接到 Centrifugo
2. 订阅频道
3. 每 30 秒发送心跳
4. 显示心跳发送成功的日志

### 手动测试超时

```bash
# 运行测试脚本
bash /tmp/test-heartbeat-timeout.sh
```

此脚本会：
1. 模拟客户端连接
2. 发送一次心跳
3. 等待 70 秒（超过 60 秒超时阈值）
4. 查看服务器日志确认客户端被自动清理

## 监控

### 查看实时日志

```bash
# 查看所有日志
pm2 logs 78-sse-22

# 只看连接/断开事件
pm2 logs 78-sse-22 | grep -E "🟢🟢🟢|🔴🔴🔴|⏱️⏱️⏱️"

# 查看清理日志
pm2 logs 78-sse-22 | grep "清理完成"
```

### API 查询

```bash
# 查看活跃电台和客户端数
curl http://localhost:8533/api/stations | jq
```

## 优势

✅ **可靠性**：不会错过断线事件（只要定期清理在运行）
✅ **简单性**：不依赖 Centrifugo 的 disconnect proxy 功能
✅ **可调节**：可根据需求调整超时阈值和检查频率
✅ **资源高效**：自动停止无客户端的语音识别，释放 Azure 密钥
✅ **详细日志**：完整记录连接、断开和超时事件

## 劣势

⚠️ **检测延迟**：最多 90 秒才能检测到断线（60 秒超时 + 30 秒检查周期）
⚠️ **网络开销**：每个客户端每 30 秒发送一次 HTTP 请求
⚠️ **时钟依赖**：客户端和服务器需要相对准确的时钟

## 配置调整

如需更快的断线检测，可以调整参数：

```javascript
// 在 78-sse-22.js 的 startServer() 函数中
const HEARTBEAT_TIMEOUT = 30000;  // 30 秒超时（更快）
const CLEANUP_INTERVAL = 15000;   // 15 秒检查一次（更频繁）
```

对应的客户端心跳间隔也需要调整：

```javascript
// 客户端代码
const heartbeatInterval = 15000;  // 15 秒发送一次
```

**推荐配置**：
- 心跳间隔：15-30 秒
- 超时阈值：30-60 秒（= 2x 心跳间隔）
- 检查频率：15-30 秒

## 未来改进

1. **使用 Redis 存储心跳数据**：支持多服务器部署
2. **心跳批量处理**：一次请求更新多个客户端状态
3. **自适应超时**：根据网络状况动态调整
4. **升级到 Centrifugo PRO**：使用官方的 Channel State Events 功能

## 相关文档

- [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md) - 客户端 ping/pong 处理
- [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) - 完整项目文档
- [Centrifugo 官方文档](https://centrifugal.dev/docs/server/proxy#why-centrifugo-does-not-have-disconnect-hooks)

## 更新记录

- **2025-10-28**: 实现心跳机制，解决客户端断线检测问题
- **2025-10-28**: 修复 channel 解析错误（lastIndexOf bug fix）
- **2025-10-28**: 完成文档和测试

---

**总结**：通过实现官方推荐的心跳 + 定期清理方案，我们成功解决了 Centrifugo 不支持 disconnect hooks 的问题，实现了可靠的客户端断线检测机制。
