const sdk = require('microsoft-cognitiveservices-speech-sdk');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');

// ===== 配置 =====
const SPEECH_KEY = process.env.AZURE_SPEECH_KEY || 'YOUR_AZURE_KEY';
const SPEECH_REGION = process.env.AZURE_SPEECH_REGION || 'eastasia';
const STREAM_URL = process.env.STREAM_URL || 'YOUR_RADIO_STREAM_URL';
const SOURCE_LANGUAGE = process.env.SOURCE_LANGUAGE || 'zh-HK';
const TARGET_LANGUAGES = (process.env.TARGET_LANGUAGES || 'zh-CN,en-US').split(',');
const PORT = process.env.PORT || 3100;

// ===== SSE 客户端管理 =====
const clients = new Set();

function sendToAllClients(eventName, data) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        res.write(payload);
    }
}

// ===== ffmpeg: Stream URL -> PCM =====
function startFfmpeg(streamUrl) {
    const ffmpeg = spawn('ffmpeg', [
        '-re',
        '-i', streamUrl,
        '-f', 's16le',
        '-ar', '16000',
        '-ac', '1',
        '-bufsize', '64k',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-timeout', '30000000',
        '-'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('error') || msg.includes('Error') || msg.includes('failed')) {
            console.error('[ffmpeg]', msg.trim());
        }
    });

    ffmpeg.on('exit', (code) => {
        console.log(`[ffmpeg] 进程退出 code=${code}`);
    });

    return ffmpeg;
}

// ===== Azure 识别 =====
let isRecognizing = false;
let ffmpegProcess = null;
let pushStream = null;
let recognizer = null;

function startRecognition() {
    if (isRecognizing) return;
    isRecognizing = true;

    console.log('[Azure] 启动识别...');
    console.log(`[Azure] 源语言: ${SOURCE_LANGUAGE}, 目标语言: ${TARGET_LANGUAGES.join(', ')}`);

    // 配置 Azure Speech
    const speechConfig = sdk.SpeechTranslationConfig.fromSubscription(SPEECH_KEY, SPEECH_REGION);
    speechConfig.speechRecognitionLanguage = SOURCE_LANGUAGE;
    TARGET_LANGUAGES.forEach(lang => speechConfig.addTargetLanguage(lang));
    speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationStrategy, 'Semantic');

    // 创建 PushAudioInputStream
    pushStream = sdk.AudioInputStream.createPushStream();
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

    // 创建识别器
    recognizer = new sdk.TranslationRecognizer(speechConfig, audioConfig);

    // 识别中（中间结果）
    recognizer.recognizing = (s, e) => {
        if (!e.result.text) return;
        sendToAllClients('recognizing', {
            text: e.result.text,
            timestamp: new Date().toISOString()
        });
    };

    // 识别完成（最终结果）
    recognizer.recognized = (s, e) => {
        if (!e.result.text) return;

        const translations = {};
        TARGET_LANGUAGES.forEach(lang => {
            translations[lang] = e.result.translations.get(lang) || null;
        });

        const offsetMs = e.result.offset / 10000;
        const durationMs = e.result.duration / 10000;

        console.log(`[Recognized] ${e.result.text}`);
        sendToAllClients('recognized', {
            text: e.result.text,
            translations,
            offsetMs,
            durationMs,
            timestamp: new Date().toISOString()
        });
    };

    recognizer.sessionStarted = (s, e) => {
        console.log(`[Azure] 会话已启动: ${e.sessionId}`);
        sendToAllClients('started', { message: '识别已启动', timestamp: new Date().toISOString() });
    };

    recognizer.sessionStopped = (s, e) => {
        console.log('[Azure] 会话已停止');
        isRecognizing = false;
        sendToAllClients('stopped', { message: '识别已停止', timestamp: new Date().toISOString() });
    };

    recognizer.canceled = (s, e) => {
        console.error(`[Azure] 识别取消: ${e.errorDetails}`);
        isRecognizing = false;
        sendToAllClients('error', { message: e.errorDetails, timestamp: new Date().toISOString() });
    };

    // 启动识别
    recognizer.startContinuousRecognitionAsync(
        () => console.log('[Azure] 连续识别已启动'),
        (err) => {
            console.error('[Azure] 启动失败:', err);
            isRecognizing = false;
        }
    );

    // 启动 ffmpeg 并将 PCM 数据写入 pushStream
    ffmpegProcess = startFfmpeg(STREAM_URL);

    ffmpegProcess.stdout.on('data', (chunk) => {
        if (isRecognizing && pushStream) {
            pushStream.write(chunk);
        }
    });

    ffmpegProcess.stdout.on('end', () => {
        console.log('[ffmpeg] 音频流结束');
        sendToAllClients('streamEnded', { message: '音频流已结束', timestamp: new Date().toISOString() });
        stopRecognition();
    });
}

