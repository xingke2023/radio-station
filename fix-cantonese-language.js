// 修正粤语电台的语言代码
// yue-HK 不是 Azure Speech SDK 支持的代码，应该使用 zh-HK

const RadioDatabase = require('./database/RadioDatabase');

async function fixCantoneseLanguage() {
    const db = new RadioDatabase({
        host: 'localhost',
        port: 8510,
        user: 'root',
        password: 'Uu8297636',
        database: 'radio'
    });

    try {
        await db.init();
        console.log('✅ 数据库连接成功\n');

        // 查询当前粤语电台
        const [oldStations] = await db.pool.execute(
            "SELECT station_code, station_name, language FROM radio_stations WHERE language = 'yue-HK'"
        );

        console.log('📻 找到以下使用 yue-HK 的电台:');
        oldStations.forEach(s => {
            console.log(`   - ${s.station_name} (${s.station_code}): ${s.language}`);
        });
        console.log();

        // 更新为正确的语言代码
        const [result] = await db.pool.execute(
            "UPDATE radio_stations SET language = 'zh-HK' WHERE language = 'yue-HK'"
        );

        console.log(`✅ 已更新 ${result.affectedRows} 个电台\n`);

        // 验证更新结果
        const [newStations] = await db.pool.execute(
            "SELECT station_code, station_name, language FROM radio_stations WHERE station_code IN ('rthk_r1', 'rthk_r2')"
        );

        console.log('📻 更新后的电台:');
        newStations.forEach(s => {
            console.log(`   - ${s.station_name} (${s.station_code}): ${s.language} ✅`);
        });
        console.log();

        console.log('🔄 请重启电台服务或等待电台自动重新加载配置');
        console.log('   命令: pm2 restart 78-sse-22');

        await db.close();
    } catch (error) {
        console.error('❌ 错误:', error.message);
        process.exit(1);
    }
}

fixCantoneseLanguage();
