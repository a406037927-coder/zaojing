# 造境 AI

造境 AI 是一个可部署的 AI 网页应用生成平台。用户用中文描述需求，服务端调用 OpenAI 兼容模型生成完整、自包含的 HTML/CSS/JavaScript，平台在受限 iframe 中提供真实交互预览，并将项目及版本保存到 SQLite。



## 功能

- 自然语言生成完整单页应用，提供待办、记账、运维巡检三个示例需求。
- 自动清理 Markdown 代码围栏并校验完整 HTML，拒绝外部脚本、外部样式及危险执行方式。
- 预览/代码视图、桌面/手机宽度切换、复制源码、下载 HTML。
- SQLite 项目历史，支持重新打开、删除、继续修改和恢复上一版本。
- 注册登录、HttpOnly 会话 Cookie 与按用户隔离的项目历史；首个注册账号自动接管升级前的历史项目。
- 生成后自动进入第二轮模型代码审查，重点修复事件绑定、状态更新、ID 类型及增删改查交互问题。
- 输入长度校验、按 IP 基础限流、模型调用并发限制、超时与输出长度限制。
- 同源生产部署、Docker 持久化数据卷、非 root 容器用户和健康检查。

## 架构

```text
Browser (React + Vite)
  ├─ /api/* ───────────────┐
  └─ sandbox iframe srcdoc │
                            ▼
Express + TypeScript ── OpenAI-compatible API
          │
          └──────────── SQLite (/app/data/zaojing.sqlite)
```

模型生成代码只作为文本保存和返回，从不在后端执行；平台页面不使用 `eval`。预览 iframe 仅启用 `allow-scripts`，不启用 `allow-same-origin`、弹窗或顶层导航，并为 `srcdoc` 注入限制网络访问的 CSP。

## 环境变量

复制示例配置：

```bash
cp .env.example .env
```

必填的模型配置：

```dotenv
AI_API_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_server_side_key
AI_MODEL=your-model-name
```

可选配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 生产服务端口 |
| `DATA_DIR` | `./data` | SQLite 数据目录 |
| `AI_REQUEST_TIMEOUT_MS` | `300000` | 一次生成流程的总超时（包含生成与代码审查） |
| `AI_MAX_OUTPUT_TOKENS` | `20000` | 单次模型响应的最大输出 token |
| `AI_MAX_CONCURRENCY` | `2` | 单实例生成并发数 |
| `AI_RATE_LIMIT_PER_HOUR` | `20` | 每 IP 每小时生成/修改次数 |
| `SESSION_DAYS` | `7` | 登录会话有效天数 |
| `COOKIE_SECURE` | `false` | HTTPS 部署后应设置为 `true` |

API Key 仅由 Node 服务读取，不会进入前端 bundle、接口响应或正常日志。

## 本地启动

要求 Node.js 24+ 与 pnpm：

```bash
pnpm install
pnpm dev
```

- 前端开发地址：<http://localhost:5173>
- 后端健康检查：<http://localhost:3000/api/health>

生产构建与同源启动：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

访问 <http://localhost:3000>。

## Docker 部署

```bash
cp .env.example .env
# 编辑 .env，填入模型配置
docker compose up -d --build
docker compose ps
curl http://localhost:3000/api/health
```

数据库保存在命名卷 `zaojing-data` 中，重建容器不会删除历史项目。备份示例：

```bash
docker compose stop
docker run --rm -v zaojing-ai_zaojing-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/zaojing-data-backup.tar.gz -C /data .
docker compose start
```

## 演示步骤

1. 打开平台并注册账号；从旧版本升级时，第一个注册账号会接管已有项目。
2. 选择“待办清单”示例或输入自己的需求，点击“生成应用”，等待生成和代码审查完成。
3. 切换“代码”、桌面/手机宽度，测试复制与下载。
4. 刷新页面，从左侧历史重新打开项目。
5. 输入“增加分类筛选，改成深色主题”，点击“继续修改”。
6. 点击“恢复上一版本”验证版本回退。
7. 重启服务后确认历史仍存在。

## 数据持久化范围

本阶段持久化的是平台中的项目、原始需求、生成代码和版本记录。沙箱应用内部的待办、账目等运行数据不会保存；预览也不依赖 `localStorage`。如需保存生成应用的业务数据，后续应提供受控的数据 API 和应用级 schema，而不是放开 iframe 的同源权限。

## 安全说明

- 不提交 `.env`、API Key、SQLite 数据文件或日志。
- 密码使用随机盐的 scrypt 哈希保存，登录态使用服务端 SQLite 会话和 HttpOnly Cookie。
- 生成结果不会在后端执行。
- iframe sandbox 不包含 `allow-same-origin`、`allow-popups`、`allow-top-navigation`。
- 预览注入 CSP，禁止网络连接和外部资源。
- HTML 校验与第二轮模型审查可显著减少无响应按钮，但不等同于完整恶意代码审计或浏览器级形式化验证。
- 当前公网实例仍是 HTTP，仅适合受控演示；正式开放注册前必须配置域名与 HTTPS，并设置 `COOKIE_SECURE=true`。

## 公网部署

任选一台安装 Docker 的 Linux 服务器：

```bash
git clone <your-repository-url> zaojing-ai
cd zaojing-ai
cp .env.example .env
vim .env
docker compose up -d --build
```

建议使用 Nginx/Caddy 反向代理 `127.0.0.1:3000`，模型生成接口的代理超时应不低于 `AI_REQUEST_TIMEOUT_MS`，并配置 HTTPS。不要直接提交 `.env`，也不要把 API Key 写进 Compose 文件或前端环境变量。

## GitHub 提交

```bash
git init
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json \
  client server Dockerfile docker-compose.yml .dockerignore .gitignore \
  .env.example README.md WRITEUP.md
git commit -m "feat: build AI web app generation platform"
git branch -M main
git remote add origin git@github.com:<account>/<repository>.git
git push -u origin main
```

请先在 GitHub 创建空仓库并确认远程地址；本项目不会擅自创建公开仓库或推送代码。

## 验收记录

本次实际执行的环境、命令、通过项与未验证项记录在 [TEST_RESULTS.md](./TEST_RESULTS.md)。阿里云 ECS 已配置百炼兼容接口并完成过真实生成；本轮升级完成了生产镜像构建、自动化测试、临时数据库认证实测与线上健康检查。模型对任意复杂需求的业务正确性仍不能作绝对保证。
