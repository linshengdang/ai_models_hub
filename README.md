# SpaceDream AI Model Hub (多模型集成与 API 代理网关)

SpaceDream AI Model Hub 是一个现代化、美观且高可用的多大语言模型集成管理平台。它不仅提供统一的 Web 用户界面用于配置和测试各类国内外主流大模型供应商，还内置了**外部 API 代理网关**，支持通过标准的 OpenAI API 格式将所有配置好的模型聚合导出，提供给 Cursor、VS Code Copilot 等外部工具使用。

---

## 🌟 核心功能

1. **三合一多模式身份验证**：支持 `API Key` 直连、`Token` 验证以及标准 `OAuth 2.0`（GitHub Copilot/Codex/Antigravity）授权绑定。
2. **多模态模型集成**：已预置集成 OpenAI、Claude (Anthropic)、Google Gemini、DeepSeek (深度求索)、Kimi (月之暗面)、通义千问 (百炼)、字节豆包 (火山方舟)、智谱 GLM、MiniMax (海螺)、SiliconFlow、Groq 等主流渠道。
3. **一键智能验证**：
   - **一键验证链接**：一键检测配置的接口及网络连通性。
   - **一键验证模型**：自动遍历验证供应商支持的全部模型，并提供可视化的 **高级毛玻璃进度条**。
4. **外部 API 代理网关 (Proxy Service)**：
   - 统一代理端点：`http://localhost:3001/v1/chat/completions`。
   - 统一密钥格式：`sk-spacedream-<username>` (如 `sk-spacedream-dddd`)。
   - 智能路由：不同供应商的同名模型自动添加前缀区分（如 `openai-gpt-4o` 与 `github_copilot-gpt-4o`），支持外部工具无缝接入。
5. **一键自动部署 (Self-healing)**：部署脚本包含 Node.js 运行环境自动检测与升级逻辑，无痛迁移与部署上线。

---

## 🛠️ 安装与部署指南

### 前提条件
- **系统环境**：Linux (CentOS / Ubuntu / Debian) 或 macOS。
- **权限要求**：自动安装 Node.js 需要 `sudo` 或以 `root` 用户运行。

---

### 1. 生产环境一键部署 (推荐 🚀)

在服务器上（例如目录 `/opt/ai_models_hub`），只需运行以下命令：

```bash
# 1. 赋予部署脚本执行权限
chmod +x deploy.sh

# 2. 运行一键部署脚本
./deploy.sh
```

#### 💡 `deploy.sh` 脚本工作流程：
- **自愈式环境升级**：自动检测本地 Node.js 状态。若未安装或版本低于 `v18`（Vite 5 运行的最低要求），脚本会自动在服务器上安装/升级至最新 **Node.js v20 LTS**。
- **依赖安装**：一键自动安装服务端和前端客户端（Vite）的所有 `node_modules` 依赖项。
- **编译打包**：使用 Vite 构建前端高度优化的静态资源并输出至 `client/dist`。
- **后台服务挂载**：
  - 优先使用 **PM2 进程管理器** 启动后端服务（实现故障自启与更新）。
  - 若无 PM2，自动回退到 **`nohup` 守护进程** 方式后台运行，并将日志输出到 `app.log`。

---

### 2. 本地开发调试运行

若要在本地启动开发模式，支持代码热更新（Hot Reload）：

```bash
# 1. 克隆/拉取代码到本地

# 2. 一键安装前后端所有依赖项
npm run install:all

# 3. 运行开发服务器 (并发启动后端 3001 和前端 Vite 5173 开发端口)
npm run dev
```

---

### 3. 本地一键推送与远程部署 (`ship.sh`)

我们在本地配置了 `ship.sh`。当您在本地开发完成，想要一键推送到远程 Git 仓库，并同步让远程服务器拉取部署时，只需在本地终端运行：

```bash
./ship.sh
```
*首次运行会提示您输入远程服务器的 IP 地址、SSH 端口和部署目录，配置将被保存在 `.deploy_config` 中以便下次免输运行。*

---

## ⚙️ 配置说明

### 环境变量 (`.env` 或 `.env.local`)
您可以在项目根目录中创建 `.env.local` 配置文件，用于预置服务端口及平台 API 密钥：

```bash
# 服务运行端口 (默认 3001)
PORT=3001

# 供应商 API 密钥 (选填，预置后 UI 界面无需再次输入即可直接使用)
OPENAI_API_KEY=your_openai_key
MOONSHOT_API_KEY=your_kimi_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_API_KEY=your_gemini_key
DEEPSEEK_API_KEY=your_deepseek_key
DASHSCOPE_API_KEY=your_qwen_key
```
---

## 📖 运行与使用指南

服务部署成功后，通过浏览器访问 `http://<您的服务器IP>:3001`：

### 1. 登录与多用户切换
- 输入用户名（如 `dddd`）并配置密码。系统为每个用户保留**相互隔离**的配置沙箱。
- 登录后，您可以在右侧点击用户名修改密码。

### 2. 供应商状态栏一键验证
- **生成授权链接 (OAuth)**：点击后会在按钮下方实时展示提示，授权成功后可直接使用。
- **一键验证链接**：检测当前供应商的 baseUrl 连通性，按钮上方展示高级磨砂质感加载进度条。
- **一键验证模型**：批量测试该供应商下支持的所有模型是否可用，按钮旁实时展示验证比例（如 `[5/10] 50%`）。

### 3. 使用外部 API 代理服务 (Proxy)
1. 点击主界面上方的 **"外部 API 代理服务"** 标签页。
2. 查看当前可用的统一 API 代理端点、您的 API Key、以及支持调用的模型列表。
3. **Cursor 配置示例**：
   - 打开 Cursor 设置 -> Models -> OpenAI API Section。
   - Override Base URL 填写：`http://<您的服务器IP>:3001/v1`。
   - API Key 填写：`sk-spacedream-dddd` (以实际用户名为准)。
   - 勾选或添加您想要调用的模型（如同名模型可使用 `github_copilot-gpt-4o` 形式）。

---

## 👥 作者与联系方式

- **作者**：linshengdang (SpaceDream)
- **联系方式 (QQ)**：44210509
- **说明**：如果您在使用、部署或二次开发中遇到任何问题，欢迎通过 QQ 与我联系交流。
