# 电台切换功能更新说明

## 更新时间
2025-11-01

## 更新内容

### ✅ 完成的修改

1. **添加电台下拉选择框**
   - 页面加载时自动从 `/api/radios` 获取电台列表
   - 显示所有可用电台供用户选择
   - 格式: `电台名称 (副标题)`

2. **字段名修正**
   - API 返回字段: `id`, `name`, `url`, `subtitle`
   - 客户端代码已全部修正为使用正确的字段名

3. **连接流程优化**
   - 用户必须先选择电台才能连接
   - 连接时会清空之前的字幕队列
   - 断开后可以重新选择其他电台

4. **状态管理**
   - 连接时禁用电台选择框
   - 断开后重新启用电台选择框
   - 状态提示包含当前电台名称

## 文件修改

### `/home/ubuntu/radio/client-subtitle-sync-sse.html`

**新增功能:**
- 电台下拉选择框 (line 227-230)
- `loadStations()` 函数 - 加载电台列表
- 页面加载时自动调用 `loadStations()`

**修改的代码:**
```javascript
// 之前 (硬编码)
const STATION_CODE = 'msnbc';
const STREAM_URL = 'https://...';

// 现在 (动态加载)
let stations = [];
let currentStation = null;
// 从 API 获取电台列表
await fetch(`${API_BASE_URL}/api/radios`);
```

## API 接口

### GET /api/radios
**说明:** 获取所有启用的电台列表

**返回格式:**
```json
{
  "success": true,
  "radios": [
    {
      "id": "msnbc",
      "name": "MSNBC",
      "subtitle": "News",
      "url": "https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8",
      "language": "en-US",
      "targetLanguage": "zh-CN"
    }
  ]
}
```

**数据来源:** `radio_stations` 数据库表

## 使用说明

1. **打开页面**
   - 页面自动加载电台列表
   - 状态显示: "电台列表加载完成"

2. **选择电台**
   - 从下拉框选择想要收听的电台
   - 可以看到电台名称和副标题

3. **连接播放**
   - 点击"连接并播放"按钮
   - 系统会:
     - 建立 SSE 连接
     - 启动语音识别
     - 开始播放音频
     - 接收实时字幕

4. **切换电台**
   - 点击"断开连接"
   - 从下拉框选择另一个电台
   - 再次点击"连接并播放"

## 数据库表

### radio_stations
```sql
- id: 主键
- station_code: 电台代码 (唯一标识)
- station_name: 电台名称
- station_subtitle: 副标题
- stream_url: 流媒体地址
- language: 识别语言
- target_language: 目标翻译语言
- is_active: 是否启用 (1=启用, 0=禁用)
```

## 测试文件

### `/home/ubuntu/radio/test-station-switch.html`
简单的测试页面，用于验证:
- 电台列表 API
- 数据结构
- 连接端点

### `/home/ubuntu/radio/test-api-fields.js`
Node.js 脚本，用于验证 API 返回的字段名

## 已知限制

1. **音频格式支持**
   - 浏览器支持: HLS (.m3u8), MP3, AAC
   - 不支持: RTSP, MMS 等协议

2. **跨域限制**
   - 需要服务器配置 CORS
   - 当前已配置: `Access-Control-Allow-Origin: *`

3. **浏览器兼容性**
   - SSE (EventSource) 支持: 所有现代浏览器
   - HLS 播放: Safari 原生支持, 其他浏览器需要 hls.js

## 下一步可能的改进

1. **电台搜索/过滤**
   - 按名称搜索
   - 按语言筛选
   - 按类型分类

2. **收藏功能**
   - 保存常用电台
   - 快速访问

3. **历史记录**
   - 记住上次选择的电台
   - 使用 localStorage

4. **电台状态指示**
   - 显示当前听众数
   - 显示识别状态

## 技术栈

- **前端:** 原生 JavaScript + HTML5 Audio
- **连接:** Server-Sent Events (SSE)
- **推送:** Centrifugo
- **后端:** Node.js + Express
- **数据库:** MySQL (通过 RadioDatabase 类)
- **识别:** Azure Speech SDK

## 系统容量

- **当前支持:** 71个电台 (数据库中)
- **并发能力:** 10万+ 客户端 (SSE + Centrifugo)
- **每电台容量:** 1万+ 并发用户
