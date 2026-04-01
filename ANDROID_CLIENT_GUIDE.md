# 安卓客户端连接电台字幕指南

## 概述

安卓客户端有两种方式连接到电台字幕服务：

1. **SSE (Server-Sent Events)** - 推荐方式，实时推送，低延迟
2. **HTTP 轮询** - 备用方式，兼容性好

---

## 方案 1: SSE 连接（推荐）

### 依赖库

在 `build.gradle` 中添加：

```gradle
dependencies {
    // OkHttp for HTTP requests
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'

    // Gson for JSON parsing
    implementation 'com.google.code.gson:gson:2.10.1'

    // Optional: EventSource library (推荐)
    implementation 'com.launchdarkly:okhttp-eventsource:4.1.1'
}
```

### Kotlin 代码示例

```kotlin
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import java.util.concurrent.TimeUnit

class RadioSubtitleClient(
    private val stationCode: String = "msnbc"
) {
    private val baseUrl = "https://radio.xingke888.com"
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // SSE 需要无限读取超时
        .build()

    private val gson = Gson()
    private var eventSource: EventSource? = null
    private var clientId: String? = null

    // 回调接口
    interface SubtitleListener {
        fun onConnected(clientId: String)
        fun onSubtitle(text: String, translation: String, offset: Long, duration: Long)
        fun onRecognizing(text: String)
        fun onStarted()
        fun onError(error: String)
        fun onDisconnected()
    }

    private var listener: SubtitleListener? = null

    fun setListener(listener: SubtitleListener) {
        this.listener = listener
    }

    /**
     * 连接到电台字幕流
     */
    suspend fun connect() = withContext(Dispatchers.IO) {
        try {
            // 步骤 1: 获取连接 token
            val token = getConnectionToken()

            // 步骤 2: 建立 SSE 连接
            connectSSE(token)

        } catch (e: Exception) {
            withContext(Dispatchers.Main) {
                listener?.onError("连接失败: ${e.message}")
            }
        }
    }

    /**
     * 获取连接 token
     */
    private suspend fun getConnectionToken(): String {
        val request = Request.Builder()
            .url("$baseUrl/sse8/sse/connect?station_code=$stationCode")
            .get()
            .build()

        val response = client.newCall(request).execute()

        if (!response.isSuccessful) {
            throw Exception("获取 token 失败: ${response.code}")
        }

        val json = gson.fromJson(response.body?.string(), JsonObject::class.java)
        return json.get("token").asString
    }

    /**
     * 建立 SSE 连接
     */
    private suspend fun connectSSE(token: String) {
        val sseUrl = "$baseUrl/centrifugo/connection/uni_sse?" +
                     "cf_connect=${java.net.URLEncoder.encode("{\"token\":\"$token\"}", "UTF-8")}"

        val request = Request.Builder()
            .url(sseUrl)
            .header("Accept", "text/event-stream")
            .build()

        eventSource = EventSources.createFactory(client)
            .newEventSource(request, object : EventSourceListener() {

                override fun onOpen(eventSource: EventSource, response: Response) {
                    println("✅ SSE 连接已建立")
                }

                override fun onEvent(
                    eventSource: EventSource,
                    id: String?,
                    type: String?,
                    data: String
                ) {
                    handleMessage(data)
                }

                override fun onClosed(eventSource: EventSource) {
                    CoroutineScope(Dispatchers.Main).launch {
                        listener?.onDisconnected()
                    }
                }

                override fun onFailure(
                    eventSource: EventSource,
                    t: Throwable?,
                    response: Response?
                ) {
                    CoroutineScope(Dispatchers.Main).launch {
                        listener?.onError("SSE 错误: ${t?.message}")
                    }
                }
            })
    }

    /**
     * 处理收到的消息
     */
    private fun handleMessage(data: String) {
        try {
            // 忽略 ping 消息
            if (data == "{}") return

            val json = gson.fromJson(data, JsonObject::class.java)

            // 连接成功
            if (json.has("connect")) {
                val connectObj = json.getAsJsonObject("connect")
                clientId = connectObj.get("client").asString

                CoroutineScope(Dispatchers.Main).launch {
                    listener?.onConnected(clientId!!)
                }

                // 启动电台
                CoroutineScope(Dispatchers.IO).launch {
                    startStation(clientId!!)
                }
            }

            // 推送消息
            if (json.has("push")) {
                val pushObj = json.getAsJsonObject("push")
                if (pushObj.has("pub")) {
                    val pubObj = pushObj.getAsJsonObject("pub")
                    if (pubObj.has("data")) {
                        val dataObj = pubObj.getAsJsonObject("data")
                        val event = dataObj.get("event").asString

                        CoroutineScope(Dispatchers.Main).launch {
                            when (event) {
                                "recognized" -> {
                                    val text = dataObj.get("text").asString
                                    val translations = dataObj.get("translations")?.asString ?: ""
                                    val offset = dataObj.get("offset").asLong
                                    val duration = dataObj.get("duration").asLong
                                    listener?.onSubtitle(text, translations, offset, duration)
                                }
                                "recognizing" -> {
                                    val text = dataObj.get("text").asString
                                    listener?.onRecognizing(text)
                                }
                                "started" -> {
                                    listener?.onStarted()
                                }
                            }
                        }
                    }
                }
            }

        } catch (e: Exception) {
            println("解析消息失败: ${e.message}")
        }
    }

    /**
     * 启动电台
     */
    private suspend fun startStation(clientId: String) {
        try {
            val requestBody = okhttp3.RequestBody.create(
                okhttp3.MediaType.parse("application/json"),
                gson.toJson(mapOf(
                    "station_code" to stationCode,
                    "client_id" to clientId
                ))
            )

            val request = Request.Builder()
                .url("$baseUrl/sse8/sse/subscribe")
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()

            if (response.isSuccessful) {
                println("✅ 电台启动成功")
            }
        } catch (e: Exception) {
            println("启动电台失败: ${e.message}")
        }
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        eventSource?.cancel()
        eventSource = null
        clientId = null
    }
}
```

