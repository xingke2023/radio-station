-- 更新电台代码以匹配快速索引
-- 生成时间：2025-10-28

-- 粤语电台
UPDATE radio_stations SET station_code = 'rthk_r1' WHERE station_code = 'rthk-radio1';
UPDATE radio_stations SET station_code = 'rthk_r2' WHERE station_code = 'rthk-radio2';

-- 英语电台 - 新闻类
UPDATE radio_stations SET station_code = 'cri_english' WHERE station_code = 'cgtn';
UPDATE radio_stations SET station_code = 'english_r7' WHERE station_code = '3abn';
UPDATE radio_stations SET station_code = 'cnnnews' WHERE station_code = 'cnn';
UPDATE radio_stations SET station_code = 'bbcworldservice' WHERE station_code = 'bbc-world';
UPDATE radio_stations SET station_code = 'wbbmam' WHERE station_code = 'wbbm';
UPDATE radio_stations SET station_code = 'kywradio' WHERE station_code = 'kyw';
UPDATE radio_stations SET station_code = 'wtam1100am' WHERE station_code = 'wtam';
UPDATE radio_stations SET station_code = 'wmalfm' WHERE station_code = 'wmal';
UPDATE radio_stations SET station_code = 'kirofm' WHERE station_code = 'kiro-news';
UPDATE radio_stations SET station_code = 'npr' WHERE station_code = 'npr24';

-- 英语电台 - 体育类
UPDATE radio_stations SET station_code = 'espnnewyork880' WHERE station_code = 'espn-ny';
UPDATE radio_stations SET station_code = '94wipsportsradio' WHERE station_code = 'wip';
UPDATE radio_stations SET station_code = 'kiro' WHERE station_code = 'kiro-espn';
UPDATE radio_stations SET station_code = 'weeifm' WHERE station_code = 'weei';
UPDATE radio_stations SET station_code = 'snr' WHERE station_code = 'steelers-radio';
UPDATE radio_stations SET station_code = 'kdkafm' WHERE station_code = 'kdka-fan';
UPDATE radio_stations SET station_code = 'wgr550' WHERE station_code = 'wgr';
UPDATE radio_stations SET station_code = 'thesportshub' WHERE station_code = 'wbzfm';
UPDATE radio_stations SET station_code = 'espn' WHERE station_code = 'espn-national';
UPDATE radio_stations SET station_code = '1053thefan' WHERE station_code = 'the-fan-dallas';
UPDATE radio_stations SET station_code = 'foxsportsradio' WHERE station_code = 'fox-sports';
UPDATE radio_stations SET station_code = 'cjcl' WHERE station_code = 'sportsnet-590';
UPDATE radio_stations SET station_code = 'raider-nation-radio' WHERE station_code = 'raider-nation';

-- 英语电台 - 谈话类
UPDATE radio_stations SET station_code = 'wlsam' WHERE station_code = 'wls';
UPDATE radio_stations SET station_code = 'wbap820amtx' WHERE station_code = 'wbap';
UPDATE radio_stations SET station_code = 'americanfamily' WHERE station_code = 'afr';

-- 英语电台 - 音乐类
UPDATE radio_stations SET station_code = 'bbcradio2' WHERE station_code = 'bbc-radio2';
UPDATE radio_stations SET station_code = '1067litefm' WHERE station_code = 'lite-fm';
UPDATE radio_stations SET station_code = 'wxbkfm' WHERE station_code = 'wxbk';
UPDATE radio_stations SET station_code = 'hot97' WHERE station_code = 'wqht';
UPDATE radio_stations SET station_code = 'kscstx' WHERE station_code = 'country-963';

-- 西班牙语电台
UPDATE radio_stations SET station_code = 'wwwelpaisaradionet' WHERE station_code = 'la-primera';
UPDATE radio_stations SET station_code = 'tropicanacali' WHERE station_code = 'tropicana-cali';
UPDATE radio_stations SET station_code = 'larancherita' WHERE station_code = 'la-rancherita';

-- 俄语电台
UPDATE radio_stations SET station_code = 'russkoe' WHERE station_code = 'russkoe-radio';

-- 法语电台
UPDATE radio_stations SET station_code = 'franceinfo' WHERE station_code = 'france-info';
