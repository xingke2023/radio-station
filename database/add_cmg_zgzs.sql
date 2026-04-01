-- 添加 CMG 中国之声电台
-- 添加时间：2025-11-01

-- 普通话电台 (1个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('cmg-zgzs', 'CMG China National Radio', '中国之声', 'China', 'News', 'https://ngcdn001.cnr.cn/live/zgzs/index.m3u8', 'https://ngcdn001.cnr.cn/live/zgzs/index.m3u8', NULL, 0, 'zh-CN', 'en');

-- 查看插入结果
SELECT station_code, station_name, station_subtitle, language, target_language, stream_url
FROM radio_stations
WHERE station_code = 'cmg-zgzs';