### 使用示例

```kotlin
class MainActivity : AppCompatActivity() {

    private lateinit var subtitleClient: RadioSubtitleClient
    private val subtitleText: TextView by lazy { findViewById(R.id.subtitleText) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 创建客户端
        subtitleClient = RadioSubtitleClient("msnbc")

        // 设置监听器
        subtitleClient.setListener(object : RadioSubtitleClient.SubtitleListener {
            override fun onConnected(clientId: String) {
                Log.d("Radio", "已连接，Client ID: $clientId")
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "已连接", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onSubtitle(text: String, translation: String, offset: Long, duration: Long) {
                Log.d("Radio", "字幕: $text | 翻译: $translation")
                runOnUiThread {
                    subtitleText.text = "$text\n$translation"
                }
            }

            override fun onRecognizing(text: String) {
                Log.d("Radio", "识别中: $text")
            }

            override fun onStarted() {
                Log.d("Radio", "语音识别已启动")
            }

            override fun onError(error: String) {
                Log.e("Radio", "错误: $error")
                runOnUiThread {
                    Toast.makeText(this@MainActivity, error, Toast.LENGTH_SHORT).show()
                }
            }

            override fun onDisconnected() {
                Log.d("Radio", "连接已断开")
            }
        })

        // 连接按钮
        findViewById<Button>(R.id.connectButton).setOnClickListener {
            lifecycleScope.launch {
                subtitleClient.connect()
            }
        }

        // 断开按钮
        findViewById<Button>(R.id.disconnectButton).setOnClickListener {
            subtitleClient.disconnect()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        subtitleClient.disconnect()
    }
}
```

---

## 方案 2: Java 代码版本

### Java 实现

