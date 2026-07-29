#!/usr/bin/env bash
# ============================================================
# DocFlow 一键部署脚本
#   用法（在服务器上）： cd /var/www/docflow-ai && bash deploy.sh
#   作用：拉最新代码（GitHub 线路不稳自动重试）→ 按需装依赖 → 构建后端+前端
#         → 刷新 nginx →（无条件）重启 pm2 后端
#   任一步失败立即停止，不会带着坏文件继续。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "▶ 拉取最新代码（GitHub 线路不稳时自动重试，Ctrl+C 可中断）…"
before=$(git rev-parse HEAD)
n=0
until git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 fetch origin; do
  n=$((n+1))
  echo "  第 ${n} 次失败（国内机房到 GitHub 线路时通时断），20 秒后重试…"
  sleep 20
done
git reset --hard origin/main
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "  已是最新提交（无新代码），仍会重新构建一次以确保产物最新。"
fi

# 仅当依赖锁文件变化时才安装，省时间
if ! git diff --quiet "$before" "$after" -- backend/package-lock.json 2>/dev/null; then
  echo "▶ 后端依赖有变化，安装…"
  ( cd backend && npm install )
fi
if ! git diff --quiet "$before" "$after" -- frontend/package-lock.json 2>/dev/null; then
  echo "▶ 前端依赖有变化，安装…"
  ( cd frontend && npm install --legacy-peer-deps )
fi

# 数据库结构变化才跑 prisma（生成客户端 + 应用迁移）
if ! git diff --quiet "$before" "$after" -- backend/prisma/schema.prisma 2>/dev/null; then
  echo "▶ 数据库结构有变化，同步…"
  ( cd backend && npx prisma generate && npx prisma migrate deploy )
fi

echo "▶ 构建后端…"
( cd backend && npm run build )

echo "▶ 构建前端…"
( cd frontend && npm run build )

echo "▶ 刷新静态文件权限并重载 nginx…"
chmod -R o+r frontend/dist
sudo systemctl reload nginx

# 无条件重启后端（与 flowai 同理：条件重启在"先手动 pull 再跑脚本"时会误判跳过，
# 导致后端跑旧代码；node 重启约 1 秒，索性每次都重启，最稳）。
echo "▶ 重启 docflow-backend…"
pm2 restart docflow-backend --update-env

echo "✅ 部署完成。浏览器请 Ctrl+Shift+R 强制刷新。"
