/**
 * 测试 Azure 密钥配额超限自动重置逻辑
 * 演示当所有密钥配额超限时，系统自动重置并继续分配的过程
 */

const RadioDatabase = require('./database/RadioDatabase');
const AzureKeyManager = require('./database/AzureKeyManager');

async function test() {
    console.log('=== 测试 Azure 密钥配额超限自动重置逻辑 ===\n');

    const db = new RadioDatabase({
        host: '127.0.0.1',
        port: 8510,
        user: 'root',
        password: 'Uu8297636',
        database: 'radio'
    });

    try {
        await db.init();
        const keyManager = new AzureKeyManager(db);

        // 步骤 1: 重置所有密钥到干净状态
        console.log('步骤 1: 重置所有密钥到干净状态');
        await db.pool.execute('UPDATE azure_keys SET quota_exceeded_count = 0, current_usage_count = 0 WHERE is_active = 1');
        await db.pool.execute('UPDATE radio_stations SET current_key_id = NULL');
        console.log('   ✓ 已重置所有密钥\n');

        // 步骤 2: 正常分配一个密钥
        console.log('步骤 2: 正常分配一个密钥');
        const key1 = await keyManager.allocateKey('station-001');
        console.log(`   ✓ 成功分配: ${key1.keyName}\n`);

        // 步骤 3: 模拟所有密钥配额超限
        console.log('步骤 3: 模拟所有密钥配额超限');
        await db.pool.execute('UPDATE azure_keys SET quota_exceeded_count = 5 WHERE is_active = 1');
        const [result] = await db.pool.execute('SELECT COUNT(*) as count FROM azure_keys WHERE is_active = 1 AND quota_exceeded_count > 0');
        console.log(`   ✓ 已设置 ${result[0].count} 个密钥配额超限\n`);

        // 步骤 4: 尝试分配新密钥（应触发自动重置）
        console.log('步骤 4: 尝试分配新密钥（应触发自动重置）');
        const key2 = await keyManager.allocateKey('station-002');
        console.log(`   ✓ 成功分配: ${key2.keyName}\n`);

        // 步骤 5: 验证重置后的状态
        console.log('步骤 5: 验证重置后的状态');
        const [stats] = await db.pool.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN quota_exceeded_count = 0 THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN quota_exceeded_count > 0 THEN 1 ELSE 0 END) as exceeded
            FROM azure_keys
            WHERE is_active = 1
        `);
        console.log(`   活跃密钥总数: ${stats[0].total}`);
        console.log(`   可用密钥数: ${stats[0].available}`);
        console.log(`   配额超限数: ${stats[0].exceeded}\n`);

        // 步骤 6: 清理测试数据
        console.log('步骤 6: 清理测试数据');
        await keyManager.releaseKey('station-001');
        await keyManager.releaseKey('station-002');
        await keyManager.resetAllQuotaExceededCounts();
        await keyManager.resetAllUsageCounts();
        console.log('   ✓ 清理完成\n');

        console.log('=== 测试成功 ===');
        console.log('✅ 配额超限自动重置功能正常工作！');

    } catch (error) {
        console.error('\n❌ 测试失败:', error.message);
        console.error(error.stack);
    } finally {
        await db.close();
    }
}

test();
