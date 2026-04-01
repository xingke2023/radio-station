# Android 客户端 Ping/Pong 问题解决方案

## 🔴 问题分析

**错误信息**: `sent ping but didn't receive pong within 25000ms`

### 原因
1. **客户端设置**: `pingInterval(25, TimeUnit.SECONDS)` - 每 25 秒发送 ping
2. **服务器未配置**: Centrifugo 默认不响应客户端的 WebSocket ping
3. **结果**: 客户端等待 25 秒后没收到 pong，认为连接死了，主动断开

## ✅ 解决方案

### 方案 1: 禁用客户端 WebSocket Ping（推荐）

Centrifugo 有自己的心跳机制，不需要 OkHttp 的 WebSocket ping。

```kotlin
private val httpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MINUTES)  // 无限读取超时
    .writeTimeout(15, TimeUnit.SECONDS)
    // ❌ 移除这行: .pingInterval(25, TimeUnit.SECONDS)
    .retryOnConnectionFailure(true)
    .build()
```

**为什么移除 pingInterval?**
- Centrifugo 使用应用层心跳（JSON 消息）
- WebSocket 层 ping 是可选的
- Centrifugo 每 25 秒会发送 JSON ping 消息，客户端需要响应

### 方案 2: 响应 Centrifugo 的心跳（应用层）

Centrifugo 会定期发送心跳消息，客户端应该响应：

```kotlin
// 在 CentrifugoMessage 数据类中添加
data class CentrifugoMessage(
    val id: Int? = null,
    val connect: ConnectResult? = null,
    val subscribe: SubscribeResult? = null,
    val push: PushMessage? = null,
    val ping: Map<String, Any>? = null,  // ✅ 添加 ping
    val error: ErrorResponse? = null
)

// 在 handleMessage 中处理 ping
private fun handleMessage(text: String) {
    try {
        val message = gson.fromJson(text, CentrifugoMessage::class.java)

        when {
            // ✅ 响应心跳
            message.ping != null -> {
                val pongMsg = mapOf("pong" to emptyMap<String, Any>())
                val json = gson.toJson(pongMsg)
                webSocket?.send(json)
                Log.d(tag, "💓 发送 pong 响应")
            }

            message.connect != null -> {
                // ... 处理连接
            }
            // ... 其他处理
        }
    } catch (e: Exception) {
        Log.e(tag, "❌ 解析消息失败: ${e.message}", e)
    }
}
```

### 方案 3: 完整的改进客户端

