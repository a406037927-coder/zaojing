import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");

const asPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: asPositiveInt(process.env.PORT, 3000),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(serverRoot, "..", "data")),
  aiBaseUrl: (process.env.AI_API_BASE_URL || "").replace(/\/$/, ""),
  aiKey: process.env.AI_API_KEY || "",
  aiModel: process.env.AI_MODEL || "",
  aiTimeoutMs: asPositiveInt(process.env.AI_REQUEST_TIMEOUT_MS, 90_000),
  aiMaxOutputTokens: asPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 12_000),
  aiMaxConcurrency: asPositiveInt(process.env.AI_MAX_CONCURRENCY, 2),
  rateLimitPerHour: asPositiveInt(process.env.AI_RATE_LIMIT_PER_HOUR, 20),
  clientDist: path.resolve(serverRoot, "..", "client", "dist"),
};

export const isAiConfigured = () => Boolean(config.aiBaseUrl && config.aiKey && config.aiModel);
