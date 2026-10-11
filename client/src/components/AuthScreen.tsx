import * as React from "react";
import { ArrowRight, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { api } from "../api";
import type { User } from "../types";
import { Brand } from "./Brand";

interface Props {
  aiConfigured: boolean | null;
  onAuthenticated: (user: User) => Promise<void>;
}

export function AuthScreen({ aiConfigured, onAuthenticated }: Props) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      const result = mode === "register"
        ? await api.register(username, password)
        : await api.login(username, password);
      await onAuthenticated(result.user);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: "login" | "register") => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <main className="auth-page">
      <section className="auth-intro">
        <Brand />
        <div className="auth-pitch">
          <span className="eyebrow"><Sparkles size={15} /> AI 应用生成工作台</span>
          <h1>把一句需求，变成可以操作的网页应用。</h1>
          <p>使用真实模型生成完整 HTML，在安全沙箱中预览，并保存每一次修改版本。</p>
          <ul>
            <li>自然语言生成真实交互应用</li>
            <li>代码审查与安全规则双重检查</li>
            <li>个人项目历史与版本恢复</li>
          </ul>
        </div>
        <div className="auth-service-status">
          <span className={`status-dot ${aiConfigured === false ? "warning" : ""}`} />
          {aiConfigured ? "AI 服务已连接" : aiConfigured === false ? "AI 服务等待配置" : "正在连接服务"}
        </div>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="账号操作">
            <button className={mode === "login" ? "is-active" : ""} onClick={() => switchMode("login")}>登录</button>
            <button className={mode === "register" ? "is-active" : ""} onClick={() => switchMode("register")}>注册</button>
          </div>
          <div className="auth-card-heading">
            <h2>{mode === "login" ? "欢迎回来" : "创建账号"}</h2>
            <p>{mode === "login" ? "登录后继续管理你的生成项目。" : "注册后即可使用 AI 生成和保存项目。"}</p>
          </div>
          <form onSubmit={submit} className="auth-form">
            <label>
              <span>用户名</span>
              <div className="auth-input"><UserRound size={18} /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength={3} maxLength={32} required placeholder="3–32 个字符" /></div>
            </label>
            <label>
              <span>密码</span>
              <div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required placeholder="至少 8 个字符" /></div>
            </label>
            {mode === "register" ? (
              <label>
                <span>确认密码</span>
                <div className="auth-input"><LockKeyhole size={18} /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={128} required placeholder="再次输入密码" /></div>
              </label>
            ) : null}
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button className="auth-submit" disabled={busy} type="submit">
              {busy ? "请稍候…" : mode === "login" ? "登录并进入" : "注册并进入"}<ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-footnote">账号用于隔离个人项目；模型密钥始终只保存在服务端。</p>
        </div>
      </section>
    </main>
  );
}
