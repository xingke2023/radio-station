# WebSocket 连接问题排查指南

## 问题描述

`client-subtitle-sync-example.html` 连接 WebSocket 有问题。

## 排查步骤

### 1. 检查服务端状态

```bash
# 检查 Centrifugo 是否运行
ps aux | grep centrifugo

# 检查端口监听
netstat -tlnp | grep 8000

# 检查 pm2 服务状态
pm2 status 78-sse-22
```

**预期结果**:
- Centrifugo 进程正在运行
- 端口 8000 正在监听
- 78-sse-22 服务状态为 online

### 2. 测试 WebSocket 连接（服务端）

```bash
# 方法1: 使用 Node.js 测试脚本
node /home/ubuntu/radio/test-centrifugo-client.js

# 方法2: 快速测试
bash /tmp/quick-test.sh
```

**预期结果**:
```
✅ WebSocket 连接成功
✅ Centrifugo 认证正常
✅ 频道订阅正常
📺 收到字幕事件: recognized
   时间戳: offset=XXXms, duration=YYYms
```

如果服务端测试失败，说明问题在服务端，请检查:
- Centrifugo 配置
- nginx 配置
- 防火墙设置

如果服务端测试成功，说明问题在客户端。

---

### 3. 测试客户端页面

#### 方法1: 使用简化测试页面

```bash
# 在浏览器中打开
/home/ubuntu/radio/simple-subtitle-test.html
```

点击"连接 WebSocket"按钮，查看日志输出。

**成功的日志示例**:
```
[时间] ✅ Centrifuge 库已加载
[时间] ✅ Centrifuge 客户端已创建
[时间] ⏳ 正在建立连接...
[时间] ✅✅✅ WebSocket 连接成功！
[时间] Client ID: xxxx-xxxx-xxxx
[时间] ✅✅✅ 频道订阅成功！
[时间] 📺 收到字幕（recognized）
[时间]    Offset: 64430ms
[时间]    Duration: 5440ms
```

**失败的日志示例**:
```
[时间] ❌ 连接错误: WebSocket connection failed
[时间] ❌ WebSocket 已断开
```

#### 方法2: 浏览器开发者工具

1. 打开 `client-subtitle-sync-example.html` 或 `simple-subtitle-test.html`
2. 按 F12 打开开发者工具
3. 切换到 "Console" 标签页
4. 点击"连接 WebSocket"按钮
5. 查看控制台输出

**常见错误信息**:

| 错误信息 | 原因 | 解决方法 |
|---------|------|---------|
| `ERR_CONNECTION_REFUSED` | 服务端未运行 | 检查 Centrifugo 和 nginx |
| `ERR_SSL_PROTOCOL_ERROR` | SSL 证书问题 | 检查 nginx SSL 配置 |
| `WebSocket connection failed` | 网络问题 | 检查防火墙和网络连接 |
| `Centrifuge 库未加载` | CDN 加载失败 | 检查网络或使用本地库 |
| `订阅错误` | 权限问题 | 检查 Centrifugo 配置 |

---

### 4. 检查 nginx 配置

```bash
# 查看 nginx 配置
sudo cat /etc/nginx/sites-enabled/default | grep -A 20 "location /centrifugo"

# 测试 nginx 配置
sudo nginx -t

# 重启 nginx
sudo systemctl restart nginx
```

**正确的配置示例**:
```nginx
location /centrifugo/ {
    proxy_pass http://localhost:8000/;

    # WebSocket 支持
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

---

### 5. 检查 Centrifugo 配置

```bash
# 查看配置文件
cat /home/ubuntu/centrifugo-config.yaml

# 检查 Centrifugo 日志
pm2 logs centrifugo --lines 50
```

**关键配置项**:
```yaml
client:
  insecure: true  # 允许不验证 token（测试用）
  ping_interval: "25s"
  pong_timeout: "10s"

proxies:
  - name: "radio_subscribe"
    endpoint: "http://localhost:8533/centrifugo/subscribe"
    timeout: "5s"

channel:
  namespaces:
    - name: "station"
      subscribe_proxy_enabled: true
      subscribe_proxy_name: "radio_subscribe"
```

---

### 6. 网络连接测试

#### 从浏览器测试

```javascript
// 在浏览器控制台执行
const ws = new WebSocket('wss://radio.xingke888.com/centrifugo/connection/websocket');

ws.onopen = () => console.log('✅ WebSocket 连接成功');
ws.onerror = (err) => console.error('❌ WebSocket 错误:', err);
ws.onclose = (e) => console.log('WebSocket 关闭:', e.code, e.reason);
```

#### 从服务器测试

```bash
# 测试 HTTPS 访问
curl -I https://radio.xingke888.com/centrifugo/

