-- 导入72个电台数据
-- 生成时间：2025-10-28

-- 粤语电台 (2个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('rthk-radio1', 'Radio Television HongKong I', 'RTHK Radio 1', 'Hong Kong', 'General', 'https://radio.xingke888.com/stream?keyid=r1', 'https://radio.xingke888.com/stream?keyid=r1', 'https://radio.xingke888.com/sse1/events', 1, 'yue-HK', 'zh-CN'),
('rthk-radio2', 'Radio Television HongKong II', 'RTHK Radio 2', 'Hong Kong', 'General', 'https://radio.xingke888.com/stream?keyid=r2', 'https://radio.xingke888.com/stream?keyid=r2', 'https://radio.xingke888.com/sse2/events', 1, 'yue-HK', 'zh-CN');

-- 英语电台 - 新闻类 (19个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('cgtn', 'China Global Television Network', '中国环球电视网', 'China', 'News', 'https://sk.cri.cn/am846.m3u8', 'https://sk.cri.cn/am846.m3u8', 'https://radio.xingke888.com/sse6/events', 1, 'en-US', 'zh-CN'),
('3abn', 'Three Angels Broadcasting Network', '3ABN', 'USA', 'News', 'https://radio.xingke888.com/stream?keyid=r6', 'https://radio.xingke888.com/stream?keyid=r6', 'https://radio.xingke888.com/sse7/events', 1, 'en-US', 'zh-CN'),
('msnbc', 'MSNBC', 'News', 'USA', 'News', 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8', 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8', 'https://radio.xingke888.com/sse8/events', 1, 'en-US', 'zh-CN'),
('cnn', 'CNN', 'News', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wins', 'WINS', '1010 WINS CBS New York', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('bbc-world', 'BBC World Service', 'International News', 'UK', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wbbm', 'WBBM Newsradio 780 AM', 'News Radio Chicago', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kyw', 'KYW', 'newsradio - News Radio Philadelphia', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wwj', 'WWJ', 'NewsRadio 950 AM - News Radio Detroit', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wfsx', 'WFSX', 'Fox News 92.5 FM', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wtam', 'WTAM 1100 AM', 'News Talk Radio Cleveland', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wibc', 'WIBC 93.1 FM', 'News Talk Radio Indianapolis', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wmal', 'WMAL-FM 105.9 FM', 'News Talk Radio Washington DC', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kcbs', 'KCBS', 'All News 106.9 FM and 740 AM - San Francisco', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wtar', 'WTAR 850 AM', 'News Talk Radio Norfolk', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wbal', 'WBAL', 'Baltimore News 1090 AM', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kiro-news', 'KIRO Radio 97.3 FM', 'News Talk Radio Seattle', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('npr24', 'NPR 24', 'NPR News', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wtmj', 'WTMJ', 'Newsradio 620 - Milwaukee', 'USA', 'News', NULL, NULL, NULL, 0, 'en-US', 'zh-CN');

-- 英语电台 - 体育类 (21个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('espn-ny', 'ESPN New York 880 AM', 'Sports Radio', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wfan', 'WFAN', '66 AM - 101.9 FM - Sports Radio New York', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wip', '94 WIP Sportsradio', 'Sports Radio Philadelphia', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wxyt', 'WXYT-FM', '97.1 The Ticket - Sports Radio Detroit', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wscr', 'WSCR', '670 AM The Score - Sports Radio Chicago', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wmvp', 'WMVP', 'ESPN 1000 AM - Sports Radio Chicago', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kiro-espn', 'KIRO', '710 ESPN Seattle 710 AM', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('weei', 'WEEI 93.7 FM', 'Boston Sports News', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('steelers-radio', 'Steelers Nation Radio', 'Sports Radio Pittsburgh', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kdka-fan', 'KDKA FM', '93.7 The Fan - Sports Radio Pittsburgh', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wgr', 'WGR 550 Sports Radio', 'Buffalo', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wbzfm', 'WBZFM', 'The Sports Hub 98.5 - Sports Radio Boston', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('espn-national', 'ESPN Radio', 'National Sports Radio', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('the-fan-dallas', '105.3 The Fan', 'CBS Dallas - Sports Radio Dallas', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wqam', 'WQAM 560 AM', 'Sports Radio Miami', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kfan', 'KFAN Sports Radio FM 100.3', 'Sports Radio Minneapolis', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wpen', 'WPEN', 'The Fanatic 97.5 FM - Sports Radio Philadelphia', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('ktck', 'KTCK', 'The Ticket 1310 AM / 96.7 FM - Sports Radio Dallas', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('knbr', 'KNBR 104.5 / 680 AM', 'Sports Radio San Francisco', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('fox-sports', 'FOX Sports Radio', 'National Sports Radio', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('sportsnet-590', 'CJCL Sportsnet 590 The FAN', 'Sports Radio Toronto', 'Canada', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('raider-nation', 'Raider Nation Radio', 'Raiders Sports Radio', 'USA', 'Sports', NULL, NULL, NULL, 0, 'en-US', 'zh-CN');

-- 英语电台 - 谈话类 (9个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('wabc', 'WABC', '77 WABC Radio - Talk Radio New York', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wcpt', 'WCPT', 'Chicago''s Progressive Talk 820 AM', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wpht', 'WPHT', 'Talk Radio Philadelphia 1210 AM', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kmox', 'KMOX', 'NewsRadio 1120 AM - St. Louis', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wamu', 'WAMU 88.5 FM', 'NPR News Washington DC', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wls', 'WLS AM 890', 'Talk Radio Chicago', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('kdka', 'KDKA 1020 AM', 'News Talk Radio Pittsburgh', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wbap', 'WBAP News Talk', 'News Talk Radio Dallas', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('afr', 'American Family Radio', 'Christian Talk & Music', 'USA', 'Talk', NULL, NULL, NULL, 0, 'en-US', 'zh-CN');

-- 英语电台 - 音乐类 (10个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('bbc-radio2', 'BBC Radio 2', 'UK Music & Talk', 'UK', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('margaritaville', 'Radio Margaritaville', 'Island Music', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wbls', 'WBLS', 'Urban Radio New York', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('lite-fm', '106.7 Lite FM', 'New York''s Best Music Variety! - Soft Rock', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wxbk', '94.7 THE BLOCK - WXBK FM', 'Urban Radio New York', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wdst', 'WDST', 'Radio Woodstock 100.1 - Alternative Rock New York', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('krnb', 'KRNB 105.7 Smooth', 'R&B Radio Dallas', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wqht', 'WQHT', 'HOT 97 - Hip Hop Radio New York', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('country-963', 'New Country 96.3', 'Country Radio Dallas', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wplr', 'WPLR', 'PLR 99.1 FM - Rock Radio Connecticut', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN'),
('wncw', 'WNCW', '88.7 FM - Public Radio North Carolina', 'USA', 'Music', NULL, NULL, NULL, 0, 'en-US', 'zh-CN');

-- 英语电台 - 商业/财经类 (1个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('bloomberg', 'Bloomberg Radio', 'Business News', 'USA', 'Business', NULL, NULL, NULL, 0, 'en-US', 'zh-CN');

-- 西班牙语电台 (4个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('la-primera', 'La Primera 88.5 Fm', 'Spanish Radio', 'USA', 'General', NULL, NULL, NULL, 0, 'es-US', 'zh-CN'),
('tropicana-cali', 'Tropicana Cali 93.1 fm', 'Salsa Radio', 'Colombia', 'Music', NULL, NULL, NULL, 0, 'es-CO', 'zh-CN'),
('la-rancherita', 'La Rancherita del Aire', 'Ranchera Music', 'Mexico', 'Music', NULL, NULL, NULL, 0, 'es-MX', 'zh-CN');

-- 俄语电台 (2个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('wsnr', 'WSNR', 'Davidzon Radio 620 AM - Russian Radio New York', 'USA', 'General', NULL, NULL, NULL, 0, 'ru-RU', 'zh-CN'),
('russkoe-radio', 'Russkoe Radio Русское Радио', 'Russian Music Radio', 'Russia', 'Music', NULL, NULL, NULL, 0, 'ru-RU', 'zh-CN');

-- 葡萄牙语电台 (1个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('rcv', 'RCV', 'Rádio de Cabo Verde', 'Cape Verde', 'General', NULL, NULL, NULL, 0, 'pt-PT', 'zh-CN');

-- 法语电台 (1个)
INSERT INTO radio_stations (station_code, station_name, station_subtitle, country, category, stream_url, audio_url, subtitle_url, has_subtitle, language, target_language) VALUES
('france-info', 'France Info', 'French News Radio', 'France', 'News', NULL, NULL, NULL, 0, 'fr-FR', 'zh-CN');
