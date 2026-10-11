import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { extractAndValidateHtml } from "../src/ai.js";
import { db, projectRepository } from "../src/db.js";
import { resetGuardsForTests } from "../src/guards.js";

const createdIds = new Set<string>();
const createdUserIds = new Set<string>();

async function register(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/register").send({
    username: `user-${crypto.randomUUID().slice(0, 12)}`,
    password: "TestPass123!",
  }).expect(201);
  createdUserIds.add(response.body.user.id as string);
  const cookie = (response.headers["set-cookie"] as unknown as string[])[0]?.split(";")[0] || "";
  return { agent, cookie };
}

const page = (label: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>button{padding:8px}</style></head>
<body><h1>${label}</h1><button id="add">添加</button><p id="count">0</p>
<script>let count=0;document.querySelector('#add').addEventListener('click',()=>{document.querySelector('#count').textContent=String(++count)})</script>
</body></html>`;

beforeEach(() => resetGuardsForTests());

afterEach(() => {
  for (const id of createdIds) projectRepository.delete(id);
  createdIds.clear();
  for (const id of createdUserIds) db.prepare("DELETE FROM users WHERE id = ?").run(id);
  createdUserIds.clear();
});

describe("projects API", () => {
  it("generates, lists, modifies, restores and deletes a persisted project", async () => {
    let generation = 0;
    const app = createApp({ generate: async () => page(`版本 ${++generation}`) });
    const { agent } = await register(app);

    const generated = await agent
      .post("/api/projects/generate")
      .send({ prompt: "生成一个可添加任务的待办清单" })
      .expect(201);

    const id = generated.body.project.id as string;
    createdIds.add(id);
    expect(generated.body.project.current_version).toBe(1);
    expect(generated.body.project.code).toContain("版本 1");

    const listed = await agent.get("/api/projects").expect(200);
    expect(listed.body.projects.some((item: { id: string }) => item.id === id)).toBe(true);

    const reopened = await agent.get(`/api/projects/${id}`).expect(200);
    expect(reopened.body.versions).toHaveLength(1);

    const modified = await agent
      .post(`/api/projects/${id}/modify`)
      .send({ prompt: "增加深色主题" })
      .expect(200);
    expect(modified.body.project.current_version).toBe(2);
    expect(modified.body.project.code).toContain("版本 2");

    const restored = await agent.post(`/api/projects/${id}/restore`).expect(200);
    expect(restored.body.project.current_version).toBe(1);
    expect(restored.body.project.code).toContain("版本 1");

    await agent.delete(`/api/projects/${id}`).expect(204);
    createdIds.delete(id);
    await agent.get(`/api/projects/${id}`).expect(404);
  });

  it("keeps the current version when a modification fails", async () => {
    const goodApp = createApp({ generate: async () => page("稳定版本") });
    const { agent, cookie } = await register(goodApp);
    const generated = await agent
      .post("/api/projects/generate")
      .send({ prompt: "生成巡检记录工具" })
      .expect(201);
    const id = generated.body.project.id as string;
    createdIds.add(id);

    const failingApp = createApp({ generate: async () => { throw new Error("provider down"); } });
    await request(failingApp)
      .post(`/api/projects/${id}/modify`)
      .set("Cookie", cookie)
      .send({ prompt: "改成深色主题" })
      .expect(500);

    const project = await agent.get(`/api/projects/${id}`).expect(200);
    expect(project.body.project.current_version).toBe(1);
    expect(project.body.project.code).toContain("稳定版本");
  });

  it("returns clear validation errors", async () => {
    const app = createApp({ generate: async () => page("unused") });
    const { agent } = await register(app);
    const empty = await agent.post("/api/projects/generate").send({ prompt: "   " }).expect(400);
    expect(empty.body.error).toContain("请输入");

    const tooLong = await agent
      .post("/api/projects/generate")
      .send({ prompt: "x".repeat(4001) })
      .expect(400);
    expect(tooLong.body.error).toContain("4000");
  });

  it("requires authentication and isolates project access", async () => {
    const app = createApp({ generate: async () => page("私有项目") });
    await request(app).get("/api/projects").expect(401);
    const first = await register(app);
    const second = await register(app);
    const generated = await first.agent.post("/api/projects/generate").send({ prompt: "私有应用" }).expect(201);
    createdIds.add(generated.body.project.id as string);
    await second.agent.get(`/api/projects/${generated.body.project.id}`).expect(404);
  });
});

describe("AI response validation", () => {
  it("extracts HTML from a markdown fence", () => {
    expect(extractAndValidateHtml(`说明文字\n\`\`\`html\n${page("围栏") }\n\`\`\``)).toContain("围栏");
  });

  it("rejects external scripts and malformed output", () => {
    expect(() => extractAndValidateHtml("not html")).toThrow("完整的 HTML");
    expect(() => extractAndValidateHtml("<html><body><script src='https://evil.example/x.js'></script></body></html>"))
      .toThrow("受限制");
    expect(() => extractAndValidateHtml(page("存储").replace("let count=0", "let count=localStorage.length")))
      .toThrow("受限制");
  });
});
