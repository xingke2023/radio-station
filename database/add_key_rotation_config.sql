-- 创建系统配置表用于追踪密钥轮换状态
CREATE TABLE IF NOT EXISTS `system_config` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `config_key` VARCHAR(100) NOT NULL UNIQUE COMMENT '配置键名',
  `config_value` TEXT COMMENT '配置值',
  `description` VARCHAR(500) COMMENT '配置描述',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表';

-- 插入密钥轮换索引配置
INSERT INTO `system_config` (`config_key`, `config_value`, `description`) VALUES
('last_key_allocation_index', '0', '上次分配密钥的索引位置，用于循环分配')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- 查询当前配置
SELECT * FROM system_config WHERE config_key = 'last_key_allocation_index';
