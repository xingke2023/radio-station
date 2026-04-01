/**
 * 安卓客户端连接电台字幕 - 最简化示例
 *
 * 使用方法：
 * 1. 添加依赖: implementation 'com.squareup.okhttp3:okhttp:4.12.0'
 * 2. 添加依赖: implementation 'com.launchdarkly:okhttp-eventsource:4.1.1'
 * 3. 添加依赖: implementation 'com.google.code.gson:gson:2.10.1'
 * 4. 添加网络权限
 */

import okhttp3.*
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import com.google.gson.Gson
import com.google.gson.JsonObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class SimpleRadioClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private var eventSource: EventSource? = null

    // 回调函数
    var onSubtitle: ((text: String, translation: String) -> Unit)? = null
    var onError: ((error: String) -> Unit)? = null

    /**
     * 连接到电台
     */
    fun connect(stationCode: String = "msnbc") {
        Thread {
            try {
                // 步骤1: 获取 token
                val token = getToken(stationCode)

                // 步骤2: 连接 SSE
                connectSSE(token, stationCode)

            } catch (e: Exception) {
                onError?.invoke("连接失败: ${e.message}")
            }
        }.start()
    }

    /**
     * 获取 token
     */
    private fun getToken(stationCode: String): String {
        val request = Request.Builder()
            .url("https://radio.xingke888.com/sse8/sse/connect?station_code=$stationCode")
            .build()

        val response = client.newCall(request).execute()
        val json = gson.fromJson(response.body?.string(), JsonObject::class.java)
        return json.get("token").asString
    }

    /**
     * 连接 SSE
     */
    private fun connectSSE(token: String, stationCode: String) {
        val url = "https://radio.xingke888.com/centrifugo/connection/uni_sse?" +
                  "cf_connect=${URLEncoder.encode("{\"token\":\"$token\"}", "UTF-8")}"

        val request = Request.Builder().url(url).build()

        eventSource = EventSources.createFactory(client)
            .newEventSource(request, object : EventSourceListener() {

                override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                    handleMessage(data, stationCode)
                }

                override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                    onError?.invoke("连接失败: ${t?.message}")
                }
            })
    }

    /**
     * 处理消息
     */
    private fun handleMessage(data: String, stationCode: String) {
        if (data == "{}") return  // 忽略 ping

        try {
            val json = gson.fromJson(data, JsonObject::class.java)

            // 连接成功，启动电台
            if (json.has("connect")) {
                val clientId = json.getAsJsonObject("connect").get("client").asString
                startStation(stationCode, clientId)
            }

            // 收到字幕
            if (json.has("push")) {
                val dataObj = json.getAsJsonObject("push")
                    .getAsJsonObject("pub")
                    .getAsJsonObject("data")

                if (dataObj.get("event").asString == "recognized") {
                    val text = dataObj.get("text").asString
                    val translation = dataObj.get("translations")?.asString ?: ""
                    onSubtitle?.invoke(text, translation)
                }
            }
        } catch (e: Exception) {
            // 忽略解析错误
        }
    }

    /**
     * 启动电台
     */
    private fun startStation(stationCode: String, clientId: String) {
        Thread {
            try {
                val body = RequestBody.create(
                    MediaType.parse("application/json"),
                    "{\"station_code\":\"$stationCode\",\"client_id\":\"$clientId\"}"
                )

                val request = Request.Builder()
                    .url("https://radio.xingke888.com/sse8/sse/subscribe")
                    .post(body)
                    .build()

                client.newCall(request).execute()
            } catch (e: Exception) {
                // 忽略错误
            }
        }.start()
    }

    /**
     * 断开连接
     */
    fun disconnect() {
        eventSource?.cancel()
    }
}

// ==================== 使用示例 ====================

/**
 * 在 Activity 中使用
 */
class MainActivity : AppCompatActivity() {

    private val radioClient = SimpleRadioClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 设置字幕回调
        radioClient.onSubtitle = { text, translation ->
            runOnUiThread {
                // 更新 UI
                textView.text = "$text\n$translation"
                Log.d("Radio", "字幕: $text")
            }
        }

        // 设置错误回调
        radioClient.onError = { error ->
            runOnUiThread {
                Toast.makeText(this, error, Toast.LENGTH_SHORT).show()
            }
        }

        // 连接按钮
        connectButton.setOnClickListener {
            radioClient.connect("msnbc")
        }

        // 断开按钮
        disconnectButton.setOnClickListener {
            radioClient.disconnect()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        radioClient.disconnect()
    }
}
