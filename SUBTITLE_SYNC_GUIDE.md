# 实时字幕同步解决方案

## 问题描述

因为客户端语音和字幕不同步，造成体验很差。Azure 语音识别返回的语音片段包含时间戳信息（`offset` 和 `duration`），我们可以利用这个特性实现音视频和字幕的精确同步。

## 核心挑战

**如何让客户端播放器时间戳与 Azure 的 offset 对齐？**

## 解决方案

### 方案1: 客户端本地播放音频流 + 时间戳字幕同步 ⭐ 推荐

#### 原理
1. 客户端直接播放原始音频流（如 HLS m3u8 流）
2. 服务端将 Azure 返回的 `offset` 和 `duration` 发送给客户端
3. 客户端根据音频播放器的 `currentTime` 匹配对应的字幕

#### 时间对齐机制

```
Azure 时间轴:
|------ offset ------|----- duration -----|
        字幕开始             字幕结束

客户端播放器时间轴:
|------ currentTime * 1000 (ms) ------|

匹配逻辑:
if (currentTimeMs >= offset && currentTimeMs < offset + duration) {
    显示该字幕
}
```

#### 优点
- ✅ 延迟低（客户端直接播放流）
- ✅ 字幕精确对齐音频时间
- ✅ 支持用户自定义延迟调整

#### 缺点
- ⚠️ 需要音频流地址可公开访问
- ⚠️ 可能存在播放器与 Azure 识别的时间偏差（可通过偏移量调整补偿）

#### 实现细节

**服务端修改** (已完成):
```javascript
// 在 onRecognizing 和 onRecognized 方法中
const offsetTicks = result.offset;      // Azure 返回的 ticks
const durationTicks = result.duration;

// 转换为毫秒 (1 tick = 100ns)
const offsetMs = offsetTicks / 10000;
const durationMs = durationTicks / 10000;

// 发送事件时包含时间信息
this.sendEvent('recognized', {
    text: sourceText,
    translations: translation,
    offset: offsetMs,          // 关键: 字幕开始时间
    duration: durationMs,       // 关键: 字幕持续时间
    timestamp: new Date().toISOString()
});
```

**客户端实现** (见 `client-subtitle-sync-example.html`):
```javascript
// 1. 播放原始音频流
audioPlayer.src = STREAM_URL;
audioPlayer.play();

// 2. 接收字幕并加入队列
sub.on('publication', (ctx) => {
    const data = ctx.data;
    if (data.event === 'recognized') {
        subtitleQueue.push({
            text: data.text,
            translation: data.translations,
            offset: data.offset,      // 来自 Azure
            duration: data.duration    // 来自 Azure
        });
    }
});

// 3. 定时匹配字幕（每 100ms）
setInterval(() => {
    const currentTimeMs = audioPlayer.currentTime * 1000;

    for (let subtitle of subtitleQueue) {
        if (currentTimeMs >= subtitle.offset &&
            currentTimeMs < subtitle.offset + subtitle.duration) {
            // 显示该字幕
            displaySubtitle(subtitle);
            break;
        }
    }
}, 100);
```

#### 延迟补偿机制

由于网络延迟或播放器缓冲，字幕可能不完全同步。解决方法:

```javascript
// 用户可调整的偏移量（毫秒）
const userOffset = parseFloat(offsetInput.value) || 0;

// 调整后的时间用于字幕匹配
const adjustedTimeMs = currentTimeMs - userOffset;

// 匹配字幕
if (adjustedTimeMs >= subtitle.offset &&
    adjustedTimeMs < subtitle.offset + subtitle.duration) {
    displaySubtitle(subtitle);
}
```

- **正值延迟** (+500ms): 字幕延后显示，适用于字幕提前的情况
- **负值提前** (-500ms): 字幕提前显示，适用于字幕滞后的情况

---

### 方案2: 服务端合成同步音视频流（备选）

如果方案1的时间对齐不理想，可以考虑服务端生成同步的音频+字幕流。