```kotlin
package com.example.radio.client

import android.util.Log
import com.example.radio.models.*
import com.google.gson.Gson
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class SubtitleClientPingFixed(
    private val stationCode: String = "msnbc",
    private val apiBaseUrl: String = "https://radio.xingke888.com"
) {
    private val tag = "SubtitleClient"
    private val gson = Gson()

    // ✅ 修改：移除 pingInterval
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MINUTES)  // 无限读取超时
        .writeTimeout(15, TimeUnit.SECONDS)
        // ❌ 不使用 WebSocket ping: .pingInterval(25, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var webSocket: WebSocket? = null
    private var clientId: String? = null

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    private val _subtitleFlow = MutableStateFlow<SubtitleData?>(null)
    val subtitleFlow: StateFlow<SubtitleData?> = _subtitleFlow

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var connectionToken: String? = null
    private var wsUrl: String? = null
    private var channelName: String = "station:$stationCode"

    // 重连配置
    private var reconnectAttempts = 0
    private val maxReconnectAttempts = 10
    private val reconnectDelayMs = 3000L
    private val isReconnecting = AtomicBoolean(false)
    private val shouldStayConnected = AtomicBoolean(false)

    // 心跳监控（监控消息接收）
    private var lastMessageTime = 0L
    private var heartbeatJob: Job? = null
    private val messageTimeoutMs = 120000L  // 120秒无任何消息则重连

    fun connect() {
        shouldStayConnected.set(true)
        reconnectAttempts = 0
        connectInternal()
    }

    private fun connectInternal() {
        if (isReconnecting.get()) return

        scope.launch {
            try {
                _connectionState.value = ConnectionState.CONNECTING
                Log.d(tag, "正在获取连接信息... (尝试 ${reconnectAttempts + 1}/$maxReconnectAttempts)")

                val connectionInfo = fetchConnectionInfo()
                connectionToken = connectionInfo.token
                wsUrl = connectionInfo.wsUrl
                channelName = connectionInfo.channel

                Log.d(tag, "WebSocket URL: $wsUrl")

                connectWebSocket()
                startHeartbeatMonitor()

            } catch (e: Exception) {
                Log.e(tag, "连接失败: ${e.message}", e)
                handleConnectionError()
            }
        }
    }

    private suspend fun fetchConnectionInfo(): ConnectionInfo = withContext(Dispatchers.IO) {
        val url = "$apiBaseUrl/events?station_code=$stationCode"
        val request = Request.Builder().url(url).get().build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("HTTP ${response.code}: ${response.message}")
            }

            val body = response.body?.string() ?: throw Exception("响应体为空")
            val jsonObject = gson.fromJson(body, Map::class.java)

            @Suppress("UNCHECKED_CAST")
            val centrifugo = jsonObject["centrifugo"] as? Map<String, Any>
                ?: throw Exception("无效的响应格式")

            ConnectionInfo(
                wsUrl = centrifugo["ws_url"] as? String ?: throw Exception("缺少 ws_url"),
                token = centrifugo["token"] as? String ?: throw Exception("缺少 token"),
                channel = centrifugo["channel"] as? String ?: "station:$stationCode"
            )
        }
    }

    private fun connectWebSocket() {
        val url = wsUrl ?: throw Exception("WebSocket URL 未初始化")
        webSocket?.close(1000, "重新连接")

        val request = Request.Builder().url(url).build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(tag, "✅ WebSocket 已连接")
                lastMessageTime = System.currentTimeMillis()
                reconnectAttempts = 0

                val connectMsg = CentrifugoConnect(
                    id = 1,
                    connect = ConnectParams(token = connectionToken!!)
                )
                webSocket.send(gson.toJson(connectMsg))
                Log.d(tag, "📤 发送连接命令")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                lastMessageTime = System.currentTimeMillis()
                handleMessage(text)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(tag, "🔴 WebSocket 已关闭: $code - $reason")
                handleDisconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(tag, "❌ WebSocket 错误: ${t.message}", t)
                handleDisconnect()
            }
        })
    }

    private fun handleMessage(text: String) {
        try {
            val message = gson.fromJson(text, CentrifugoMessage::class.java)

            when {
                // ✅ 处理服务器 ping，返回 pong
                message.ping != null -> {
                    val pongMsg = mapOf("pong" to emptyMap<String, Any>())
                    webSocket?.send(gson.toJson(pongMsg))
                    Log.d(tag, "💓 收到 ping，发送 pong")
                }

                message.connect != null -> {
                    clientId = message.connect.client
                    Log.d(tag, "✅ 连接成功, Client ID: $clientId")

                    val subscribeMsg = CentrifugoSubscribe(
                        id = 2,
                        subscribe = SubscribeParams(channel = channelName)
                    )
                    webSocket?.send(gson.toJson(subscribeMsg))
                    Log.d(tag, "📤 发送订阅命令: $channelName")
                }

                message.subscribe != null -> {
                    Log.d(tag, "✅ 订阅成功: $channelName")
                    _connectionState.value = ConnectionState.CONNECTED
                }

                message.push?.pub?.data != null -> {
                    val subtitleData = message.push.pub.data
                    handleSubtitleData(subtitleData)
                }

                message.error != null -> {
                    Log.e(tag, "❌ 服务器错误: ${message.error}")
                    handleConnectionError()
                }
            }

        } catch (e: Exception) {
            Log.e(tag, "❌ 解析消息失败: ${e.message}", e)
        }
    }

    private fun handleSubtitleData(data: SubtitleData) {
        when (data.event) {
            "started" -> Log.d(tag, "🎬 识别已启动")
            "recognizing", "recognized" -> _subtitleFlow.value = data
            "heartbeat" -> Log.d(tag, "💓 应用层心跳")
            "error" -> Log.e(tag, "❌ 错误: ${data.message}")
        }
    }

    private fun startHeartbeatMonitor() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && shouldStayConnected.get()) {
                delay(30000)  // 每 30 秒检查

                val timeSinceLastMessage = System.currentTimeMillis() - lastMessageTime
                if (timeSinceLastMessage > messageTimeoutMs) {
                    Log.w(tag, "⚠️ 消息超时 (${timeSinceLastMessage}ms)，触发重连")
                    handleDisconnect()
                    break
                }
            }
        }
    }

    private fun handleDisconnect() {
        if (!shouldStayConnected.get()) {
            _connectionState.value = ConnectionState.DISCONNECTED
            return
        }

        if (_connectionState.value != ConnectionState.CONNECTED) return

        _connectionState.value = ConnectionState.RECONNECTING
        scheduleReconnect()
    }

    private fun handleConnectionError() {
        if (!shouldStayConnected.get()) {
            _connectionState.value = ConnectionState.ERROR
            return
        }
        _connectionState.value = ConnectionState.RECONNECTING
        scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (!shouldStayConnected.get()) return

        if (reconnectAttempts >= maxReconnectAttempts) {
            Log.e(tag, "❌ 达到最大重连次数，停止重连")
            _connectionState.value = ConnectionState.ERROR
            shouldStayConnected.set(false)
            return
        }

        if (isReconnecting.compareAndSet(false, true)) {
            reconnectAttempts++
            val delay = reconnectDelayMs * reconnectAttempts

            Log.d(tag, "🔄 将在 ${delay}ms 后重连 (${reconnectAttempts}/$maxReconnectAttempts)")

            scope.launch {
                delay(delay)
                isReconnecting.set(false)
                if (shouldStayConnected.get()) {
                    connectInternal()
                }
            }
        }
    }

    fun disconnect() {
        Log.d(tag, "🔌 用户断开连接")
        shouldStayConnected.set(false)
        heartbeatJob?.cancel()
        webSocket?.close(1000, "客户端关闭")
        webSocket = null
        _connectionState.value = ConnectionState.DISCONNECTED
    }

    fun release() {
        disconnect()
        scope.cancel()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.connectionPool.evictAll()
    }

    private data class ConnectionInfo(
        val wsUrl: String,
        val token: String,
        val channel: String
    )

    enum class ConnectionState {
        DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, ERROR
    }
}
```

