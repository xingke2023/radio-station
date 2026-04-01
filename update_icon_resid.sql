-- 更新 iconResId 字段为 com.xingke888.radiotranslator.R.drawable.{station_code}

UPDATE radio_stations
SET iconResId = CONCAT('com.xingke888.radiotranslator.R.drawable.', station_code)
WHERE station_code IN (
    'rthk_r1', 'rthk_r2', 'cri_english', 'cmg-zgzs', 'english_r7',
    'msnbc', 'cnnnews', 'espnnewyork880', 'wfan', '94wipsportsradio',
    'wxyt', 'wscr', 'wins', 'wmvp', 'kiro', 'weeifm', 'snr', 'kdkafm',
    'wabc', 'wwwelpaisaradionet', 'wcpt', 'bbcworldservice', 'wbbmam',
    '1053thefan', 'wpht', 'kmox', 'wgr550', 'thesportshub', 'espn',
    'wfsx', 'wtam1100am', 'wwj', 'ktck', 'bloomberg', 'wqam', 'wibc',
    'wmalfm', 'kcbs', 'margaritaville', 'rcv', 'wbls', 'bbcradio2',
    'kywradio', 'tropicanacali', 'kfan', 'wpen', 'wamu', 'wlsam',
    'knbr', 'wxbkfm', 'kdka', '1067litefm', 'wbap820amtx', 'foxsportsradio',
    'americanfamily', 'wsnr', 'wncw', 'wtar', 'franceinfo', 'wdst',
    'krnb', 'hot97', 'kscstx', 'wplr', 'russkoe', 'larancherita',
    'wbal', 'kirofm', 'cjcl', 'npr', 'raider-nation-radio', 'wtmj'
);
