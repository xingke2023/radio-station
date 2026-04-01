# 实时电台语音识别和翻译项目 - 项目概览

> **快速启动指南：Claude 或新开发者第一次接触本项目时，请先阅读此文档！**

---

## 📋 项目基本信息

### 项目名称
多电台实时语音识别和翻译系统

### 项目描述
使用 Azure Speech API 实时识别和翻译电台音频流，通过 Centrifugo 推送字幕给多个客户端（Web、Android、iOS）。

### 技术栈
- **后端**: Node.js + Express
- **语音识别**: Azure Cognitive Services Speech SDK
- **实时推送**: Centrifugo v6.4.0 (WebSocket)
- **音频处理**: FFmpeg
- **数据库**: MySQL 8
- **部署**: PM2 进程管理
- **反向代理**: Nginx

### 服务器环境
- **系统**: Ubuntu Linux 6.8.0-51-generic
- **工作目录**: `/home/ubuntu/radio/`
- **域名**: `https://radio.xingke888.com`
- **用户**: ubuntu

---

## 🗂️ 项目结构

```
/home/ubuntu/radio/
├── 78-sse-22.js                    # 🔥 主服务文件（当前生产版本）
├── database/
│   ├── RadioDatabase.js            # 数据库操作类
│   └── AzureKeyManager.js          # Azure 密钥管理器
├── test-client-disconnect.js       # WebSocket 客户端测试脚本
├── CENTRIFUGO-CLIENT-MEMO.md       # 🔴 Centrifugo 客户端连接重要备忘
├── android-ping-fix.md             # Android 客户端 ping/pong 修复
├── PROJECT-OVERVIEW.md             # 📖 本文件
├── CHANGELOG.md                    # 变更日志
└── node_modules/                   # 依赖包
```

---

## 🚀 核心服务

### 1. 主服务 (78-sse-22.js)
- **端口**: 8533
- **PM2 进程名**: `78-sse-22`
- **功能**:
  - 管理多个电台实例
  - 从数据库分配 Azure 密钥
  - 处理 Centrifugo Webhook (订阅/取消订阅)
  - 实时语音识别和翻译

**启动命令**:
```bash
pm2 list                    # 查看进程状态
pm2 logs 78-sse-22          # 查看日志
pm2 restart 78-sse-22       # 重启服务
pm2 stop 78-sse-22          # 停止服务
```

### 2. Centrifugo 服务
- **端口**: 8000 (内部), 443 (外部通过 Nginx)
- **PM2 进程名**: `centrifugo`
- **配置文件**: `/home/ubuntu/centrifugo-config.json`
- **WebSocket 地址**: `wss://radio.xingke888.com/centrifugo/connection/websocket`

**启动命令**:
```bash
pm2 logs centrifugo         # 查看日志
pm2 restart centrifugo      # 重启服务
```

### 3. MySQL 数据库
- **端口**: 8510
- **数据库名**: `radio`
- **用户**: root
- **密码**: Uu8297636

**主要表**:
- `radio_stations`: 电台信息
- `azure_keys`: Azure Speech API 密钥
- `system_config`: 系统配置

---

## 🔑 重要配置

### Azure 密钥管理

**位置**: `database/AzureKeyManager.js`

**机制**:
1. 循环分配密钥（轮询）
2. 自动过滤黑名单区域（如 eastus2）
3. 配额超限时自动切换下一个密钥
4. 所有密钥超限时自动重置配额计数

**密钥状态字段**:
- `is_active`: 是否激活（0/1）
- `quota_exceeded_count`: 配额超限次数（>0 时暂时不可用）
- `current_usage_count`: 当前使用数
- `max_concurrent_stations`: 最大并发电台数（默认 5）

### Centrifugo 配置

**配置文件**: `/home/ubuntu/centrifugo-config.json`

**关键配置**:
```json
{
  "client": {
    "ping_interval": "25s",      // 每 25 秒发送 ping
    "pong_timeout": "10s"        // 等待 10 秒 pong
  }
}
```

⚠️ **重要**: 客户端必须响应空消息 `{}` 作为 pong，否则会在 35 秒后断开！
详见: [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md)

---

## 📡 API 端点

### 客户端连接
```
GET /events?station_code=<电台代码>
```
返回 Centrifugo 连接信息（WebSocket URL、频道名称）

### 电台管理
```
GET  /api/radios              # 获取所有电台列表
POST /api/radios              # 添加新电台
PUT  /api/radios/:code        # 更新电台信息
DELETE /api/radios/:code      # 删除电台（软删除）
GET  /api/radios/status       # 获取电台状态
```

