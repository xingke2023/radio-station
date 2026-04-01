# Claude 启动清单 - 快速上手指南

> **当 Claude 第一次进入这个项目时，按照这个清单快速了解项目！**

---

## ✅ 第一步：快速了解（5分钟）

### 1. 项目是什么？
实时电台语音识别和翻译系统（英语→中文），使用 Azure + Centrifugo + WebSocket

### 2. 核心文件
```bash
cd /home/ubuntu/radio/
ls -lh 78-sse-22.js              # 主服务文件
ls -lh database/                 # 数据库操作
```

### 3. 当前运行状态
```bash
pm2 list                         # 查看所有服务
pm2 logs 78-sse-22 --lines 20    # 最近日志
```

### 4. 必读文档
1. 📖 **[PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md)** - 完整项目文档（10分钟阅读）
2. 🔴 **[CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md)** - 客户端连接关键信息

---

## 🔥 关键信息速查

### 服务信息

| 服务 | 端口 | PM2 名称 | 状态查看 |
|-----|------|---------|---------|
| 主服务 | 8533 | 78-sse-22 | `pm2 logs 78-sse-22` |
| Centrifugo | 8000 | centrifugo | `pm2 logs centrifugo` |
| MySQL | 8510 | - | `mysql -u root -p` (密码: Uu8297636) |

### 目录结构
```
/home/ubuntu/radio/
├── 78-sse-22.js                 # 🔥 主程序
├── database/                    # 数据库操作类
├── test-client-disconnect.js    # 测试脚本
├── PROJECT-OVERVIEW.md          # 📖 完整文档
└── CENTRIFUGO-CLIENT-MEMO.md    # 🔴 客户端连接备忘
```

### API 端点速查
```bash
# 客户端连接
curl http://localhost:8533/events?station_code=msnbc

# 电台列表
curl http://localhost:8533/api/radios

# 密钥状态
curl http://localhost:8533/api/keys

# 活跃电台
curl http://localhost:8533/api/stations
```

---

## 🐛 遇到问题？按这个顺序检查

### 问题 1: 服务不响应
```bash
pm2 list                    # 进程是否在线？
pm2 restart 78-sse-22       # 重启试试
pm2 logs 78-sse-22 --err    # 查看错误日志
```

### 问题 2: 客户端断开连接
**最常见原因**: 客户端没有响应 Centrifugo 的 ping

**解决方案**: 查看 [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md)

关键代码：
```javascript
if (Object.keys(msg).length === 0) {
    ws.send(JSON.stringify({}));  // 必须响应 pong！
}
```

### 问题 3: Azure 密钥配额超限
```bash
# 查看密钥状态
curl http://localhost:8533/api/keys | jq

# 系统会自动切换到下一个密钥
# 查看日志确认：
pm2 logs 78-sse-22 | grep "切换"
```

---

## 🔧 常用操作命令

### 查看状态
```bash
pm2 list                         # 所有进程
pm2 logs 78-sse-22 --lines 50    # 查看日志
curl http://localhost:8533/api/stations  # 活跃电台
```

### 重启服务
```bash
pm2 restart 78-sse-22            # 重启主服务
pm2 restart centrifugo           # 重启 Centrifugo
```

### 测试
```bash
# 测试客户端连接
node test-client-disconnect.js

# 测试 API
curl http://localhost:8533/api/radios
```

### 修改代码
```bash
# 1. 备份
cp 78-sse-22.js 78-sse-22.js.backup

# 2. 编辑
vi 78-sse-22.js  # 或使用 Claude 的 Edit 工具

# 3. 重启
pm2 restart 78-sse-22

# 4. 查看日志确认
pm2 logs 78-sse-22 --lines 30
```

---

## 🎯 典型任务快速指南

### 任务 1: 添加新电台
```bash
# 1. 通过 API 添加
curl -X POST http://localhost:8533/api/radios \
  -H "Content-Type: application/json" \
  -d '{
    "station_code": "cnn",
    "station_name": "CNN",
    "stream_url": "https://...",
    "language": "en-US",
    "target_language": "zh-CN"
  }'

# 2. 测试连接
curl http://localhost:8533/events?station_code=cnn
```

### 任务 2: 排查识别问题
```bash
# 1. 检查电台实例
curl http://localhost:8533/api/stations | jq

# 2. 查看日志
pm2 logs 78-sse-22 --lines 100 | grep msnbc

# 3. 检查音频流
ffmpeg -i "https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8" -t 5 -f null -

# 4. 查看密钥状态
curl http://localhost:8533/api/keys | jq
```