## 📝 更新 Models.kt

```kotlin
// 更新 CentrifugoMessage 添加 ping 字段
data class CentrifugoMessage(
    val id: Int? = null,
    val connect: ConnectResult? = null,
    val subscribe: SubscribeResult? = null,
    val push: PushMessage? = null,
    val ping: Map<String, Any>? = null,  // ✅ 新增
    val error: ErrorResponse? = null
)
```

## 🧪 测试验证

```kotlin
// 在 Activity 中测试
lifecycleScope.launch {
    subtitleClient.connectionState.collect { state ->
        Log.d("Test", "连接状态: $state")

        when (state) {
            ConnectionState.CONNECTED -> {
                // 连接成功，观察是否稳定保持
                Handler(Looper.getMainLooper()).postDelayed({
                    Log.d("Test", "30秒后仍然连接: ${subtitleClient.connectionState.value}")
                }, 30000)
            }
            else -> {}
        }
    }
}
```

## 📊 验证清单

- [ ] Logcat 不再出现 "didn't receive pong" 错误
- [ ] 连接保持稳定超过 5 分钟
- [ ] 能看到 "收到 ping，发送 pong" 日志
- [ ] 持续接收字幕数据

## 🎯 总结

**核心改动**:
1. ❌ 移除客户端 WebSocket ping: `.pingInterval()`
2. ✅ 响应服务器的应用层 ping
3. ✅ 使用消息超时检测代替 WebSocket ping

**为什么这样做**:
- Centrifugo 使用 JSON 消息实现心跳，不依赖 WebSocket ping
- OkHttp 的 WebSocket ping 会与 Centrifugo 的心跳机制冲突
- 通过监控消息时间戳可以更可靠地检测连接状态
