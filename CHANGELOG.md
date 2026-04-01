# 更新日志

## 2024-01-XX - 配额管理系统重构

### 修复的问题
- ✅ 修复 `ReferenceError: getCurrentKey is not defined` 错误
- ✅ 修复 `ReferenceError: rotateKey is not defined` 错误

### 主要变更

#### 1. 移除旧的密钥管理代码
- 删除 `getCurrentKey()` 函数调用
- 删除 `rotateKey()` 函数调用
- 删除 `updateCredentials()` 方法
- 移除对 `keys.js` 文件的依赖

#### 2. 集成数据库密钥管理
- `AzureTranslationClient` 现在接收 `keyManager` 引用
- 实例保存 `keyId`, `keyName`, `stationCode` 用于配额管理
- 密钥信息从数据库 `azure_keys` 表获取

#### 3. 配额错误处理重构

**startRecognition() 错误回调**:
```javascript
// 旧逻辑：切换到下一个密钥并重试
rotateKey() -> updateCredentials() -> 重试

// 新逻辑：记录配额超限并关闭连接
recordQuotaExceeded() -> close() -> 客户端重连时自动分配新密钥
```

**onCanceled() 事件处理**:
```javascript
// 旧逻辑：检测配额错误 -> 切换密钥 -> 重启识别
if (quota error) { rotateKey(); restart(); }

// 新逻辑：检测配额错误 -> 记录超限 -> 停止识别
if (quota error) { recordQuotaExceeded(); stop(); }
```

#### 4. 自动密钥分配流程

**新电台连接**:
1. 客户端请求 `/events?station_code=xxx`
2. `RadioStationManager.getOrCreateStation()` 被调用
3. 如果是新电台，从 `keyManager.allocateKey()` 获取密钥
4. 创建 `AzureTranslationClient` 实例

**配额超限时**:
1. Azure API 返回配额错误
2. 调用 `keyManager.recordQuotaExceeded(keyId)` 标记密钥
3. 关闭当前实例（触发客户端重连）
4. 客户端重连时，实例已被销毁
5. `getOrCreateStation()` 创建新实例，自动分配新密钥

**自动重置机制**:
- 当所有活跃密钥的 `quota_exceeded_count > 0` 时
- `allocateKey()` 自动重置所有配额计数
- 继续正常分配流程

### 配置要求

#### 数据库表
确保 `azure_keys` 表已创建并包含密钥数据：
```sql
-- 查看当前密钥状态
SELECT
    id, key_name, region, is_active,
    quota_exceeded_count, current_usage_count, max_concurrent_stations
FROM azure_keys
WHERE is_active = 1
ORDER BY quota_exceeded_count, current_usage_count;
```

#### 服务器启动
```javascript
const db = new RadioDatabase(config);
await db.init();

const keyManager = new AzureKeyManager(db);
await keyManager.resetAllUsageCounts(); // 重置使用计数

const stationManager = new RadioStationManager(db, keyManager);
await stationManager.loadRadioList();
```

### SSE 事件变更

#### 新增事件: `quotaExceeded`
```json
{
  "event": "quotaExceeded",
  "data": {
    "message": "密钥配额超限: azure-eastus-1",
    "keyId": 12,
    "keyName": "azure-eastus-1",
    "errorDetails": "Quota exceeded...",
    "timestamp": "2024-01-XX..."
  }
}
```

#### 移除事件: `keyRotated`
此事件不再发送，因为密钥切换现在通过重连实现。

#### 修改事件: `started`
```json
{
  "event": "started",
  "data": {
    "message": "开始语音识别和翻译",
    "keyName": "azure-eastus-1",      // 变更: 从 keyIndex 改为 keyName
    "region": "eastus",
    "timestamp": "2024-01-XX..."
  }
}
```

### 兼容性说明

**破坏性变更**:
- 不再支持 `keys.js` 文件
- 移除了动态密钥切换功能
- 配额错误会导致连接断开（需要客户端重连）

**客户端影响**:
- 客户端应该实现自动重连逻辑
- 监听 `quotaExceeded` 事件，延迟几秒后重连
- 不再需要处理 `keyRotated` 事件

**示例客户端重连逻辑**:
```javascript
const eventSource = new EventSource('/events?station_code=xxx');

eventSource.addEventListener('quotaExceeded', (e) => {
    console.log('配额超限，3秒后重连...');
    eventSource.close();
    setTimeout(() => {
        // 重新连接，服务器会分配新密钥
        connectToStation();
    }, 3000);
});

eventSource.onerror = () => {
    console.log('连接断开，尝试重连...');
    eventSource.close();
    setTimeout(connectToStation, 5000);
};
```

### 测试建议

1. **正常流程测试**:
   ```bash
   # 启动服务器
   node 78-sse-22.js

   # 客户端连接
   curl -N http://localhost:3000/events?station_code=bbcworldservice
   ```

2. **配额超限测试**:
   ```bash
   # 模拟所有密钥配额超限
   mysql -e "UPDATE azure_keys SET quota_exceeded_count = 1 WHERE is_active = 1"

   # 尝试连接，应该触发自动重置
   node test_quota_auto_reset.js
   ```

3. **监控密钥状态**:
   ```bash
   # 查看密钥使用情况
   curl http://localhost:3000/api/keys
   ```

### 相关文件

- `/home/ubuntu/radio/78-sse-22.js` - 主服务器文件
- `/home/ubuntu/radio/database/AzureKeyManager.js` - 密钥管理器
- `/home/ubuntu/radio/database/RadioDatabase.js` - 数据库操作
- `/home/ubuntu/radio/test_quota_auto_reset.js` - 自动重置测试
- `/home/ubuntu/radio/docs/azure_key_quota_management.md` - 完整文档
