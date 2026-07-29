#!/bin/bash
# ============================================================
# Talking Legend — 开发运维脚本
# 用法:
#   bash dev.sh             一键拉起（前后台+构建）
#   bash dev.sh start        同上
#   bash dev.sh backend      仅后台
#   bash dev.sh frontend     仅前台
#   bash dev.sh restart      重拉（kill + 重建 + 启动）
#   bash dev.sh hot          热更新模式（watch 编译 + 自动重启）
#   bash dev.sh stop         停止全部
#   bash dev.sh build        仅构建
# ============================================================

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=4001
FRONTEND_PORT=5173

# ── 工具函数 ──────────────────────────────────────────────

kill_all() {
  echo "🛑 停止所有进程..."
  taskkill //F //IM node.exe 2>/dev/null || true
  # 强制释放端口（Windows netstat 找 PID）
  for port in $BACKEND_PORT $FRONTEND_PORT; do
    pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $NF}' | head -1)
    [ -n "$pid" ] && taskkill //F //PID "$pid" 2>/dev/null || true
  done
  sleep 2
}

wait_backend() {
  for i in $(seq 1 20); do
    curl -s "http://localhost:$BACKEND_PORT/api/health" > /dev/null 2>&1 && break
    sleep 1
  done
}

# ── 构建 ──────────────────────────────────────────────────

build() {
  echo "🔨 构建 shared + backend + frontend..."
  cd "$ROOT"
  npm run build -w shared
  npm run build -w backend
  npm run build -w frontend
  echo "✅ 构建完成"
}

# ── 后台 ──────────────────────────────────────────────────

backend() {
  echo "🚀 启动后台 (port $BACKEND_PORT)..."
  (cd "$ROOT/backend" && rm -f data/talking-legend.db && node dist/main.js) &
  sleep 2
  wait_backend
  echo "✅ 后台就绪: http://localhost:$BACKEND_PORT"
}

# ── 前台 ──────────────────────────────────────────────────

frontend() {
  echo "🚀 启动前台 (port $FRONTEND_PORT)..."
  (cd "$ROOT/frontend" && npx vite --port $FRONTEND_PORT) &
  sleep 3
  echo "✅ 前台就绪: http://localhost:$FRONTEND_PORT"
}

# ── 一键拉起 ──────────────────────────────────────────────

start() {
  kill_all
  build
  backend
  frontend
  echo ""
  echo "============================================"
  echo "  🎮 传说之语 已就绪"
  echo "  前台: http://localhost:$FRONTEND_PORT"
  echo "  后台: http://localhost:$BACKEND_PORT"
  echo "============================================"
}

# ── 重拉 ──────────────────────────────────────────────────

restart() {
  kill_all
  build
  backend
  frontend
  echo "✅ 重拉完成"
}

# ── 热更新（watch 模式） ──────────────────────────────────

hot() {
  kill_all
  cd "$ROOT/backend" && rm -f data/talking-legend.db
  echo "🔥 热更新模式 — 后台 watch + 前台 dev..."
  cd "$ROOT"
  npm run dev &
  sleep 5
  echo "✅ 热更新就绪: http://localhost:$FRONTEND_PORT"
  echo "   修改源码后自动编译重启"
}

# ── 停止 ──────────────────────────────────────────────────

stop() {
  kill_all
  echo "✅ 已停止"
}

# ── 入口 ──────────────────────────────────────────────────

case "${1:-start}" in
  start)    start ;;
  backend)  build && backend ;;
  frontend) build && frontend ;;
  restart)  restart ;;
  hot)      hot ;;
  stop)     stop ;;
  build)    build ;;
  *)
    echo "用法: bash dev.sh {start|backend|frontend|restart|hot|stop|build}"
    echo "  start    一键拉起（默认）"
    echo "  backend  仅后台"
    echo "  frontend 仅前台"
    echo "  restart  重拉（kill + 重建 + 启动）"
    echo "  hot      热更新（watch 编译）"
    echo "  stop     停止全部"
    echo "  build    仅构建"
    exit 1
    ;;
esac