#### 原理
1. 服务端使用 Azure TTS 将识别的文本转为语音
2. 将合成的语音片段和字幕打包成同步的流
3. 客户端直接播放，字幕与音频完美对齐

#### 优点
- ✅ 字幕与音频100%同步（服务端控制）
- ✅ 不依赖原始音频流的访问权限

#### 缺点
- ❌ 延迟大（需要等待识别 + TTS 合成）
- ❌ 增加服务端成本（TTS 服务费用）
- ❌ 音频质量取决于 TTS 质量

**不推荐使用此方案**，除非对实时性要求不高。

---

## 实际部署建议

### 1. 使用方案1（推荐）

```bash
# 1. 启动修改后的服务端
pm2 restart radio-service

# 2. 部署客户端示例页面
cp client-subtitle-sync-example.html /var/www/html/subtitle-demo.html

# 3. 访问测试
open https://your-domain.com/subtitle-demo.html
```

### 2. 调试技巧

在浏览器控制台观察:
```javascript
// 查看字幕队列
console.log(subtitleQueue);

// 查看当前播放时间与字幕匹配
console.log(`播放时间: ${audioPlayer.currentTime * 1000}ms`);
console.log(`字幕偏移: ${currentSubtitle.offset}ms`);
```

### 3. 性能优化

- 字幕队列保持在 **50-100** 条（约 5-10 分钟）
- 每 **100ms** 检查一次字幕匹配（不要太频繁）
- 使用 HLS 流，兼容性更好

---

## FAQ

### Q1: 字幕总是提前或滞后怎么办？

**A**: 使用"字幕延迟调整"参数:
- 字幕提前 → 设置正值延迟 (+200ms, +500ms)
- 字幕滞后 → 设置负值提前 (-200ms, -500ms)

### Q2: Azure 的 offset 是从什么时候开始计算的？

**A**: `offset` 是从 **Azure 识别会话开始** 的时间偏移。也就是说:
- 服务端调用 `startContinuousRecognitionAsync()` 时，Azure 内部开始计时
- 每个识别结果的 `offset` 是相对于会话开始的时间

**关键**: 客户端音频播放器的 `currentTime` 需要与 Azure 会话时间对齐。

### Q3: 如果客户端中途加入，如何对齐？

**A**: 有两种策略:

**策略1: 从当前时间开始**
```javascript
// 新客户端只显示从连接后收到的字幕
// 忽略历史字幕，从 offset 最小值开始
```

**策略2: 尝试对齐（复杂）**
```javascript
// 1. 服务端记录识别会话开始时间 (sessionStartTime)
// 2. 客户端连接时，获取 sessionStartTime 和当前时间
// 3. 计算时间差作为 offset 调整
const timeDiff = Date.now() - sessionStartTime;
const adjustedOffset = subtitle.offset - timeDiff;
```

推荐使用 **策略1**（简单有效）。

### Q4: 是否需要缓冲字幕？

**A**: 建议保持一个小缓冲（2-3秒），原因:
- 网络抖动可能导致字幕延迟到达
- 客户端播放器可能有缓冲延迟

```javascript
// 字幕提前到达，等待音频追上
const BUFFER_MS = 2000; // 2秒缓冲
if (currentTimeMs + BUFFER_MS >= subtitle.offset) {
    // 开始显示字幕
}
```

---

## 总结

✅ **推荐方案**: 客户端本地播放音频流 + 时间戳字幕同步

**关键代码修改**:
1. 服务端: 在 `onRecognizing` 和 `onRecognized` 中发送 `offset` 和 `duration`
2. 客户端: 根据 `audioPlayer.currentTime` 匹配对应的字幕

**核心逻辑**:
```javascript
if (currentTimeMs >= offset && currentTimeMs < offset + duration) {
    displaySubtitle();
}
```

**文件**:
- 服务端: `78-sse-22.js` (已修改)
- 客户端示例: `client-subtitle-sync-example.html`
- 本文档: `SUBTITLE_SYNC_GUIDE.md`
