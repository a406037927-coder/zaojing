import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

type WindowEntry = { count: number; resetAt: number };
const windows = new Map<string, WindowEntry>();
let activeGenerations = 0;

export function generationRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = req.ip || "unknown";
  const current = windows.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + 60 * 60 * 1000 }
    : current;
  entry.count += 1;
  windows.set(key, entry);
  res.setHeader("X-RateLimit-Limit", config.rateLimitPerHour);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, config.rateLimitPerHour - entry.count));
  if (entry.count > config.rateLimitPerHour) {
    res.status(429).json({ error: "生成请求过于频繁，请稍后再试。" });
    return;
  }
  next();
}

export async function withGenerationSlot<T>(task: () => Promise<T>) {
  if (activeGenerations >= config.aiMaxConcurrency) {
    const error = new Error("当前生成任务已达并发上限，请稍后再试。");
    error.name = "ConcurrencyLimitError";
    throw error;
  }
  activeGenerations += 1;
  try {
    return await task();
  } finally {
    activeGenerations -= 1;
  }
}

export function resetGuardsForTests() {
  windows.clear();
  activeGenerations = 0;
}
