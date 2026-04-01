/**
 * 测试 Azure 密钥配额超限自动重置逻辑
 */

const RadioDatabase = require('./database/RadioDatabase');
const AzureKeyManager = require('./database/AzureKeyManager');

async function testQuotaReset() {
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

        console.log('步骤 1: 查看当前密钥状态');
        let stats = await keyManager.getKeyStatistics();
        const activeKeys = stats.filter(k => k.is_active === 1);
        const exceededKeys = activeKeys.filter(k => k.quota_exceeded_count > 0);
        console.log(`   活跃密钥数: ${activeKeys.length}`);
        console.log(`   配额超限密钥数: ${exceededKeys.length}`);
        console.log(`   可用密钥数: ${activeKeys.length - exceededKeys.length}\n`);

        console.log('步骤 2: 模拟所有密钥配额超限');
        await db.pool.execute('UPDATE azure_keys SET quota_exceeded_count = 1 WHERE is_active = 1');
        console.log('   ✓ 已将所有活跃密钥的 quota_exceeded_count 设置为 1\n');

        console.log('步骤 3: 尝试分配密钥（应触发自动重置）');
        try {
            const keyInfo = await keyManager.allocateKey('test-station');
            console.log(`   ✓ 成功分配密钥: ${keyInfo.keyName} (${keyInfo.region})\n`);
        } catch (error) {
            console.error(`   ✗ 分配失败: ${error.message}\n`);
        }

        console.log('步骤 4: 验证重置后的状态');
        stats = await keyManager.getKeyStatistics();
        const activeKeysAfter = stats.filter(k => k.is_active === 1);
        const exceededKeysAfter = activeKeysAfter.filter(k => k.quota_exceeded_count > 0);
        console.log(`   活跃密钥数: ${activeKeysAfter.length}`);
        console.log(`   配额超限密钥数: ${exceededKeysAfter.length}`);
        console.log(`   可用密钥数: ${activeKeysAfter.length - exceededKeysAfter.length}\n`);

        // 清理测试数据
        console.log('步骤 5: 清理测试数据');
        await keyManager.releaseKey('test-station');
        await keyManager.resetAllQuotaExceededCounts();
        console.log('   ✓ 清理完成\n');

        console.log('=== 测试完成 ===');

    } catch (error) {
        console.error('测试失败:', error);
    } finally {
        await db.close();
    }
}

testQuotaReset();
