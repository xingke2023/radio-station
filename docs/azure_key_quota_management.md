# Azure 密钥配额管理系统

## 概述

本系统实现了 Azure Speech API 密钥的智能分配和配额管理，支持多密钥循环分配和配额超限自动重置功能。

## 密钥可用性规则

### 1. 永久禁用 (`is_active = 0`)
- 密钥被标记为永久不可用
- 不会被 `getAllKeys()` 返回
- 不参与密钥分配
- **用途**: 密钥过期、账户问题等需要永久停用的情况

### 2. 配额超限 (`quota_exceeded_count > 0`)
- 密钥暂时不可用
- 不会被 `getAllKeys()` 返回
- 当所有活跃密钥都配额超限时，系统会自动重置所有配额计数
- **用途**: Azure API 返回配额限制错误时标记密钥

### 3. 可用密钥
- `is_active = 1` 且 `quota_exceeded_count = 0`
- 参与循环分配
- 按 `current_usage_count` 和 `id` 排序

## 自动重置机制

### 触发条件
当尝试分配密钥时，如果满足以下条件：
```
所有活跃密钥的 quota_exceeded_count > 0
```

### 重置操作
```sql
UPDATE azure_keys
SET quota_exceeded_count = 0
WHERE is_active = 1
```

### 工作流程
```
1. allocateKey() 被调用
2. getAllKeys(true) 返回空数组（没有可用密钥）
3. 检查所有活跃密钥的配额超限情况
4. 如果所有活跃密钥都超限 → 执行重置
5. 重新获取可用密钥
6. 继续正常分配流程
```

## 数据库字段说明

### `azure_keys` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_active` | TINYINT(1) | 0=永久禁用, 1=可用 |
| `quota_exceeded_count` | INT | 配额超限次数，>0 则暂时不可用 |
| `current_usage_count` | INT | 当前使用该密钥的电台数 |
| `max_concurrent_stations` | INT | 最大并发电台数限制 |
| `total_requests` | BIGINT | 总请求次数（统计用） |

## API 方法

### `getAllKeys(activeOnly = true)`
获取可用的密钥列表

**筛选条件**:
- `activeOnly = true`: 返回 `is_active = 1` 且 `quota_exceeded_count = 0` 的密钥
- `activeOnly = false`: 返回所有密钥

### `allocateKey(stationCode)`
为电台分配密钥，包含自动重置逻辑

**流程**:
1. 获取可用密钥
2. 如果没有可用密钥，检查是否需要自动重置
3. 从上次分配位置开始循环查找可用密钥
4. 更新密钥使用计数
5. 关联密钥到电台

### `releaseKey(stationCode)`
释放电台占用的密钥

**操作**:
1. 减少密钥的 `current_usage_count`
2. 清除电台的 `current_key_id` 关联

### `recordQuotaExceeded(keyId)`
记录密钥配额超限

**效果**:
- `quota_exceeded_count` 增加 1
- 该密钥立即变为不可用状态
- 当所有密钥都超限时，触发自动重置

### `resetAllQuotaExceededCounts()`
重置所有活跃密钥的配额超限计数

**SQL**:
```sql
UPDATE azure_keys
SET quota_exceeded_count = 0
WHERE is_active = 1
```

## 使用示例

### 正常分配流程
```javascript
const keyManager = new AzureKeyManager(db);

// 为电台分配密钥
const keyInfo = await keyManager.allocateKey('bbc-radio1');
console.log(keyInfo);
// {
//   id: 4,
//   keyName: 'azure-eastus-1',
//   subscriptionKey: 'abc123...',
//   region: 'eastus'
// }
```

### 处理配额超限
```javascript
// Azure API 返回配额错误时
try {
    // ... Azure API 调用
} catch (error) {
    if (error.code === 'QuotaExceeded') {
        await keyManager.recordQuotaExceeded(keyId);
        // 重新分配新密钥（会自动重置如果所有密钥都超限）
        const newKey = await keyManager.allocateKey(stationCode);
    }
}
```

### 释放密钥
```javascript
// 电台停止识别时
await keyManager.releaseKey('bbc-radio1');
```

## 监控和统计

### 查看密钥使用统计
```javascript
const stats = await keyManager.getKeyStatistics();
console.table(stats);
```

**返回字段**:
- `key_name`: 密钥名称
- `region`: Azure 区域
- `is_active`: 是否活跃
- `current_usage_count`: 当前使用数
- `max_concurrent_stations`: 最大并发数
- `quota_exceeded_count`: 配额超限次数
- `usage_percentage`: 使用率百分比
- `last_used_at`: 最后使用时间

## 服务器启动初始化

```javascript
async function main() {
    const db = new RadioDatabase(config);
    await db.init();

    const keyManager = new AzureKeyManager(db);

    // 重置所有使用计数（服务器重启时）
    await keyManager.resetAllUsageCounts();

    // 可选：重置所有配额超限计数（如果需要全新开始）
    // await keyManager.resetAllQuotaExceededCounts();

    const stationManager = new RadioStationManager(db, keyManager);
    // ...
}
```

## 测试

运行自动重置功能测试：
```bash
node test_quota_auto_reset.js
```

测试内容：
1. 正常分配密钥
2. 模拟所有密钥配额超限
3. 验证自动重置触发
4. 确认重置后可以继续分配

## 注意事项

1. **配额重置是全局操作**: 重置会影响所有活跃密钥，谨慎使用手动重置
2. **自动重置仅在必要时触发**: 只有当所有活跃密钥都超限时才会自动重置
3. **永久禁用不参与重置**: `is_active = 0` 的密钥永远不会被重置
4. **并发安全**: 使用数据库事务确保并发环境下的数据一致性
5. **监控建议**: 定期检查 `quota_exceeded_count` 的变化趋势，及时发现配额问题

## 配额管理策略

### 预防性策略
- 合理设置 `max_concurrent_stations`
- 分散电台负载到多个密钥
- 监控 `quota_exceeded_count` 趋势

### 响应性策略
- Azure API 错误时立即标记密钥超限
- 自动重置机制确保服务连续性
- 禁用问题密钥防止循环错误

## 数据库迁移

如需更新现有系统，执行以下 SQL：

```sql
-- 确保字段存在
ALTER TABLE azure_keys
ADD COLUMN IF NOT EXISTS quota_exceeded_count INT DEFAULT 0
COMMENT '配额超限次数';

-- 添加索引优化查询
CREATE INDEX IF NOT EXISTS idx_active_quota
ON azure_keys(is_active, quota_exceeded_count);
```
