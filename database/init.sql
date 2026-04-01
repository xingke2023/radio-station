-- 创建电台明细表
CREATE TABLE IF NOT EXISTS `radio_stations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  `station_code` VARCHAR(50) NOT NULL UNIQUE COMMENT '电台英文缩写（唯一标识）',
  `station_name` VARCHAR(200) NOT NULL COMMENT '电台全称',
  `station_subtitle` VARCHAR(500) DEFAULT NULL COMMENT '电台副标题/描述',
  `stream_url` VARCHAR(1000) NOT NULL COMMENT '电台流媒体URL',
  `current_clients` INT DEFAULT 0 COMMENT '当前连接数',
  `is_recognizing` TINYINT(1) DEFAULT 0 COMMENT '是否在识别中（0=否，1=是）',
  `language` VARCHAR(20) DEFAULT 'en-US' COMMENT '识别语言代码',
  `target_language` VARCHAR(20) DEFAULT 'zh-CN' COMMENT '目标翻译语言',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否启用（0=禁用，1=启用）',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_station_code` (`station_code`),
  INDEX `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='电台明细表';

-- 插入示例数据
INSERT INTO `radio_stations` (`station_code`, `station_name`, `station_subtitle`, `stream_url`, `language`, `target_language`) VALUES
('bbc-radio1', 'BBC Radio 1', 'The best new music and entertainment', 'https://tunein.cdnstream1.com/3511_96.aac/playlist.m3u8', 'en-US', 'zh-CN'),
('bbc-radio2', 'BBC Radio 2', 'The home of great music and entertainment', 'https://tunein.cdnstream1.com/2868_96.aac/playlist.m3u8', 'en-US', 'zh-CN'),
('bbc-world-service', 'BBC World Service', 'International news and current affairs', 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', 'en-US', 'zh-CN')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- 查询所有启用的电台
-- SELECT * FROM radio_stations WHERE is_active = 1 ORDER BY station_code;

-- 查询当前正在识别的电台
-- SELECT * FROM radio_stations WHERE is_recognizing = 1;

-- 更新电台连接数
-- UPDATE radio_stations SET current_clients = current_clients + 1 WHERE station_code = 'bbc-radio1';
