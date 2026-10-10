import * as React from "react";
import { Clock3, Plus, Search, Trash2 } from "lucide-react";
import type { ProjectSummary } from "../types";

interface Props {
  projects: ProjectSummary[];
  selectedId?: string;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (project: ProjectSummary) => void;
}

const formatDate = (value: string) => new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

export function HistorySidebar({ projects, selectedId, loading, onSelect, onNew, onDelete }: Props) {
  const [query, setQuery] = React.useState("");
  const filtered = projects.filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <aside className="history-panel">
      <div className="history-heading">
        <h2>项目历史</h2>
        <button className="icon-text-button" onClick={onNew}><Plus size={16} />新项目</button>
      </div>
      <label className="search-field">
        <Search size={16} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目" />
      </label>
      <div className="history-list" aria-live="polite">
        {loading ? <div className="list-state">正在加载历史…</div> : null}
        {!loading && filtered.length === 0 ? (
          <div className="list-state"><Clock3 size={22} /><span>{query ? "没有匹配项目" : "生成的应用会保存在这里"}</span></div>
        ) : null}
        {filtered.map((project) => (
          <div key={project.id} className={`history-row ${selectedId === project.id ? "is-selected" : ""}`}>
            <button className="history-select" onClick={() => onSelect(project.id)}>
              <span className="history-icon">{project.name.slice(0, 1)}</span>
              <span className="history-copy">
                <strong>{project.name}</strong>
                <small>v{project.current_version} · {formatDate(project.updated_at)}</small>
              </span>
            </button>
            <button className="row-delete" aria-label={`删除 ${project.name}`} onClick={() => onDelete(project)}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <p className="storage-note">项目与代码保存于服务端 SQLite；预览应用内部数据不会持久化。</p>
    </aside>
  );
}
