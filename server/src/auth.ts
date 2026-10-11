import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { sessionRepository, userRepository, type UserRow } from "./db.js";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "zaojing_session";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(req: Request) {
  const cookies = (req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return "";
}

export async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(password: string, user: UserRow) {
  const derived = await scrypt(password, user.password_salt, 64) as Buffer;
  const expected = Buffer.from(user.password_hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function publicUser(user: UserRow) {
  return { id: user.id, username: user.username, created_at: user.created_at };
}

export function startSession(res: Response, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const maxAge = config.sessionDays * 24 * 60 * 60 * 1000;
  sessionRepository.create(tokenHash(token), userId, new Date(Date.now() + maxAge).toISOString());
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    maxAge,
    path: "/",
  });
}

export function endSession(req: Request, res: Response) {
  const token = readCookie(req);
  if (token) sessionRepository.delete(tokenHash(token));
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/" });
}

export function currentUser(req: Request) {
  const token = readCookie(req);
  return token ? sessionRepository.getUser(tokenHash(token)) : undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先注册或登录后再使用。", code: "AUTH_REQUIRED" });
  res.locals.user = user;
  next();
}