### 统计信息
```
GET /api/stations             # 活跃电台实例
GET /api/keys                 # Azure 密钥统计
GET /api/statistics           # 综合统计
```

### Centrifugo Webhook
```
POST /centrifugo/subscribe    # 订阅事件（启动识别）
POST /centrifugo/unsubscribe  # 取消订阅（停止识别）
```

---

## 🔥 关键流程

### 客户端连接流程

```
1. 客户端请求 /events?station_code=msnbc
   ↓
2. 服务器返回 WebSocket URL 和频道信息
   ↓
3. 客户端连接 Centrifugo WebSocket
   ↓
4. 发送 connect 命令 (id: 1, connect: {})
   ↓
5. 收到连接响应，获取 client_id
   ↓
6. 发送 subscribe 命令 (id: 2, subscribe: {channel: "station:msnbc"})
   ↓
7. Centrifugo 触发 Webhook → /centrifugo/subscribe
   ↓
8. 服务器检测到首个连接 → 启动语音识别
   ↓
9. 客户端开始接收实时字幕数据
   ↓
10. 每 25 秒响应 ping (空消息 {})
```

### 密钥自动切换流程

```
1. Azure 返回配额超限错误
   ↓
2. 记录当前密钥配额超限 (quota_exceeded_count + 1)
   ↓
3. 发送 quotaExceeded 事件
   ↓
4. 调用 switchToNextKey()
   ↓
5. 停止当前识别 & 释放旧密钥
   ↓
6. 从密钥池分配新密钥
   ↓
7. 更新 SpeechConfig
   ↓
8. 发送 keySwitched 事件
   ↓
9. 延迟 2 秒后重启识别
   ↓
10. 继续服务（对客户端透明）
```

---

## 🐛 常见问题和解决方案

### 1. 客户端 25-35 秒后断开连接

**症状**: 关闭代码 `3012: no pong`

**原因**: 客户端没有响应 Centrifugo 的 ping（空消息）

**解决方案**:
```javascript
if (Object.keys(msg).length === 0) {
    ws.send(JSON.stringify({}));  // 响应 pong
    return;
}
```

详见: [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md)

### 2. Azure 密钥配额超限

**症状**: 日志显示 "Quota exceeded" 或 "Authentication failed"

**解决方案**:
- 系统会自动切换到下一个可用密钥
- 查看密钥状态: `GET /api/keys`
- 手动重置配额计数（如果所有密钥都超限）:
```sql
UPDATE azure_keys SET quota_exceeded_count = 0 WHERE is_active = 1;
```

### 3. 语音识别停止

**可能原因**:
- 音频流断开
- Azure 密钥失效
- 所有客户端断开连接

**检查步骤**:
```bash
# 1. 查看主服务日志
pm2 logs 78-sse-22 --lines 100

# 2. 检查活跃电台
curl http://localhost:8533/api/stations

# 3. 检查密钥状态
curl http://localhost:8533/api/keys

# 4. 测试音频流
ffmpeg -i "https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8" -t 10 -f null -
```

### 4. Centrifugo 连接失败

**症状**: 客户端无法连接 WebSocket

**检查步骤**:
```bash
# 1. 检查 Centrifugo 服务
pm2 logs centrifugo

# 2. 检查 Nginx 配置
sudo nginx -t
sudo systemctl status nginx

# 3. 测试 WebSocket 连接
node test-client-disconnect.js
```

---

## 📊 监控和日志

### 日志位置
```bash
# PM2 日志
~/.pm2/logs/78-sse-22-out.log     # 标准输出
~/.pm2/logs/78-sse-22-error.log   # 错误输出

# Nginx 日志
/var/log/nginx/access.log
/var/log/nginx/error.log
```

### 监控命令
```bash
# 实时查看日志
pm2 logs 78-sse-22

# 监控进程状态
pm2 monit

# 查看系统资源
htop

# 查看网络连接
netstat -tupln | grep -E "8533|8000"
```

### 关键指标

**电台实例**:
- 活跃实例数
- 客户端连接数
- 识别状态

**Azure 密钥**:
- 可用密钥数
- 配额超限数
- 平均使用率

**性能统计**:
- 事件发送次数
- 平均发送耗时
- 错误率

---

## 🔧 维护操作

### 日常维护

