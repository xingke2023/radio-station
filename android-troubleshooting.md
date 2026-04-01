# Android 客户端字幕停止显示 - 问题排查与解决方案

## 🔍 常见原因分析

### 1. **WebSocket 连接超时**
**现象**: 显示一会儿后突然停止接收数据

**原因**:
- 默认的 OkHttp 读取超时时间太短
- 移动网络不稳定导致长时间无数据传输
- 没有心跳保活机制

**解决方案**:
```kotlin
private val httpClient = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MINUTES)  // ✅ 无限读取超时
    .pingInterval(25, TimeUnit.SECONDS)  // ✅ 启用 WebSocket ping
    .build()
```

### 2. **Token 过期**
**现象**: 几分钟后停止接收

**原因**:
- JWT token 有 7 天有效期，但某些情况下可能提前失效
- 没有刷新 token 机制

**解决方案**:
- 每次重连时重新获取新的 token
- 监听错误响应，token 过期时自动重连

### 3. **应用进入后台被系统杀死**
**现象**: 切换应用后停止接收

**原因**:
- Android 后台限制
- WebSocket 连接被系统中断

**解决方案**:
```kotlin
// 在 AndroidManifest.xml 中
<service
    android:name=".SubtitleService"
    android:foregroundServiceType="mediaPlayback" />

// 使用前台服务保持连接
class SubtitleService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = createNotification()
        startForeground(NOTIFICATION_ID, notification)
        // 启动字幕客户端...
        return START_STICKY
    }
}
```

### 4. **网络切换导致断连**
**现象**: WiFi 切换到移动网络时停止

**原因**:
- 网络切换时 WebSocket 连接中断
- 没有自动重连机制

**解决方案**:
- 实现自动重连
- 监听网络状态变化

### 5. **内存不足**
**现象**: 字幕数据累积后停止

**原因**:
- StateFlow 持续发送数据导致内存累积
- 没有及时清理旧数据

**解决方案**:
```kotlin
// 使用 SharedFlow 代替 StateFlow
private val _subtitleFlow = MutableSharedFlow<SubtitleData>(
    replay = 1,  // 只保留最新的一条
    extraBufferCapacity = 1
)
```

## ✅ 完整解决方案

### 方案 1: 使用改进版客户端（推荐）

使用 `/home/ubuntu/radio/android-client-fixed.kt` 中的代码，包含以下改进：

#### 核心特性:
1. ✅ **自动重连机制** - 连接断开自动重连（指数退避）
2. ✅ **心跳监控** - 90秒无消息自动触发重连
3. ✅ **Token 刷新** - 每次重连获取新 token
4. ✅ **无限读取超时** - 适合长连接
5. ✅ **WebSocket Ping** - 25秒自动发送 ping 保活

#### 使用方法:
```kotlin
class MainActivity : AppCompatActivity() {
    private lateinit var subtitleClient: SubtitleClientFixed  // 使用 Fixed 版本

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        subtitleClient = SubtitleClientFixed(
            stationCode = "msnbc",
            apiBaseUrl = "https://radio.xingke888.com"
        )

        // 监听连接状态
        lifecycleScope.launch {
            subtitleClient.connectionState.collect { state ->
                runOnUiThread {
                    when (state) {
                        SubtitleClientFixed.ConnectionState.CONNECTED -> {
                            textViewStatus.text = "已连接 ✓"
                        }
                        SubtitleClientFixed.ConnectionState.RECONNECTING -> {
                            textViewStatus.text = "重连中..."
                        }
                        SubtitleClientFixed.ConnectionState.ERROR -> {
                            textViewStatus.text = "连接错误"
                        }
                        else -> {
                            textViewStatus.text = state.name
                        }
                    }
                }
            }
        }

        // 监听字幕
        lifecycleScope.launch {
            subtitleClient.subtitleFlow.collect { subtitle ->
                subtitle?.let {
                    runOnUiThread {
                        textViewEnglish.text = it.text ?: ""
                        textViewChinese.text = it.translations ?: ""
                    }
                }
            }
        }

        subtitleClient.connect()
    }

    override fun onDestroy() {
        super.onDestroy()
        subtitleClient.release()  // 使用 release() 而不是 disconnect()
    }
}
```

### 方案 2: 使用前台服务（长时间后台运行）

