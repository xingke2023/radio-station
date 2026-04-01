# Azure Speech API 语言代码参考

## 重要说明

**原文识别（language）和译文翻译（target_language）使用不同的代码格式！**

---

## 原文识别语言代码（language 字段）

用于 **Speech Recognition**，需要带区域代码：

| 语言 | 代码 | 说明 |
|------|------|------|
| 英语（美国） | `en-US` | English (United States) |
| 英语（英国） | `en-GB` | English (United Kingdom) |
| 英语（澳大利亚） | `en-AU` | English (Australia) |
| 粤语（香港） | `yue-HK` | Cantonese (Hong Kong) |
| 粤语（香港） | `zh-HK` | Cantonese (Hong Kong) - 旧格式 |
| 普通话（中国） | `zh-CN` | Mandarin (China) |
| 普通话（台湾） | `zh-TW` | Mandarin (Taiwan) |
| 日语（日本） | `ja-JP` | Japanese (Japan) |
| 韩语（韩国） | `ko-KR` | Korean (Korea) |
| 西班牙语（美国） | `es-US` | Spanish (United States) |
| 西班牙语（西班牙） | `es-ES` | Spanish (Spain) |
| 西班牙语（墨西哥） | `es-MX` | Spanish (Mexico) |
| 法语（法国） | `fr-FR` | French (France) |
| 德语（德国） | `de-DE` | German (Germany) |
| 俄语（俄罗斯） | `ru-RU` | Russian (Russia) |
| 葡萄牙语（葡萄牙） | `pt-PT` | Portuguese (Portugal) |
| 葡萄牙语（巴西） | `pt-BR` | Portuguese (Brazil) |
| 意大利语（意大利） | `it-IT` | Italian (Italy) |
| 阿拉伯语（沙特） | `ar-SA` | Arabic (Saudi Arabia) |

---

## 译文翻译语言代码（target_language 字段）

用于 **Speech Translation**，使用简短格式（无区域代码）：

| 语言 | 代码 | 说明 |
|------|------|------|
| 简体中文 | `zh-Hans` | Chinese Simplified |
| 繁体中文 | `zh-Hant` | Chinese Traditional |
| 英语 | `en` | English |
| 日语 | `ja` | Japanese |
| 韩语 | `ko` | Korean |
| 西班牙语 | `es` | Spanish |
| 法语 | `fr` | French |
| 德语 | `de` | German |
| 俄语 | `ru` | Russian |
| 葡萄牙语 | `pt` | Portuguese |
| 意大利语 | `it` | Italian |
| 阿拉伯语 | `ar` | Arabic |
| 荷兰语 | `nl` | Dutch |
| 波兰语 | `pl` | Polish |
| 瑞典语 | `sv` | Swedish |
| 泰语 | `th` | Thai |
| 越南语 | `vi` | Vietnamese |
| 印尼语 | `id` | Indonesian |
| 土耳其语 | `tr` | Turkish |

---

## 多语言翻译

`target_language` 字段支持逗号分隔的多个语言，例如：

```
zh-Hans,en,ja          → 翻译为简体中文、英语、日语
zh-Hans,zh-Hant        → 翻译为简体中文、繁体中文
en,es,fr,de            → 翻译为英语、西班牙语、法语、德语
```

---

## 配置示例

### 示例 1：英语电台翻译为中文
```sql
language = 'en-US'
target_language = 'zh-Hans'
```

### 示例 2：粤语电台翻译为简体中文
```sql
language = 'yue-HK'
target_language = 'zh-Hans'
```

### 示例 3：英语电台翻译为中文和日文
```sql
language = 'en-US'
target_language = 'zh-Hans,ja'
```

### 示例 4：西班牙语电台翻译为英语和中文
```sql
language = 'es-US'
target_language = 'en,zh-Hans'
```

---

## 参考链接

- [Azure Speech Recognition 语言支持](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt)
- [Azure Speech Translation 语言支持](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=speech-translation)
