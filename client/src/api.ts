import type { AcceptanceItem, ProjectPayload, ProjectSummary, User, VersionPayload } from "./types";

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
  me: () => request<{ user: User | null }>("/api/auth/me"),
  register: (username: string, password: string) => request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }),
  login: (username: string, password: string) => request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  listProjects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),
  getProject: (id: string) => request<ProjectPayload>(`/api/projects/${id}`),
  getVersion: (id: string, versionNo: number) => request<VersionPayload>(`/api/projects/${id}/versions/${versionNo}`),
  generate: (prompt: string) => request<ProjectPayload>("/api/projects/generate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }),
  modify: (id: string, prompt: string) => request<ProjectPayload>(`/api/projects/${id}/modify`, {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }),
  repair: (id: string, acceptanceItemIds: string[]) => request<ProjectPayload>(`/api/projects/${id}/repair`, {
    method: "POST",
    body: JSON.stringify({ acceptanceItemIds }),
  }),
  rename: (id: string, name: string) => request<ProjectPayload>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  }),
  restore: (id: string, versionNo?: number) => request<ProjectPayload>(`/api/projects/${id}/restore`, {
    method: "POST",
    body: JSON.stringify(versionNo ? { versionNo } : {}),
  }),
  addAcceptance: (id: string, versionNo: number, title: string, expected: string) =>
    request<{ item: AcceptanceItem }>(`/api/projects/${id}/versions/${versionNo}/acceptance`, {
      method: "POST", body: JSON.stringify({ title, expected }),
    }),
  updateAcceptance: (id: string, versionNo: number, item: AcceptanceItem) =>
    request<{ item: AcceptanceItem }>(`/api/projects/${id}/versions/${versionNo}/acceptance/${item.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: item.title,
        expected: item.expected_result,
        status: item.status,
        issueDescription: item.issue_description,
      }),
    }),
  deleteAcceptance: (id: string, versionNo: number, itemId: string) =>
    request<void>(`/api/projects/${id}/versions/${versionNo}/acceptance/${itemId}`, { method: "DELETE" }),
  delete: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
