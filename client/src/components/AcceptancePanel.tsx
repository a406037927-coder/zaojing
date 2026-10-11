import * as React from "react";
import { AlertTriangle, CheckCircle2, Circle, Plus, Save, Trash2, Wrench } from "lucide-react";
import type { AcceptanceItem } from "../types";

interface Props {
  items: AcceptanceItem[];
  editable: boolean;
  busy: boolean;
  onAdd: (title: string, expected: string) => Promise<void>;
  onUpdate: (item: AcceptanceItem) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRepair: (ids: string[]) => Promise<void>;
}

export function AcceptancePanel({ items, editable, busy, onAdd, onUpdate, onDelete, onRepair }: Props) {
  const [drafts, setDrafts] = React.useState<AcceptanceItem[]>(items);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [adding, setAdding] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState("");
  const [newExpected, setNewExpected] = React.useState("");

  React.useEffect(() => {
    setDrafts(items);
    setSelected(new Set());
  }, [items]);

  const checked = drafts.filter((item) => item.status !== "unchecked").length;
  const failed = drafts.filter((item) => item.status === "failed");

  const change = (id: string, patch: Partial<AcceptanceItem>) => {
    setDrafts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const submitNew = async () => {
    if (!newTitle.trim() || !newExpected.trim()) return;
    await onAdd(newTitle.trim(), newExpected.trim());
    setNewTitle("");
    setNewExpected("");
    setAdding(false);
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="acceptance-panel">
      <div className="acceptance-summary">
        <div>
          <strong>版本验收清单</strong>
          <span>{editable ? "请按步骤人工操作后确认结果" : "正在查看历史版本的验收记录"}</span>
        </div>
        <div className="acceptance-counts">
          <span>已检查 {checked}/{drafts.length}</span>
          <span className={failed.length ? "has-failures" : ""}>问题 {failed.length}</span>
        </div>
      </div>

      {drafts.length === 0 ? (
        <div className="acceptance-empty">
          <Circle size={24} />
          <strong>尚未创建验收清单</strong>
          <p>旧项目不会自动调用模型补齐；你可以为当前版本手动添加。</p>
        </div>
      ) : (
        <div className="acceptance-list">
          {drafts.map((item, index) => (
            <article className={`acceptance-card status-${item.status}`} key={item.id}>
              <div className="acceptance-card-head">
                <span className="acceptance-index">{index + 1}</span>
                <div className="acceptance-fields">
                  <input
                    aria-label={`验收操作 ${index + 1}`}
                    value={item.title}
                    readOnly={!editable}
                    onChange={(event) => change(item.id, { title: event.target.value })}
                  />
                  <textarea
                    aria-label={`预期结果 ${index + 1}`}
                    value={item.expected_result}
                    readOnly={!editable}
                    onChange={(event) => change(item.id, { expected_result: event.target.value })}
                  />
                </div>
                {editable ? (
                  <button className="acceptance-delete" aria-label="删除验收项" onClick={() => onDelete(item.id)} disabled={busy}>
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </div>

              <div className="acceptance-actions" aria-label="验收状态">
                <button
                  className={item.status === "unchecked" ? "is-active" : ""}
                  disabled={!editable || busy}
                  onClick={() => change(item.id, { status: "unchecked", issue_description: "" })}
                ><Circle size={14} />未检查</button>
                <button
                  className={item.status === "passed" ? "is-active pass" : ""}
                  disabled={!editable || busy}
                  onClick={() => change(item.id, { status: "passed", issue_description: "" })}
                ><CheckCircle2 size={14} />确认通过</button>
                <button
                  className={item.status === "failed" ? "is-active fail" : ""}
                  disabled={!editable || busy}
                  onClick={() => change(item.id, { status: "failed" })}
                ><AlertTriangle size={14} />发现问题</button>
              </div>

              {item.status === "failed" ? (
                <div className="issue-row">
                  {editable ? (
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label="选择此问题进行修复"
                    />
                  ) : null}
                  <textarea
                    value={item.issue_description}
                    readOnly={!editable}
                    onChange={(event) => change(item.id, { issue_description: event.target.value })}
                    placeholder="请描述实际现象，例如：点击删除按钮没有响应…"
                  />
                </div>
              ) : null}
              {editable ? (
                <button className="save-check-button" onClick={() => onUpdate(item)} disabled={busy || !item.title.trim() || !item.expected_result.trim()}>
                  <Save size={14} />保存本项记录
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {editable ? (
        <div className="acceptance-footer">
          {adding ? (
            <div className="acceptance-add-form">
              <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="操作，例如：点击开始游戏" />
              <textarea value={newExpected} onChange={(event) => setNewExpected(event.target.value)} placeholder="预期结果，例如：水果从顶部落下" />
              <div><button onClick={() => setAdding(false)}>取消</button><button onClick={submitNew} disabled={busy || !newTitle.trim() || !newExpected.trim()}>添加</button></div>
            </div>
          ) : (
            <button className="add-check-button" onClick={() => setAdding(true)} disabled={busy}><Plus size={15} />新增验收项</button>
          )}
          <button className="repair-button" onClick={() => onRepair([...selected])} disabled={busy || selected.size === 0}>
            <Wrench size={15} />修复所选问题（{selected.size}）
          </button>
        </div>
      ) : null}
    </div>
  );
}
