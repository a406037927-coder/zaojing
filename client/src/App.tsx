import * as React from "react";
import { AlertCircle, CheckCircle2, LogOut, X } from "lucide-react";
import { api } from "./api";
import { Brand } from "./components/Brand";
import { AuthScreen } from "./components/AuthScreen";
import { Composer } from "./components/Composer";
import { HistorySidebar } from "./components/HistorySidebar";
import { PreviewPanel } from "./components/PreviewPanel";
import type {
  AcceptanceItem, Project, ProjectSummary, ProjectVersion, ProjectVersionDetail, User,
} from "./types";

type Notice = { type: "success" | "error"; message: string } | null;
type HistoricalView = { version: ProjectVersionDetail; acceptance: AcceptanceItem[] } | null;

export function App() {
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [project, setProject] = React.useState<Project | null>(null);
  const [versions, setVersions] = React.useState<ProjectVersion[]>([]);
  const [acceptance, setAcceptance] = React.useState<AcceptanceItem[]>([]);
  const [historicalView, setHistoricalView] = React.useState<HistoricalView>(null);
  const [busy, setBusy] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [loadingHistory, setLoadingHistory] = React.useState(true);
  const [aiConfigured, setAiConfigured] = React.useState<boolean | null>(null);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [user, setUser] = React.useState<User | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);

  const notify = React.useCallback((message: string, type: "success" | "error" = "success") => {
    setNotice({ message, type });
  }, []);

  const refreshProjects = React.useCallback(async () => {
    const result = await api.listProjects();
    setProjects(result.projects);
  }, []);

  React.useEffect(() => {
    Promise.all([api.me(), api.health()])
      .then(async ([auth, health]) => {
        setUser(auth.user);
        setAiConfigured(health.aiConfigured);
        if (auth.user) await refreshProjects();
      })
      .catch((error: Error) => notify(error.message, "error"))
      .finally(() => { setLoadingHistory(false); setAuthLoading(false); });
  }, [notify, refreshProjects]);

  React.useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  React.useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsedSeconds(0);
    const interval = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [busy]);

  const applyPayload = React.useCallback((result: {
    project: Project;
    versions: ProjectVersion[];
    acceptance: AcceptanceItem[];
  }) => {
    setProject(result.project);
    setVersions(result.versions);
    setAcceptance(result.acceptance);
    setHistoricalView(null);
  }, []);

  const selectProject = async (id: string) => {
    try {
      applyPayload(await api.getProject(id));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const run = async (action: () => ReturnType<typeof api.generate>, successMessage: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      applyPayload(result);
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
    if (!prompt.trim()) { notify("请输入应用需求。", "error"); return; }
    await run(() => api.generate(prompt), "应用已生成，请按验收清单人工检查").catch(() => undefined);
  };

  const modify = async (prompt: string) => {
    if (!project || !prompt.trim()) return;
    await run(() => api.modify(project.id, prompt), "修改已生成，新版本需要重新验收").catch(() => undefined);
  };

  const repair = async (ids: string[]) => {
    if (!project || ids.length === 0) return;
    await run(() => api.repair(project.id, ids), "问题修复版本已创建，请重新验收").catch(() => undefined);
  };

  const restore = async (versionNo: number) => {
    if (!project || !window.confirm(`恢复 v${versionNo} 的内容并创建一个新的恢复版本吗？`)) return;
    setBusy(true);
    try {
      const result = await api.restore(project.id, versionNo);
      applyPayload(result);
      await refreshProjects();
      notify(`已基于 v${versionNo} 创建恢复版本 v${result.project.current_version}，请重新验收`);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const viewVersion = async (versionNo: number) => {
    if (!project) return;
    if (versionNo === project.current_version) { setHistoricalView(null); return; }
    try {
      setHistoricalView(await api.getVersion(project.id, versionNo));
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const rename = async (name: string) => {
    if (!project) return;
    try {
      applyPayload(await api.rename(project.id, name));
      await refreshProjects();
      notify("项目名称已更新，未调用模型");
    } catch (error) {
      notify((error as Error).message, "error");
      throw error;
    }
  };

  const addAcceptance = async (title: string, expected: string) => {
    if (!project) return;
    try {
      const result = await api.addAcceptance(project.id, project.current_version, title, expected);
      setAcceptance((current) => [...current, result.item]);
      notify("验收项已添加");
    } catch (error) { notify((error as Error).message, "error"); }
  };

  const updateAcceptance = async (item: AcceptanceItem) => {
    if (!project) return;
    try {
      const result = await api.updateAcceptance(project.id, project.current_version, item);
      setAcceptance((current) => current.map((entry) => entry.id === result.item.id ? result.item : entry));
      notify("验收记录已保存");
    } catch (error) { notify((error as Error).message, "error"); }
  };

  const deleteAcceptance = async (id: string) => {
    if (!project || !window.confirm("确定删除这条验收项吗？")) return;
    try {
      await api.deleteAcceptance(project.id, project.current_version, id);
      setAcceptance((current) => current.filter((item) => item.id !== id));
      notify("验收项已删除");
    } catch (error) { notify((error as Error).message, "error"); }
  };

  const remove = async (target: ProjectSummary) => {
    if (!window.confirm(`确定删除“${target.name}”吗？此操作无法撤销。`)) return;
    try {
      await api.delete(target.id);
      if (project?.id === target.id) {
        setProject(null); setVersions([]); setAcceptance([]); setHistoricalView(null);
      }
      await refreshProjects();
      notify("项目已删除");
    } catch (error) { notify((error as Error).message, "error"); }
  };

  const authenticated = async (nextUser: User) => {
    setUser(nextUser); setLoadingHistory(true);
    try { await refreshProjects(); } finally { setLoadingHistory(false); }
  };

  const logout = async () => {
    await api.logout();
    setUser(null); setProjects([]); setProject(null); setVersions([]); setAcceptance([]); setHistoricalView(null);
  };

  const clearSelection = () => {
    setProject(null); setVersions([]); setAcceptance([]); setHistoricalView(null);
  };

  if (authLoading) return <div className="app-loading"><span className="spinner" /><strong>正在载入造境 AI</strong></div>;
  if (!user) return <AuthScreen aiConfigured={aiConfigured} onAuthenticated={authenticated} />;

  const shownCode = historicalView?.version.code || project?.code || null;
  const shownVersionNo = historicalView?.version.version_no || project?.current_version || null;
  const shownAcceptance = historicalView?.acceptance || acceptance;

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="header-status">
          <span className={`status-dot ${aiConfigured === false ? "warning" : ""}`} />
          {aiConfigured === null ? "正在连接服务" : aiConfigured ? "AI 服务已连接" : "等待配置 AI 服务"}
          <span className="user-name">{user.username}</span>
          <button className="logout-button" onClick={logout} title="退出登录"><LogOut size={15} />退出</button>
        </div>
      </header>
      <div className="workspace">
        <HistorySidebar
          projects={projects} selectedId={project?.id} loading={loadingHistory}
          onSelect={selectProject} onNew={clearSelection} onDelete={remove}
        />
        <Composer
          project={project} versions={versions} selectedVersionNo={shownVersionNo}
          aiConfigured={aiConfigured} busy={busy}
          onGenerate={generate} onModify={modify} onRestore={restore}
          onViewVersion={viewVersion} onRename={rename}
        />
        <PreviewPanel
          project={project} code={shownCode} versionNo={shownVersionNo}
          acceptance={shownAcceptance} isCurrentVersion={!historicalView}
          busy={busy} elapsedSeconds={elapsedSeconds} onNotify={notify}
          onAddAcceptance={addAcceptance} onUpdateAcceptance={updateAcceptance}
          onDeleteAcceptance={deleteAcceptance} onRepair={repair}
        />
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
