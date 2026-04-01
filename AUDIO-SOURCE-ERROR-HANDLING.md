# 音频源错误处理机制

## 更新时间
2025-11-01

## 功能说明

当音频源无法连接或出现问题时,系统会自动:
1. 检测音频源连接失败
2. 重试连接(最多5次)
3. 5次失败后停止识别
4. 向客户端推送详细错误消息

## 实现细节

### 1. 音频源连接检测

#### a) ffmpeg 进程监控
- 监听 ffmpeg 的 stderr 错误输出
- 检测常见错误模式:
  - Connection refused (连接被拒绝)
  - Server returned 404 (服务器返回404)
  - Server returned 403 (服务器返回403)
  - Invalid data found (无效数据)
  - Connection timed out (连接超时)

#### b) 进程退出监控
- 监听 ffmpeg 进程异常退出
- 如果进程在接收到数据前退出,标记为音频源连接失败

#### c) 超时检测
- **15秒初始检测**: 如果启动后15秒内未接收到任何音频数据,标记为连接失败
- **60秒持续检测**: 运行中如果60秒内未接收到数据,触发重连

### 2. 重试机制

#### 参数配置
```javascript
this.maxRetries = 5;           // 最大重试次数
this.retryDelay = 3000;        // 基础延迟3秒
this.currentRetries = 0;       // 当前重试计数
```

#### 延迟策略
- 第1次重试: 3秒后
- 第2次重试: 6秒后
- 第3次重试: 9秒后
- 第4次重试: 12秒后
- 第5次重试: 15秒后

**总重试时长**: 约45秒

### 3. 错误事件推送

#### a) 重连中事件 (reconnecting)
```json
{
  "event": "reconnecting",
  "message": "音频源连接失败，第 1 次重试中 (共5次)...",
  "reason": "音频源连接超时",
  "isAudioSourceError": true,
  "retryCount": 1,
  "maxRetries": 5,
  "timestamp": "2025-11-01T08:00:00.000Z"
}
```

#### b) 最终失败事件 (audioSourceFailed)
```json
{
  "event": "audioSourceFailed",
  "message": "音频源连接失败，已重试 5 次",
  "details": "15秒内未接收到音频数据，音频源可能无法访问",
  "streamUrl": "https://example.com/stream.m3u8",
  "retryCount": 5,
  "maxRetries": 5,
  "timestamp": "2025-11-01T08:01:00.000Z"
}
```

### 4. 客户端处理

#### 显示重试状态
```javascript
if (pushData.event === 'reconnecting') {
    const retryMsg = pushData.isAudioSourceError
        ? `⚠️ 音频源连接失败，正在重试 (${pushData.retryCount}/${pushData.maxRetries})...`
        : `🔄 连接中断，正在重试 (${pushData.retryCount}/${pushData.maxRetries})...`;
    updateStatus(retryMsg, 'info');
}
```

#### 显示最终错误
```javascript
if (pushData.event === 'audioSourceFailed') {
    updateStatus(`❌ ${pushData.message}: ${pushData.details}`, 'error');
    subtitleEn.textContent = '❌ 音频源无法连接';
    subtitleZh.textContent = `${pushData.message}\n${pushData.details}`;

    // 3秒后自动断开连接
    setTimeout(() => disconnect(), 3000);
}
```

## 代码位置

### 服务端 (78-sse-22.js)

1. **音频源监控** (line 390-447)
   - `streamToPcm()` 函数
   - 添加 stderr 错误监听
   - 添加进程退出监听
   - 标记: `audioSourceConnected`, `audioDataReceivedCount`

2. **数据接收标记** (line 541-575)
   - pcmStream 'data' 事件
   - 接收到第一个数据包时标记连接成功

3. **超时检测** (line 610-645)
   - `setupDataTimeoutCheck()` 函数
   - 15秒初始检测
   - 60秒持续检测

4. **重连处理** (line 652-742)
   - `handleReconnection()` 函数
   - 检测音频源错误类型
   - 构建错误消息
   - 发送事件给客户端

5. **资源清理** (line 805-818)
   - `stopRecognitionInternal()` 函数
   - 清理超时检测器

### 客户端 (client-subtitle-sync-sse.html)

1. **事件处理** (line 511-530)
   - 'reconnecting' 事件处理
   - 'audioSourceFailed' 事件处理
   - 自动断开连接

## 测试场景

### 场景 1: 无效的流地址
```
流地址: https://example.com/invalid.m3u8
预期结果: 15秒后检测到连接失败，5次重试后停止
错误消息: "15秒内未接收到音频数据，音频源可能无法访问"
```

### 场景 2: 404错误
```
流地址: https://tunein.com/nonexistent.aac
预期结果: ffmpeg 立即报404错误，5次重试后停止
错误消息: "Server returned 404 Not Found"
```

### 场景 3: 连接超时
```
流地址: https://unreachable-server.com/stream.m3u8
预期结果: 连接超时，15秒后检测到失败，5次重试后停止
错误消息: "Connection timed out"
```

### 场景 4: 流中断
```
情况: 正常连接后流突然中断
预期结果: 60秒无数据后触发重连，5次重试后停止
错误消息: "数据接收超时"
```

## 日志输出示例

### 成功连接
```
✅ 音频源连接成功，开始接收数据
📊 音频数据流动: 160.0 KB (最近5秒)
```

### 连接失败并重试
```
❌ 15秒内未接收到音频数据，音频源可能无法访问
准备重新连接 (1/5)，原因: 音频源连接超时，延迟: 3000ms
尝试重新连接 (1/5)...

❌ ffmpeg 进程异常退出 (code: 1, signal: null)
❌ 音频源连接失败: https://example.com/invalid.m3u8
准备重新连接 (2/5)，原因: 音频源连接超时，延迟: 6000ms
...
```

### 最终失败
```
❌ 重试次数已达上限 (5)，停止重试
❌ 音频源连接失败，已重试 5 次
   详情: 15秒内未接收到音频数据，音频源可能无法访问
   流地址: https://example.com/invalid.m3u8
```

## 错误类型映射

| 错误模式 | 检测方式 | 错误消息 |
|---------|---------|---------|
| Connection refused | ffmpeg stderr | 连接被拒绝 |
| Server returned 404 | ffmpeg stderr | 服务器返回404 |
| Server returned 403 | ffmpeg stderr | 服务器返回403 |
| Invalid data found | ffmpeg stderr | 无效的音频数据 |
| Connection timed out | ffmpeg stderr | 连接超时 |
| 15秒无数据 | 初始超时检测 | 15秒内未接收到音频数据 |
| 60秒无数据 | 持续超时检测 | 数据接收超时 |
| ffmpeg 异常退出 | 进程监控 | 音频源连接失败 |

## 优化建议

### 当前配置
- 最大重试次数: 5次
- 初始检测超时: 15秒
- 持续检测超时: 60秒

### 可调整参数
```javascript
// 更快失败（适合测试）
this.maxRetries = 3;
this.initialCheckTimeout = 10000;  // 10秒

// 更多容忍（适合不稳定网络）
this.maxRetries = 10;
this.initialCheckTimeout = 30000;  // 30秒
```

## 相关文件
- `/home/ubuntu/radio/78-sse-22.js` - 服务端实现
- `/home/ubuntu/radio/client-subtitle-sync-sse.html` - 客户端实现
- `/home/ubuntu/radio/AUDIO-SOURCE-ERROR-HANDLING.md` - 本文档