```kotlin
// SubtitleService.kt
class SubtitleService : Service() {
    private lateinit var subtitleClient: SubtitleClientFixed
    private val binder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun getService(): SubtitleService = this@SubtitleService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        subtitleClient = SubtitleClientFixed(
            stationCode = "msnbc",
            apiBaseUrl = "https://radio.xingke888.com"
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 创建通知
        val notification = createNotification()
        startForeground(1, notification)

        // 连接字幕服务
        subtitleClient.connect()

        return START_STICKY
    }

    private fun createNotification(): Notification {
        val channelId = "subtitle_service"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "字幕服务",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("MSNBC 字幕")
            .setContentText("正在接收实时字幕")
            .setSmallIcon(R.drawable.ic_subtitle)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun getSubtitleFlow() = subtitleClient.subtitleFlow

    override fun onDestroy() {
        super.onDestroy()
        subtitleClient.release()
    }
}
```

```kotlin
// MainActivity.kt - 使用服务
class MainActivity : AppCompatActivity() {
    private var subtitleService: SubtitleService? = null
    private var bound = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as SubtitleService.LocalBinder
            subtitleService = binder.getService()
            bound = true

            // 监听字幕
            lifecycleScope.launch {
                subtitleService?.getSubtitleFlow()?.collect { subtitle ->
                    subtitle?.let {
                        runOnUiThread {
                            textViewEnglish.text = it.text ?: ""
                            textViewChinese.text = it.translations ?: ""
                        }
                    }
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            bound = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 启动并绑定服务
        Intent(this, SubtitleService::class.java).also { intent ->
            startForegroundService(intent)
            bindService(intent, connection, Context.BIND_AUTO_CREATE)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (bound) {
            unbindService(connection)
            bound = false
        }
    }
}
```

```xml
<!-- AndroidManifest.xml -->
<manifest>
    <!-- 添加前台服务权限 -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application>
        <service
            android:name=".SubtitleService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>
</manifest>
```

### 方案 3: 网络状态监听

```kotlin
class NetworkMonitor(private val context: Context) {
    private val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE)
        as ConnectivityManager

    fun registerCallback(onNetworkAvailable: () -> Unit) {
        val networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                Log.d("NetworkMonitor", "网络可用")
                onNetworkAvailable()
            }

            override fun onLost(network: Network) {
                Log.d("NetworkMonitor", "网络断开")
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, networkCallback)
    }
}

// 在 Activity 中使用
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val networkMonitor = NetworkMonitor(this)
    networkMonitor.registerCallback {
        // 网络恢复时重连
        if (subtitleClient.connectionState.value !=
            SubtitleClientFixed.ConnectionState.CONNECTED) {
            subtitleClient.connect()
        }
    }
}
```

## 🧪 测试建议

### 1. 测试连接稳定性
```kotlin
// 添加日志追踪
lifecycleScope.launch {
    var messageCount = 0
    subtitleClient.subtitleFlow.collect { subtitle ->
        messageCount++
        Log.d("Test", "收到第 $messageCount 条消息")

        // 检查消息间隔
        val currentTime = System.currentTimeMillis()
        Log.d("Test", "消息时间: ${subtitle?.timestamp}")
    }
}
```

### 2. 测试重连机制
```kotlin
// 模拟网络断开
Handler(Looper.getMainLooper()).postDelayed({
    // 强制关闭 WebSocket
    subtitleClient.disconnect()

    // 3秒后检查是否自动重连
    Handler(Looper.getMainLooper()).postDelayed({
        Log.d("Test", "状态: ${subtitleClient.connectionState.value}")
    }, 3000)
}, 10000)
```

## 📊 调试清单

- [ ] 检查 Logcat 中是否有 "WebSocket 已关闭" 消息
- [ ] 检查是否有 "心跳超时" 消息
- [ ] 检查是否有 "Token 过期" 或 "401" 错误
- [ ] 检查应用切换到后台后是否还在接收消息
- [ ] 检查网络切换时是否自动重连
- [ ] 检查内存使用情况（是否持续增长）

## 🔧 快速诊断命令

```bash
# 查看 Logcat 过滤字幕客户端日志
adb logcat | grep SubtitleClient

# 查看网络连接
adb shell dumpsys connectivity

# 查看应用进程状态
adb shell ps | grep com.example.radio
```

## 📞 获取支持

如果问题仍然存在，请提供:
1. Logcat 日志（特别是 SubtitleClient 相关）
2. 出现问题的时间点
3. 设备型号和 Android 版本
4. 网络环境（WiFi/4G/5G）
