import * as React from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { api } from "./api";
import { Brand } from "./components/Brand";
import { Composer } from "./components/Composer";
import { HistorySidebar } from "./components/HistorySidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import type { Project, ProjectSummary, ProjectVersion } from "./types";

type Notice = { type: "success" | "error"; message: string } | null;

export function App() {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);
  const [versions, setVersions] = React.useState<ProjectVersion[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(true);
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);

  const notify = React.useCallback((message: string, type: "success" | "error" = "success") => {
    setNotice({ message, type });
  }, []);

  const refreshProjects = React.useCallback(async () => {
    const result = await api.listProjects();
    setProjects(result.projects);
  }, []);

  React.useEffect(() => {
    Promise.all([api.listProjects(), api.health()])
      .then(([list, health]) => {
        setProjects(list.projects);
        setAiConfigured(health.aiConfigured);
      })
      .catch((error: Error) => notify(error.message, "error"))
      .finally(() => setLoadingHistory(false));
  }, [notify]);

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectProject = async (id: string) => {
    try {
      const result = await api.getProject(id);
      setProject(result.project);
      setVersions(result.versions);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const run = async (action: () => ReturnType<typeof api.generate>, successMessage: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setProject(result.project);
      setVersions(result.versions);
      await refreshProjects();
      notify(successMessage);
    } catch (error) {
      notify((error as Error).message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const generate = async (prompt: string) => {
    if (!prompt.trim()) {
      notify("请输入应用需求。", "error");
      return;
    }
    await run(() => api.generate(prompt), "应用已生成并保存").catch(() => undefined);
  };

  const modify = async (prompt: string) => {
    if (!project || !prompt.trim()) return;
    await run(() => api.modify(project.id, prompt), "修改已生成，原版本仍可恢复").catch(() => undefined);
  };

  const restore = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const result = await api.restore(project.id);
      setProject(result.project);
      setVersions(result.versions);
      await refreshProjects();
      notify(`已恢复到 v${result.project.current_version}`);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (target: ProjectSummary) => {
    if (!window.confirm(`确定删除“${target.name}”吗？此操作无法撤销。`)) return;
    try {
      await api.delete(target.id);
      if (project?.id === target.id) {
        setProject(null);
        setVersions([]);
      }
      await refreshProjects();
      notify("项目已删除");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="header-status">
          <span className={`status-dot ${aiConfigured === false ? "warning" : ""}`} />
          {aiConfigured === null ? "正在连接服务" : aiConfigured ? "AI 服务已连接" : "等待配置 AI 服务"}
        </div>
      </header>
      <div className="workspace">
        <HistorySidebar
          projects={projects}
          selectedId={project?.id}
          loading={loadingHistory}
          onSelect={selectProject}
          onNew={() => { setProject(null); setVersions([]); }}
          onDelete={remove}
        />
        <Composer
          project={project}
          versions={versions}
          aiConfigured={aiConfigured}
          busy={busy}
          onGenerate={generate}
          onModify={modify}
          onRestore={restore}
        />
        <PreviewPanel project={project} busy={busy} onNotify={notify} />
      </div>
      {notice ? (
        <div className={`toast ${notice.type}`} role="status">
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notice.message}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(null)}><X size={15} /></button>
        </div>
      ) : null}
    </div>
  );
}
