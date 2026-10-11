import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  AiConfigError, AiResponseError, extractGenerationResult, generateApplication,
  type AiGenerationResult,
} from "./ai.js";
import { currentUser, endSession, hashPassword, publicUser, requireAuth, startSession, verifyPassword } from "./auth.js";
import { config, isAiConfigured } from "./config.js";
import {
  acceptanceRepository, projectRepository, userRepository,
  type AcceptanceStatus, type UserRow,
} from "./db.js";
import { generationRateLimit, withGenerationSlot } from "./guards.js";

const createSchema = z.object({
  prompt: z.string().trim().min(1, "请输入应用需求。").max(4000, "需求不能超过 4000 个字符。"),
});

const modifySchema = z.object({
  prompt: z.string().trim().min(1, "请输入修改需求。").max(2000, "修改需求不能超过 2000 个字符。"),
});

const renameSchema = z.object({
  name: z.string().trim().min(1, "项目名称不能为空。").max(40, "项目名称不能超过 40 个字符。"),
});

const acceptanceCreateSchema = z.object({
  title: z.string().trim().min(1, "请填写验收操作。").max(200),
  expected: z.string().trim().min(1, "请填写预期结果。").max(500),
});

const acceptanceUpdateSchema = acceptanceCreateSchema.extend({
  status: z.enum(["unchecked", "passed", "failed"]),
  issueDescription: z.string().trim().max(1000).default(""),
});

const repairSchema = z.object({
  acceptanceItemIds: z.array(z.string().uuid()).min(1, "请选择至少一个失败项。").max(20),
});

