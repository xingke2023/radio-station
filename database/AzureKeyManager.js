/**
 * Azure 密钥管理器
 * 负责智能分配和管理 Azure Speech API 密钥
 */
class AzureKeyManager {
    constructor(database) {
        this.db = database;
    }

    /**
     * 获取所有可用的密钥
     *
     * 密钥可用性规则：
     * - is_active = 1 且 quota_exceeded_count = 0: 密钥可用
     * - is_active = 0: 密钥永久禁用，不可使用
     * - quota_exceeded_count > 0: 密钥配额已超限，暂时不可用
     */
    async getAllKeys(activeOnly = true) {
        const sql = activeOnly
            ? 'SELECT * FROM azure_keys WHERE is_active = 1 AND quota_exceeded_count = 0 ORDER BY current_usage_count ASC, id ASC'
            : 'SELECT * FROM azure_keys ORDER BY id ASC';

        const [rows] = await this.db.pool.execute(sql);
        return rows;
    }

    /**
     * 根据ID获取密钥
     */
    async getKeyById(keyId) {
        const sql = 'SELECT * FROM azure_keys WHERE id = ?';
        const [rows] = await this.db.pool.execute(sql, [keyId]);
        return rows[0] || null;
    }

    /**
     * 循环分配密钥
     * 从上次分配的位置开始，顺序循环读取密钥
     * 如果所有活跃密钥的 quota_exceeded_count > 0，则自动重置所有配额计数
     */
    async allocateKey(stationCode) {
        try {
            // ⚠️ 区域黑名单：这些区域的 WebSocket 端点无法从当前服务器访问
            const BLOCKED_REGIONS = ['eastus2'];

            // 获取所有可用的密钥（is_active=1 且 quota_exceeded_count=0）
            let keys = await this.getAllKeys(true);

            // 过滤掉黑名单区域
            const beforeFilter = keys.length;
            keys = keys.filter(key => !BLOCKED_REGIONS.includes(key.region));
            if (beforeFilter > keys.length) {
                console.log(`   已过滤 ${beforeFilter - keys.length} 个黑名单区域的密钥`);
            }

            // 如果没有可用密钥，检查是否所有活跃密钥都配额超限
            if (keys.length === 0) {
                console.warn('⚠️ 没有可用密钥，检查是否所有密钥都配额超限...');

                // 检查所有活跃密钥的配额超限情况
                const allActiveSql = `
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN quota_exceeded_count > 0 THEN 1 ELSE 0 END) as exceeded
                    FROM azure_keys
                    WHERE is_active = 1
                `;
                const [rows] = await this.db.pool.execute(allActiveSql);
                const { total, exceeded } = rows[0];
                const exceededCount = Number(exceeded) || 0;

                console.log(`   活跃密钥总数: ${total}, 配额超限数: ${exceededCount}`);

                if (total > 0 && exceededCount === Number(total)) {
                    // 所有活跃密钥都配额超限，重置所有配额计数
                    console.warn('⚠️ 所有活跃密钥都配额超限，执行自动重置...');
                    await this.resetAllQuotaExceededCounts();

                    // 重新获取可用密钥
                    keys = await this.getAllKeys(true);
                    console.log(`   重置后可用密钥数: ${keys.length}`);
                }

                if (keys.length === 0) {
                    throw new Error('没有可用的 Azure 密钥（请检查 is_active 状态）');
                }
            }

            // 获取上次分配的索引位置
            let lastIndex = await this.getLastAllocationIndex();

            // 从下一个位置开始查找
            let startIndex = (lastIndex + 1) % keys.length;
            let selectedKey = null;
            let selectedIndex = startIndex;

            // 循环查找第一个未达到上限的密钥
            for (let i = 0; i < keys.length; i++) {
                const currentIndex = (startIndex + i) % keys.length;
                const key = keys[currentIndex];

                if (key.current_usage_count < key.max_concurrent_stations) {
                    selectedKey = key;
                    selectedIndex = currentIndex;
                    break;
                }
            }

            // 如果所有密钥都达到上限，继续循环使用
            if (!selectedKey) {
                console.warn('⚠️ 所有密钥都达到并发上限，继续循环使用');
                selectedKey = keys[startIndex];
                selectedIndex = startIndex;
            }

            // 更新上次分配的索引位置
            await this.setLastAllocationIndex(selectedIndex);

            // 更新密钥的使用计数
            await this.incrementKeyUsage(selectedKey.id);

            // 更新电台的当前密钥ID
            await this.assignKeyToStation(stationCode, selectedKey.id);

            console.log(`✅ 为电台 ${stationCode} 分配密钥: ${selectedKey.key_name} (${selectedKey.region})`);
            console.log(`   索引位置: ${selectedIndex + 1}/${keys.length}`);
            console.log(`   当前使用: ${selectedKey.current_usage_count + 1}/${selectedKey.max_concurrent_stations}`);

            return {
                id: selectedKey.id,
                keyName: selectedKey.key_name,
                subscriptionKey: selectedKey.subscription_key,
                region: selectedKey.region
            };
        } catch (error) {
            console.error('分配密钥失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取上次分配的密钥索引
     */
    async getLastAllocationIndex() {
        const sql = "SELECT config_value FROM system_config WHERE config_key = 'last_key_allocation_index'";
        const [rows] = await this.db.pool.execute(sql);

        if (rows.length === 0) {
            return 0;
        }

        return parseInt(rows[0].config_value) || 0;
    }

    /**
     * 设置上次分配的密钥索引
     */
    async setLastAllocationIndex(index) {
        const sql = `
            UPDATE system_config
            SET config_value = ?
            WHERE config_key = 'last_key_allocation_index'
        `;
        await this.db.pool.execute(sql, [index.toString()]);
    }

    /**
     * 释放密钥（电台停止识别时调用）
     */
    async releaseKey(stationCode) {
        try {
            // 获取电台当前使用的密钥ID
            const sql = 'SELECT current_key_id FROM radio_stations WHERE station_code = ?';
            const [rows] = await this.db.pool.execute(sql, [stationCode]);

            if (rows.length === 0 || !rows[0].current_key_id) {
                console.log(`电台 ${stationCode} 没有分配密钥，无需释放`);
                return;
            }

            const keyId = rows[0].current_key_id;

            // 减少密钥的使用计数
            await this.decrementKeyUsage(keyId);

            // 清除电台的密钥关联
            await this.assignKeyToStation(stationCode, null);

            console.log(`✅ 释放电台 ${stationCode} 的密钥 (ID: ${keyId})`);
        } catch (error) {
            console.error('释放密钥失败:', error.message);
            throw error;
        }
    }

    /**
     * 增加密钥的使用计数
     */
    async incrementKeyUsage(keyId) {
        const sql = `
            UPDATE azure_keys
            SET current_usage_count = current_usage_count + 1,
                total_requests = total_requests + 1,
                last_used_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        const [result] = await this.db.pool.execute(sql, [keyId]);
        return result.affectedRows;
    }

    /**
     * 减少密钥的使用计数
     */
    async decrementKeyUsage(keyId) {
        const sql = `
            UPDATE azure_keys
            SET current_usage_count = GREATEST(current_usage_count - 1, 0)
            WHERE id = ?
        `;
        const [result] = await this.db.pool.execute(sql, [keyId]);
        return result.affectedRows;
    }

    /**
     * 为电台分配密钥
     */
    async assignKeyToStation(stationCode, keyId) {
        const sql = 'UPDATE radio_stations SET current_key_id = ? WHERE station_code = ?';
        const [result] = await this.db.pool.execute(sql, [keyId, stationCode]);
        return result.affectedRows;
    }

    /**
     * 记录配额超限
     *
     * 注意：quota_exceeded_count > 0 的密钥将暂时不可用
     * 当所有活跃密钥都配额超限时，系统会自动重置所有配额计数
     */
    async recordQuotaExceeded(keyId) {
        const sql = `
            UPDATE azure_keys
            SET quota_exceeded_count = quota_exceeded_count + 1
            WHERE id = ?
        `;
        const [result] = await this.db.pool.execute(sql, [keyId]);
        console.warn(`⚠️ 密钥 ID ${keyId} 配额超限次数 +1，该密钥暂时不可用`);
        return result.affectedRows;
    }

    /**
     * 获取密钥使用统计
     */
    async getKeyStatistics() {
        const sql = `
            SELECT
                id,
                key_name,
                region,
                is_active,
                current_usage_count,
                max_concurrent_stations,
                total_requests,
                quota_exceeded_count,
                ROUND(current_usage_count / max_concurrent_stations * 100, 2) as usage_percentage,
                last_used_at
            FROM azure_keys
            ORDER BY is_active DESC, current_usage_count DESC
        `;
        const [rows] = await this.db.pool.execute(sql);
        return rows;
    }

    /**
     * 添加新密钥
     */
    async addKey(keyData) {
        const sql = `
            INSERT INTO azure_keys
            (key_name, subscription_key, region, max_concurrent_stations, notes, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const values = [
            keyData.key_name,
            keyData.subscription_key,
            keyData.region,
            keyData.max_concurrent_stations || 5,
            keyData.notes || null,
            keyData.is_active !== undefined ? keyData.is_active : 1
        ];
        const [result] = await this.db.pool.execute(sql, values);
        return result.insertId;
    }

    /**
     * 更新密钥信息
     */
    async updateKey(keyId, updates) {
        const allowedFields = [
            'key_name',
            'subscription_key',
            'region',
            'max_concurrent_stations',
            'is_active',
            'notes'
        ];

        const updateFields = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateFields.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (updateFields.length === 0) {
            throw new Error('没有有效的更新字段');
        }

        values.push(keyId);
        const sql = `UPDATE azure_keys SET ${updateFields.join(', ')} WHERE id = ?`;

        const [result] = await this.db.pool.execute(sql, values);
        return result.affectedRows;
    }

    /**
     * 禁用密钥
     */
    async disableKey(keyId) {
        const sql = 'UPDATE azure_keys SET is_active = 0 WHERE id = ?';
        const [result] = await this.db.pool.execute(sql, [keyId]);
        return result.affectedRows;
    }

    /**
     * 启用密钥
     */
    async enableKey(keyId) {
        const sql = 'UPDATE azure_keys SET is_active = 1 WHERE id = ?';
        const [result] = await this.db.pool.execute(sql, [keyId]);
        return result.affectedRows;
    }

    /**
     * 重置所有密钥的配额超限计数
     * 当所有活跃密钥的 quota_exceeded_count > 0 时调用
     */
    async resetAllQuotaExceededCounts() {
        const sql = 'UPDATE azure_keys SET quota_exceeded_count = 0 WHERE is_active = 1';
        const [result] = await this.db.pool.execute(sql);
        console.log(`🔄 已重置所有活跃密钥的配额超限计数 (${result.affectedRows} 条记录)`);
        return result.affectedRows;
    }

    /**
     * 重置所有密钥的使用计数（服务器启动时调用）
     */
    async resetAllUsageCounts() {
        const sql = 'UPDATE azure_keys SET current_usage_count = 0';
        const [result] = await this.db.pool.execute(sql);
        console.log(`🔄 已重置所有密钥的使用计数 (${result.affectedRows} 条记录)`);
        return result.affectedRows;
    }
}

module.exports = AzureKeyManager;
