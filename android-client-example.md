# Android Kotlin 客户端 - MSNBC 字幕服务连接指南

## 1. 添加依赖 (build.gradle.kts)

```kotlin
dependencies {
    // OkHttp WebSocket
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JSON 解析
    implementation("com.google.code.gson:gson:2.10.1")

    // Coroutines (协程)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Lifecycle (可选，用于生命周期管理)
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
}
```

## 2. 添加网络权限 (AndroidManifest.xml)

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

## 3. 核心代码

### 3.1 数据模型 (Models.kt)

```kotlin
package com.example.radio.models

import com.google.gson.annotations.SerializedName

// Centrifugo 连接请求
data class CentrifugoConnect(
    val id: Int = 1,
    val connect: ConnectParams
)

data class ConnectParams(
    val token: String
)

// Centrifugo 订阅请求
data class CentrifugoSubscribe(
    val id: Int = 2,
    val subscribe: SubscribeParams
)

data class SubscribeParams(
    val channel: String
)

// Centrifugo 响应消息
data class CentrifugoMessage(
    val id: Int? = null,
    val connect: ConnectResult? = null,
    val subscribe: SubscribeResult? = null,
    val push: PushMessage? = null
)

data class ConnectResult(
    val client: String,
    val version: String,
    val ping: Int,
    val pong: Boolean
)

data class SubscribeResult(
    val channel: String? = null
)

data class PushMessage(
    val channel: String,
    val pub: PublicationData
)

data class PublicationData(
    val data: SubtitleData
)

// 字幕数据
data class SubtitleData(
    val event: String,
    val text: String? = null,
    val translations: String? = null,
    val message: String? = null,
    val timestamp: String? = null,
    val keyName: String? = null,
    val region: String? = null
)
```

### 3.2 字幕服务客户端 (SubtitleClient.kt)

```kotlin
package com.example.radio.client

import android.util.Log
import com.example.radio.models.*
import com.google.gson.Gson
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class SubtitleClient(
    private val stationCode: String = "msnbc",
    private val apiBaseUrl: String = "https://radio.xingke888.com"
) {
    private val tag = "SubtitleClient"
    private val gson = Gson()

    // OkHttp 客户端
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
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

    // 连接令牌
    private var connectionToken: String? = null
    private var wsUrl: String? = null

    /**
     * 连接到字幕服务
     */
    fun connect() {
        scope.launch {
            try {
                _connectionState.value = ConnectionState.CONNECTING
                Log.d(tag, "正在获取连接信息...")

                // 1. 获取连接信息
                val connectionInfo = fetchConnectionInfo()
                connectionToken = connectionInfo.token
                wsUrl = connectionInfo.wsUrl

                Log.d(tag, "WebSocket URL: $wsUrl")
                Log.d(tag, "连接令牌已获取")

                // 2. 建立 WebSocket 连接
                connectWebSocket()

            } catch (e: Exception) {
                Log.e(tag, "连接失败: ${e.message}", e)
                _connectionState.value = ConnectionState.ERROR
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
        val request = Request.Builder()
            .url(url)
            .build()

        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(tag, "WebSocket 已连接")

                // 发送连接命令
                val connectMsg = CentrifugoConnect(
                    id = 1,
                    connect = ConnectParams(token = connectionToken!!)
                )
                val json = gson.toJson(connectMsg)
                webSocket.send(json)
                Log.d(tag, "发送连接命令: $json")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(tag, "WebSocket 正在关闭: $code - $reason")
                _connectionState.value = ConnectionState.DISCONNECTING
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(tag, "WebSocket 已关闭: $code - $reason")
                _connectionState.value = ConnectionState.DISCONNECTED
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(tag, "WebSocket 错误: ${t.message}", t)
                _connectionState.value = ConnectionState.ERROR
            }
        })
    }

    /**
     * 处理接收到的消息
     */
    private fun handleMessage(text: String) {
        try {
            Log.d(tag, "收到消息: $text")
            val message = gson.fromJson(text, CentrifugoMessage::class.java)

            when {
                // 连接成功响应
                message.connect != null -> {
                    clientId = message.connect.client
                    Log.d(tag, "连接成功, Client ID: $clientId")

                    // 订阅频道
                    val subscribeMsg = CentrifugoSubscribe(
                        id = 2,
                        subscribe = SubscribeParams(channel = "station:$stationCode")
                    )
                    val json = gson.toJson(subscribeMsg)
                    webSocket?.send(json)
                    Log.d(tag, "发送订阅命令: $json")
                }

                // 订阅成功响应
                message.subscribe != null -> {
                    Log.d(tag, "订阅成功: station:$stationCode")
                    _connectionState.value = ConnectionState.CONNECTED
                }

                // 字幕数据推送
                message.push?.pub?.data != null -> {
                    val subtitleData = message.push.pub.data
                    handleSubtitleData(subtitleData)
                }
            }

        } catch (e: Exception) {
            Log.e(tag, "解析消息失败: ${e.message}", e)
        }
    }

    /**
     * 处理字幕数据
     */
    private fun handleSubtitleData(data: SubtitleData) {
        when (data.event) {
            "started" -> {
                Log.d(tag, "识别已启动: ${data.message}")
            }
            "recognizing" -> {
                // 实时识别中的字幕（中间结果）
                Log.d(tag, "识别中 - 英文: ${data.text}")
                Log.d(tag, "识别中 - 中文: ${data.translations}")
                _subtitleFlow.value = data
            }
            "recognized" -> {
                // 最终识别结果
                Log.d(tag, "识别完成 - 英文: ${data.text}")
                Log.d(tag, "识别完成 - 中文: ${data.translations}")
                _subtitleFlow.value = data
            }
            "heartbeat" -> {
                Log.d(tag, "心跳")
            }
            "error" -> {
                Log.e(tag, "错误: ${data.message}")
            }
            else -> {
                Log.d(tag, "其他事件: ${data.event}")
            }
        }
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        webSocket?.close(1000, "客户端关闭")
        webSocket = null
        clientId = null
        _connectionState.value = ConnectionState.DISCONNECTED
        scope.cancel()
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
        DISCONNECTING,
        ERROR
    }
}
```

