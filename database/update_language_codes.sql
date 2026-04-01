-- 更新译文语言代码为 Azure Speech Translation API 标准格式
-- 参考：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=speech-translation

-- 重要说明：
-- 1. language 字段（原文识别）：使用带区域的格式，如 en-US, yue-HK, ja-JP （不修改）
-- 2. target_language 字段（译文翻译）：使用简短格式，如 en, zh-Hans, ja （需要更新）

-- Azure Translation 译文语言代码说明：
-- zh-Hans = Chinese Simplified (简体中文)
-- zh-Hant = Chinese Traditional (繁体中文)
-- ja = Japanese (日语)
-- en = English (英语)
-- es = Spanish (西班牙语)
-- fr = French (法语)
-- de = German (德语)
-- ko = Korean (韩语)
-- pt = Portuguese (葡萄牙语)
-- ru = Russian (俄语)
-- ar = Arabic (阿拉伯语)
-- it = Italian (意大利语)

-- 【仅更新 target_language 字段，不修改 language 字段】

-- 将 zh-CN 更新为 zh-Hans (简体中文)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'zh-CN', 'zh-Hans')
WHERE target_language LIKE '%zh-CN%';

-- 将 zh-TW 更新为 zh-Hant (繁体中文)，如果有的话
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'zh-TW', 'zh-Hant')
WHERE target_language LIKE '%zh-TW%';

-- 将 ja-JP 更新为 ja (日语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'ja-JP', 'ja')
WHERE target_language LIKE '%ja-JP%';

-- 将 en-US 更新为 en (英语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'en-US', 'en')
WHERE target_language LIKE '%en-US%';

-- 将 es-US/es-ES 等更新为 es (西班牙语)
UPDATE radio_stations
SET target_language = REPLACE(REPLACE(target_language, 'es-US', 'es'), 'es-ES', 'es')
WHERE target_language LIKE '%es-%';

-- 将 fr-FR 等更新为 fr (法语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'fr-FR', 'fr')
WHERE target_language LIKE '%fr-FR%';

-- 将 de-DE 等更新为 de (德语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'de-DE', 'de')
WHERE target_language LIKE '%de-DE%';

-- 将 ko-KR 等更新为 ko (韩语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'ko-KR', 'ko')
WHERE target_language LIKE '%ko-KR%';

-- 将 pt-PT/pt-BR 等更新为 pt (葡萄牙语)
UPDATE radio_stations
SET target_language = REPLACE(REPLACE(target_language, 'pt-PT', 'pt'), 'pt-BR', 'pt')
WHERE target_language LIKE '%pt-%';

-- 将 ru-RU 等更新为 ru (俄语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'ru-RU', 'ru')
WHERE target_language LIKE '%ru-RU%';

-- 将 ar-SA 等更新为 ar (阿拉伯语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'ar-SA', 'ar')
WHERE target_language LIKE '%ar-%';

-- 将 it-IT 等更新为 it (意大利语)
UPDATE radio_stations
SET target_language = REPLACE(target_language, 'it-IT', 'it')
WHERE target_language LIKE '%it-IT%';

-- 查看更新后的结果
SELECT station_code, station_name, language, target_language
FROM radio_stations
ORDER BY language, station_code;
