-- 创建 Azure 密钥管理表
CREATE TABLE IF NOT EXISTS `azure_keys` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键ID',
  `key_name` VARCHAR(100) NOT NULL UNIQUE COMMENT '密钥名称（唯一标识）',
  `subscription_key` VARCHAR(100) NOT NULL COMMENT 'Azure 订阅密钥',
  `region` VARCHAR(50) NOT NULL COMMENT 'Azure 区域（如: eastus, westus）',
  `is_active` TINYINT(1) DEFAULT 1 COMMENT '是否启用（0=禁用，1=启用）',
  `max_concurrent_stations` INT DEFAULT 5 COMMENT '最大并发电台数',
  `current_usage_count` INT DEFAULT 0 COMMENT '当前使用数',
  `total_requests` BIGINT DEFAULT 0 COMMENT '总请求次数',
  `quota_exceeded_count` INT DEFAULT 0 COMMENT '配额超限次数',
  `last_used_at` TIMESTAMP NULL DEFAULT NULL COMMENT '最后使用时间',
  `notes` TEXT DEFAULT NULL COMMENT '备注信息',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_is_active` (`is_active`),
  INDEX `idx_current_usage` (`current_usage_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Azure 密钥管理表';

-- 修改 radio_stations 表，添加当前使用的密钥字段
ALTER TABLE `radio_stations`
ADD COLUMN `current_key_id` INT DEFAULT NULL COMMENT '当前使用的 Azure 密钥 ID' AFTER `target_language`,
ADD INDEX `idx_current_key_id` (`current_key_id`),
ADD CONSTRAINT `fk_radio_stations_azure_keys`
    FOREIGN KEY (`current_key_id`)
    REFERENCES `azure_keys`(`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- 插入示例 Azure 密钥数据（请替换为实际的密钥）
INSERT INTO `azure_keys` (`key_name`, `subscription_key`, `region`, `max_concurrent_stations`, `notes`) VALUES
('azure-key-1', 'YOUR_AZURE_KEY_1_HERE', 'eastus', 5, '主要密钥 - East US'),
('azure-key-2', 'YOUR_AZURE_KEY_2_HERE', 'westus', 5, '备用密钥 - West US'),
('azure-key-3', 'YOUR_AZURE_KEY_3_HERE', 'eastus', 3, '测试密钥 - East US')
ON DUPLICATE KEY UPDATE `updated_at` = CURRENT_TIMESTAMP;

-- 查询所有可用的密钥
SELECT
    id,
    key_name,
    region,
    is_active,
    max_concurrent_stations,
    current_usage_count,
    CONCAT(LEFT(subscription_key, 8), '...') as key_preview
FROM azure_keys
WHERE is_active = 1
ORDER BY current_usage_count ASC, id ASC;
