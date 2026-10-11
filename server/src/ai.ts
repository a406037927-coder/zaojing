import { config, isAiConfigured } from "./config.js";

const CODE_FENCE = /```(?:html)?\s*([\s\S]*?)```/i;
const META_BLOCK = /<!--\s*ZAOJING_META\s*([\s\S]*?)-->/i;
const MAX_HTML_BYTES = 1_000_000;

export interface GeneratedAcceptanceItem {
  title: string;
  expected: string;
}

export interface AiGenerationResult {
  code: string;
  acceptance: GeneratedAcceptanceItem[];
  summary: string;
}

const outputContract = `在 </html> 后追加下面格式的元数据注释，JSON 必须有效：
<!-- ZAOJING_META
{"summary":"不超过60字的本次实现说明","acceptance":[{"title":"具体操作","expected":"可观察的预期结果"}]}
-->
acceptance 必须有 3–6 项，必须描述用户可以亲手执行的操作和肉眼可确认的结果；它们只是待验收清单，不能声称已经测试通过。`;

const baseInstructions = `你是一名资深前端工程师和产品设计师。请根据用户需求生成一个完整、可运行、可交互的单页 Web 应用。

硬性要求：
1. 仅返回完整 HTML 文档和指定的 ZAOJING_META 注释，不要解释，不要使用 Markdown 代码围栏。
2. 必须包含 <!doctype html>、内联 CSS 和原生 JavaScript；不得引用外部脚本、样式、字体、图片或 API。若需求指定 Matter.js 等外部库，请使用原生 Canvas/JavaScript 实现等价核心体验，不要内联第三方库源码。
3. 应用必须真实可操作，按钮、添加、删除、筛选、表单和游戏控制等不能只是装饰。
4. 使用语义化 HTML、响应式布局、清晰的中文界面和无障碍标签。
5. 数据只需保存在页面运行期间的内存中，不要依赖 localStorage、cookie、IndexedDB 或联网请求。
6. 不使用 eval、new Function、iframe、object、embed、window.open 或顶层导航。
7. 所有业务 ID 必须使用 crypto.randomUUID() 生成字符串；dataset 读取结果也是字符串，不得用 parseInt 处理 ID。
8. 每次新增、删除、修改、筛选后都必须重新渲染相关列表与统计数据；提交前逐项检查所有可见按钮确实绑定事件。
9. 不要生成 React/Vue 源码；直接生成浏览器可以执行的 HTML/CSS/JavaScript。

${outputContract}`;

const reviewInstructions = `你是一名严格的前端代码审查工程师。请审查下面的完整 HTML，并直接返回修复后的完整 HTML 文档和 ZAOJING_META 注释，不要解释，不要使用 Markdown 围栏。

必须逐项检查并修复：
1. 所有按钮、表单、添加、删除、编辑、筛选、切换、游戏控制和重置操作都有真实事件处理。
2. 状态改变后立即重新渲染列表、汇总和可见结果；动画循环不会因异常静默停止。
3. ID 一律使用 crypto.randomUUID() 字符串；dataset 值按字符串比较，禁止 parseInt 处理 ID。
4. 禁止 localStorage、sessionStorage、IndexedDB、cookie、联网请求及外部资源；数据仅保存在内存。
5. 禁止 eval、new Function、iframe、object、embed、window.open 和顶层导航。
6. 保持原需求、现有功能、中文界面和响应式样式，不要删减功能。
7. 更新验收清单，使其覆盖当前版本最重要的 3–6 个真实交互。

${outputContract}`;

export class AiConfigError extends Error {}
export class AiResponseError extends Error {}

