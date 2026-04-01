const mysql = require('mysql2/promise');

class RadioDatabase {
    constructor(config) {
        this.config = {
            host: config.host || 'localhost',
            port: config.port || 8510,
            user: config.user || 'root',
            password: config.password || 'Uu8297636',
            database: config.database || 'radio',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        };

        this.pool = null;
    }

    // 初始化连接池
    async init() {
        try {
            this.pool = mysql.createPool(this.config);

            // 测试连接
            const connection = await this.pool.getConnection();
            console.log('✅ MySQL 数据库连接成功');
            console.log(`   主机: ${this.config.host}:${this.config.port}`);
            console.log(`   数据库: ${this.config.database}`);
            connection.release();

            return true;
        } catch (error) {
            console.error('❌ MySQL 数据库连接失败:', error.message);
            throw error;
        }
    }

    // 获取所有启用的电台
    async getAllRadios(activeOnly = true) {
        const sql = activeOnly
            ? 'SELECT * FROM radio_stations WHERE is_active = 1 ORDER BY station_code'
            : 'SELECT * FROM radio_stations ORDER BY station_code';

        const [rows] = await this.pool.execute(sql);
        return rows;
    }

    // 根据电台代码获取电台信息
    async getRadioByCode(stationCode) {
        const sql = 'SELECT * FROM radio_stations WHERE station_code = ? AND is_active = 1';
        const [rows] = await this.pool.execute(sql, [stationCode]);
        return rows[0] || null;
    }

    // 根据 stream_url 获取电台信息
    async getRadioByUrl(streamUrl) {
        const sql = 'SELECT * FROM radio_stations WHERE stream_url = ? AND is_active = 1';
        const [rows] = await this.pool.execute(sql, [streamUrl]);
        return rows[0] || null;
    }

    // 添加新电台
    async addRadio(radioData) {
        const sql = `
            INSERT INTO radio_stations
            (station_code, station_name, station_subtitle, stream_url, language, target_language, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const values = [
            radioData.station_code,
            radioData.station_name,
            radioData.station_subtitle || null,
            radioData.stream_url,
            radioData.language || 'en-US',
            radioData.target_language || 'zh-CN',
            radioData.is_active !== undefined ? radioData.is_active : 1
        ];

        const [result] = await this.pool.execute(sql, values);
        return result.insertId;
    }

    // 更新电台信息
    async updateRadio(stationCode, updates) {
        const allowedFields = [
            'station_name',
            'station_subtitle',
            'stream_url',
            'language',
            'target_language',
            'is_active'
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

        values.push(stationCode);
        const sql = `UPDATE radio_stations SET ${updateFields.join(', ')} WHERE station_code = ?`;

        const [result] = await this.pool.execute(sql, values);
        return result.affectedRows;
    }

    // 删除电台（软删除 - 设置为不启用）
    async deleteRadio(stationCode) {
        const sql = 'UPDATE radio_stations SET is_active = 0 WHERE station_code = ?';
        const [result] = await this.pool.execute(sql, [stationCode]);
        return result.affectedRows;
    }

    // 永久删除电台
    async permanentDeleteRadio(stationCode) {
        const sql = 'DELETE FROM radio_stations WHERE station_code = ?';
        const [result] = await this.pool.execute(sql, [stationCode]);
        return result.affectedRows;
    }

    // 更新电台连接数（增加）
    async incrementClientCount(stationCode) {
        const sql = `
            UPDATE radio_stations
            SET current_clients = current_clients + 1
            WHERE station_code = ?
        `;
        const [result] = await this.pool.execute(sql, [stationCode]);
        return result.affectedRows;
    }

    // 更新电台连接数（减少）
    async decrementClientCount(stationCode) {
        const sql = `
            UPDATE radio_stations
            SET current_clients = GREATEST(current_clients - 1, 0)
            WHERE station_code = ?
        `;
        const [result] = await this.pool.execute(sql, [stationCode]);
        return result.affectedRows;
    }

    // 设置电台识别状态
    async setRecognitionStatus(stationCode, isRecognizing) {
        const sql = `
            UPDATE radio_stations
            SET is_recognizing = ?
            WHERE station_code = ?
        `;
        const [result] = await this.pool.execute(sql, [isRecognizing ? 1 : 0, stationCode]);
        return result.affectedRows;
    }

    // 更新电台状态（连接数和识别状态）
    async updateStationStatus(stationCode, clientCount, isRecognizing) {
        const sql = `
            UPDATE radio_stations
            SET current_clients = ?, is_recognizing = ?
            WHERE station_code = ?
        `;
        const [result] = await this.pool.execute(sql, [clientCount, isRecognizing ? 1 : 0, stationCode]);
        return result.affectedRows;
    }

    // 重置所有电台状态（用于服务器启动时）
    async resetAllStationStatus() {
        const sql = `
            UPDATE radio_stations
            SET current_clients = 0, is_recognizing = 0
        `;
        const [result] = await this.pool.execute(sql);
        console.log(`🔄 已重置所有电台状态（${result.affectedRows} 条记录）`);
        return result.affectedRows;
    }

    // 获取当前正在识别的电台
    async getRecognizingRadios() {
        const sql = 'SELECT * FROM radio_stations WHERE is_recognizing = 1 ORDER BY station_code';
        const [rows] = await this.pool.execute(sql);
        return rows;
    }

    // 获取统计信息
    async getStatistics() {
        const sql = `
            SELECT
                COUNT(*) as total_radios,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_radios,
                SUM(CASE WHEN is_recognizing = 1 THEN 1 ELSE 0 END) as recognizing_radios,
                SUM(current_clients) as total_clients
            FROM radio_stations
        `;
        const [rows] = await this.pool.execute(sql);
        return rows[0];
    }

    // 关闭连接池
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('🔌 MySQL 数据库连接已关闭');
        }
    }

    // 执行原始 SQL 查询（用于调试）
    async query(sql, params = []) {
        const [rows] = await this.pool.execute(sql, params);
        return rows;
    }
}

module.exports = RadioDatabase;
