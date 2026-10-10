import * as React from "react";
import { Check, Clipboard, Code2, Download, Monitor, Smartphone } from "lucide-react";
import type { Project } from "../types";
import { securePreviewDocument } from "../previewSecurity";

interface Props {
  project: Project | null;
  busy: boolean;
  onNotify: (message: string) => void;
}

export function PreviewPanel({ project, busy, onNotify }: Props) {
  const [tab, setTab] = React.useState<"preview" | "code">("preview");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    if (!project) return;
    await navigator.clipboard.writeText(project.code);
    setCopied(true);
    onNotify("代码已复制到剪贴板");
    window.setTimeout(() => setCopied(false), 1600);
  };

  const download = () => {
    if (!project) return;
    const blob = new Blob([project.code], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.name.replace(/[\\/:*?"<>|]/g, "-")}.html`;
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
        </div>
        <div className="toolbar-actions">
          <div className="device-switch" aria-label="预览尺寸">
            <button className={device === "desktop" ? "is-active" : ""} onClick={() => setDevice("desktop")}><Monitor size={15} />桌面</button>
            <button className={device === "mobile" ? "is-active" : ""} onClick={() => setDevice("mobile")}><Smartphone size={15} />手机</button>
          </div>
          <button onClick={copy} disabled={!project}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? "已复制" : "复制代码"}</button>
          <button onClick={download} disabled={!project}><Download size={15} />下载 HTML</button>
        </div>
      </div>

      <div className={`preview-stage ${device === "mobile" ? "is-mobile" : ""}`}>
        {busy ? (
          <div className="generation-state">
            <span className="spinner" />
            <strong>AI 正在搭建应用</strong>
            <p>正在组织页面结构、交互与样式，这通常需要几十秒。</p>
            <div className="progress-track"><span /></div>
          </div>
        ) : null}
        {!busy && !project ? (
          <div className="preview-empty">
            <div className="empty-symbol"><Code2 size={28} /></div>
            <strong>等待第一个想法</strong>
            <p>在左侧输入需求，生成后即可在安全沙箱中操作和查看代码。</p>
          </div>
        ) : null}
        {!busy && project && tab === "preview" ? (
          <div className={`iframe-frame ${device}`}>
            <iframe
              key={`${project.id}-${project.current_version}-${device}`}
              title={`${project.name} 应用预览`}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={securePreviewDocument(project.code)}
            />
          </div>
        ) : null}
        {!busy && project && tab === "code" ? (
          <pre className="code-view" tabIndex={0}><code>{project.code}</code></pre>
        ) : null}
      </div>
    </section>
  );
}
