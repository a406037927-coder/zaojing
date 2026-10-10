# 实际测试结果

测试日期：2026-10-10（Asia/Shanghai）

## 已通过

| 项目 | 方法 | 结果 |
| --- | --- | --- |
| 前后端 TypeScript | 分别执行 `tsc --noEmit` / `tsc -b` | 通过 |
| 前端生产构建 | `vite build --configLoader runner` | 通过，输出至 `client/dist` |
| 后端自动化测试 | `vitest run` | 1 个测试文件、5 个用例全部通过 |
| 健康检查 | `GET /api/health` | `200`，返回状态及 `aiConfigured` |
| 无效输入 | 空需求、4001 字符需求 | 返回明确的 `400` 中文提示 |
| API 未配置 | 未设置三项 AI 环境变量后生成 | 返回 `503 / AI_NOT_CONFIGURED` 及配置方法 |
| 生成完整流程 | 本地 OpenAI 兼容模拟端点 + 生产构建 UI | 成功生成并保存项目 |
| 沙箱交互 | 在 iframe 中添加“检查生产告警”任务 | 成功，列表出现任务并提供删除按钮 |
| 代码视图与复制 | 浏览器切换代码页、读取剪贴板 | 成功，剪贴板包含完整 `<!doctype html>` |
| 继续修改 | 输入“改成深色主题” | 成功生成 v2，原 v1 保留 |
| 恢复上一版本 | 点击恢复并重新打开 | 成功回到 v1 |
| 刷新持久化 | 刷新后从历史重新打开 | 成功 |
| 重启持久化 | 重启 Express 后重新打开 | 成功，SQLite 数据仍存在 |
| 响应式布局 | 浏览器 390×844 视口 + 内置手机预览 | 无页面横向溢出，功能区可正常使用 |

## 受环境限制或尚未验证

- 当前没有提供真实 `AI_API_BASE_URL`、`AI_API_KEY`、`AI_MODEL`，因此未验证真实模型的响应质量、时延和兼容接口差异。测试所用模拟端点只验证协议和产品链路，不代表真实 AI 调用成功。
- 内置浏览器中“下载 HTML”按钮被正常点击，但该浏览器没有捕获到页面创建的 `blob:` 下载事件；实现使用标准 Blob/Object URL + `download` 属性，仍建议在 Chrome/Edge 做一次人工下载复核。
- 当前电脑未安装 Docker，无法实际执行镜像构建和 Compose 启动；Dockerfile、Compose、非 root 用户、健康检查及数据卷配置已完成静态检查。
- 未创建公网地址、GitHub 仓库或推送代码，因为没有服务器与目标仓库信息，且需求明确禁止擅自公开或部署到未知账号。

## 复测命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

浏览器访问 `http://localhost:3000`，按 README 的演示步骤复测。
