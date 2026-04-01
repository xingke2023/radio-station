# Bug修复: 重试计数器问题

## 问题描述

### 发现时间
2025-11-01

### 症状
当音频源连接失败(如404错误)时,重试计数一直显示 (1/5)，无法正确累加到 (2/5), (3/5) 等。

### 日志示例
```
准备重新连接 (1/5)，原因: 音频流已结束，延迟: 3000ms
...
准备重新连接 (1/5)，原因: 音频流已结束，延迟: 3000ms  ← 仍然是 1/5
...
准备重新连接 (1/5)，原因: 音频流已结束，延迟: 3000ms  ← 仍然是 1/5
```

## 根本原因

### 代码逻辑问题
在 `78-sse-22.js:496` 行:
```javascript
// 识别启动成功后重置重试计数
this.currentRetries = 0;
```

### 问题分析
1. 音频源404错误发生
2. ffmpeg 立即失败,触发重连
3. `handleReconnection()` 增加重试计数: `currentRetries = 1`
4. 延迟3秒后重试
5. Azure Speech SDK 连接成功(识别器启动)
6. **执行 `currentRetries = 0` - 重置计数** ❌
7. 但音频流仍然404,再次失败
8. 重试计数又变成 1

### 时序图
```
时刻 0: 404错误 → currentRetries++ → 1
时刻 3s: 重试启动 → Azure连接成功 → currentRetries=0 (重置)
时刻 3s: ffmpeg仍404 → currentRetries++ → 1 (又回到1)
时刻 6s: 重试启动 → Azure连接成功 → currentRetries=0 (重置)
时刻 6s: ffmpeg仍404 → currentRetries++ → 1 (又回到1)
... 无限循环
```

## 解决方案

### 修改策略
**只在接收到音频数据后才重置重试计数**，而不是在识别器启动时重置。

### 代码修改

#### 修改1: 移除识别启动时的重置
**文件**: `78-sse-22.js:495-498`

**之前:**
```javascript
// 重置重试计数和密钥切换计数（识别成功启动后重置）
this.currentRetries = 0;
this.keySwitchAttempts = 0;
```

**之后:**
```javascript
// 重置重试计数和密钥切换计数（识别成功启动后重置）
// 注意: 只有在接收到音频数据后才重置 currentRetries，避免音频源失败时重置计数
// this.currentRetries 会在接收到第一个音频数据包时重置
this.keySwitchAttempts = 0;
```

#### 修改2: 在接收到音频数据时重置
**文件**: `78-sse-22.js:549-553`

**新增代码:**
```javascript
// 标记音频源连接成功（接收到第一个数据包）
if (!this.audioSourceConnected) {
    this.audioSourceConnected = true;
    console.log('✅ 音频源连接成功，开始接收数据');

    // 重置重试计数（音频源成功连接后）
    if (this.currentRetries > 0) {
        console.log(`✅ 音频源恢复正常，重置重试计数 (之前: ${this.currentRetries})`);
        this.currentRetries = 0;
    }
}
```

## 修复后的行为

### 正常场景 (音频源可用)
```
时刻 0: 启动识别 → Azure连接
时刻 1s: 接收到音频数据 → audioSourceConnected=true → currentRetries=0
时刻 N: 继续正常运行
```

### 失败场景 (音频源404)
```
时刻 0: 404错误 → currentRetries=1
时刻 3s: 重试启动 → Azure连接 (不重置计数)
时刻 3s: 仍404 → currentRetries=2
时刻 6s: 重试启动 → Azure连接 (不重置计数)
时刻 6s: 仍404 → currentRetries=3
时刻 9s: 重试启动 → Azure连接 (不重置计数)
时刻 9s: 仍404 → currentRetries=4
时刻 12s: 重试启动 → Azure连接 (不重置计数)
时刻 12s: 仍404 → currentRetries=5
时刻 15s: 重试启动 → Azure连接 (不重置计数)
时刻 15s: 仍404 → currentRetries=5 达到上限
时刻 15s: 发送 audioSourceFailed 事件 → 停止识别
```

### 恢复场景 (音频源临时失败)
```
时刻 0: 网络波动 → 数据中断 → currentRetries=1
时刻 3s: 重试启动 → Azure连接
时刻 4s: 接收到音频数据 → currentRetries=0 ✅ (恢复正常)
```

## 测试验证

### 测试场景1: 404错误
```bash
# 使用 russkoe 电台测试 (已知404)
curl http://localhost:8533/sse/connect?station_code=russkoe
```

**预期日志:**
```
准备重新连接 (1/5)，原因: 音频流已结束，延迟: 3000ms
尝试重新连接 (1/5)...
准备重新连接 (2/5)，原因: 音频流已结束，延迟: 6000ms  ← 正确递增
尝试重新连接 (2/5)...
准备重新连接 (3/5)，原因: 音频流已结束，延迟: 9000ms  ← 正确递增
...
❌ 重试次数已达上限 (5)，停止重试
❌ 音频源连接失败，已重试 5 次
```

### 测试场景2: 正常电台
```bash
# 使用正常电台测试
curl http://localhost:8533/sse/connect?station_code=msnbc
```

**预期日志:**
```
✅ 音频源连接成功，开始接收数据
📊 音频数据流动: 160.0 KB (最近5秒)
(currentRetries 保持为 0)
```

## 影响范围

### 修复的问题
- ✅ 重试计数器正确累加
- ✅ 5次重试后正确停止
- ✅ audioSourceFailed 事件正确触发

### 不影响的功能
- ✅ 正常电台的识别
- ✅ Azure密钥切换机制
- ✅ 临时网络波动的恢复

## 相关文件

### 修改的文件
- `/home/ubuntu/radio/78-sse-22.js`
  - Line 495-498: 移除识别启动时的重置
  - Line 549-553: 添加接收数据时的重置

### 文档
- `/home/ubuntu/radio/BUGFIX-RETRY-COUNTER.md` - 本文档
- `/home/ubuntu/radio/AUDIO-SOURCE-ERROR-HANDLING.md` - 错误处理机制文档

## 部署

### 服务重启
```bash
pm2 restart 78-sse-22
```

### 验证
```bash
# 查看日志
pm2 logs 78-sse-22 --lines 100

# 应该看到正确的重试计数
```

## 版本信息
- 修复日期: 2025-11-01
- 修复版本: v1.1.0
- 修复类型: Bug修复
