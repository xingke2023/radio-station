# 快速开始指南

## 📋 前置要求

1. Node.js (v14+)
2. MySQL (运行在 localhost:8510)
3. FFmpeg (用于音频流处理)

## 🚀 快速启动（5分钟）

### 步骤 1: 初始化数据库

```bash
# 登录 MySQL
mysql -h localhost -P 8510 -u root -p

# 创建数据库
CREATE DATABASE IF NOT EXISTS `radio` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE radio;

# 执行初始化脚本
SOURCE /Users/mi/github/radio/database/init.sql;

# 验证表已创建
SHOW TABLES;
SELECT * FROM radio_stations;

# 退出
EXIT;
```

### 步骤 2: 安装依赖

```bash
cd /Users/mi/github/radio
npm install
```

### 步骤 3: 启动服务器

```bash
node 78-sse-22.js
```

你应该看到类似的输出：

```
Starting with Speech Key Index: 0/X, Region: xxx
多电台实例管理系统已启动
✅ MySQL 数据库连接成功
   主机: localhost:8510
   数据库: radio
🔄 已重置所有电台状态（3 条记录）
📻 已从数据库加载 3 个电台
SSE服务器已启动，监听端口 8533
当前使用的密钥: xxx, 区域: xxx

使用方法:
  连接电台: GET /events?stream=<电台URL>
  电台列表: GET /api/radios
  活跃实例: GET /api/stations
```

### 步骤 4: 打开客户端

在浏览器中打开：

```
file:///Users/mi/github/radio/test/multi-radio-client.html
```

或者使用简单的 HTTP 服务器：

```bash
cd /Users/mi/github/radio/test
python3 -m http.server 8080
```

然后访问：`http://localhost:8080/multi-radio-client.html`

### 步骤 5: 测试连接

点击任意电台，应该会看到：
- 状态变为"已连接"
- 开始接收实时字幕

## 🧪 测试 API

### 查看电台列表

```bash
curl http://localhost:8533/api/radios
```

### 查看电台状态

```bash
curl http://localhost:8533/api/radios/status
```

### 查看统计信息

```bash
curl http://localhost:8533/api/statistics
```

### 添加新电台

```bash
curl -X POST http://localhost:8533/api/radios \
  -H "Content-Type: application/json" \
  -d '{
    "station_code": "test-radio",
    "station_name": "Test Radio Station",
    "station_subtitle": "A test radio station",
    "stream_url": "https://example.com/stream.m3u8"
  }'
```

### 更新电台

```bash
curl -X PUT http://localhost:8533/api/radios/test-radio \
  -H "Content-Type: application/json" \
  -d '{
    "station_name": "Updated Test Radio"
  }'
```

### 删除电台

```bash
curl -X DELETE http://localhost:8533/api/radios/test-radio
```

## 📊 监控运行状态

### 方式 1: 服务器日志

服务器会自动输出：
- 客户端连接/断开
- 电台实例创建/清理
- 每30秒的状态摘要

### 方式 2: API 查询

```bash
# 查看当前活跃的电台实例
curl http://localhost:8533/api/stations

# 查看数据库中的电台状态
curl http://localhost:8533/api/radios/status

# 查看综合统计
curl http://localhost:8533/api/statistics
```

### 方式 3: 数据库查询

```sql
-- 连接 MySQL
mysql -h localhost -P 8510 -u root -p radio

-- 查看所有电台状态
SELECT
    station_code,
    station_name,
    current_clients,
    is_recognizing,
    is_active
FROM radio_stations;

-- 查看统计信息
SELECT
    COUNT(*) as total,
    SUM(current_clients) as total_clients,
    SUM(is_recognizing) as recognizing
FROM radio_stations
WHERE is_active = 1;
```

## 🔧 常见问题

### 问题 1: 数据库连接失败

**错误信息**：
```
❌ MySQL 数据库连接失败: connect ECONNREFUSED 127.0.0.1:8510
```

**解决方案**：
1. 检查 MySQL 是否运行
   ```bash
   ps aux | grep mysql
   ```
2. 检查端口是否正确
   ```bash
   netstat -an | grep 8510
   ```
3. 检查用户名密码
   ```bash
   mysql -h localhost -P 8510 -u root -p
   ```

### 问题 2: 电台列表为空

**检查**：
```sql
USE radio;
SELECT * FROM radio_stations WHERE is_active = 1;
```

**如果为空，重新执行初始化脚本**：
```bash
mysql -h localhost -P 8510 -u root -p radio < database/init.sql
```

### 问题 3: 客户端无法连接

**检查**：
1. 服务器是否运行在端口 8533
   ```bash
   netstat -an | grep 8533
   ```
2. 检查浏览器控制台的错误信息
3. 确认 URL 中的 stream 参数正确编码

### 问题 4: 字幕不显示

**可能原因**：
1. Azure Speech 配额用尽
2. 电台流 URL 无效
3. 网络问题

**检查服务器日志**：
- 是否有 "识别已启动" 的消息
- 是否有错误信息

## 📚 下一步

1. **添加更多电台**
   - 通过 API 添加
   - 或直接在数据库中插入

2. **自定义配置**
   - 修改数据库连接参数（78-sse-22.js:1094-1100）
   - 修改服务器端口（78-sse-22.js:1088）

3. **扩展功能**
   - 添加用户认证
   - 添加字幕历史保存
   - 添加导出功能

4. **监控和维护**
   - 设置定时备份
   - 监控资源使用
   - 查看日志文件

## 🆘 获取帮助

- 查看详细文档：`DATABASE-SETUP.md`
- 查看多电台指南：`MULTI-RADIO-GUIDE.md`
- 检查服务器日志输出
- 查看浏览器控制台

## ⚠️ 注意事项

1. **Azure Speech 配额**
   - 免费层有使用限制
   - 配额用尽会自动轮换密钥

2. **资源管理**
   - 每个电台实例会占用 ffmpeg 进程
   - 连接过多可能影响性能

3. **网络稳定性**
   - 确保电台流 URL 可访问
   - 网络断开会自动重连

4. **数据安全**
   - 生产环境修改数据库密码
   - 限制 API 访问权限
   - 定期备份数据

祝使用愉快！🎉
