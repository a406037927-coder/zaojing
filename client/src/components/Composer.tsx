import * as React from "react";
import { ArrowRight, Eye, Pencil, RotateCcw, Sparkles } from "lucide-react";
import type { Project, ProjectVersion } from "../types";

export const examples = [
  { title: "待办清单", text: "生成一个可以添加、删除、完成和按状态筛选任务的待办清单，界面简洁，显示完成进度。" },
  { title: "记账工具", text: "生成一个个人记账工具，可以添加收支、选择分类、查看余额和分类统计，并支持删除记录。" },
  { title: "运维巡检", text: "生成一个运维巡检记录工具，可以登记服务器、巡检状态、问题描述和负责人，并按状态筛选。" },
];

const operationLabels: Record<ProjectVersion["operation_type"], string> = {
  generate: "首次生成",
  modify: "普通修改",
  repair: "问题修复",
  restore: "版本恢复",
};

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

interface Props {
  project: Project | null;
  versions: ProjectVersion[];
  selectedVersionNo: number | null;
  aiConfigured: boolean | null;
  busy: boolean;
  onGenerate: (prompt: string) => Promise<void>;
  onModify: (prompt: string) => Promise<void>;
  onRestore: (versionNo: number) => Promise<void>;
  onViewVersion: (versionNo: number) => Promise<void>;
  onRename: (name: string) => Promise<void>;
}

export function Composer({
  project, versions, selectedVersionNo, aiConfigured, busy,
  onGenerate, onModify, onRestore, onViewVersion, onRename,
}: Props) {
  const [prompt, setPrompt] = React.useState("");
  const [modification, setModification] = React.useState("");
  const [name, setName] = React.useState(project?.name || "");
  const [renaming, setRenaming] = React.useState(false);

  React.useEffect(() => { setName(project?.name || ""); setRenaming(false); }, [project?.id, project?.name]);

  const generate = async () => {
    await onGenerate(prompt);
    setPrompt("");
  };
  const modify = async () => {
    await onModify(modification);
    setModification("");
  };
  const saveName = async () => {
    if (!name.trim() || name.trim() === project?.name) { setRenaming(false); return; }
    await onRename(name.trim());
    setRenaming(false);
  };

  return (
    <main className="composer-panel">
      <div className="composer-intro">
        <span className="composer-kicker">创建新项目</span>
        <h1>把想法变成可运行的应用</h1>
        <p>这里始终用于新建应用；下方“继续修改”只作用于当前选中的项目。</p>
      </div>

      {aiConfigured === false ? (
        <div className="config-alert" role="status">
          <strong>AI 服务尚未配置</strong>
          <span>请在服务端 .env 中设置 AI_API_BASE_URL、AI_API_KEY 和 AI_MODEL。</span>
        </div>
      ) : null}

      <label className="field-label" htmlFor="prompt">应用需求</label>
      <div className="textarea-shell">
        <textarea
          id="prompt" value={prompt} maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：生成一个可以添加、删除和筛选任务的待办清单…" disabled={busy}
        />
        <span>{prompt.length} / 4000</span>
      </div>

      <div className="example-section">
        <span className="field-label">试试这些需求</span>
        <div className="example-list">
          {examples.map((example) => (
            <button key={example.title} onClick={() => setPrompt(example.text)} disabled={busy}>
              <span>{example.title}</span><ArrowRight size={15} />
            </button>
          ))}
        </div>
      </div>

      <button className="primary-button" onClick={generate} disabled={busy || !prompt.trim()}>
        <Sparkles size={17} />{busy ? "已有生成任务进行中" : "生成新应用"}
      </button>

      {project ? (
        <section className="modify-section">
          <div className="section-heading project-heading">
            <div>
              <span>当前操作对象</span>
              {renaming ? (
                <div className="rename-row">
                  <input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} autoFocus />
                  <button onClick={saveName} disabled={busy}>保存</button>
                </div>
              ) : (
                <strong>{project.name}<button className="rename-button" onClick={() => setRenaming(true)} aria-label="重命名项目"><Pencil size={13} /></button></strong>
              )}
            </div>
          </div>
          <details className="project-requirement">
            <summary>查看完整原始需求</summary>
            <p>{project.original_prompt || project.prompt}</p>
          </details>
          <div className="version-line"><span className="status-dot" />当前成果为 v{project.current_version} · 共 {versions.length} 个版本</div>

          <label className="field-label" htmlFor="modification">继续修改“{project.name}”</label>
          <div className="textarea-shell compact">
            <textarea
              id="modification" value={modification} maxLength={2000}
              onChange={(event) => setModification(event.target.value)}
              placeholder="例如：增加分类筛选，并改成深色主题…" disabled={busy}
            />
            <span>{modification.length} / 2000</span>
          </div>
          <button className="outline-button" onClick={modify} disabled={busy || !modification.trim()}>
            <Sparkles size={16} />继续修改当前项目
          </button>

          <div className="version-history">
            <div className="field-label">版本记录</div>
            {versions.map((version) => (
              <article className={selectedVersionNo === version.version_no ? "is-selected" : ""} key={version.id}>
                <button className="version-view" onClick={() => onViewVersion(version.version_no)} disabled={busy}>
                  <Eye size={14} />
                  <span><strong>v{version.version_no} · {operationLabels[version.operation_type]}</strong><small>{formatDate(version.created_at)} · {version.change_summary || "未填写说明"}</small></span>
                </button>
                {version.version_no !== project.current_version ? (
                  <button className="version-restore" onClick={() => onRestore(version.version_no)} disabled={busy} title={`恢复 v${version.version_no}`}>
                    <RotateCcw size={14} />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