const restoreSchema = z.object({
  versionNo: z.number().int().positive().optional(),
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
  const quoted = prompt.match(/[“\"']([^”\"']{2,24})[”\"']/)?.[1]?.trim();
  if (quoted) return quoted;
  const product = prompt.match(/([\p{L}\p{N}]{2,18}(?:清单|工具|游戏|看板|系统|应用|计数器|编辑器|播放器))/u)?.[1];
  if (product) return product.replace(/^(?:生成|创建|开发|制作)(?:一个|一款)?/u, "").slice(0, 16);
  const firstLine = prompt.split(/[。！？\n]/)[0]?.trim() || "未命名应用";
  return firstLine.replace(/^(生成|创建|做|开发|帮我)(一个|一款|一个可以)?/u, "").slice(0, 24) || "AI 生成应用";
}

function normalizedGeneration(result: AiGenerationResult | string, prompt: string) {
  return typeof result === "string" ? extractGenerationResult(result, prompt) : result;
}

function payload(project: NonNullable<ReturnType<typeof projectRepository.get>>, ownerId: string) {
  return {
    project,
    versions: projectRepository.versions(project.id, ownerId),
    acceptance: acceptanceRepository.list(project.id, project.current_version, ownerId),
  };
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message || "输入内容不合法。";
}

export function createApp(options?: {
  generate?: (prompt: string, existingCode?: string) => Promise<AiGenerationResult | string>;
}) {
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
    return res.json(payload(project, userFrom(res).id));
  });

  app.get("/api/projects/:id/versions/:versionNo", (req, res) => {
    const versionNo = Number(req.params.versionNo);
    const version = Number.isInteger(versionNo)
      ? projectRepository.version(String(req.params.id), versionNo, userFrom(res).id)
      : undefined;
    if (!version) return res.status(404).json({ error: "版本不存在或无权访问。" });
    return res.json({
      version,
      acceptance: acceptanceRepository.list(version.project_id, version.version_no, userFrom(res).id),
    });
  });

  app.post("/api/projects/generate", generationRateLimit, async (req, res, next) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    try {
      const generated = normalizedGeneration(
        await withGenerationSlot(() => generate(parsed.data.prompt)),
        parsed.data.prompt,
      );
      const now = new Date().toISOString();
      const project = projectRepository.create({
        id: crypto.randomUUID(),
        name: projectName(parsed.data.prompt),
        prompt: parsed.data.prompt,
        original_prompt: parsed.data.prompt,
        code: generated.code,
        current_version: 1,
        created_at: now,
        updated_at: now,
        owner_id: userFrom(res).id,
      }, { acceptance: generated.acceptance, summary: generated.summary });
      return project ? res.status(201).json(payload(project, userFrom(res).id)) : next(new Error("project create failed"));
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
      const generated = normalizedGeneration(
        await withGenerationSlot(() => generate(parsed.data.prompt, project.code)),
        parsed.data.prompt,
      );
      const updated = projectRepository.update(project.id, parsed.data.prompt, generated.code, userFrom(res).id, {
        operationType: "modify",
        summary: generated.summary,
        acceptance: generated.acceptance,
      });
      return updated ? res.json(payload(updated, userFrom(res).id)) : next(new Error("project update failed"));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/projects/:id/repair", generationRateLimit, async (req, res, next) => {
    const parsed = repairSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const ownerId = userFrom(res).id;
    const project = projectRepository.get(String(req.params.id), ownerId);
    if (!project) return res.status(404).json({ error: "项目不存在或已被删除。" });
    const currentItems = acceptanceRepository.list(project.id, project.current_version, ownerId);
    const selected = currentItems.filter((item) => parsed.data.acceptanceItemIds.includes(item.id));
    if (selected.length !== parsed.data.acceptanceItemIds.length || selected.some((item) => item.status !== "failed")) {
      return res.status(400).json({ error: "只能提交当前版本中已标记为失败的验收项。" });
    }
    const repairPrompt = [
      "请修复以下人工验收发现的问题，不要删减其他已有功能：",
      ...selected.map((item, index) => [
        `${index + 1}. 操作：${item.title}`,
        `   预期：${item.expected_result}`,
        `   实际问题：${item.issue_description || "用户确认未达到预期"}`,
      ].join("\n")),
    ].join("\n");
    try {
      const generated = normalizedGeneration(
        await withGenerationSlot(() => generate(repairPrompt, project.code)),
        repairPrompt,
      );
      const applicable = currentItems.map((item) => ({ title: item.title, expected: item.expected_result }));
      const seen = new Set(applicable.map((item) => `${item.title}\n${item.expected}`));
      for (const item of generated.acceptance) {
        const key = `${item.title}\n${item.expected}`;
        if (!seen.has(key)) { applicable.push(item); seen.add(key); }
      }
      const updated = projectRepository.update(project.id, repairPrompt, generated.code, ownerId, {
        operationType: "repair",
        summary: generated.summary || `修复 ${selected.length} 个验收问题`,
        acceptance: applicable.slice(0, 20),
      });
      return updated ? res.json(payload(updated, ownerId)) : next(new Error("project repair failed"));
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/projects/:id", (req, res) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const renamed = projectRepository.rename(String(req.params.id), parsed.data.name, userFrom(res).id);
    if (!renamed) return res.status(404).json({ error: "项目不存在或已被删除。" });
    return res.json(payload(renamed, userFrom(res).id));
  });

  app.post("/api/projects/:id/versions/:versionNo/acceptance", (req, res) => {
    const parsed = acceptanceCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const versionNo = Number(req.params.versionNo);
    const item = acceptanceRepository.add(
      String(req.params.id), versionNo, userFrom(res).id, parsed.data.title, parsed.data.expected,
    );
    if (!item) return res.status(404).json({ error: "版本不存在或无权访问。" });
    return res.status(201).json({ item });
  });

  app.patch("/api/projects/:id/versions/:versionNo/acceptance/:itemId", (req, res) => {
    const parsed = acceptanceUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const item = acceptanceRepository.update(
      String(req.params.id), Number(req.params.versionNo), String(req.params.itemId), userFrom(res).id,
      { ...parsed.data, status: parsed.data.status as AcceptanceStatus },
    );
    if (!item) return res.status(404).json({ error: "验收项不存在或无权访问。" });
    return res.json({ item });
  });

  app.delete("/api/projects/:id/versions/:versionNo/acceptance/:itemId", (req, res) => {
    const removed = acceptanceRepository.delete(
      String(req.params.id), Number(req.params.versionNo), String(req.params.itemId), userFrom(res).id,
    );
    return removed ? res.status(204).send() : res.status(404).json({ error: "验收项不存在或无权访问。" });
  });

  app.post("/api/projects/:id/restore", (req, res) => {
    const project = projectRepository.get(String(req.params.id), userFrom(res).id);
    if (!project) return res.status(404).json({ error: "项目不存在或已被删除。" });
    const parsed = restoreSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: validationMessage(parsed.error) });
    const target = parsed.data.versionNo ?? project.current_version - 1;
    if (target < 1 || target === project.current_version) {
      return res.status(409).json({ error: "请选择其他历史版本进行恢复。" });
    }
    const restored = projectRepository.restore(project.id, target, userFrom(res).id);
    if (!restored) return res.status(404).json({ error: "目标历史版本不存在。" });
    return res.json(payload(restored, userFrom(res).id));
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
