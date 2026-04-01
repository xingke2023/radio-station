#!/bin/bash

# 查看 PM2 管理的 Node 进程端口
# 使用方法: ./check_pm2_ports.sh

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                      PM2 进程端口监听情况                                    ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# 打印表头
printf "%-4s %-20s %-10s %-10s %s\n" "ID" "Name" "PID" "Status" "Ports"
echo "────────────────────────────────────────────────────────────────────────────────"

# 获取 PM2 进程列表并处理
pm2 jlist | jq -r '.[] | select(.pm2_env.status == "online") | "\(.pm2_env.pm_id)|\(.name)|\(.pid)|\(.pm2_env.status)"' | while IFS='|' read -r pm_id name pid status; do
    # 获取该进程监听的端口
    ports=$(netstat -nltp 2>/dev/null | grep "$pid/" | grep LISTEN | awk '{print $4}' | sed 's/.*://' | sort -n | uniq | tr '\n' ',' | sed 's/,$//')

    # 如果没有端口，显示 -
    if [ -z "$ports" ]; then
        ports="-"
    fi

    # 打印结果
    printf "%-4s %-20s %-10s %-10s %s\n" "$pm_id" "$name" "$pid" "$status" "$ports"
done

echo ""
