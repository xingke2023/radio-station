#!/bin/bash

echo "================================================"
echo "  音频源错误处理测试"
echo "================================================"
echo ""

# 测试电台 - 使用一个无效的URL
INVALID_STATION_CODE="test-invalid"
INVALID_URL="https://invalid-url-for-testing-12345.com/stream.m3u8"

echo "📝 测试步骤:"
echo "1. 在数据库中创建一个测试电台（无效URL）"
echo "2. 尝试连接该电台"
echo "3. 观察重试过程（5次）"
echo "4. 确认收到 audioSourceFailed 事件"
echo ""

echo "🔧 准备测试数据..."

# 创建测试电台
mysql -h localhost -P 8510 -u root -p'Uu8297636' radio <<EOF
-- 删除旧的测试电台（如果存在）
DELETE FROM radio_stations WHERE station_code = '${INVALID_STATION_CODE}';

-- 插入测试电台
INSERT INTO radio_stations (station_code, station_name, station_subtitle, stream_url, language, target_language, is_active)
VALUES ('${INVALID_STATION_CODE}', 'Test Invalid Station', 'For testing error handling', '${INVALID_URL}', 'en-US', 'zh-CN', 1);

SELECT '✅ 测试电台已创建:' as status;
SELECT station_code, station_name, stream_url FROM radio_stations WHERE station_code = '${INVALID_STATION_CODE}';
EOF

echo ""
echo "================================================"
echo "  测试电台信息"
echo "================================================"
echo "电台代码: ${INVALID_STATION_CODE}"
echo "流地址: ${INVALID_URL}"
echo ""

echo "📋 测试说明:"
echo "1. 打开浏览器访问 client-subtitle-sync-sse.html"
echo "2. 从下拉框选择 'Test Invalid Station'"
echo "3. 点击'连接并播放'"
echo ""

echo "预期结果:"
echo "• 状态显示: '⚠️ 音频源连接失败，正在重试 (1/5)...'"
echo "• 状态显示: '⚠️ 音频源连接失败，正在重试 (2/5)...'"
echo "• ..."
echo "• 状态显示: '⚠️ 音频源连接失败，正在重试 (5/5)...'"
echo "• 最终: '❌ 音频源连接失败，已重试 5 次'"
echo "• 字幕显示: '❌ 音频源无法连接'"
echo "• 3秒后自动断开连接"
echo ""

echo "查看日志:"
echo "  pm2 logs 78-sse-22 --lines 100"
echo ""

echo "测试完成后清理:"
echo "  mysql -h localhost -P 8510 -u root -p'Uu8297636' radio -e \"DELETE FROM radio_stations WHERE station_code = '${INVALID_STATION_CODE}';\""
echo ""

echo "================================================"
echo "  测试准备完成!"
echo "================================================"