# 测试 WebSocket 升级
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://radio.xingke888.com/centrifugo/connection/websocket
```

---

## 常见问题解决方案

### 问题1: 浏览器显示 "连接错误: WebSocket connection failed"

**原因**:
- Centrifugo 服务未运行
- nginx 配置错误
- 防火墙阻止连接

**解决**:
```bash
# 1. 检查服务状态
pm2 status centrifugo
pm2 status 78-sse-22

# 2. 重启服务
pm2 restart centrifugo
pm2 restart 78-sse-22

# 3. 检查 nginx
sudo systemctl status nginx
sudo nginx -t
sudo systemctl restart nginx
```

### 问题2: 连接成功但无字幕数据

**原因**:
- 订阅频道错误
- 电台代码不存在
- 识别服务未启动

**解决**:
```bash
# 1. 确认电台代码
# 在客户端页面，检查 STATION_CODE 是否正确

# 2. 检查服务端日志
pm2 logs 78-sse-22 --lines 100 | grep "station:cnnnews"

# 3. 手动触发连接
node test-centrifugo-client.js
```

### 问题3: 字幕缺少时间戳（offset/duration 为 undefined）

**原因**: 服务端未发送时间戳信息

**解决**:
```bash
# 1. 确认代码已更新
grep "offsetMs" /home/ubuntu/radio/78-sse-22.js

# 2. 重启服务
pm2 restart 78-sse-22

# 3. 验证时间戳
node test-centrifugo-client.js | grep "offset"
```

应该看到:
```
时间戳: offset=64430ms, duration=5440ms
```

### 问题4: CORS 错误

**原因**: 跨域访问被阻止

**解决**:
```nginx
# 在 nginx 配置中添加 CORS 头
location /centrifugo/ {
    # ... 其他配置 ...

    add_header Access-Control-Allow-Origin *;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS";
    add_header Access-Control-Allow-Headers "Content-Type, Authorization";
}
```

然后重启 nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## 测试工具

### 1. 简化测试页面
**文件**: `simple-subtitle-test.html`

特点:
- 详细的连接日志
- 实时状态显示
- 字幕数据验证

### 2. Node.js 测试脚本
**文件**: `test-centrifugo-client.js`

运行:
```bash
node test-centrifugo-client.js
```

### 3. WebSocket 诊断工具
**文件**: `test-websocket-connection.html`

浏览器打开后点击"开始测试"。

---

## 完整诊断流程

```bash
# === 步骤1: 服务端测试 ===
echo "1. 检查服务状态..."
pm2 status | grep -E "(centrifugo|78-sse-22)"

echo "2. 测试 WebSocket 连接..."
timeout 10 node test-centrifugo-client.js | grep -E "(✅|❌|offset)"

# === 步骤2: 客户端测试 ===
echo "3. 在浏览器中打开测试页面:"
echo "   file:///home/ubuntu/radio/simple-subtitle-test.html"
echo "   或"
echo "   https://your-domain.com/simple-subtitle-test.html"

# === 步骤3: 查看日志 ===
echo "4. 查看服务端日志..."
pm2 logs 78-sse-22 --lines 50 --nostream | tail -20
pm2 logs centrifugo --lines 50 --nostream | tail -20
```

---

## 成功标志

✅ 服务端测试通过
✅ 浏览器控制台无错误
✅ WebSocket 连接状态为 "OPEN"
✅ 收到 `recognized` 事件
✅ 时间戳 `offset` 和 `duration` 存在且正确
✅ 字幕正常显示

---

## 联系支持

如果以上步骤都无法解决问题，请提供:

1. 浏览器控制台完整日志
2. 服务端日志（pm2 logs）
3. nginx 错误日志（/var/log/nginx/error.log）
4. 使用的浏览器和版本
5. 网络环境（公网/内网/VPN）

```bash
# 收集诊断信息
echo "=== 浏览器信息 ===" > /tmp/diagnostic.log
echo "请手动添加" >> /tmp/diagnostic.log

echo "" >> /tmp/diagnostic.log
echo "=== 服务状态 ===" >> /tmp/diagnostic.log
pm2 status >> /tmp/diagnostic.log

echo "" >> /tmp/diagnostic.log
echo "=== 服务端日志 ===" >> /tmp/diagnostic.log
pm2 logs 78-sse-22 --lines 50 --nostream >> /tmp/diagnostic.log

echo "" >> /tmp/diagnostic.log
echo "=== Centrifugo 日志 ===" >> /tmp/diagnostic.log
pm2 logs centrifugo --lines 50 --nostream >> /tmp/diagnostic.log

echo "" >> /tmp/diagnostic.log
echo "=== Nginx 错误日志 ===" >> /tmp/diagnostic.log
sudo tail -50 /var/log/nginx/error.log >> /tmp/diagnostic.log

cat /tmp/diagnostic.log
```