```java
import okhttp3.*;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class RadioSubtitleClient {

    private static final String BASE_URL = "https://radio.xingke888.com";
    private final String stationCode;
    private final OkHttpClient client;
    private final Gson gson;
    private EventSource eventSource;
    private String clientId;
    private SubtitleListener listener;

    public interface SubtitleListener {
        void onConnected(String clientId);
        void onSubtitle(String text, String translation, long offset, long duration);
        void onRecognizing(String text);
        void onStarted();
        void onError(String error);
        void onDisconnected();
    }

    public RadioSubtitleClient(String stationCode) {
        this.stationCode = stationCode;
        this.client = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build();
        this.gson = new Gson();
    }

    public void setListener(SubtitleListener listener) {
        this.listener = listener;
    }

    public void connect() {
        new Thread(() -> {
            try {
                // 获取 token
                String token = getConnectionToken();

                // 连接 SSE
                connectSSE(token);

            } catch (Exception e) {
                if (listener != null) {
                    listener.onError("连接失败: " + e.getMessage());
                }
            }
        }).start();
    }

    private String getConnectionToken() throws IOException {
        Request request = new Request.Builder()
            .url(BASE_URL + "/sse8/sse/connect?station_code=" + stationCode)
            .get()
            .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("获取 token 失败: " + response.code());
            }

            JsonObject json = gson.fromJson(response.body().string(), JsonObject.class);
            return json.get("token").getAsString();
        }
    }

    private void connectSSE(String token) throws Exception {
        String sseUrl = BASE_URL + "/centrifugo/connection/uni_sse?" +
                       "cf_connect=" + URLEncoder.encode("{\"token\":\"" + token + "\"}", "UTF-8");

        Request request = new Request.Builder()
            .url(sseUrl)
            .header("Accept", "text/event-stream")
            .build();

        eventSource = EventSources.createFactory(client)
            .newEventSource(request, new EventSourceListener() {

                @Override
                public void onOpen(EventSource eventSource, Response response) {
                    System.out.println("✅ SSE 连接已建立");
                }

                @Override
                public void onEvent(EventSource eventSource, String id, String type, String data) {
                    handleMessage(data);
                }

                @Override
                public void onClosed(EventSource eventSource) {
                    if (listener != null) {
                        listener.onDisconnected();
                    }
                }

                @Override
                public void onFailure(EventSource eventSource, Throwable t, Response response) {
                    if (listener != null) {
                        listener.onError("SSE 错误: " + t.getMessage());
                    }
                }
            });
    }

    private void handleMessage(String data) {
        try {
            if (data.equals("{}")) return;

            JsonObject json = gson.fromJson(data, JsonObject.class);

            // 连接成功
            if (json.has("connect")) {
                JsonObject connectObj = json.getAsJsonObject("connect");
                clientId = connectObj.get("client").getAsString();

                if (listener != null) {
                    listener.onConnected(clientId);
                }

                // 启动电台
                new Thread(() -> startStation(clientId)).start();
            }

            // 推送消息
            if (json.has("push")) {
                JsonObject pushObj = json.getAsJsonObject("push");
                if (pushObj.has("pub")) {
                    JsonObject pubObj = pushObj.getAsJsonObject("pub");
                    if (pubObj.has("data")) {
                        JsonObject dataObj = pubObj.getAsJsonObject("data");
                        String event = dataObj.get("event").getAsString();

                        if (listener != null) {
                            switch (event) {
                                case "recognized":
                                    String text = dataObj.get("text").getAsString();
                                    String translations = dataObj.has("translations") ?
                                        dataObj.get("translations").getAsString() : "";
                                    long offset = dataObj.get("offset").getAsLong();
                                    long duration = dataObj.get("duration").getAsLong();
                                    listener.onSubtitle(text, translations, offset, duration);
                                    break;

                                case "recognizing":
                                    text = dataObj.get("text").getAsString();
                                    listener.onRecognizing(text);
                                    break;

                                case "started":
                                    listener.onStarted();
                                    break;
                            }
                        }
                    }
                }
            }

        } catch (Exception e) {
            System.out.println("解析消息失败: " + e.getMessage());
        }
    }

    private void startStation(String clientId) {
        try {
            Map<String, String> body = new HashMap<>();
            body.put("station_code", stationCode);
            body.put("client_id", clientId);

            RequestBody requestBody = RequestBody.create(
                MediaType.parse("application/json"),
                gson.toJson(body)
            );

            Request request = new Request.Builder()
                .url(BASE_URL + "/sse8/sse/subscribe")
                .post(requestBody)
                .build();

            try (Response response = client.newCall(request).execute()) {
                if (response.isSuccessful()) {
                    System.out.println("✅ 电台启动成功");
                }
            }
        } catch (Exception e) {
            System.out.println("启动电台失败: " + e.getMessage());
        }
    }

    public void disconnect() {
        if (eventSource != null) {
            eventSource.cancel();
            eventSource = null;
        }
        clientId = null;
    }
}
```

---

## 方案 3: HTTP 轮询（备用方案）

如果 SSE 不可用，可以使用 HTTP 轮询方式（服务端需要额外实现）。

---

## API 端点说明

### 1. 获取连接 Token
- **URL**: `GET https://radio.xingke888.com/sse8/sse/connect?station_code=msnbc`
- **响应**:
```json
{
  "success": true,
  "token": "eyJhbGc...",
  "channel": "station:msnbc",
  "station": {
    "code": "msnbc",
    "name": "MSNBC"
  }
}
```

### 2. 连接 SSE 流
- **URL**: `GET https://radio.xingke888.com/centrifugo/connection/uni_sse?cf_connect={"token":"YOUR_TOKEN"}`
- **Headers**: `Accept: text/event-stream`
- **响应**: 持续的 SSE 数据流

### 3. 启动电台
- **URL**: `POST https://radio.xingke888.com/sse8/sse/subscribe`
- **Body**:
```json
{
  "station_code": "msnbc",
  "client_id": "YOUR_CLIENT_ID"
}
```

---

## 消息格式

### 连接消息
```json
{
  "connect": {
    "client": "client-id-xxx",
    "subs": {
      "station:msnbc": {}
    }
  }
}
```

### 字幕消息
```json
{
  "push": {
    "pub": {
      "data": {
        "event": "recognized",
        "text": "Hello world",
        "translations": "你好世界",
        "offset": 1234,
        "duration": 2000,
        "timestamp": 1234567890
      }
    }
  }
}
```

### 识别中消息
```json
{
  "push": {
    "pub": {
      "data": {
        "event": "recognizing",
        "text": "Hello",
        "offset": 1234
      }
    }
  }
}
```

---

## 权限配置

在 `AndroidManifest.xml` 中添加：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- 如果需要后台运行 -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

---

## 注意事项

1. **网络权限**: 确保应用有网络访问权限
2. **后台运行**: 如果需要后台接收字幕，使用 Foreground Service
3. **错误处理**: 实现断线重连机制
4. **线程管理**: UI 更新必须在主线程
5. **内存管理**: 及时清理不需要的字幕数据
6. **HTTPS**: 所有连接都使用 HTTPS 加密

---

## 可用电台代码

- `msnbc` - MSNBC 新闻
- 其他电台请联系服务器管理员

---

## 测试工具

可以先使用浏览器测试：
- https://radio.xingke888.com/client-subtitle-sync-sse.html
- https://radio.xingke888.com/test-sse-simple.html

---

## 技术支持

如有问题，请查看服务器日志或联系技术支持。
