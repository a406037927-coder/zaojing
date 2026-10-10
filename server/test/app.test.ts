import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { extractAndValidateHtml } from "../src/ai.js";
import { projectRepository } from "../src/db.js";
import { resetGuardsForTests } from "../src/guards.js";

const createdIds = new Set<string>();

const page = (label: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>button{padding:8px}</style></head>
<body><h1>${label}</h1><button id="add">添加</button><p id="count">0</p>
<script>let count=0;document.querySelector('#add').addEventListener('click',()=>{document.querySelector('#count').textContent=String(++count)})</script>
</body></html>`;

beforeEach(() => resetGuardsForTests());

afterEach(() => {
  for (const id of createdIds) projectRepository.delete(id);
  createdIds.clear();
});

describe("projects API", () => {
  it("generates, lists, modifies, restores and deletes a persisted project", async () => {
    let generation = 0;
    const app = createApp({ generate: async () => page(`版本 ${++generation}`) });

    const generated = await request(app)
      .post("/api/projects/generate")
      .send({ prompt: "生成一个可添加任务的待办清单" })
      .expect(201);

    const id = generated.body.project.id as string;
    createdIds.add(id);
    expect(generated.body.project.current_version).toBe(1);
    expect(generated.body.project.code).toContain("版本 1");

    const listed = await request(app).get("/api/projects").expect(200);
    expect(listed.body.projects.some((item: { id: string }) => item.id === id)).toBe(true);

    const reopened = await request(app).get(`/api/projects/${id}`).expect(200);
    expect(reopened.body.versions).toHaveLength(1);

    const modified = await request(app)
      .post(`/api/projects/${id}/modify`)
      .send({ prompt: "增加深色主题" })
      .expect(200);
    expect(modified.body.project.current_version).toBe(2);
    expect(modified.body.project.code).toContain("版本 2");

    const restored = await request(app).post(`/api/projects/${id}/restore`).expect(200);
    expect(restored.body.project.current_version).toBe(1);
    expect(restored.body.project.code).toContain("版本 1");

    await request(app).delete(`/api/projects/${id}`).expect(204);
    createdIds.delete(id);
    await request(app).get(`/api/projects/${id}`).expect(404);
  });

  it("keeps the current version when a modification fails", async () => {
    const goodApp = createApp({ generate: async () => page("稳定版本") });
    const generated = await request(goodApp)
      .post("/api/projects/generate")
      .send({ prompt: "生成巡检记录工具" })
      .expect(201);
    const id = generated.body.project.id as string;
    createdIds.add(id);

    const failingApp = createApp({ generate: async () => { throw new Error("provider down"); } });
    await request(failingApp)
      .post(`/api/projects/${id}/modify`)
      .send({ prompt: "改成深色主题" })
      .expect(500);

    const project = await request(goodApp).get(`/api/projects/${id}`).expect(200);
    expect(project.body.project.current_version).toBe(1);
    expect(project.body.project.code).toContain("稳定版本");
  });

  it("returns clear validation errors", async () => {
    const app = createApp({ generate: async () => page("unused") });
    const empty = await request(app).post("/api/projects/generate").send({ prompt: "   " }).expect(400);
    expect(empty.body.error).toContain("请输入");

    const tooLong = await request(app)
      .post("/api/projects/generate")
      .send({ prompt: "x".repeat(4001) })
      .expect(400);
    expect(tooLong.body.error).toContain("4000");
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
  });
});