**每天检查**:
```bash
# 查看服务状态
pm2 list

# 查看磁盘空间
df -h

# 查看日志大小
du -sh ~/.pm2/logs/
```

**每周检查**:
```bash
# 清理旧日志
pm2 flush

# 检查数据库
mysql -u root -p radio -e "SELECT COUNT(*) FROM radio_stations WHERE is_deleted=0;"

# 查看密钥使用情况
curl http://localhost:8533/api/keys | jq
```

### 更新部署

**更新代码后**:
```bash
# 1. 备份当前版本
cp 78-sse-22.js 78-sse-22.js.backup

# 2. 修改代码
# ... 编辑文件 ...

# 3. 重启服务
pm2 restart 78-sse-22

# 4. 检查日志
pm2 logs 78-sse-22 --lines 50

# 5. 验证功能
node test-client-disconnect.js
```

### 紧急回滚

```bash
# 恢复备份
cp 78-sse-22.js.backup 78-sse-22.js

# 重启服务
pm2 restart 78-sse-22
```

---

## 📝 开发规范

### 代码修改注意事项

1. **日志控制**
   - Recognizing/Recognized 事件日志已注释（减少日志量）
   - 保留重要的连接和状态日志
   - 使用 console.log/warn/error 按级别输出

2. **密钥管理**
   - 所有密钥操作通过 AzureKeyManager
   - 不要手动修改数据库中的密钥状态
   - 配额超限时依赖自动切换机制

3. **客户端连接**
   - 使用 Centrifugo Webhook 触发识别启动/停止
   - 支持 useCentrifugo 模式（客户端数为 0 时继续识别）
   - 客户端示例代码必须包含 ping/pong 处理

4. **错误处理**
   - 配额错误触发密钥切换
   - 其他错误触发重连机制（最多 5 次）
   - 发送相应的事件给客户端

### 测试流程

**功能测试**:
```bash
# 1. 测试 WebSocket 连接
node test-client-disconnect.js

# 2. 测试 API 端点
curl http://localhost:8533/api/radios
curl http://localhost:8533/events?station_code=msnbc

# 3. 测试密钥切换
# （手动将某个密钥标记为超限，观察是否自动切换）
```

**性能测试**:
```bash
# 模拟多客户端连接
# 观察内存和 CPU 使用情况
```

---

## 🔗 相关文档

### 必读文档
- [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md) - 客户端连接备忘
- [android-ping-fix.md](./android-ping-fix.md) - Android 客户端修复

### 参考文档
- [CHANGELOG.md](./CHANGELOG.md) - 变更历史
- [QUICK-START.md](./QUICK-START.md) - 快速开始
- [MULTI-RADIO-GUIDE.md](./MULTI-RADIO-GUIDE.md) - 多电台指南

### 外部资源
- [Azure Speech SDK 文档](https://learn.microsoft.com/zh-cn/azure/cognitive-services/speech-service/)
- [Centrifugo 文档](https://centrifugal.dev/docs/getting-started/introduction)
- [FFmpeg 文档](https://ffmpeg.org/documentation.html)

---

## 🆘 紧急联系

### 问题排查优先级

**P0 - 紧急（服务完全中断）**:
1. 检查进程状态: `pm2 list`
2. 查看错误日志: `pm2 logs 78-sse-22 --err`
3. 重启服务: `pm2 restart 78-sse-22`
4. 检查数据库连接
5. 检查 Centrifugo 服务

**P1 - 高优先级（部分功能异常）**:
1. 查看密钥状态: `curl http://localhost:8533/api/keys`
2. 测试音频流连接
3. 检查客户端连接数
4. 查看系统资源（内存/CPU）

**P2 - 中优先级（性能问题）**:
1. 查看日志大小
2. 检查数据库查询性能
3. 优化配置参数

---

## 📌 快速命令参考

```bash
# 服务管理
pm2 list                              # 查看所有进程
pm2 restart 78-sse-22                 # 重启主服务
pm2 logs 78-sse-22 --lines 100        # 查看日志
pm2 monit                             # 实时监控

# 测试
node test-client-disconnect.js        # 测试客户端连接
curl http://localhost:8533/api/keys   # 查看密钥状态

# 数据库
mysql -u root -pUu8297636 radio       # 连接数据库

# 系统
df -h                                 # 磁盘空间
free -h                               # 内存使用
htop                                  # 系统监控
```

---

## 更新日期
最后更新: 2025-10-28

---

**欢迎来到实时电台语音识别项目！如有疑问，请查阅相关文档或查看代码注释。**
