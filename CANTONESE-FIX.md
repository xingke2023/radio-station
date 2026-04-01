# 粤语电台字幕问题修复

## 问题时间
2025-11-01

## 问题描述
粤语电台 (RTHK Radio 1/2) 无法显示字幕，服务器日志显示不断切换密钥并报错。

## 根本原因

### ❌ 错误的语言代码
数据库中粤语电台使用了 **`yue-HK`** 作为语言代码，但这不是 Azure Speech SDK 支持的代码。

### 错误日志
```
❌ 识别已取消，原因: Invalid 'language' query parameter or unknown custom deployment.
websocket error code: 1007
```

### Azure Speech SDK 语言代码规范
- ❌ **`yue-HK`** - 不支持 (ISO 639-3 代码)
- ✅ **`zh-HK`** - 正确 (中文-粤语-香港)

## 解决方案

### 1. 数据库修正

**修改前:**
```sql
SELECT station_code, language FROM radio_stations WHERE station_code = 'rthk_r1';
-- rthk_r1 | yue-HK  ❌
```

**修改后:**
```sql
UPDATE radio_stations SET language = 'zh-HK' WHERE language = 'yue-HK';
-- rthk_r1 | zh-HK  ✅
```

### 2. 执行修复脚本

```bash
node fix-cantonese-language.js
```

**输出:**
```
✅ 找到以下使用 yue-HK 的电台:
   - Radio Television HongKong I (rthk_r1): yue-HK
   - Radio Television HongKong II (rthk_r2): yue-HK

✅ 已更新 2 个电台

📻 更新后的电台:
   - Radio Television HongKong I (rthk_r1): zh-HK ✅
   - Radio Television HongKong II (rthk_r2): zh-HK ✅
```

### 3. 重启服务

```bash
pm2 restart 78-sse-22
```

## 验证修复

### API 验证
```bash
curl http://localhost:8533/api/radios | jq '.radios[] | select(.id == "rthk_r1")'
```

**期望输出:**
```json
{
  "id": "rthk_r1",
  "name": "Radio Television HongKong I",
  "subtitle": "RTHK Radio 1",
  "url": "https://stm.rthk.hk/radio1",
  "language": "zh-HK",  ← 正确!
  "targetLanguage": "zh-CN"
}
```

### 字幕测试
打开测试页面: `/home/ubuntu/radio/test-cantonese-station.html`

**预期行为:**
1. ✅ 配置检查通过 (语言代码为 zh-HK)
2. ✅ SSE 连接成功
3. ✅ 语音识别启动
4. ✅ 开始接收粤语字幕和中文翻译

## Azure Speech 粤语支持说明

### 支持的功能
| 功能 | 语言代码 | 支持状态 |
|------|---------|---------|
| 语音识别 (STT) | zh-HK | ✅ 完全支持 |
| 语音翻译 | zh-HK → zh-CN | ✅ 完全支持 |
| 语音翻译 | zh-HK → en-US | ✅ 完全支持 |
| 语音翻译 | zh-HK → ja-JP | ✅ 完全支持 |

### 语言代码对照表
| 语言 | 正确代码 | 错误代码 | 说明 |
|------|---------|---------|------|
| 粤语 (香港) | zh-HK | yue-HK | ISO 639-3 vs BCP 47 |
| 普通话 (中国) | zh-CN | cmn-CN | |
| 英语 (美国) | en-US | eng-US | |

## 相关文件

### 修复脚本
- `/home/ubuntu/radio/fix-cantonese-language.js` - 数据库修正脚本

### 测试文件
- `/home/ubuntu/radio/test-cantonese-station.html` - 粤语电台测试页面

### 核心代码
- `/home/ubuntu/radio/78-sse-22.js:26` - 设置识别语言
```javascript
this.speechConfig.speechRecognitionLanguage = this.language;  // 现在会使用 zh-HK
```

## 其他粤语资源

### RTHK 电台列表
1. **RTHK Radio 1** (rthk_r1)
   - 流地址: https://stm.rthk.hk/radio1
   - 语言: zh-HK
   - 内容: 新闻、时事

2. **RTHK Radio 2** (rthk_r2)
   - 流地址: https://stm.rthk.hk/radio2
   - 语言: zh-HK
   - 内容: 娱乐、音乐

## 常见问题

### Q1: 为什么之前使用 yue-HK?
A: `yue-HK` 是 ISO 639-3 标准的粤语代码，但 Azure Speech SDK 使用 BCP 47 标准，需要使用 `zh-HK`。

### Q2: 如果还是看不到字幕怎么办?
A: 检查以下几点:
1. 确认语言代码已更新为 `zh-HK`
2. 重启了 78-sse-22 服务
3. 检查 Azure 密钥是否有效
4. 查看 PM2 日志: `pm2 logs 78-sse-22`

### Q3: 其他语言需要注意什么?
A: 确保使用 Azure Speech SDK 支持的 BCP 47 语言代码:
- 法语: fr-FR (不是 fra-FR)
- 西班牙语: es-ES (不是 spa-ES)
- 俄语: ru-RU (不是 rus-RU)

## 技术细节

### Azure Speech SDK 语言参数
```javascript
// 正确 ✅
this.speechConfig.speechRecognitionLanguage = "zh-HK";

// 错误 ❌
this.speechConfig.speechRecognitionLanguage = "yue-HK";
// 结果: Error code 1007 - Invalid language parameter
```

### 错误代码说明
- **1007**: WebSocket 协议错误，表示语言参数不被接受
- **原因**: 使用了非标准的语言代码

## 参考文档
- [Azure Speech SDK 支持的语言列表](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)
- [BCP 47 语言标签](https://tools.ietf.org/html/bcp47)
- [ISO 639-3 代码列表](https://iso639-3.sil.org/code_tables/639/data)
