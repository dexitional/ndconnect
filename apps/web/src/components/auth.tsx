import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeft,
  MessageSquare,
  Radio,
  ShieldCheck,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import { motion } from "framer-motion";
import { Button, Input, Field } from "@ndc/ui";
import { api, post } from "../lib/api";
export function Auth({ mode = "login" }: { mode?: string }) {
  const admin = mode === "admin/login",
    signup = mode === "signup",
    reset = mode === "reset-password";
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "google")
      setError(
        "Google sign-in could not be completed. Please try again or sign in with your phone.",
      );
  }, []);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config"),
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if ((signup || reset) && !sent) {
        const r = await post("/auth/otp", { phone });
        setSent(true);
        setNotice(
          r.testCode
            ? `Local test mode · verification code: ${r.testCode}`
            : "A 6-digit code is on its way to your phone.",
        );
      } else if (reset) {
        await post("/auth/reset-password", { phone, password, code });
        window.location.assign("/login");
      } else {
        await post(
          signup ? "/auth/register" : "/auth/login",
          signup ? { name, phone, password, code } : { phone, password, admin },
        );
        window.location.assign(admin ? "/admin" : "/");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <a href="/login" className="auth-brand">
        <img src="/brand/logo.png" alt="NDC" />
        <span>
          connect<span className="brand-dot">.</span>
        </span>
      </a>
      <div className="auth-card">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="auth-form"
        >
          <span className="eyebrow">
            {admin
              ? "ADMINISTRATOR PORTAL"
              : "CONNECTED COMMUNITIES. STRONGER TOGETHER."}
          </span>
          <h1>
            {signup
              ? "Let’s get connected."
              : reset
                ? "A fresh start."
                : admin
                  ? "Welcome back, admin."
                  : "Good to see you again."}
          </h1>
          <p className="muted">
            {signup
              ? "Create your account and bring your community closer."
              : reset
                ? "Verify your phone to set a new password."
                : "Sign in to your NDC Connect workspace."}
          </p>
          {admin && (
            <div className="notice">
              <ShieldCheck size={18} /> Secure access for platform
              administrators
            </div>
          )}
          {config.data?.googleEnabled && !admin && !reset && (
            <>
              <Button
                variant="outline"
                className="full"
                onClick={() => window.location.assign("/api/auth/google")}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="#4285F4"
                    d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.41 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.92V7.49H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.51l3.34-2.59Z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z"
                  />
                </svg>
                Continue with Google
              </Button>
              <div className="divider">or with your phone number</div>
            </>
          )}
          <form onSubmit={submit}>
            {signup && (
              <Field label="Full name">
                <Input
                  autoComplete="name"
                  disabled={!ready}
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                />
              </Field>
            )}
            <Field label="Phone number">
              <Input
                autoComplete="tel"
                type="tel"
                required
                value={phone}
                disabled={!ready || sent}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="024 123 4567"
              />
            </Field>
            {(!(signup || reset) || sent) && (
              <>
                <Field
                  label={reset ? "New password" : "Password"}
                  hint={signup || reset ? "At least 12 characters." : undefined}
                >
                  <div className="password-input">
                    <Input
                      autoComplete={
                        signup || reset ? "new-password" : "current-password"
                      }
                      type={show ? "text" : "password"}
                      required
                      minLength={signup || reset ? 12 : 1}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                    />
                    <button
                      type="button"
                      aria-label={show ? "Hide password" : "Show password"}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
                {!signup && !reset && (
                  <a className="forgot" href="/reset-password">
                    Forgot password?
                  </a>
                )}
              </>
            )}
            {sent && (
              <Field label="Verification code">
                <Input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6-digit code"
                />
              </Field>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button
              className="full"
              busy={busy}
              disabled={!ready}
              type="submit"
            >
              {(signup || reset) && !sent
                ? "Send verification code"
                : signup
                  ? "Create account"
                  : reset
                    ? "Reset password"
                    : "Sign in"}
              <ArrowRight size={17} />
            </Button>
            {sent && (
              <Button
                variant="ghost"
                className="full"
                type="button"
                onClick={() => {
                  setSent(false);
                  setCode("");
                  setNotice("");
                }}
              >
                Change number or request another code
              </Button>
            )}
          </form>
          <p className="auth-bottom">
            {signup || reset ? (
              <a href="/login">
                <ArrowLeft size={14} /> Back to sign in
              </a>
            ) : (
              <>
                New to NDC Connect? <a href="/signup">Create an account</a>
              </>
            )}
          </p>
          {!admin && !signup && !reset && (
            <a className="admin-link" href="/admin/login">
              <ShieldCheck size={14} /> Administrator sign in
            </a>
          )}
        </motion.section>
        <section className="auth-visual">
          <div className="auth-orbit">
            <div className="orbit one" />
            <div className="orbit two" />
            <div className="orbit three" />
            <div className="orbit-logo">
              <img src="/brand/logo.png" alt="NDC umbrella" />
            </div>
            <span className="floating-message">
              <MessageSquare size={20} />
              <span>
                One message.
                <br />
                <b>A thousand connections.</b>
              </span>
              <span className="floating-check">
                <Check size={13} />
              </span>
            </span>
            <span className="floating-voice">
              <Radio size={22} />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="auth-caption">
            <span className="eyebrow">EVERY VOICE MATTERS</span>
            <h2>
              A little closer.
              <br />A lot stronger.
            </h2>
            <p>
              Reach your people with messages that matter.
              <br />
              SMS and voice, all in one place.
            </p>
            <div className="auth-powered">
              <span className="live-dot" /> SMS & voice messaging
            </div>
          </div>
        </section>
      </div>
      <footer className="auth-footer">
        NDC Connect <span>Building connections. Moving forward together.</span>
        <span>© {new Date().getFullYear()}</span>
      </footer>
    </main>
  );
}
