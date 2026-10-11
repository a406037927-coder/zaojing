import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { AiConfigError, AiResponseError, generateApplication } from "./ai.js";
import { currentUser, endSession, hashPassword, publicUser, requireAuth, startSession, verifyPassword } from "./auth.js";
import { config, isAiConfigured } from "./config.js";
import { projectRepository, userRepository, type UserRow } from "./db.js";
import { generationRateLimit, withGenerationSlot } from "./guards.js";

const createSchema = z.object({
  prompt: z.string().trim().min(1, "请输入应用需求。").max(4000, "需求不能超过 4000 个字符。"),
});

const modifySchema = z.object({
  prompt: z.string().trim().min(1, "请输入修改需求。").max(2000, "修改需求不能超过 2000 个字符。"),
});

const authSchema = z.object({
  username: z.string().trim().min(3, "用户名至少 3 个字符。").max(32, "用户名不能超过 32 个字符。")
    .regex(/^[\p{L}\p{N}_-]+$/u, "用户名只能包含文字、数字、下划线和短横线。"),
  password: z.string().min(8, "密码至少 8 个字符。").max(128, "密码不能超过 128 个字符。"),
});

function userFrom(res: Response) {
  return res.locals.user as UserRow;
}

function projectName(prompt: string) {
  const firstLine = prompt.split(/[。！？\n]/)[0]?.trim() || "未命名应用";
  return firstLine.replace(/^(生成|创建|做|开发|帮我)(一个|一款|一个可以)?/u, "").slice(0, 24) || "AI 生成应用";
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "输入内容不合法。";
}

export function createApp(options?: { generate?: typeof generateApplication }) {
  const generate = options?.generate || generateApplication;
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", aiConfigured: isAiConfigured(), timestamp: new Date().toISOString() });
  });

  app.get("/api/auth/me", (req, res) => {
    const user = currentUser(req);
    return res.json({ user: user ? publicUser(user) : null });
  });

  app.post("/api/auth/register", async (req, res, next) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    if (userRepository.getByUsername(parsed.data.username)) {
      return res.status(409).json({ error: "该用户名已被注册。" });
    }
    try {
      const isFirstUser = userRepository.count() === 0;
      const password = await hashPassword(parsed.data.password);
      const user = userRepository.create({
        id: crypto.randomUUID(),
        username: parsed.data.username,
        password_hash: password.hash,
        password_salt: password.salt,
        created_at: new Date().toISOString(),
      });
      if (!user) throw new Error("user create failed");
      if (isFirstUser) projectRepository.claimUnowned(user.id);
      startSession(res, user.id);
      return res.status(201).json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    try {
      const user = userRepository.getByUsername(parsed.data.username);
      if (!user || !await verifyPassword(parsed.data.password, user)) {
        return res.status(401).json({ error: "用户名或密码不正确。" });
      }
      startSession(res, user.id);
      return res.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    endSession(req, res);
    return res.status(204).send();
  });

  app.use("/api/projects", requireAuth);

  app.get("/api/projects", (_req, res) => {
    res.json({ projects: projectRepository.list(userFrom(res).id) });
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = projectRepository.get(String(req.params.id), userFrom(res).id);
    if (!project) return res.status(404).json({ error: "项目不存在或已被删除。" });
    return res.json({ project, versions: projectRepository.versions(project.id, userFrom(res).id) });
  });

  app.post("/api/projects/generate", generationRateLimit, async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    try {
      const code = await withGenerationSlot(() => generate(parsed.data.prompt));
      const now = new Date().toISOString();
      const project = projectRepository.create({
        id: crypto.randomUUID(),
        name: projectName(parsed.data.prompt),
        prompt: parsed.data.prompt,
        code,
        current_version: 1,
        created_at: now,
        updated_at: now,
        owner_id: userFrom(res).id,
      });
      return res.status(201).json({ project, versions: project ? projectRepository.versions(project.id, userFrom(res).id) : [] });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/projects/:id/modify", generationRateLimit, async (req, res, next) => {
    const parsed = modifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const project = projectRepository.get(String(req.params.id), userFrom(res).id);
    if (!project) return res.status(404).json({ error: "项目不存在或已被删除。" });
    try {
      const code = await withGenerationSlot(() => generate(parsed.data.prompt, project.code));
      const updated = projectRepository.update(project.id, parsed.data.prompt, code, userFrom(res).id);
      return res.json({ project: updated, versions: projectRepository.versions(project.id, userFrom(res).id) });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/projects/:id/restore", (req, res) => {
    const project = projectRepository.get(String(req.params.id), userFrom(res).id);
    if (!project) return res.status(404).json({ error: "项目不存在或已被删除。" });
    const restored = projectRepository.restorePrevious(project.id, userFrom(res).id);
    if (!restored) return res.status(409).json({ error: "当前已经是最早版本，无法继续恢复。" });
    return res.json({ project: restored, versions: projectRepository.versions(project.id, userFrom(res).id) });
  });

  app.delete("/api/projects/:id", (req, res) => {
    if (!projectRepository.delete(String(req.params.id), userFrom(res).id)) {
      return res.status(404).json({ error: "项目不存在或已被删除。" });
    }
    return res.status(204).send();
  });

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AiConfigError) return res.status(503).json({ error: error.message, code: "AI_NOT_CONFIGURED" });
    if (error instanceof AiResponseError) return res.status(502).json({ error: error.message, code: "AI_REQUEST_FAILED" });
    if (error instanceof Error && error.name === "ConcurrencyLimitError") {
      return res.status(429).json({ error: error.message, code: "AI_BUSY" });
    }
    if (error instanceof SyntaxError) return res.status(400).json({ error: "请求体不是有效的 JSON。" });
    console.error("Unhandled request error", error instanceof Error ? error.message : error);
    return res.status(500).json({ error: "服务暂时不可用，请稍后重试。" });
  });

  return app;
}
