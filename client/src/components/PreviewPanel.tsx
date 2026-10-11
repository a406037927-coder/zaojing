import * as React from "react";
import { Check, Clipboard, ClipboardCheck, Code2, Download, Monitor, Smartphone } from "lucide-react";
import type { AcceptanceItem, Project } from "../types";
import { securePreviewDocument } from "../previewSecurity";
import { AcceptancePanel } from "./AcceptancePanel";

interface Props {
  project: Project | null;
  code: string | null;
  versionNo: number | null;
  acceptance: AcceptanceItem[];
  isCurrentVersion: boolean;
  busy: boolean;
  elapsedSeconds: number;
  onNotify: (message: string) => void;
  onAddAcceptance: (title: string, expected: string) => Promise<void>;
  onUpdateAcceptance: (item: AcceptanceItem) => Promise<void>;
  onDeleteAcceptance: (id: string) => Promise<void>;
  onRepair: (ids: string[]) => Promise<void>;
}

export function PreviewPanel({
  project, code, versionNo, acceptance, isCurrentVersion, busy, elapsedSeconds, onNotify,
  onAddAcceptance, onUpdateAcceptance, onDeleteAcceptance, onRepair,
}: Props) {
  const [tab, setTab] = React.useState<"preview" | "code" | "acceptance">("preview");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    onNotify("代码已复制到剪贴板");
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    if (!project || !code) return;
    const blob = new Blob([code], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, "-")}-v${versionNo || project.current_version}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify("HTML 文件已下载");
  };

  return (
    <section className="preview-panel">
      <div className="preview-toolbar">
        <div className="tab-list" role="tablist">
          <button className={tab === "preview" ? "is-active" : ""} onClick={() => setTab("preview")}><Monitor size={16} />预览</button>
          <button className={tab === "code" ? "is-active" : ""} onClick={() => setTab("code")}><Code2 size={16} />代码</button>
          <button className={tab === "acceptance" ? "is-active" : ""} onClick={() => setTab("acceptance")}><ClipboardCheck size={16} />验收</button>
          {project && !isCurrentVersion ? <span className="history-badge">历史 v{versionNo}</span> : null}
        </div>
        <div className="toolbar-actions">
          {tab === "preview" ? (
            <div className="device-switch" aria-label="预览尺寸">
              <button className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")}><Monitor size={15} />桌面</button>
              <button className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")}><Smartphone size={15} />手机</button>
            </div>
          ) : null}
          <button onClick={copy} disabled={!code}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "已复制" : "复制代码"}</button>
          <button onClick={download} disabled={!code}><Download size={15} />下载 HTML</button>
        </div>
      </div>

      <div className={`preview-stage ${device === "mobile" && tab === "preview" ? "is-mobile" : ""} ${tab === "acceptance" ? "acceptance-stage" : ""}`}>
        {busy ? (
          <div className="generation-state generation-overlay">
            <span className="spinner" />
            <strong>AI 正在生成并审查应用</strong>
            <p>已等待 {elapsedSeconds} 秒。复杂应用会先生成，再进行一轮交互代码审查。</p>
            <small>这里显示真实等待时间，不代表虚构完成百分比。</small>
          </div>
        ) : null}
        {!project ? (
          <div className="preview-empty">
            <div className="empty-symbol"><Code2 size={28} /></div>
            <strong>等待第一个想法</strong>
            <p>在左侧输入需求，生成后即可预览、查看代码并进行人工验收。</p>
          </div>
        ) : null}

        {project && code ? (
          <div className={`iframe-frame ${device} ${tab === "preview" ? "" : "is-hidden"}`} aria-hidden={tab !== "preview"}>
            <iframe
              key={`${project.id}-${versionNo}`}
              title={`${project.name} v${versionNo} 应用预览`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={securePreviewDocument(code)}
            />
          </div>
        ) : null}
        {project && code && tab === "code" ? (
          <pre className="code-view" tabIndex={0}><code>{code}</code></pre>
        ) : null}
        {project && tab === "acceptance" ? (
          <AcceptancePanel
            items={acceptance}
            editable={isCurrentVersion}
            busy={busy}
            onAdd={onAddAcceptance}
            onUpdate={onUpdateAcceptance}
            onDelete={onDeleteAcceptance}
            onRepair={onRepair}
          />
        ) : null}
      </div>
    </section>
  );
}
