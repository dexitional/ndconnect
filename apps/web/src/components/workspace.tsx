import { ContactUs } from "./contact-us";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { logoUrl } from "../lib/brand";
import {
  LayoutDashboard,
  Send,
  Users,
  Library,
  Settings,
  LogOut,
  ChevronRight,
  Plus,
  ArrowUpRight,
  MessageSquare,
  Mic,
  CalendarDays,
  CheckCheck,
  Radio,
  ShieldCheck,
  Menu,
  X,
  Search,
  FileText,
  Activity,
  Ban,
  ArrowRight,
  CornerDownLeft,
  Globe,
  ChevronDown,
  CreditCard,
} from "lucide-react";
import { Button, Badge } from "@ndc/ui";
import { api, post, type Row } from "../lib/api";
import { number } from "../lib/shared";
import { Contacts, LeadLibrary } from "./contacts";
import { Campaigns, Composer } from "./campaigns";
import { SenderIds, SmsNotifications } from "./senders";
import { VoiceCredits, AdminPayments, NotificationBell } from "./billing";
import {
  AdminUsers,
  AdminLists,
  Gateway,
  Audit,
  Suppressions,
  Profile,
} from "./settings";
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        ["active", "approved", "completed", "delivered"].includes(value)
          ? "green"
          : [
                "pending",
                "scheduled",
                "queued",
                "processing",
                "accepted",
              ].includes(value)
            ? "amber"
            : [
                  "failed",
                  "rejected",
                  "suspended",
                  "attention",
                  "unknown",
                ].includes(value)
              ? "red"
              : "neutral"
      }
    >
      <span className="badge-dot" />
      {value.replaceAll("_", " ")}
    </Badge>
  );
}
export function Empty({
  icon: Icon = MessageSquare,
  title,
  description,
  action,
}: {
  icon?: any;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" aria-label="Loading workspace">
      <span className="loading-dot" />
      <span>Getting your workspace ready…</span>
    </div>
  );
}
export function QueryError({
  error,
  retry,
}: {
  error: Error | null;
  retry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <h3>We couldn’t load this page</h3>
      <p>{error?.message}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="heading-actions">{children}</div>
    </div>
  );
}
const navUser = [
  { href: "/sender-ids", label: "SMS Sender IDs", icon: MessageSquare },
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Send },
  { href: "/contacts", label: "My contacts", icon: Users },
  { href: "/leads", label: "Shared leads", icon: Library },
  { href: "/credits", label: "SMS & voice credits", icon: CreditCard },
];
const navAdmin = [
  {
    href: "/admin/sender-ids",
    label: "Sender ID approvals",
    icon: ShieldCheck,
  },
  {
    href: "/admin/sms-notifications",
    label: "SMS notifications",
    icon: MessageSquare,
  },
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/campaigns", label: "All campaigns", icon: Send },
  { href: "/admin/users", label: "People & access", icon: Users },
  { href: "/admin/leads", label: "Lead moderation", icon: ShieldCheck },
  { href: "/admin/suppressions", label: "Opt-out register", icon: Ban },
  { href: "/admin/audit", label: "Activity log", icon: Activity },
  { href: "/admin/gateway", label: "Gateway settings", icon: Settings },
  { href: "/admin/payments", label: "Payments & credits", icon: CreditCard },
];
export function Workspace({ page = "" }: { page?: string }) {
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const me = useQuery({ queryKey: ["me"], queryFn: () => api("/auth/me") });
  const admin = page === "admin" || page.startsWith("admin/");
  const path = "/" + page;
  useEffect(() => {
    if (me.data && !me.data.user)
      window.location.replace(admin ? "/admin/login" : "/login");
  }, [me.data, admin]);
  if (me.isError)
    return <QueryError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data?.user) return <Loading />;
  const user = me.data.user;
  if (admin && user.role !== "admin")
    return (
      <div className="not-found">
        <ShieldCheck size={40} />
        <h1>Administrator access required</h1>
        <a href="/">Return to your workspace</a>
      </div>
    );
  const nav = admin ? navAdmin : navUser;
  const current =
    nav.find((n) => n.href === path)?.label ||
    (page === "compose"
      ? "New campaign"
      : page === "settings"
        ? "My account"
        : "Workspace");
  const known = [
    "sender-ids",
    "admin/sender-ids",
    "admin/sms-notifications",
    "",
    "campaigns",
    "contacts",
    "leads",
    "compose",
    "credits",
    "settings",
    "admin",
    "admin/campaigns",
    "admin/users",
    "admin/leads",
    "admin/suppressions",
    "admin/audit",
    "admin/gateway",
    "admin/payments",
  ];
  return (
    <div className="app-shell">
      <aside
        className={`sidebar ${mobile ? "sidebar-open" : ""}`}
        aria-label={admin ? "Admin navigation" : "Workspace navigation"}
        tabIndex={0}
      >
        <a className="brand" href={admin ? "/admin" : "/"}>
          <img src={logoUrl} alt="NDC" />
          <span>
            connect<span className="brand-dot">.</span>
            <small>COMMUNICATIONS HUB</small>
          </span>
        </a>
        <button
          className="workspace-switch"
          onClick={() =>
            window.location.assign(
              user.role === "admin" ? (admin ? "/" : "/admin") : "/settings",
            )
          }
        >
          <span className="workspace-icon">
            {admin ? <ShieldCheck size={18} /> : <Globe size={18} />}
          </span>
          <span>
            <strong>
              {admin ? "Administration Platform" : "My workspace"}
            </strong>
            {!admin && <small>NDC Connect</small>}
          </span>
          <ChevronDown size={16} />
        </button>
        <span className="nav-label">{admin ? "MANAGEMENT" : "WORKSPACE"}</span>
        <nav>
          {nav.map((n) => (
            <a
              key={n.href}
              className={path === n.href ? "nav-item active" : "nav-item"}
              href={n.href}
            >
              <n.icon size={19} />
              {n.label}
              {path === n.href && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!admin && (
            <div className="sidebar-callout">
              <span className="callout-icon">
                <Radio size={20} />
              </span>
              <h4>Let your voice be heard.</h4>
              <p>Add a personal touch with a voice campaign.</p>
              <a href="/compose?channel=voice">
                Try voice messaging <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          <a className="nav-item" href="/settings">
            <Settings size={19} /> My account
          </a>
          <a className="nav-item" href={admin ? "/" : "/admin/login"}>
            {admin ? <ArrowRight size={19} /> : <ShieldCheck size={19} />}{" "}
            {admin ? "Member workspace" : "Administration"}
          </a>
          <button
            className="profile-button"
            onClick={() => {
              void post("/auth/logout")
                .then(() => window.location.assign("/login"))
                .catch((e) => toast.error(e.message));
            }}
          >
            <span className="avatar">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>
                {user.role === "admin" ? "Administrator" : "Member"}
              </small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              variant="ghost"
              size="icon"
              className="mobile-toggle"
              aria-label="Toggle navigation"
              onClick={() => setMobile(!mobile)}
            >
              {mobile ? <X size={20} /> : <Menu size={20} />}
            </Button>
            <span>{admin ? "Administration" : "Workspace"}</span>
            <ChevronRight size={14} />
            <b>{current}</b>
          </div>
          <div className="top-actions">
            <form
              className="header-search"
              onSubmit={(e) => {
                e.preventDefault();
                window.location.assign(
                  `${admin ? "/admin/campaigns" : "/campaigns"}?q=${encodeURIComponent(search)}`,
                );
              }}
            >
              <Search size={16} />
              <input
                aria-label="Search campaigns"
                placeholder="Search campaigns…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                className="search-submit"
                type="submit"
                aria-label="Submit campaign search"
              >
                <CornerDownLeft size={16} />
              </button>
            </form>
            <span className="top-divider" />
            <NotificationBell />
            <ContactUs icon />
            <a
              className="avatar small"
              href="/settings"
              aria-label="My profile"
              title="My profile"
            >
              {user.name.slice(0, 2).toUpperCase()}
            </a>
          </div>
        </header>
        <motion.main
          className="content"
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {!known.includes(page) ? (
            <Empty
              title="This page isn’t here"
              description="Use the navigation to return to your workspace."
              action={
                <Button asChild>
                  <a href="/">Go to overview</a>
                </Button>
              }
            />
          ) : page === "" || page === "admin" ? (
            <Overview admin={admin} user={user} />
          ) : page === "contacts" ? (
            <Contacts />
          ) : page === "leads" ? (
            <LeadLibrary />
          ) : page === "compose" ? (
            <Composer user={user} />
          ) : page.endsWith("campaigns") ? (
            <Campaigns admin={admin} />
          ) : page === "settings" ? (
            <Profile user={user} />
          ) : page === "credits" ? (
            <VoiceCredits user={user} />
          ) : page.endsWith("sender-ids") ? (
            <SenderIds admin={admin} />
          ) : page === "admin/sms-notifications" ? (
            <SmsNotifications />
          ) : page === "admin/payments" ? (
            <AdminPayments />
          ) : page === "admin/users" ? (
            <AdminUsers user={user} />
          ) : page === "admin/leads" ? (
            <AdminLists />
          ) : page === "admin/gateway" ? (
            <Gateway />
          ) : page === "admin/suppressions" ? (
            <Suppressions />
          ) : (
            <Audit />
          )}
        </motion.main>
        <footer className="app-footer">
          <span className="footer-contact">
            © {new Date().getFullYear()} <ContactUs />
          </span>
          <span>
            <span className="live-dot" /> NDC Connect{" "}
            <span className="footer-separator">/</span> SMS & voice messaging
          </span>
        </footer>
      </div>
    </div>
  );
}
function Overview({ admin, user }: { admin: boolean; user: Row }) {
  const q = useQuery({
    queryKey: ["dashboard", admin],
    queryFn: () => api("/dashboard" + (admin ? "?admin=true" : "")),
    refetchInterval: 15000,
  });
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const { stats, campaigns, activity } = q.data;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 6 + i);
    const key = d.toISOString().slice(0, 10);
    return {
      label: d.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }),
      count: activity.find((x: Row) => x.day === key)?.total || 0,
    };
  });
  const max = Math.max(...days.map((d) => d.count), 4);
  const points = days
    .map((d, i) => `${i * 100},${140 - (d.count / max) * 110}`)
    .join(" ");
  const total = stats.recipients || 0;
  return (
    <>
      <PageHeading
        eyebrow={admin ? "PLATFORM AT A GLANCE" : "YOUR COMMUNITY, CONNECTED"}
        title={
          admin
            ? "A clear view of every connection."
            : `Welcome back, ${user.name.split(" ")[0]}.`
        }
        description={
          admin
            ? "Manage your people, shared leads, and messaging activity."
            : "Here’s what’s happening in your communications hub."
        }
      >
        <span className="date-chip">
          <CalendarDays size={16} />
          {new Date().toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "Africa/Accra",
          })}
        </span>
        <Button asChild>
          <a href="/compose">
            <Plus size={18} /> New campaign
          </a>
        </Button>
      </PageHeading>
      {!admin && (
        <section className="welcome-banner">
          <div>
            <span className="banner-kicker">
              <span /> MADE FOR MEANINGFUL CONNECTIONS
            </span>
            <h2>
              One message.
              <br />A community of possibilities.
            </h2>
            <p>Reach your people wherever they are, with SMS and voice.</p>
            <a href="/compose">
              Let’s start a conversation <ArrowRight size={17} />
            </a>
          </div>
          <div className="banner-illustration" aria-hidden="true">
            <div className="banner-circle" />
            <div className="message-tile">
              <div className="message-tile-icon">
                <MessageSquare size={22} />
              </div>
              <div>
                <b>Your next connection</b>
                <span>starts with a message.</span>
              </div>
              <CheckCheck size={20} />
            </div>
            <div className="voice-tile">
              <Mic size={19} />
              <div className="waveform">
                {[14, 25, 18, 34, 24, 40, 29, 16, 32, 22, 37, 18, 26, 13].map(
                  (h, i) => (
                    <i key={i} style={{ height: h }} />
                  ),
                )}
              </div>
              <span>VOICE</span>
            </div>
            <span className="banner-spark spark-one">✳</span>
            <span className="banner-spark spark-two">✳</span>
          </div>
        </section>
      )}
      <section className="stats-grid">
        {[
          {
            label: admin ? "Platform members" : "Total recipients",
            value: admin ? stats.users : total,
            icon: admin ? Users : Send,
            note: admin ? "Registered accounts" : "Across all your campaigns",
            color: "green",
          },
          {
            label: "SMS campaigns",
            value: stats.sms_campaigns,
            icon: MessageSquare,
            note: "Messages that make an impact",
            color: "blue",
          },
          {
            label: "Voice campaigns",
            value: stats.voice_campaigns,
            icon: Mic,
            note: "A more personal connection",
            color: "violet",
          },
          {
            label: "Saved contacts",
            value: stats.contacts,
            icon: Users,
            note: `${stats.shared} shared lists available`,
            color: "orange",
          },
        ].map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={18} />
              </span>
            </div>
            <strong>{number(s.value || 0)}</strong>
            <small>{s.note}</small>
          </div>
        ))}
      </section>
      <div className="overview-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h3>Campaign activity</h3>
              <p>Your reach over the last 7 days</p>
            </div>
            <Badge>
              <span className="legend-dot" /> Recipients queued
            </Badge>
          </div>
          <div className="chart">
            <div className="chart-scale">
              {[max, Math.round(max / 2), 0].map((n, i) => (
                <span key={i}>{number(n)}</span>
              ))}
            </div>
            <div className="chart-body">
              <div className="chart-grid">
                <i />
                <i />
                <i />
              </div>
              <svg
                viewBox="0 0 600 160"
                preserveAspectRatio="none"
                role="img"
                aria-label="Recipients queued per day over the last seven days"
              >
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0c8155" stopOpacity=".18" />
                    <stop offset="100%" stopColor="#0c8155" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon points={`0,160 ${points} 600,160`} fill="url(#area)" />
                <polyline
                  points={points}
                  fill="none"
                  stroke="#087f55"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                />
                {days.map((d, i) => (
                  <circle
                    key={i}
                    cx={i * 100}
                    cy={140 - (d.count / max) * 110}
                    r="3.5"
                    fill="#087f55"
                  >
                    <title>
                      {d.label}: {d.count} recipients
                    </title>
                  </circle>
                ))}
              </svg>
              <div className="chart-labels">
                {days.map((d, i) => (
                  <span key={i}>{d.label}</span>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section className="panel delivery-panel">
          <div className="panel-heading">
            <div>
              <h3>Delivery overview</h3>
              <p>Every recipient, accounted for</p>
            </div>
          </div>
          <div className="delivery-content">
            <div
              className="delivery-donut"
              style={{
                background: total
                  ? `conic-gradient(#087f55 0 ${(stats.delivered / total) * 100}%, #9fceb9 ${(stats.delivered / total) * 100}% ${((stats.delivered + stats.accepted) / total) * 100}%, #edf0ee 0)`
                  : "#edf0ee",
              }}
            >
              <div>
                <strong>
                  {total ? Math.round((stats.delivered / total) * 100) : 0}%
                </strong>
                <span>delivered</span>
              </div>
            </div>
            <div className="delivery-key">
              {[
                ["Delivered", stats.delivered, "green"],
                ["Accepted", stats.accepted, "light"],
                ["Needs review", stats.failed, "red"],
              ].map(([label, value, color]) => (
                <div key={String(label)}>
                  <span>
                    <i className={`legend-dot ${color}`} />
                    {label}
                  </span>
                  <b>{number(Number(value) || 0)}</b>
                </div>
              ))}
            </div>
          </div>
          <small className="delivery-note">
            Delivery is confirmed by gateway callbacks.
          </small>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>Recent campaigns</h3>
            <p>Your latest conversations, in one place</p>
          </div>
          <a
            className="text-link"
            href={admin ? "/admin/campaigns" : "/campaigns"}
          >
            View all campaigns <ArrowUpRight size={15} />
          </a>
        </div>
        {campaigns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Channel</th>
                  <th>Recipients</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: Row) => (
                  <tr key={c.id}>
                    <td>
                      <div className="table-title">
                        <span className={`channel-icon ${c.channel}`}>
                          {c.channel === "sms" ? (
                            <MessageSquare size={18} />
                          ) : (
                            <Mic size={18} />
                          )}
                        </span>
                        <b>{c.name}</b>
                      </div>
                    </td>
                    <td>{c.channel === "sms" ? "SMS" : "Voice"}</td>
                    <td>{number(c.recipients)}</td>
                    <td>
                      <Status value={c.status} />
                    </td>
                    <td>
                      {new Date(c.created_at + "Z").toLocaleDateString(
                        "en-GB",
                        { day: "numeric", month: "short" },
                      )}
                    </td>
                    <td>
                      <a
                        aria-label={`View ${c.name}`}
                        href={`${admin ? "/admin/campaigns" : "/campaigns"}?id=${c.id}`}
                      >
                        <ArrowUpRight size={17} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Send}
            title="Your first connection starts here"
            description="Create a campaign to send an SMS or voice message to your community."
            action={
              <Button variant="outline" asChild>
                <a href="/compose">
                  <Plus size={16} /> Create a campaign
                </a>
              </Button>
            }
          />
        )}
      </section>
      <div className="quick-links">
        <a href="/contacts">
          <span className="quick-icon">
            <Users size={21} />
          </span>
          <div>
            <h4>Bring your people together</h4>
            <p>Import and organise your contact lists.</p>
          </div>
          <ArrowUpRight size={19} />
        </a>
        <a href="/leads">
          <span className="quick-icon rose">
            <Library size={21} />
          </span>
          <div>
            <h4>Make your next connection</h4>
            <p>Discover approved, community-shared leads.</p>
          </div>
          <ArrowUpRight size={19} />
        </a>
      </div>
    </>
  );
}
