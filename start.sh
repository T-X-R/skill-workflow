#!/bin/bash
# ============================================
# 视频剪辑自动化平台 — 一键启动脚本
# ============================================
# 后端: FastAPI (localhost:8000)
# 前端: Vite   (localhost:5173)
# ============================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
    echo ""
    echo -e "${YELLOW}正在关闭服务...${NC}"
    # 杀掉整个进程组，确保 uvicorn reloader/server 子进程一并退出
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill -- -"$(ps -o pgid= -p "$BACKEND_PID" 2>/dev/null | tr -d ' ')" 2>/dev/null || kill "$BACKEND_PID" 2>/dev/null
    fi
    # 兜底：直接释放端口
    lsof -ti :8000 2>/dev/null | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}  ✓ 后端已停止${NC}"
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill "$FRONTEND_PID" 2>/dev/null
        echo -e "${GREEN}  ✓ 前端已停止${NC}"
    fi
    echo -e "${GREEN}已安全退出${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}   视频剪辑自动化平台${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# ---- 检查环境 ----
echo -e "${YELLOW}[1/4] 检查环境...${NC}"

if ! command -v python &>/dev/null; then
    echo -e "${RED}  ✗ 未找到 python，请安装 Python 3.11+${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Python: $(python --version)${NC}"

if ! command -v node &>/dev/null; then
    echo -e "${RED}  ✗ 未找到 node，请安装 Node.js 18+${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Node.js: $(node --version)${NC}"

if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo -e "${RED}  ✗ 未找到 .env 文件，请先配置环境变量${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ .env 配置文件存在${NC}"

# ---- 安装依赖 ----
echo ""
echo -e "${YELLOW}[2/4] 检查依赖...${NC}"

cd "$PROJECT_DIR"
if command -v uv &>/dev/null; then
    # 先检查核心依赖是否已安装，避免每次 uv sync 做全量校验（mediapipe 等大包校验很慢）
    if .venv/bin/python -c "import fastapi, uvicorn, langchain" 2>/dev/null; then
        echo -e "${GREEN}  ✓ Python 依赖已就绪，跳过 uv sync${NC}"
    else
        echo -e "${YELLOW}  ⏳ 安装 Python 依赖（首次可能较慢）...${NC}"
        uv sync 2>&1 | tail -3
        echo -e "${GREEN}  ✓ Python 依赖已同步 (uv)${NC}"
    fi
else
    echo -e "${YELLOW}  ⚠ 未找到 uv，跳过 Python 依赖检查${NC}"
fi

cd "$PROJECT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}  ⏳ 安装前端依赖...${NC}"
    npm install --silent
fi
echo -e "${GREEN}  ✓ 前端依赖就绪${NC}"

# ---- 启动后端 ----
echo ""
echo -e "${YELLOW}[3/4] 启动后端服务...${NC}"

# 清理占用 8000 端口的旧进程
EXISTING_PID=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$EXISTING_PID" ]; then
    echo -e "${YELLOW}  ⚠ 端口 8000 被进程 $EXISTING_PID 占用，正在释放...${NC}"
    kill -9 $EXISTING_PID 2>/dev/null
    sleep 1
fi

cd "$PROJECT_DIR"
if command -v uv &>/dev/null; then
    uv run python main.py &
elif [ -x "$PROJECT_DIR/.venv/bin/python" ]; then
    "$PROJECT_DIR/.venv/bin/python" main.py &
else
    python main.py &
fi
BACKEND_PID=$!

# 等待后端就绪
for i in $(seq 1 15); do
    if curl -s http://localhost:8000/health >/dev/null 2>&1; then
        echo -e "${GREEN}  ✓ 后端已启动 → http://localhost:8000${NC}"
        echo -e "${GREEN}    API 文档 → http://localhost:8000/docs${NC}"
        break
    fi
    if [ $i -eq 15 ]; then
        echo -e "${RED}  ✗ 后端启动超时${NC}"
        cleanup
    fi
    sleep 1
done

# ---- 启动前端 ----
echo ""
echo -e "${YELLOW}[4/4] 启动前端服务...${NC}"

cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
sleep 3
echo -e "${GREEN}  ✓ 前端已启动 → http://localhost:5173${NC}"

# ---- 完成 ----
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  平台已启动！${NC}"
echo -e "${CYAN}  前端: http://localhost:5173${NC}"
echo -e "${CYAN}  后端: http://localhost:8000${NC}"
echo -e "${CYAN}  API:  http://localhost:8000/docs${NC}"
echo -e "${CYAN}============================================${NC}"
echo -e "${YELLOW}  按 Ctrl+C 停止所有服务${NC}"
echo ""

wait
