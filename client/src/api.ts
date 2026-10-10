import type { ProjectPayload, ProjectSummary } from "./types";

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: options?.body ? { "content-type": "application/json", ...options.headers } : options?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "请求失败，请稍后重试。" }));
    throw new ApiError(body.error || "请求失败，请稍后重试。", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; aiConfigured: boolean }>("/api/health"),
  listProjects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),
  getProject: (id: string) => request<ProjectPayload>(`/api/projects/${id}`),
  generate: (prompt: string) => request<ProjectPayload>("/api/projects/generate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }),
  modify: (id: string, prompt: string) => request<ProjectPayload>(`/api/projects/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }),
  restore: (id: string) => request<ProjectPayload>(`/api/projects/${id}/restore`, { method: "POST" }),
  delete: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
