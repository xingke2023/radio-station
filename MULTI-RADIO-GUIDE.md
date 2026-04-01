# 多电台实时字幕系统使用指南

## 🎯 功能特点

### 核心优势
- **多电台支持**：可以同时管理多个不同的电台流
- **实例共享**：多个客户端连接同一电台时，只创建一个识别实例
- **智能资源管理**：当最后一个客户端断开时，自动关闭并释放该电台的资源
- **引用计数**：自动跟踪每个电台的客户端数量

### 架构设计

```
客户端1 ──┐
客户端2 ──┼──> 电台A实例 (BBC Radio 1)
客户端3 ──┘

客户端4 ──┐
客户端5 ──┼──> 电台B实例 (BBC Radio 2)
客户端6 ──┘

客户端7 ────> 电台C实例 (自定义电台)
```

## 📡 API 接口

### 1. 连接电台 SSE 流
```
GET /events?stream=<电台URL>
```

**参数说明**：
- `stream`: 电台流的 URL（必须进行 URL 编码）

**示例**：
```javascript
const streamUrl = encodeURIComponent('https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8');
const eventSource = new EventSource(`http://localhost:8533/events?stream=${streamUrl}`);
```

**返回事件类型**：
- `connected` - 连接成功
- `started` - 识别已启动
- `recognizing` - 实时识别中（临时结果）
- `recognized` - 最终识别结果
- `history` - 历史记录（新客户端连接时接收）
- `heartbeat` - 心跳保活
- `reconnecting` - 重连中
- `error` - 错误信息

### 2. 获取预定义电台列表
```
GET /api/radios
```

**返回示例**：
```json
{
  "success": true,
  "radios": [
    {
      "id": "bbc1",
      "name": "BBC Radio 1",
      "url": "https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8"
    },
    {
      "id": "bbc2",
      "name": "BBC Radio 2",
      "url": "https://tunein.cdnstream1.com/2868_96.aac/playlist.m3u8"
    }
  ]
}
```

### 3. 获取当前活跃的电台实例
```
GET /api/stations
```

**返回示例**：
```json
{
  "success": true,
  "totalStations": 2,
  "stations": [
    {
      "url": "https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8",
      "clients": 3,
      "isRecognizing": true
    },
    {
      "url": "https://tunein.cdnstream1.com/2868_96.aac/playlist.m3u8",
      "clients": 1,
      "isRecognizing": true
    }
  ]
}
```

## 🚀 快速开始

### 启动服务器

```bash
node 78-sse-22.js
```

服务器将在端口 `8533` 启动。

### 使用预制客户端

打开浏览器访问：
```
file:///Users/mi/github/radio/test/multi-radio-client.html
```

或将文件托管到 Web 服务器上。

### 自定义客户端示例

```html
<!DOCTYPE html>
<html>
<head>
    <title>自定义电台客户端</title>
</head>
<body>
    <h1>电台字幕</h1>
    <div id="subtitle"></div>

    <script>
        // 电台 URL
        const radioUrl = 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8';
        const streamUrl = encodeURIComponent(radioUrl);

        // 连接到服务器
        const eventSource = new EventSource(`http://localhost:8533/events?stream=${streamUrl}`);

        // 监听连接事件
        eventSource.addEventListener('connected', (e) => {
            console.log('已连接到电台');
        });

        // 监听识别结果
        eventSource.addEventListener('recognized', (e) => {
            const data = JSON.parse(e.data);
            document.getElementById('subtitle').innerHTML = `
                <p><strong>原文:</strong> ${data.text}</p>
                <p><strong>翻译:</strong> ${data.translations}</p>
            `;
        });

        // 错误处理
        eventSource.onerror = (e) => {
            console.error('连接错误');
        };
    </script>
