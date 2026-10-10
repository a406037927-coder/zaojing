import * as React from "react";
import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import type { Project, ProjectVersion } from "../types";

export const examples = [
  { title: "待办清单", text: "生成一个可以添加、删除、完成和按状态筛选任务的待办清单，界面简洁，显示完成进度。" },
  { title: "记账工具", text: "生成一个个人记账工具，可以添加收支、选择分类、查看余额和分类统计，并支持删除记录。" },
  { title: "运维巡检", text: "生成一个运维巡检记录工具，可以登记服务器、巡检状态、问题描述和负责人，并按状态筛选。" },
];

interface Props {
  project: Project | null;
  versions: ProjectVersion[];
  aiConfigured: boolean | null;
  busy: boolean;
  onGenerate: (prompt: string) => Promise<void>;
  onModify: (prompt: string) => Promise<void>;
  onRestore: () => Promise<void>;
}

export function Composer({ project, versions, aiConfigured, busy, onGenerate, onModify, onRestore }: Props) {
  const [prompt, setPrompt] = React.useState("");
  const [modification, setModification] = React.useState("");

  const generate = async () => {
    await onGenerate(prompt);
    setPrompt("");
  };
  const modify = async () => {
    await onModify(modification);
    setModification("");
  };

  return (
    <main className="composer-panel">
      <div className="composer-intro">
        <h1>把想法变成可运行的应用</h1>
        <p>描述你需要的功能，AI 会生成完整、自包含的 HTML、CSS 和 JavaScript。</p>
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
          id="prompt"
          value={prompt}
          maxLength={4000}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="例如：生成一个可以添加、删除和筛选任务的待办清单…"
          disabled={busy}
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
        <Sparkles size={17} />{busy ? "正在生成，请稍候…" : "生成应用"}
      </button>

      {project ? (
        <section className="modify-section">
          <div className="section-heading">
            <div>
              <span>当前项目</span>
              <strong>{project.name}</strong>
            </div>
            <button className="secondary-button" onClick={onRestore} disabled={busy || project.current_version <= 1}>
              <RotateCcw size={15} />恢复上一版本
            </button>
          </div>
          <div className="version-line"><span className="status-dot" />当前为 v{project.current_version} · 共 {versions.length} 个生成版本</div>
          <label className="field-label" htmlFor="modification">继续修改</label>
          <div className="textarea-shell compact">
            <textarea
              id="modification"
              value={modification}
              maxLength={2000}
              onChange={(event) => setModification(event.target.value)}
              placeholder="例如：增加分类筛选，并改成深色主题…"
              disabled={busy}
            />
            <span>{modification.length} / 2000</span>
          </div>
          <button className="outline-button" onClick={modify} disabled={busy || !modification.trim()}>
            <Sparkles size={16} />继续修改
          </button>
        </section>
      ) : null}
    </main>
  );
}