### 3.3 在 Activity/Fragment 中使用

```kotlin
package com.example.radio

import android.os.Bundle
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.example.radio.client.SubtitleClient
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private val tag = "MainActivity"
    private lateinit var subtitleClient: SubtitleClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 创建字幕客户端
        subtitleClient = SubtitleClient(
            stationCode = "msnbc",
            apiBaseUrl = "https://radio.xingke888.com"
        )

        // 监听连接状态
        lifecycleScope.launch {
            subtitleClient.connectionState.collect { state ->
                Log.d(tag, "连接状态: $state")
                // 更新 UI
                runOnUiThread {
                    when (state) {
                        SubtitleClient.ConnectionState.CONNECTING -> {
                            // 显示连接中...
                        }
                        SubtitleClient.ConnectionState.CONNECTED -> {
                            // 显示已连接
                        }
                        SubtitleClient.ConnectionState.ERROR -> {
                            // 显示错误
                        }
                        else -> {}
                    }
                }
            }
        }

        // 监听字幕数据
        lifecycleScope.launch {
            subtitleClient.subtitleFlow.collect { subtitleData ->
                subtitleData?.let {
                    Log.d(tag, "字幕事件: ${it.event}")
                    Log.d(tag, "英文: ${it.text}")
                    Log.d(tag, "中文: ${it.translations}")

                    // 更新 UI 显示字幕
                    runOnUiThread {
                        updateSubtitle(it.text, it.translations, it.event)
                    }
                }
            }
        }

        // 连接到服务
        subtitleClient.connect()
    }

    private fun updateSubtitle(english: String?, chinese: String?, event: String) {
        // 根据事件类型显示不同样式的字幕
        when (event) {
            "recognizing" -> {
                // 显示临时字幕（灰色或淡色）
                // textViewEnglish.text = english
                // textViewChinese.text = chinese
                // textViewEnglish.alpha = 0.6f
            }
            "recognized" -> {
                // 显示最终字幕（正常颜色）
                // textViewEnglish.text = english
                // textViewChinese.text = chinese
                // textViewEnglish.alpha = 1.0f
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        subtitleClient.disconnect()
    }
}
```

## 4. 完整的 UI 示例 (activity_main.xml)

```xml
<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:padding="16dp">

    <!-- 连接状态 -->
    <TextView
        android:id="@+id/textViewStatus"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="未连接"
        android:textSize="14sp"
        app:layout_constraintTop_toTopOf="parent"
        app:layout_constraintStart_toStartOf="parent" />

    <!-- 英文字幕 -->
    <TextView
        android:id="@+id/textViewEnglish"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:text="English subtitle will appear here"
        android:textSize="18sp"
        android:textColor="#000000"
        android:layout_marginTop="32dp"
        app:layout_constraintTop_toBottomOf="@id/textViewStatus"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent" />

    <!-- 中文字幕 -->
    <TextView
        android:id="@+id/textViewChinese"
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:text="中文字幕将在这里显示"
        android:textSize="18sp"
        android:textColor="#666666"
        android:layout_marginTop="16dp"
        app:layout_constraintTop_toBottomOf="@id/textViewEnglish"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent" />

    <!-- 连接按钮 -->
    <Button
        android:id="@+id/buttonConnect"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="连接"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintStart_toStartOf="parent" />

    <!-- 断开按钮 -->
    <Button
        android:id="@+id/buttonDisconnect"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="断开"
        android:layout_marginStart="16dp"
        app:layout_constraintBottom_toBottomOf="parent"
        app:layout_constraintStart_toEndOf="@id/buttonConnect" />

</androidx.constraintlayout.widget.ConstraintLayout>
```

