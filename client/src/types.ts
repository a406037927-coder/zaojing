export interface ProjectSummary {
  id: string;
  name: string;
  prompt: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface Project extends ProjectSummary {
  code: string;
  original_prompt: string;
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  version_no: number;
  prompt: string;
  operation_type: "generate" | "modify" | "repair" | "restore";
  change_summary: string;
  created_at: string;
}

export interface ProjectVersionDetail extends ProjectVersion {
  code: string;
}

export interface AcceptanceItem {
  id: string;
  project_id: string;
  version_no: number;
  title: string;
  expected_result: string;
  status: "unchecked" | "passed" | "failed";
  issue_description: string;
  source: "ai" | "user";
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectPayload {
  project: Project;
  versions: ProjectVersion[];
  acceptance: AcceptanceItem[];
}

export interface VersionPayload {
  version: ProjectVersionDetail;
  acceptance: AcceptanceItem[];
}

export interface User {
  id: string;
  username: string;
  created_at: string;
}