export function extractAndValidateHtml(raw: string) {
  const fenced = raw.match(CODE_FENCE)?.[1];
  let html = (fenced || raw).trim();
  const doctypeIndex = html.toLowerCase().indexOf("<!doctype html");
  const htmlIndex = html.toLowerCase().indexOf("<html");
  const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
  if (start > 0) html = html.slice(start);
  const closingIndex = html.toLowerCase().lastIndexOf("</html>");
  if (closingIndex >= 0) html = html.slice(0, closingIndex + 7);

  if (!/^\s*(?:<!doctype html[^>]*>\s*)?<html[\s>]/i.test(html)) {
    throw new AiResponseError("模型未返回完整的 HTML 文档，请重试并换一种描述方式。");
  }
  if (!/<body[\s>][\s\S]*<\/body>/i.test(html)) {
    throw new AiResponseError("模型返回的 HTML 缺少完整 body，已拒绝保存。");
  }
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    throw new AiResponseError("模型输出过大，已超过 1 MB 安全限制。");
  }
  const forbidden = [
    /<script\b[^>]*\bsrc\s*=/i,
    /<link\b[^>]*\bhref\s*=\s*["']?https?:/i,
    /<(?:iframe|object|embed)\b/i,
    /\b(?:eval|new\s+Function)\s*\(/i,
    /\bwindow\.open\s*\(/i,
    /\b(?:localStorage|sessionStorage|indexedDB)\b/i,
    /\bdocument\.cookie\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(html))) {
    throw new AiResponseError("模型输出包含外部资源或受限制的执行方式，请重试。");
  }
  return html;
}

function fallbackAcceptance(prompt: string): GeneratedAcceptanceItem[] {
  const subject = prompt.replace(/\s+/g, " ").slice(0, 80);
  return [
    { title: "打开应用并检查主要界面", expected: "页面完整显示，核心内容和主要操作入口清晰可见。" },
    { title: `执行核心操作：${subject}`, expected: "操作产生可观察的结果，页面状态和相关统计同步更新。" },
    { title: "连续操作并切换不同状态", expected: "所有可见按钮均有响应，页面不会报错或丢失当前数据。" },
  ];
}

export function extractGenerationResult(raw: string, prompt: string): AiGenerationResult {
  const code = extractAndValidateHtml(raw);
  const metaText = raw.match(META_BLOCK)?.[1]?.trim();
  let summary = "生成可交互应用";
  let acceptance = fallbackAcceptance(prompt);
  if (metaText) {
    try {
      const meta = JSON.parse(metaText) as { summary?: unknown; acceptance?: unknown };
      if (typeof meta.summary === "string" && meta.summary.trim()) summary = meta.summary.trim().slice(0, 200);
      if (Array.isArray(meta.acceptance)) {
        const parsed = meta.acceptance.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const title = "title" in item && typeof item.title === "string" ? item.title.trim() : "";
          const expected = "expected" in item && typeof item.expected === "string" ? item.expected.trim() : "";
          return title && expected ? [{ title: title.slice(0, 200), expected: expected.slice(0, 500) }] : [];
        }).slice(0, 6);
        if (parsed.length >= 3) acceptance = parsed;
      }
    } catch {
      // Keep deterministic unchecked items instead of adding another model request.
    }
  }
  return { code, acceptance, summary };
}

function endpoint() {
  if (/\/chat\/completions$/i.test(config.aiBaseUrl)) return config.aiBaseUrl;
  return `${config.aiBaseUrl}/chat/completions`;
}

async function readStreamingContent(response: Response) {
  if (!response.body) throw new AiResponseError("模型接口未返回响应内容。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
        content += event.choices?.[0]?.delta?.content || event.choices?.[0]?.message?.content || "";
      } catch {
        // Ignore provider-specific bookkeeping events.
      }
    }
    if (done) break;
  }
  return content;
}

async function requestCompletion(userContent: string, phase: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.aiKey}` },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: "system", content: baseInstructions },
          { role: "user", content: userContent },
        ],
        temperature: 0.25,
        max_tokens: config.aiMaxOutputTokens,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      const safeReason = body.slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
      throw new AiResponseError(`模型接口请求失败（HTTP ${response.status}）：${safeReason || "请检查服务配置"}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const content = contentType.includes("text/event-stream")
      ? await readStreamingContent(response)
      : ((await response.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || "";
    if (!content) throw new AiResponseError("模型接口未返回有效内容。");
    return content;
  } catch (error) {
    if (error instanceof AiResponseError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiResponseError(`${phase}超过 ${Math.round(config.aiTimeoutMs / 1000)} 秒，已停止等待；原有版本未被覆盖。`);
    }
    throw new AiResponseError("无法连接模型服务，请检查 API 地址、网络或模型名称。");
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateApplication(prompt: string, existingCode?: string): Promise<AiGenerationResult> {
  if (!isAiConfigured()) {
    throw new AiConfigError(
      "AI 服务尚未配置。请在服务端 .env 中设置 AI_API_BASE_URL、AI_API_KEY 和 AI_MODEL，然后重启服务。",
    );
  }
  const userContent = existingCode
    ? `这是当前可用版本：\n\n${existingCode}\n\n修改或修复需求：${prompt}\n\n请返回修改后的完整 HTML，保留原有可用功能。`
    : `应用需求：${prompt}`;
  const draft = await requestCompletion(userContent, "首次生成");
  const reviewed = await requestCompletion(
    `${reviewInstructions}\n\n原始需求：${prompt}\n\n待审查代码：\n${draft.slice(0, 250_000)}`,
    "代码审查",
  );
  return extractGenerationResult(reviewed, prompt);
}