</body>
</html>
```

## 🔧 配置电台列表

在 `78-sse-22.js` 中修改 `RadioStationManager` 类的 `radioList` 数组：

```javascript
this.radioList = [
    {
        id: 'bbc1',
        name: 'BBC Radio 1',
        url: 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8'
    },
    {
        id: 'bbc2',
        name: 'BBC Radio 2',
        url: 'https://tunein.cdnstream1.com/2868_96.aac/playlist.m3u8'
    },
    {
        id: 'npr',
        name: 'NPR News',
        url: 'https://example.com/npr.m3u8'
    },
    // 添加更多电台...
];
```

## 📊 监控与日志

### 服务器端日志

服务器会自动输出以下信息：

1. **客户端连接/断开**
   ```
   客户端已连接，当前连接数: 3，上次事件ID: none
   客户端已断开，当前连接数: 2
   ```

2. **电台实例管理**
   ```
   创建新电台实例: https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8
   复用现有电台实例: https://..., 当前客户端数: 2
   电台实例无客户端连接，清理资源: https://...
   ```

3. **全局状态监控**（每30秒）
   ```
   [2025-10-28T12:00:00.000Z] 活跃电台数: 2
     电台 1: https://tunein.cdnstream1.com/3511_96.aac/play... | 客户端数: 3 | 识别中: true
     电台 2: https://tunein.cdnstream1.com/2868_96.aac/play... | 客户端数: 1 | 识别中: true
   ```

## 🧪 测试场景

### 场景 1: 多客户端连接同一电台
1. 打开多个浏览器标签页
2. 在每个标签页中打开 `multi-radio-client.html`
3. 点击同一个电台（如 BBC Radio 1）
4. 观察服务器日志：应该显示"复用现有电台实例"
5. 所有客户端应该接收到相同的字幕

### 场景 2: 多客户端连接不同电台
1. 打开多个浏览器标签页
2. 在第一个标签页连接 BBC Radio 1
3. 在第二个标签页连接 BBC Radio 2
4. 观察服务器日志：应该创建两个不同的电台实例
5. 每个客户端应该接收到各自电台的字幕

### 场景 3: 实例自动清理
1. 连接到一个电台
2. 关闭所有连接到该电台的浏览器标签页
3. 观察服务器日志：1秒后应该显示"电台实例无客户端连接，清理资源"
4. 使用 `/api/stations` 确认实例已被移除

### 场景 4: 自定义电台
1. 在客户端输入框中输入自定义电台 URL
2. 点击"连接"按钮
3. 观察服务器创建新的实例
4. 接收该电台的实时字幕

## ⚡ 性能优化

### 资源管理
- **按需创建**：只有当客户端请求时才创建电台实例
- **自动释放**：当最后一个客户端断开时，自动关闭实例和 ffmpeg 进程
- **共享实例**：多个客户端共享同一个 Azure Speech 识别器

### 内存优化
- 每个电台实例保留最近 50 个识别段落作为历史记录
- 事件去重机制防止重复发送
- 定期清理过期的事件记录

## 🐛 故障排查

### 问题：无法连接到电台
- 检查 `stream` 参数是否正确 URL 编码
- 确认电台流 URL 是否可访问
- 查看服务器日志中的错误信息

### 问题：收不到字幕
- 检查电台流是否包含音频
- 确认 Azure Speech 服务配额是否用尽
- 查看浏览器控制台中的 SSE 事件

### 问题：实例未被清理
- 检查客户端是否正确关闭连接
- 观察1秒延迟后的日志输出
- 使用 `/api/stations` 端点查看当前实例状态

## 📝 技术细节

### 实例管理原理
```javascript
class RadioStationManager {
    constructor() {
        this.stations = new Map(); // key: streamUrl, value: AzureTranslationClient
    }

    getOrCreateStation(streamUrl) {
        // 如果已存在，直接返回
        if (this.stations.has(streamUrl)) {
            return this.stations.get(streamUrl);
        }

        // 创建新实例
        const station = new AzureTranslationClient(speechKey, region, streamUrl);
        this.stations.set(streamUrl, station);
        return station;
    }

    cleanupStation(streamUrl) {
        const station = this.stations.get(streamUrl);
        if (station && station.clients.size === 0) {
            station.close(); // 关闭所有资源
            this.stations.delete(streamUrl);
        }
    }
}
```

### 引用计数机制
每个 `AzureTranslationClient` 实例维护一个 `clients` Map，存储所有连接的客户端。当客户端断开时，自动从 Map 中移除。当 Map 为空时，触发实例清理。

## 🔒 安全建议

1. **CORS 配置**：生产环境中应限制允许的域名
2. **URL 验证**：验证客户端提供的电台 URL，防止恶意请求
3. **速率限制**：添加连接频率限制，防止滥用
4. **认证授权**：考虑添加用户认证机制

## 📄 许可证

[根据项目需要添加许可证信息]
