#!/bin/bash

# ==============================================================================
# SpaceDream AI Model Hub - One-Click Git Commit, Push & Remote SSH Deploy
# ==============================================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}        🚀 SpaceDream 一键发布与远程部署工具           ${NC}"
echo -e "${BLUE}====================================================${NC}"

CONFIG_FILE=".deploy_config"

# Load existing configuration
if [ -f "$CONFIG_FILE" ]; then
  source "$CONFIG_FILE"
fi

# Prompt user for settings if not configured
if [ -z "$SSH_HOST" ]; then
  read -p "请输入远程服务器 IP [默认: 47.98.169.237]: " input_host
  SSH_HOST=${input_host:-47.98.169.237}
fi

if [ -z "$SSH_USER" ]; then
  read -p "请输入 SSH 用户名 [默认: root]: " input_user
  SSH_USER=${input_user:-root}
fi

if [ -z "$REMOTE_PATH" ]; then
  read -p "请输入服务器上的部署目录绝对路径 [默认: /root/spacedream/demoui4ai]: " input_path
  REMOTE_PATH=${input_path:-/root/spacedream/demoui4ai}
fi

if [ -z "$GIT_BRANCH" ]; then
  read -p "请输入要部署的 Git 分支 [当前分支 / 默认: feat-demo-guest-updates]: " input_branch
  GIT_BRANCH=${input_branch:-feat-demo-guest-updates}
fi

# Save configuration for next runs
cat <<EOT > "$CONFIG_FILE"
SSH_HOST="$SSH_HOST"
SSH_USER="$SSH_USER"
REMOTE_PATH="$REMOTE_PATH"
GIT_BRANCH="$GIT_BRANCH"
EOT

# 1. Commit changes if any
if [ -n "$(git status --porcelain)" ]; then
  echo -e "\n${YELLOW}[Step 1/3] 检测到本地有未提交的更改，正在为您自动提交...${NC}"
  git add .
  git commit -m "auto: deploy commit $(date '+%Y-%m-%d %H:%M:%S')"
else
  echo -e "\n${YELLOW}[Step 1/3] 本地代码已全部提交。${NC}"
fi

# 2. Push to Git remote
echo -e "\n${YELLOW}[Step 2/3] 正在推送到远程 Git 仓库...${NC}"
REMOTE_NAME=$(git remote | head -n 1)
if [ -z "$REMOTE_NAME" ]; then
  echo -e "${YELLOW}未检测到绑定的远程仓库，尝试使用 'origin'...${NC}"
  REMOTE_NAME="origin"
fi

# Double check if remote exists
if ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo -e "${RED}✗ 未找到 Git 远程仓库配置，请先运行 git remote add origin <您的Git仓库地址> 绑定后再运行此脚本。${NC}"
  exit 1
fi

if git push "$REMOTE_NAME" "$GIT_BRANCH"; then
  echo -e "${GREEN}✓ 代码已成功推送到远程仓库 ${REMOTE_NAME}/${GIT_BRANCH}！${NC}"
else
  echo -e "${RED}✗ 代码推送失败，请检查远程仓库权限或网络连接。${NC}"
  exit 1
fi

# 3. SSH into remote server and run deploy.sh
echo -e "\n${YELLOW}[Step 3/3] 正在通过 SSH 连接远程服务器 ${SSH_USER}@${SSH_HOST} 进行部署...${NC}"
echo -e "${YELLOW}执行命令: ssh -t ${SSH_USER}@${SSH_HOST} \"cd ${REMOTE_PATH} && ./deploy.sh\"${NC}"

# We use ssh with -t to allocate a pseudo-tty so output colors and interactive prompts display correctly.
ssh -t "${SSH_USER}@${SSH_HOST}" "cd ${REMOTE_PATH} && ./deploy.sh"

if [ $? -eq 0 ]; then
  echo -e "\n${GREEN}====================================================${NC}"
  echo -e "${GREEN}      🎉 项目已成功一键推送到 Git 并远程部署完成！        ${NC}"
  echo -e "${GREEN}====================================================${NC}"
else
  echo -e "\n${RED}====================================================${NC}"
  echo -e "${RED}      ✗ 远程服务器部署过程中发生错误，请检查日志。        ${NC}"
  echo -e "${RED}====================================================${NC}"
  exit 1
fi
