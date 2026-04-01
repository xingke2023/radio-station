#!/bin/bash

echo "======================================================================"
echo "🔍 WebSocket 连接诊断工具"
echo "======================================================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_service() {
    local service=$1
    local name=$2

    if pm2 status | grep -q "$service.*online"; then
        echo -e "${GREEN}✅ $name 运行正常${NC}"
        return 0
    else
        echo -e "${RED}❌ $name 未运行${NC}"
        return 1
    fi
}

# 1. 检查服务状态
echo "1️⃣ 检查服务状态..."
echo "----------------------------------------"
check_service "centrifugo" "Centrifugo"
check_service "78-sse-22" "字幕服务"
echo ""

# 2. 检查端口监听
echo "2️⃣ 检查端口监听..."
echo "----------------------------------------"
if netstat -tlnp 2>/dev/null | grep -q ":8000.*LISTEN"; then
    echo -e "${GREEN}✅ 端口 8000 正在监听 (Centrifugo)${NC}"
else
    echo -e "${RED}❌ 端口 8000 未监听${NC}"
fi

if netstat -tlnp 2>/dev/null | grep -q ":8533.*LISTEN"; then
    echo -e "${GREEN}✅ 端口 8533 正在监听 (字幕服务)${NC}"
else
    echo -e "${RED}❌ 端口 8533 未监听${NC}"
fi
echo ""

# 3. 测试本地 WebSocket 连接
echo "3️⃣ 测试本地 WebSocket 连接（10秒）..."
echo "----------------------------------------"
timeout 10 node /home/ubuntu/radio/test-centrifugo-client.js 2>&1 | \
    grep -E "(✅|❌|📺|时间戳)" | head -10

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 本地 WebSocket 连接正常${NC}"
else
    echo -e "${RED}❌ 本地 WebSocket 连接失败${NC}"
fi
echo ""

# 4. 检查 nginx 配置
echo "4️⃣ 检查 nginx 配置..."
echo "----------------------------------------"
if sudo nginx -t 2>&1 | grep -q "successful"; then
    echo -e "${GREEN}✅ nginx 配置正确${NC}"
else
    echo -e "${RED}❌ nginx 配置错误${NC}"
    sudo nginx -t 2>&1
fi
echo ""

# 5. 检查 Centrifugo 配置
echo "5️⃣ 检查 Centrifugo 配置..."
echo "----------------------------------------"
if [ -f "/home/ubuntu/centrifugo-config.yaml" ]; then
    echo -e "${GREEN}✅ 配置文件存在${NC}"
    echo "关键配置:"
    grep -E "(insecure|subscribe_proxy)" /home/ubuntu/centrifugo-config.yaml | head -5
else
    echo -e "${RED}❌ 配置文件不存在${NC}"
fi
echo ""

# 6. 检查最近的错误日志
echo "6️⃣ 最近的错误日志..."
echo "----------------------------------------"
echo "Centrifugo 错误:"
pm2 logs centrifugo --lines 20 --nostream 2>&1 | grep -i "error" | tail -5 || echo "无错误"
echo ""
echo "字幕服务错误:"
pm2 logs 78-sse-22 --lines 20 --nostream 2>&1 | grep -E "(❌|错误|Error)" | tail -5 || echo "无错误"
echo ""

# 7. 生成诊断报告
echo "======================================================================"
echo "📊 诊断总结"
echo "======================================================================"

# 统计问题
issues=0

if ! pm2 status | grep -q "centrifugo.*online"; then
    echo -e "${RED}⚠️  Centrifugo 服务未运行${NC}"
    issues=$((issues+1))
fi

if ! pm2 status | grep -q "78-sse-22.*online"; then
    echo -e "${RED}⚠️  字幕服务未运行${NC}"
    issues=$((issues+1))
fi

if ! netstat -tlnp 2>/dev/null | grep -q ":8000.*LISTEN"; then
    echo -e "${RED}⚠️  Centrifugo 端口未监听${NC}"
    issues=$((issues+1))
fi

if [ $issues -eq 0 ]; then
    echo -e "${GREEN}✅ 所有检查通过！${NC}"
    echo ""
    echo "下一步:"
    echo "  1. 在浏览器中打开: /home/ubuntu/radio/simple-subtitle-test.html"
    echo "  2. 点击 '连接 WebSocket' 按钮"
    echo "  3. 查看浏览器控制台（F12）的日志输出"
    echo ""
    echo "如果浏览器连接失败，可能是:"
    echo "  - SSL 证书问题"
    echo "  - 防火墙阻止"
    echo "  - CORS 配置问题"
else
    echo -e "${RED}发现 $issues 个问题，请先解决上述问题${NC}"
    echo ""
    echo "快速修复:"
    echo "  pm2 restart centrifugo"
    echo "  pm2 restart 78-sse-22"
    echo "  sudo systemctl restart nginx"
fi

echo "======================================================================"