### 任务 3: 优化日志输出
主要日志配置在 `78-sse-22.js`:
- 第 755 行: Recognizing 日志（已注释）
- 第 818 行: Recognized 日志（已注释）
- 第 220 行: Centrifugo 发布日志（已注释）

**保留的日志**:
- ✅ 客户端连接/断开
- ✅ 识别启动/停止
- ✅ 密钥切换
- ✅ 错误和警告

---

## 📚 深入学习路径

### Level 1: 基础理解（已完成本清单）
- [x] 知道项目是做什么的
- [x] 知道核心文件在哪里
- [x] 能查看服务状态和日志
- [x] 了解常见问题

### Level 2: 熟悉架构（阅读文档）
- [ ] 阅读 [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md)
- [ ] 理解客户端连接流程
- [ ] 理解密钥管理机制
- [ ] 理解 Centrifugo Webhook

### Level 3: 修改代码（实战）
- [ ] 阅读 `78-sse-22.js` 主要类和方法
- [ ] 理解 `AzureKeyManager.js` 密钥分配逻辑
- [ ] 理解 `RadioDatabase.js` 数据库操作
- [ ] 能独立添加新功能

---

## 🚨 紧急情况处理

### 服务完全挂掉
```bash
# 1. 立即重启
pm2 restart all

# 2. 查看错误
pm2 logs --err

# 3. 检查系统资源
free -h
df -h
```

### 所有密钥超限
```bash
# 1. 连接数据库
mysql -u root -pUu8297636 radio

# 2. 重置配额计数
UPDATE azure_keys SET quota_exceeded_count = 0 WHERE is_active = 1;

# 3. 重启服务
pm2 restart 78-sse-22
```

### 数据库连接失败
```bash
# 1. 检查 MySQL 服务
sudo systemctl status mysql

# 2. 重启 MySQL
sudo systemctl restart mysql

# 3. 重启主服务
pm2 restart 78-sse-22
```

---

## 💡 开发技巧

### 使用 Claude Code 工具
```bash
# 读取文件
Read: /home/ubuntu/radio/78-sse-22.js

# 搜索代码
Grep: "switchToNextKey" in 78-sse-22.js

# 查找文件
Glob: **/*.js

# 编辑文件
Edit: 使用 old_string 和 new_string

# 执行命令
Bash: pm2 logs 78-sse-22 --lines 20
```

### 日志调试技巧
```bash
# 实时查看日志
pm2 logs 78-sse-22

# 只看错误
pm2 logs 78-sse-22 --err

# 搜索关键词
pm2 logs 78-sse-22 | grep "客户端"

# 查看最近 N 行
pm2 logs 78-sse-22 --lines 100
```

### 测试客户端连接
```bash
# 运行测试脚本（会保持 60 秒以上连接）
timeout 120 node test-client-disconnect.js

# 预期结果：
# - 连接成功
# - 订阅成功
# - 收到字幕数据
# - 每 25 秒看到 ping/pong
# - 120 秒后超时退出（正常）
```

---

## 📌 记住这些！

### 🔴 绝对不能忘记的 3 件事

1. **客户端必须响应 ping**
   ```javascript
   if (Object.keys(msg).length === 0) {
       ws.send(JSON.stringify({}));
   }
   ```

2. **Azure 密钥会自动切换**
   - 不要惊慌看到 "Quota exceeded"
   - 系统会自动切换到下一个密钥
   - 查看日志确认切换成功

3. **主服务端口 8533**
   - 不是 8000（那是 Centrifugo）
   - API 端点: `http://localhost:8533/...`
   - WebSocket: `wss://radio.xingke888.com/centrifugo/...`

---

## ✅ 完成清单

使用这个项目前，确保你已经：

- [ ] 阅读了本清单（你正在做！）
- [ ] 查看了服务运行状态 (`pm2 list`)
- [ ] 测试了 API 端点 (`curl localhost:8533/api/radios`)
- [ ] 知道如何查看日志 (`pm2 logs 78-sse-22`)
- [ ] 阅读了 [CENTRIFUGO-CLIENT-MEMO.md](./CENTRIFUGO-CLIENT-MEMO.md)
- [ ] （可选）阅读了 [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md)

---

**准备好了？开始工作吧！遇到问题随时查阅文档或运行测试命令。**

📖 **下一步**: 阅读 [PROJECT-OVERVIEW.md](./PROJECT-OVERVIEW.md) 深入了解系统架构
