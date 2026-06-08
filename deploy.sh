#!/bin/bash

# ==============================================================================
# SpaceDream AI Model Hub - Production One-Click Deployment Script
# ==============================================================================

# Set text colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}          🚀 SpaceDream AI Model Hub 部署启动          ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Fetch latest changes from Git
echo -e "\n${YELLOW}[Step 1/5] 正在拉取最新的 Git 代码更新...${NC}"
if git pull; then
  echo -e "${GREEN}✓ 代码拉取成功！${NC}"
else
  echo -e "${RED}✗ 拉取 Git 代码失败，请检查网络或 Git 配置。${NC}"
  echo -e "${YELLOW}提示: 如果您是第一次手动拉取，请确保已经配置好免密密钥，并继续执行。${NC}"
fi

# 2. Check Node.js & NPM environment
echo -e "\n${YELLOW}[Step 2/5] 检查 Node.js & NPM 运行环境...${NC}"

# Try loading NVM if it is installed but not in current PATH (e.g. non-interactive ssh)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  \. "$NVM_DIR/nvm.sh"
elif [ -s "/usr/local/nvm/nvm.sh" ]; then
  export NVM_DIR="/usr/local/nvm"
  \. "$NVM_DIR/nvm.sh"
fi

install_node() {
  echo -e "${YELLOW}正在尝试自动安装/升级 Node.js v20 LTS...${NC}"
  SUDO=""
  if [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
  fi

  if command -v yum >/dev/null 2>&1; then
    echo -e "${YELLOW}检测到 CentOS/RHEL 系列系统，使用 yum 进行升级安装...${NC}"
    $SUDO yum remove -y nodejs || true
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
    $SUDO yum install -y nodejs
  elif command -v apt-get >/dev/null 2>&1; then
    echo -e "${YELLOW}检测到 Ubuntu/Debian 系列系统，使用 apt-get 进行升级安装...${NC}"
    $SUDO apt-get remove -y nodejs || true
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
  else
    echo -e "${YELLOW}未检测到主流包管理器，尝试通过 NVM 进行自动安装...${NC}"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    nvm install 20
    nvm use 20
    nvm alias default 20
  fi
}

NEEDS_INSTALL=false
if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}未检测到 Node.js 环境。${NC}"
  NEEDS_INSTALL=true
else
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d'v' -f2 | cut -d'.' -f1)
  echo -e "${GREEN}检测到 Node.js 当前版本: ${NODE_VER}${NC}"
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${YELLOW}⚠️ 当前 Node.js 版本低于 v18 (Vite 5 运行需要 v18+)，准备自动升级...${NC}"
    NEEDS_INSTALL=true
  fi
fi

if [ "$NEEDS_INSTALL" = true ]; then
  install_node
  # Check again after install
  if command -v node >/dev/null 2>&1; then
    NODE_VER=$(node -v)
    echo -e "${GREEN}✓ Node.js 成功安装/升级: ${NODE_VER}${NC}"
  else
    echo -e "${RED}✗ 自动安装 Node.js 失败，请手动登录服务器安装 Node.js v18+。${NC}"
    exit 1
  fi
fi

if command -v npm >/dev/null 2>&1; then
  NPM_VER=$(npm -v)
  echo -e "${GREEN}✓ 找到 NPM: ${NPM_VER}${NC}"
else
  echo -e "${RED}✗ 未找到 NPM，请检查 Node.js 安装状态。${NC}"
  exit 1
fi

# 3. Install dependencies
echo -e "\n${YELLOW}[Step 3/5] 正在安装服务端与客户端的依赖依赖项...${NC}"
if npm run install:all; then
  echo -e "${GREEN}✓ 所有依赖项安装成功！${NC}"
else
  echo -e "${RED}✗ 依赖项安装失败，请检查 npm install 日志。${NC}"
  exit 1
fi

# 4. Compile frontend assets
echo -e "\n${YELLOW}[Step 4/5] 正在编译前端客户端静态资源 (Vite Build)...${NC}"
if npm run build; then
  echo -e "${GREEN}✓ 前端资源编译成功，已生成 client/dist 文件夹！${NC}"
else
  echo -e "${RED}✗ 前端编译失败，请检查编译日志。${NC}"
  exit 1
fi

# 5. Process Process Management (PM2 or Nohup)
echo -e "\n${YELLOW}[Step 5/5] 启动/重启后端 Node.js 服务进程...${NC}"
PORT=${PORT:-3001}

if command -v pm2 >/dev/null 2>&1; then
  echo -e "${GREEN}✓ 检测到已安装 PM2 进程管理器，将使用 PM2 进行零停机部署。${NC}"
  
  # Check if app is already running under PM2
  if pm2 show demoui4ai >/dev/null 2>&1; then
    echo -e "${YELLOW}检测到服务正在运行，正在为您进行重启更新...${NC}"
    pm2 restart demoui4ai --update-env
  else
    echo -e "${YELLOW}正在创建并启动新的 PM2 进程...${NC}"
    PORT=$PORT pm2 start server/index.js --name "demoui4ai" --update-env
  fi
  
  pm2 save
  echo -e "${GREEN}✓ PM2 部署管理成功！${NC}"
  pm2 status demoui4ai
else
  echo -e "${YELLOW}⚠️ 未检测到 PM2 进程管理器，推荐安装：npm install -g pm2${NC}"
  echo -e "${YELLOW}将使用后台守护进程 (nohup) 方式启动服务...${NC}"
  
  # Kill existing process running on the target PORT
  PID=$(lsof -t -i:$PORT)
  if [ -n "$PID" ]; then
    echo -e "${YELLOW}正在停止端口 $PORT 上运行的旧进程 (PID: $PID)...${NC}"
    kill -9 $PID
  fi
  
  # Start server in background
  PORT=$PORT nohup node server/index.js > app.log 2>&1 &
  sleep 2
  
  if ps -p $! >/dev/null; then
    echo -e "${GREEN}✓ 服务已成功在后台启动 (PID: $!)。日志已输出到 app.log。${NC}"
  else
    echo -e "${RED}✗ 服务启动失败，请检查 app.log 里的报错内容。${NC}"
    exit 1
  fi
fi

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}        🎉 SpaceDream AI Model Hub 部署成功！          ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "${BLUE}访问地址 (Web URL): http://localhost:${PORT}${NC}"
echo -e "${BLUE}代理接口 (API Base): http://localhost:${PORT}/v1${NC}"
echo -e "${BLUE}API 密钥格式 (API Key): sk-spacedream-<username>${NC}"
echo -e "${BLUE}日志文件 (Log File): app.log (或使用 'pm2 logs demoui4ai')${NC}"
echo -e "${GREEN}====================================================${NC}"