function stopRecognition() {
    isRecognizing = false;
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGKILL');
        ffmpegProcess = null;
    }
    if (recognizer) {
        recognizer.stopContinuousRecognitionAsync(
            () => console.log('[Azure] 识别已停止'),
            (err) => console.error('[Azure] 停止错误:', err)
        );
        recognizer = null;
    }
    if (pushStream) {
        pushStream.close();
        pushStream = null;
    }
}

// ===== Express 服务器 =====
const app = express();
app.use(cors());

// SSE 端点：客户端连接此端点接收实时推送
app.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);
    console.log(`[SSE] 客户端连接，当前连接数: ${clients.size}`);

    // 发送心跳保持连接
    const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
    }, 15000);

    // 首个客户端连接时启动识别
    if (clients.size === 1 && !isRecognizing) {
        startRecognition();
    }

    req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
        console.log(`[SSE] 客户端断开，当前连接数: ${clients.size}`);

        // 无客户端时停止识别
        if (clients.size === 0) {
            console.log('[SSE] 无客户端，停止识别');
            stopRecognition();
        }
    });
});

// 状态端点
app.get('/status', (req, res) => {
    res.json({
        isRecognizing,
        clientCount: clients.size,
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguages: TARGET_LANGUAGES,
        streamUrl: STREAM_URL
    });
});

// 演示页面：在浏览器中查看实时字幕
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>实时字幕</title>
  <style>
    body { font-family: sans-serif; background: #111; color: #eee; padding: 20px; }
    h2 { color: #4af; }
    #status { color: #aaa; font-size: 14px; margin-bottom: 10px; }
    #interim { color: #888; font-style: italic; min-height: 24px; margin-bottom: 8px; }
    #output { max-height: 70vh; overflow-y: auto; }
    .line { margin: 6px 0; padding: 8px 12px; background: #222; border-radius: 6px; }
    .line .src { font-size: 18px; }
    .line .trans { font-size: 14px; color: #8cf; margin-top: 4px; }
    .line .meta { font-size: 12px; color: #555; margin-top: 2px; }
  </style>
</head>
<body>
  <h2>实时字幕</h2>
  <div id="status">连接中...</div>
  <div id="interim"></div>
  <div id="output"></div>

  <script>
    const output = document.getElementById('output');
    const interim = document.getElementById('interim');
    const statusEl = document.getElementById('status');

    const es = new EventSource('/sse');

    es.addEventListener('started', e => {
      statusEl.textContent = '识别中...';
    });

    es.addEventListener('recognizing', e => {
      const d = JSON.parse(e.data);
      interim.textContent = '▶ ' + d.text;
    });

    es.addEventListener('recognized', e => {
      interim.textContent = '';
      const d = JSON.parse(e.data);
      const div = document.createElement('div');
      div.className = 'line';

      const transLines = Object.entries(d.translations || {})
        .filter(([, v]) => v)
        .map(([lang, text]) => \`<span style="margin-right:12px">[{\${lang}}] {\${text}}</span>\`)
        .join('');

      div.innerHTML = \`
        <div class="src">{\${d.text}}</div>
        {\${transLines ? '<div class="trans">' + transLines + '</div>' : ''}}
        <div class="meta">offset: {\${d.offsetMs?.toFixed(0)}}ms  duration: {\${d.durationMs?.toFixed(0)}}ms  {\${d.timestamp}}</div>
      \`;
      output.prepend(div);
    });

    es.addEventListener('stopped', e => {
      statusEl.textContent = '识别已停止';
    });

    es.addEventListener('error', e => {
      try {
        const d = JSON.parse(e.data);
        statusEl.textContent = '错误: ' + d.message;
      } catch(_) {}
    });

    es.onerror = () => {
      statusEl.textContent = 'SSE 连接断开，尝试重连...';
    };
  </script>
</body>
</html>`);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务已启动: http://localhost:${PORT}`);
    console.log(`SSE 端点:    http://localhost:${PORT}/sse`);
    console.log(`状态端点:    http://localhost:${PORT}/status`);
    console.log('');
    console.log('环境变量配置:');
    console.log(`  AZURE_SPEECH_KEY    = ${SPEECH_KEY.slice(0, 4)}****`);
    console.log(`  AZURE_SPEECH_REGION = ${SPEECH_REGION}`);
    console.log(`  STREAM_URL          = ${STREAM_URL}`);
    console.log(`  SOURCE_LANGUAGE     = ${SOURCE_LANGUAGE}`);
    console.log(`  TARGET_LANGUAGES    = ${TARGET_LANGUAGES.join(', ')}`);
});