## 5. 完整的 Activity 实现（带 UI 绑定）

```kotlin
package com.example.radio

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.example.radio.client.SubtitleClient
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var subtitleClient: SubtitleClient

    private lateinit var textViewStatus: TextView
    private lateinit var textViewEnglish: TextView
    private lateinit var textViewChinese: TextView
    private lateinit var buttonConnect: Button
    private lateinit var buttonDisconnect: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 初始化视图
        textViewStatus = findViewById(R.id.textViewStatus)
        textViewEnglish = findViewById(R.id.textViewEnglish)
        textViewChinese = findViewById(R.id.textViewChinese)
        buttonConnect = findViewById(R.id.buttonConnect)
        buttonDisconnect = findViewById(R.id.buttonDisconnect)

        // 创建字幕客户端
        subtitleClient = SubtitleClient(
            stationCode = "msnbc",
            apiBaseUrl = "https://radio.xingke888.com"
        )

        // 设置按钮点击事件
        buttonConnect.setOnClickListener {
            subtitleClient.connect()
        }

        buttonDisconnect.setOnClickListener {
            subtitleClient.disconnect()
        }

        // 监听连接状态
        lifecycleScope.launch {
            subtitleClient.connectionState.collect { state ->
                runOnUiThread {
                    textViewStatus.text = when (state) {
                        SubtitleClient.ConnectionState.DISCONNECTED -> "未连接"
                        SubtitleClient.ConnectionState.CONNECTING -> "连接中..."
                        SubtitleClient.ConnectionState.CONNECTED -> "已连接 ✓"
                        SubtitleClient.ConnectionState.DISCONNECTING -> "断开中..."
                        SubtitleClient.ConnectionState.ERROR -> "连接错误"
                    }

                    buttonConnect.isEnabled = state == SubtitleClient.ConnectionState.DISCONNECTED
                    buttonDisconnect.isEnabled = state == SubtitleClient.ConnectionState.CONNECTED
                }
            }
        }

        // 监听字幕数据
        lifecycleScope.launch {
            subtitleClient.subtitleFlow.collect { subtitleData ->
                subtitleData?.let {
                    runOnUiThread {
                        when (it.event) {
                            "recognizing" -> {
                                // 临时字幕（半透明）
                                textViewEnglish.text = it.text ?: ""
                                textViewChinese.text = it.translations ?: ""
                                textViewEnglish.alpha = 0.6f
                                textViewChinese.alpha = 0.6f
                            }
                            "recognized" -> {
                                // 最终字幕（正常显示）
                                textViewEnglish.text = it.text ?: ""
                                textViewChinese.text = it.translations ?: ""
                                textViewEnglish.alpha = 1.0f
                                textViewChinese.alpha = 1.0f
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        subtitleClient.disconnect()
    }
}
```

## 6. 使用说明

1. **将所有代码文件添加到项目中**
2. **在 `build.gradle.kts` 中添加依赖**
3. **在 `AndroidManifest.xml` 中添加网络权限**
4. **运行应用并点击"连接"按钮**

## 7. 支持的电台列表

可以通过修改 `stationCode` 参数来连接不同的电台：

```kotlin
subtitleClient = SubtitleClient(
    stationCode = "msnbc",  // 可改为其他电台代码
    apiBaseUrl = "https://radio.xingke888.com"
)
```

## 8. 注意事项

1. **网络连接**: 确保设备有网络连接
2. **生命周期管理**: 在 Activity/Fragment 销毁时调用 `disconnect()`
3. **错误处理**: 监听 `connectionState` 来处理连接错误
4. **UI 更新**: 使用 `runOnUiThread` 在主线程更新 UI
5. **协程作用域**: 使用 `lifecycleScope` 确保协程随生命周期取消

## 9. 调试

查看 Logcat 日志（过滤 "SubtitleClient"）：
```
adb logcat | grep SubtitleClient
```
