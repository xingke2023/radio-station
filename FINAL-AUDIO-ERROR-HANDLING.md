# 音频源错误处理 - 最终版本

## 更新时间
2025-11-01 (最终版)

## 完整功能

### 1. 音频源连接失败检测 ✅
- ffmpeg 错误输出监控 (404, 403, Connection refused等)
- 进程异常退出检测
- 15秒初始超时检测
- 60秒持续超时检测

### 2. 智能重试机制 ✅
- **最大重试次数**: 5次
- **递增延迟**: 3秒, 6秒, 9秒, 12秒, 15秒
- **重试计数修复**: 正确累加,不会重置

### 3. 跳过无效识别 ✅ (新增)
**核心优化**: 对于明确失败的音频源(404/403/Connection refused),不启动Azure识别器,避免浪费API调用

#### 跳过条件
- HTTP 404 Not Found
- HTTP 403 Forbidden
- Connection refused

#### 不跳过的情况(可能恢复)
- 网络超时
- 临时连接中断
- 15秒初始超时

### 4. 错误消息推送 ✅
- 重试过程: `reconnecting` 事件
- 最终失败: `audioSourceFailed` 事件
- 客户端友好提示

## 工作流程

### 场景1: 明确失败 (404/403/拒绝连接)

```
ffmpeg检测到404错误
  ↓
标记: audioSourceError = "404 Not Found"
  ↓
第1次重试计划: currentRetries=1, 延迟3秒
  ↓
3秒后: 检测到404错误,跳过Azure识别
      console: ⚠️ 音频源明确失败(404/403/拒绝连接)，跳过识别启动
  ↓
立即进入第2次重试: currentRetries=2, 延迟6秒
  ↓
6秒后: 再次跳过识别
  ↓
... 继续到第5次
  ↓
第5次失败后: 发送 audioSourceFailed 事件
  ↓
客户端显示错误 + 3秒后断开
  ↓
停止识别,释放资源
```

**总耗时**: 约 3+6+9+12+15 = 45秒
**节省**: 避免了5次Azure API调用

### 场景2: 临时失败 (超时/网络波动)

```
网络超时
  ↓
15秒后检测到无数据
  ↓
第1次重试: currentRetries=1, 延迟3秒
  ↓
3秒后: 启动Azure识别 (可能恢复)
  ↓
接收到音频数据 → 成功恢复
  ↓
重置: currentRetries=0
  ↓
继续正常运行
```

## 代码修改汇总

### 修改1: 重试计数器修复
**文件**: `78-sse-22.js:495-498`

移除识别启动时的重置,改为在接收到音频数据时重置

### 修改2: 音频数据接收时重置计数
**文件**: `78-sse-22.js:549-553`

```javascript
if (!this.audioSourceConnected) {
    this.audioSourceConnected = true;
    console.log('✅ 音频源连接成功，开始接收数据');

    if (this.currentRetries > 0) {
        console.log(`✅ 音频源恢复正常，重置重试计数`);
        this.currentRetries = 0;
    }
}
```

### 修改3: 跳过无效识别 (关键优化)
**文件**: `78-sse-22.js:714-731`

```javascript
if (isAudioSourceError) {
    const shouldSkipRecognition = this.audioSourceError && (
        this.audioSourceError.includes('404') ||
        this.audioSourceError.includes('403') ||
        this.audioSourceError.includes('Connection refused')
    );

    if (shouldSkipRecognition) {
        console.log('⚠️ 音频源明确失败(404/403/拒绝连接)，跳过识别启动');
        this.handleReconnection('音频源持续失败');
        return;
    }
}
```

## 日志示例

### 404错误 - 跳过识别
```
ffmpeg 错误: [https @ 0x...] HTTP error 404 Not Available
❌ ffmpeg 进程异常退出 (code: 8, signal: null)
❌ 音频源连接失败: https://rusradio.hostingradio.ru/rusradio96.aac
准备重新连接 (1/5)，原因: 音频流已结束，延迟: 3000ms

尝试重新连接 (1/5)...
⚠️ 音频源明确失败(404/403/拒绝连接)，跳过识别启动，直接进入下次重试
准备重新连接 (2/5)，原因: 音频源持续失败，延迟: 6000ms  ← 正确递增

尝试重新连接 (2/5)...
⚠️ 音频源明确失败(404/403/拒绝连接)，跳过识别启动，直接进入下次重试
准备重新连接 (3/5)，原因: 音频源持续失败，延迟: 9000ms  ← 正确递增

... (继续到5次)

❌ 重试次数已达上限 (5)，停止重试
❌ 音频源连接失败，已重试 5 次
   详情: HTTP error 404 Not Available
   流地址: https://rusradio.hostingradio.ru/rusradio96.aac
```

