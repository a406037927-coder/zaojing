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
}

export interface ProjectVersion {
  id: string;
  project_id: string;
  version_no: number;
  prompt: string;
  created_at: string;
}

export interface ProjectPayload {
  project: Project;
  versions: ProjectVersion[];
}
