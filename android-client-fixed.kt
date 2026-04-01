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

/**
 * 改进版字幕客户端 - 解决断连问题
 *
 * 主要改进:
 * 1. 自动重连机制
 * 2. 心跳保活
 * 3. Token 过期处理
 * 4. 网络状态监控
 */
class SubtitleClientFixed(
    private val stationCode: String = "msnbc",
    private val apiBaseUrl: String = "https://radio.xingke888.com"
) {
    private val tag = "SubtitleClient"
    private val gson = Gson()

    // OkHttp 客户端 - 增加超时时间和保活配置
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MINUTES)  // 无限读取超时，适合长连接
        .writeTimeout(15, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)  // WebSocket ping 间隔
        .retryOnConnectionFailure(true)
        .build()

    // WebSocket 连接
    private var webSocket: WebSocket? = null
    private var clientId: String? = null

    // 连接状态
    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    // 字幕数据流
    private val _subtitleFlow = MutableStateFlow<SubtitleData?>(null)
    val subtitleFlow: StateFlow<SubtitleData?> = _subtitleFlow

    // 协程作用域
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 连接信息
    private var connectionToken: String? = null
    private var wsUrl: String? = null
    private var channelName: String = "station:$stationCode"

    // 重连配置
    private var reconnectAttempts = 0
    private val maxReconnectAttempts = 10
    private val reconnectDelayMs = 3000L
    private val isReconnecting = AtomicBoolean(false)
    private val shouldStayConnected = AtomicBoolean(false)

    // 心跳监控
    private var lastMessageTime = 0L
    private var heartbeatJob: Job? = null
    private val heartbeatIntervalMs = 30000L  // 30秒
    private val heartbeatTimeoutMs = 90000L   // 90秒无消息则认为断连

    /**
     * 连接到字幕服务
     */
    fun connect() {
        shouldStayConnected.set(true)
        reconnectAttempts = 0
        connectInternal()
    }

    /**
     * 内部连接逻辑
     */
    private fun connectInternal() {
        if (isReconnecting.get()) {
            Log.d(tag, "正在重连中，跳过此次连接请求")
            return
        }

        scope.launch {
            try {
                _connectionState.value = ConnectionState.CONNECTING
                Log.d(tag, "正在获取连接信息... (尝试 ${reconnectAttempts + 1}/$maxReconnectAttempts)")

                // 1. 获取新的连接信息（每次都刷新 token）
                val connectionInfo = fetchConnectionInfo()
                connectionToken = connectionInfo.token
                wsUrl = connectionInfo.wsUrl
                channelName = connectionInfo.channel

                Log.d(tag, "WebSocket URL: $wsUrl")
                Log.d(tag, "频道: $channelName")

                // 2. 建立 WebSocket 连接
                connectWebSocket()

                // 3. 启动心跳监控
                startHeartbeatMonitor()

            } catch (e: Exception) {
                Log.e(tag, "连接失败: ${e.message}", e)
                handleConnectionError()
            }
        }
    }

    /**
     * 获取连接信息
     */
    private suspend fun fetchConnectionInfo(): ConnectionInfo = withContext(Dispatchers.IO) {
        val url = "$apiBaseUrl/events?station_code=$stationCode"
        val request = Request.Builder()
            .url(url)
            .get()
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("HTTP ${response.code}: ${response.message}")
            }

            val body = response.body?.string() ?: throw Exception("响应体为空")
            Log.d(tag, "连接信息响应: $body")

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

    /**
     * 建立 WebSocket 连接
     */
    private fun connectWebSocket() {
        val url = wsUrl ?: throw Exception("WebSocket URL 未初始化")

        // 关闭旧连接
        webSocket?.close(1000, "重新连接")

        val request = Request.Builder()
            .url(url)
            .build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(tag, "✅ WebSocket 已连接")
                lastMessageTime = System.currentTimeMillis()
                reconnectAttempts = 0  // 重置重连计数

                // 发送连接命令
                val connectMsg = CentrifugoConnect(
                    id = 1,
                    connect = ConnectParams(token = connectionToken!!)
                )
                val json = gson.toJson(connectMsg)
                webSocket.send(json)
                Log.d(tag, "📤 发送连接命令")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                lastMessageTime = System.currentTimeMillis()
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(tag, "⚠️ WebSocket 正在关闭: $code - $reason")
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

    /**
     * 处理接收到的消息
     */
    private fun handleMessage(text: String) {
        try {
            // Log.d(tag, "📨 收到消息: ${text.take(200)}...")  // 只打印前200字符
            val message = gson.fromJson(text, CentrifugoMessage::class.java)

            when {
                // 连接成功响应
                message.connect != null -> {
                    clientId = message.connect.client
                    Log.d(tag, "✅ 连接成功, Client ID: $clientId")

                    // 订阅频道
                    val subscribeMsg = CentrifugoSubscribe(
                        id = 2,
                        subscribe = SubscribeParams(channel = channelName)
                    )
                    val json = gson.toJson(subscribeMsg)
                    webSocket?.send(json)
                    Log.d(tag, "📤 发送订阅命令: $channelName")
                }

                // 订阅成功响应
                message.subscribe != null -> {
                    Log.d(tag, "✅ 订阅成功: $channelName")
                    _connectionState.value = ConnectionState.CONNECTED
                }

                // 字幕数据推送
                message.push?.pub?.data != null -> {
                    val subtitleData = message.push.pub.data
                    handleSubtitleData(subtitleData)
                }

                // 错误响应
                message.error != null -> {
                    Log.e(tag, "❌ 服务器错误: ${message.error}")
                    handleConnectionError()
                }
            }

        } catch (e: Exception) {
            Log.e(tag, "❌ 解析消息失败: ${e.message}", e)
        }
    }

    /**
     * 处理字幕数据
     */
    private fun handleSubtitleData(data: SubtitleData) {
        when (data.event) {
            "started" -> {
                Log.d(tag, "🎬 识别已启动: ${data.message}")
            }
            "recognizing" -> {
                // 实时识别中的字幕（中间结果）
                _subtitleFlow.value = data
            }
            "recognized" -> {
                // 最终识别结果
                Log.d(tag, "✅ 识别完成 - ${data.text?.take(50)}...")
                _subtitleFlow.value = data
            }
            "heartbeat" -> {
                Log.d(tag, "💓 心跳")
            }
            "error" -> {
                Log.e(tag, "❌ 错误: ${data.message}")
            }
            else -> {
                Log.d(tag, "📦 其他事件: ${data.event}")
            }
        }
    }

    /**
     * 启动心跳监控
     */
    private fun startHeartbeatMonitor() {
        heartbeatJob?.cancel()
        heartbeatJob = scope.launch {
            while (isActive && shouldStayConnected.get()) {
                delay(heartbeatIntervalMs)

                val timeSinceLastMessage = System.currentTimeMillis() - lastMessageTime
                if (timeSinceLastMessage > heartbeatTimeoutMs) {
                    Log.w(tag, "⚠️ 心跳超时 (${timeSinceLastMessage}ms)，触发重连")
                    handleDisconnect()
                    break
                }
            }
        }
    }

    /**
     * 处理断连
     */
    private fun handleDisconnect() {
        if (!shouldStayConnected.get()) {
            Log.d(tag, "用户主动断开，不重连")
            _connectionState.value = ConnectionState.DISCONNECTED
            return
        }

        if (_connectionState.value != ConnectionState.CONNECTED) {
            // 避免重复处理
            return
        }

        _connectionState.value = ConnectionState.RECONNECTING
        scheduleReconnect()
    }

    /**
     * 处理连接错误
     */
    private fun handleConnectionError() {
        if (!shouldStayConnected.get()) {
            _connectionState.value = ConnectionState.ERROR
            return
        }

        _connectionState.value = ConnectionState.RECONNECTING
        scheduleReconnect()
    }

    /**
     * 安排重连
     */
    private fun scheduleReconnect() {
        if (!shouldStayConnected.get()) {
            return
        }

        if (reconnectAttempts >= maxReconnectAttempts) {
            Log.e(tag, "❌ 达到最大重连次数 ($maxReconnectAttempts)，停止重连")
            _connectionState.value = ConnectionState.ERROR
            shouldStayConnected.set(false)
            return
        }

        if (isReconnecting.compareAndSet(false, true)) {
            reconnectAttempts++
            val delay = reconnectDelayMs * reconnectAttempts  // 指数退避

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

    /**
     * 断开连接
     */
    fun disconnect() {
        Log.d(tag, "🔌 用户断开连接")
        shouldStayConnected.set(false)
        heartbeatJob?.cancel()

        webSocket?.close(1000, "客户端关闭")
        webSocket = null
        clientId = null

        _connectionState.value = ConnectionState.DISCONNECTED
    }

    /**
     * 清理资源
     */
    fun release() {
        disconnect()
        scope.cancel()
        httpClient.dispatcher.executorService.shutdown()
        httpClient.connectionPool.evictAll()
    }

    // 内部数据类
    private data class ConnectionInfo(
        val wsUrl: String,
        val token: String,
        val channel: String
    )

    enum class ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED,
        RECONNECTING,  // 新增：重连中
        ERROR
    }
}

// 错误响应数据类（需要添加到 Models.kt）
data class ErrorResponse(
    val code: Int,
    val message: String
)

// 更新 CentrifugoMessage 添加 error 字段
data class CentrifugoMessageFixed(
    val id: Int? = null,
    val connect: ConnectResult? = null,
    val subscribe: SubscribeResult? = null,
    val push: PushMessage? = null,
    val error: ErrorResponse? = null  // 新增
)
