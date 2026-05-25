#!/bin/bash
# Datation 启动脚本
# 端口优先级: app.json > 环境变量(.env) > 默认值

set -e

echo "🚀 启动 Datation..."

# 检查依赖
if ! command -v uv &> /dev/null; then
    echo "❌ uv 未安装，请访问 https://docs.astral.sh/uv/ 安装"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请访问 https://nodejs.org/ 安装"
    exit 1
fi

cd "$(dirname "$0")"

# 加载 .env 文件（如果存在）
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# 读取端口配置: app.json > 环境变量 > 默认值
APP_CONFIG="$HOME/.datation/config/app.json"
if [ -f "$APP_CONFIG" ]; then
    CFG_API_PORT=$(python3 -c "import json; d=json.load(open('$APP_CONFIG')); print(d.get('api_port',''))" 2>/dev/null || echo "")
    CFG_WEB_PORT=$(python3 -c "import json; d=json.load(open('$APP_CONFIG')); print(d.get('web_port',''))" 2>/dev/null || echo "")
fi
API_PORT="${CFG_API_PORT:-${API_PORT:-18321}}"
WEB_PORT="${CFG_WEB_PORT:-${WEB_PORT:-1420}}"
echo "📋 后端端口: $API_PORT | 前端端口: $WEB_PORT"

# 安装 Python 依赖
echo "📦 安装 Python 依赖..."
uv sync

# 安装前端依赖
echo "📦 安装前端依赖..."
cd frontend && npm install && cd ..

# 清理旧进程
pkill -f "datation.main" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# 启动后端
echo "📡 启动后端服务..."
echo -e "\n\n========== $(date '+%Y-%m-%d %H:%M:%S') Backend Restart ==========" >> /tmp/datation-backend.log
PYTHONPATH="$(pwd)/datation:$PYTHONPATH" uv run python -m datation.main >> /tmp/datation-backend.log 2>&1 &
BACKEND_PID=$!
echo "  日志: /tmp/datation-backend.log"

# 等待后端完全就绪
echo "⏳ 等待后端完全就绪 (端口 $API_PORT)..."
for i in {1..60}; do
    HEALTH=$(curl -s "http://localhost:${API_PORT}/health" 2>/dev/null || echo "")
    if echo "$HEALTH" | grep -q '"ready"' && echo "$HEALTH" | grep -q 'true'; then
        echo "✅ 后端已完全就绪"
        break
    fi
    sleep 2
done

# 启动 Vite
echo "🎨 启动 Web 前端服务..."
cd frontend
VITE_PORT=$WEB_PORT npm run dev > /tmp/datation-vite.log 2>&1 &
VITE_PID=$!
echo "  日志: /tmp/datation-vite.log"

# 等待 Vite 就绪
echo "⏳ 等待 Vite 启动 (端口 $WEB_PORT)..."
for i in {1..30}; do
    if curl -s "http://localhost:${WEB_PORT}" > /dev/null 2>&1; then
        echo "✅ Vite 已就绪"
        break
    fi
    sleep 1
done

cd ..

echo ""
echo "✅ Datation Web 版已启动: http://localhost:${WEB_PORT}"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 清理函数
cleanup() {
    echo ""
    echo "🛑 停止所有服务..."
    kill $BACKEND_PID $VITE_PID 2>/dev/null || true
    pkill -P $$ 2>/dev/null || true
    exit 0
}

trap cleanup INT TERM

# 等待任一进程退出
wait -n $BACKEND_PID $VITE_PID 2>/dev/null || wait $BACKEND_PID
cleanup