### 正常电台
```
✅ [SessionStarted] Azure 会话已启动
✅ 音频源连接成功，开始接收数据
📊 音频数据流动: 160.0 KB (最近5秒)
```

## 性能对比

### 修改前 (有bug)
```
问题1: 重试计数不累加,可能无限重试
问题2: 每次重试都启动Azure识别
成本: 5次失败 = 5次Azure API调用
```

### 修改后
```
✅ 重试计数正确累加
✅ 404/403错误跳过Azure识别
成本: 5次失败 = 0次Azure API调用 (节省100%)
耗时: 45秒完成5次重试
```

## 测试场景

### 测试1: 404错误
```bash
# russkoe电台(已知404)
curl http://localhost:8533/sse/connect?station_code=russkoe
```

**预期**: 跳过识别,重试计数正确递增

### 测试2: 无效URL
```bash
# 使用测试脚本
./test-audio-source-error.sh
```

**预期**: 15秒超时,跳过识别,5次重试后停止

### 测试3: 正常电台
```bash
curl http://localhost:8533/sse/connect?station_code=msnbc
```

**预期**: 正常启动,接收数据,计数器保持0

## 优势总结

### 1. 节省资源 💰
- 避免对404/403电台的无效Azure API调用
- 每次失败节省约 $0.001-0.01

### 2. 更快失败 ⚡
- 404错误立即跳过,不等待Azure超时
- 总失败时间从 ~60秒 缩短到 ~45秒

### 3. 正确计数 ✅
- 重试计数器正确累加
- 5次后确保停止

### 4. 智能恢复 🔄
- 临时错误仍会启动识别尝试恢复
- 音频恢复时自动重置计数

## 配置参数

### 当前配置
```javascript
this.maxRetries = 5;              // 最大重试次数
this.retryDelay = 3000;           // 基础延迟3秒
initialCheckTimeout = 15000;      // 15秒初始检测
dataTimeoutCheck = 60000;         // 60秒持续检测
```

### 调整建议

#### 快速失败模式(测试环境)
```javascript
this.maxRetries = 3;              // 3次重试
this.retryDelay = 2000;           // 2秒延迟
initialCheckTimeout = 10000;      // 10秒检测
// 总耗时: 约 2+4+6 = 12秒
```

#### 容错模式(生产环境)
```javascript
this.maxRetries = 5;              // 5次重试 (当前)
this.retryDelay = 3000;           // 3秒延迟 (当前)
initialCheckTimeout = 15000;      // 15秒检测 (当前)
// 总耗时: 约 3+6+9+12+15 = 45秒
```

## 相关文件

### 代码
- `/home/ubuntu/radio/78-sse-22.js` - 服务端实现
- `/home/ubuntu/radio/client-subtitle-sync-sse.html` - 客户端实现

### 文档
- `/home/ubuntu/radio/FINAL-AUDIO-ERROR-HANDLING.md` - 本文档 (最终版)
- `/home/ubuntu/radio/AUDIO-SOURCE-ERROR-HANDLING.md` - 技术文档
- `/home/ubuntu/radio/BUGFIX-RETRY-COUNTER.md` - Bug修复记录
- `/home/ubuntu/radio/SUMMARY-AUDIO-ERROR-HANDLING.md` - 功能总结

### 测试
- `/home/ubuntu/radio/test-audio-source-error.sh` - 测试脚本

## 版本历史

### v1.0.0 (2025-11-01 早)
- 初始实现音频源错误检测
- 实现重试机制
- 添加错误消息推送

### v1.0.1 (2025-11-01 中)
- 修复重试计数器bug
- 改为在接收数据时重置计数

### v1.1.0 (2025-11-01 晚) - 当前版本
- **新增**: 跳过无效识别(404/403/拒绝连接)
- 节省Azure API成本
- 更快的失败检测

## 未来改进

1. **URL预验证**
   - 在启动识别前HEAD请求验证URL有效性
   - 立即拒绝无效URL

2. **智能重试间隔**
   - 404错误: 快速失败(减少间隔)
   - 超时错误: 慢速重试(增加间隔)

3. **电台健康监控**
   - 定期检查数据库中电台URL
   - 自动禁用持续失败的电台
   - 发送管理员告警

4. **用户体验优化**
   - 推荐备用电台
   - 显示预计恢复时间
   - 提供错误诊断工具
