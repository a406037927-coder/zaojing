import { config, isAiConfigured } from "./config.js";

const CODE_FENCE = /```(?:html)?\s*([\s\S]*?)```/i;
const MAX_HTML_BYTES = 1_000_000;

const baseInstructions = `你是一名资深前端工程师和产品设计师。请根据用户需求生成一个完整、可运行、可交互的单页 Web 应用。

硬性要求：
1. 仅返回完整 HTML 文档，不要解释，不要使用 Markdown 代码围栏。
2. 必须包含 <!doctype html>、内联 CSS 和原生 JavaScript；不得引用外部脚本、样式、字体、图片或 API。
3. 应用必须真实可操作，按钮、添加、删除、筛选、表单等需求不能只是装饰。
4. 使用语义化 HTML、响应式布局、清晰的中文界面和无障碍标签。
5. 数据只需保存在页面运行期间的内存中，不要依赖 localStorage、cookie、IndexedDB 或联网请求。
6. 不使用 eval、new Function、iframe、object、embed、window.open 或顶层导航。
7. 不要生成 React/Vue 源码；直接生成浏览器可以执行的 HTML/CSS/JavaScript。`;

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
  ];
  if (forbidden.some((pattern) => pattern.test(html))) {
    throw new AiResponseError("模型输出包含外部资源或受限制的执行方式，请重试。");
  }
  return html;
}

function endpoint() {
  if (/\/chat\/completions$/i.test(config.aiBaseUrl)) return config.aiBaseUrl;
  return `${config.aiBaseUrl}/chat/completions`;
}

export async function generateApplication(prompt: string, existingCode?: string) {
  if (!isAiConfigured()) {
    throw new AiConfigError(
      "AI 服务尚未配置。请在服务端 .env 中设置 AI_API_BASE_URL、AI_API_KEY 和 AI_MODEL，然后重启服务。",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);
  const userContent = existingCode
    ? `这是当前可用版本：\n\n${existingCode}\n\n修改需求：${prompt}\n\n请返回修改后的完整 HTML，保留原有可用功能。`
    : `应用需求：${prompt}`;

  try {
    const response = await fetch(endpoint(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.aiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: "system", content: baseInstructions },
          { role: "user", content: userContent },
        ],
        temperature: 0.4,
        max_tokens: config.aiMaxOutputTokens,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      const safeReason = body.slice(0, 300).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");
      throw new AiResponseError(`模型接口请求失败（HTTP ${response.status}）：${safeReason || "请检查服务配置"}`);
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new AiResponseError("模型接口未返回有效内容。");
    return extractAndValidateHtml(content);
  } catch (error) {
    if (error instanceof AiConfigError || error instanceof AiResponseError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AiResponseError(`模型请求超过 ${Math.round(config.aiTimeoutMs / 1000)} 秒，已自动取消。`);
    }
    throw new AiResponseError("无法连接模型服务，请检查 API 地址、网络或模型名称。");
  } finally {
    clearTimeout(timeout);
  }
}
