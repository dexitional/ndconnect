import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users,
  Search,
  Plus,
  ShieldCheck,
  Check,
  X,
  Activity,
  Settings,
  Ban,
  RefreshCw,
  LockKeyhole,
  Radio,
  MessageSquare,
  Save,
  ArrowUpRight,
} from "lucide-react";
import { Button, Input, Field, Dialog, Badge, Select } from "@ndc/ui";
import { api, patch, post, type Row } from "../lib/api";
import { Empty, PageHeading, Loading, QueryError, Status } from "./workspace";
import { ContactManager } from "./contacts";
import { number } from "../lib/shared";
export function AdminUsers() {
  const q = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api("/admin/users"),
  });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [grant, setGrant] = useState(1000);
  const [busy, setBusy] = useState(false);
  async function update(user: Row, data: Row) {
    setBusy(true);
    try {
      await patch("/admin/users/" + user.id, data);
      void q.refetch();
      setSelected(null);
      toast.success("Account updated.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  return (
    <>
      <PageHeading
        eyebrow="YOUR PLATFORM, YOUR PEOPLE"
        title="People & access"
        description="Manage member access and allocate messaging allowance."
      />
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Search members"
            placeholder="Search name, phone or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Badge>{q.data.users.length} members</Badge>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Contact</th>
                <th>Role</th>
                <th>Send allowance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.data.users
                .filter((u: Row) =>
                  `${u.name} ${u.phone} ${u.email}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((u: Row) => (
                  <tr key={u.id}>
                    <td>
                      <div className="table-title">
                        <span className="avatar">
                          {u.name.slice(0, 2).toUpperCase()}
                        </span>
                        <b>{u.name}</b>
                      </div>
                    </td>
                    <td>{u.phone || u.email}</td>
                    <td>
                      <Badge>{u.role}</Badge>
                    </td>
                    <td>{number(u.allowance)} units</td>
                    <td>
                      <Status value={u.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(u)}
                        >
                          <Plus size={14} /> Allocate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={busy}
                          onClick={() =>
                            void update(u, {
                              status:
                                u.status === "active" ? "suspended" : "active",
                            })
                          }
                        >
                          {u.status === "active" ? "Suspend" : "Reactivate"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={() => setSelected(null)}
        title="Allocate send allowance"
        description={`Add messaging units to ${selected?.name}’s account. These are platform limits, not provider account credits.`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void update(selected!, { grant });
          }}
        >
          <Field
            label="Units to add"
            hint="One unit per SMS part or voice recipient."
          >
            <Input
              type="number"
              min={1}
              max={1000000}
              value={grant}
              onChange={(e) => setGrant(Number(e.target.value))}
              required
            />
          </Field>
          <Button className="full" busy={busy}>
            Allocate {number(grant)} units
          </Button>
        </form>
      </Dialog>
    </>
  );
}
export function AdminLists() {
  const q = useQuery({
    queryKey: ["admin-lists"],
    queryFn: () => api("/admin/lists"),
  });
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function moderate(id: string, status: string) {
    setBusy(id);
    try {
      await patch("/admin/lists/" + id, { status });
      void q.refetch();
      toast.success(
        status === "approved"
          ? "List approved for community use."
          : "List removed from community access.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const lists = q.data.lists.filter(
    (l: Row) => filter === "all" || l.status === filter,
  );
  return (
    <>
      <PageHeading
        eyebrow="TRUSTED CONNECTIONS"
        title="Lead moderation"
        description="Review shared audiences before they become available to everyone."
      />
      <div className="toolbar">
        <div className="segmented">
          {["pending", "approved", "rejected", "all"].map((s) => (
            <button
              key={s}
              className={s === filter ? "selected" : ""}
              onClick={() => setFilter(s)}
            >
              {s === "all"
                ? "All lists"
                : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <Badge>{lists.length} lists</Badge>
      </div>
      <section className="panel">
        {lists.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Shared list</th>
                  <th>Submitted by</th>
                  <th>Contacts</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l: Row) => (
                  <tr key={l.id}>
                    <td>
                      <b>{l.name}</b>
                      <small className="table-sub">
                        {l.category} · {l.description}
                      </small>
                    </td>
                    <td>{l.owner_name}</td>
                    <td>{number(l.contact_count)}</td>
                    <td>
                      <Status value={l.status} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(l)}
                        >
                          Inspect
                        </Button>
                        {l.status !== "approved" && (
                          <Button
                            size="sm"
                            busy={busy === l.id}
                            onClick={() => void moderate(l.id, "approved")}
                          >
                            <Check size={14} /> Approve
                          </Button>
                        )}
                        {l.status !== "rejected" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            busy={busy === l.id}
                            onClick={() => void moderate(l.id, "rejected")}
                          >
                            Reject
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={ShieldCheck}
            title="You’re all caught up"
            description="Shared contact lists matching this status will appear here."
          />
        )}
      </section>
      {selected && (
        <ContactManager list={selected} close={() => setSelected(null)} />
      )}
    </>
  );
}
export function Gateway() {
  const client = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["gateway"],
    queryFn: () => api("/admin/gateway"),
    refetchInterval: 15000,
  });
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const g = q.data;
  const providerName = g.provider === "mnotify" ? "mNotify" : "Arkesel";
  const heartbeat = g.worker
    ? Date.now() - new Date(g.worker.created_at + "Z").getTime()
    : Infinity;
  return (
    <>
      <PageHeading
        eyebrow="THE ENGINE BEHIND YOUR CONNECTIONS"
        title="Gateway settings"
        description="Check messaging, authentication, and background processing."
      >
        <Button variant="outline" onClick={() => void q.refetch()}>
          <RefreshCw size={16} /> Refresh status
        </Button>
      </PageHeading>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="stat-icon green">
              <Radio size={22} />
            </span>
            <div>
              <h3>{providerName} messaging</h3>
              <p>SMS and voice delivery</p>
            </div>
            <Badge tone={g.configured ? "green" : "amber"}>
              {g.mock
                ? "Local mock"
                : g.configured
                  ? "Configured"
                  : "Not configured"}
            </Badge>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await patch("/admin/gateway", {
                  provider: selectedProvider || g.provider,
                });
                setSelectedProvider("");
                await Promise.all([
                  client.invalidateQueries({ queryKey: ["gateway"] }),
                  client.invalidateQueries({ queryKey: ["config"] }),
                ]);
                toast.success("Messaging provider updated.");
              } catch (error) {
                toast.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="Messaging provider"
              hint="Applies to new campaigns and verification codes. Existing campaigns and codes keep their original provider."
            >
              <Select
                value={selectedProvider || g.provider}
                disabled={busy}
                onChange={(e) => setSelectedProvider(e.target.value)}
              >
                {g.providers.map((p: Row) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={!p.configured && !g.mock}
                  >
                    {p.name}
                    {!p.configured && !g.mock ? " — not configured" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              busy={busy}
              disabled={!selectedProvider || selectedProvider === g.provider}
            >
              <Save size={16} /> Save provider
            </Button>
          </form>
          <dl>
            <div>
              <dt>SMS sender ID</dt>
              <dd>{g.sender}</dd>
            </div>
            <div>
              <dt>Voice caller ID (optional)</dt>
              <dd>
                {g.provider === "mnotify"
                  ? "Not required"
                  : g.voiceId || "No custom caller ID"}
              </dd>
            </div>
            <div>
              <dt>Delivery reports</dt>
              <dd>
                {g.provider === "mnotify"
                  ? "Checked by campaign worker"
                  : g.webhooks
                    ? "Signed callbacks enabled"
                    : "Callbacks not configured"}
              </dd>
            </div>
            <div>
              <dt>API key</dt>
              <dd>
                {g.configured
                  ? "Stored securely on the server"
                  : "Not configured"}
              </dd>
            </div>
          </dl>
          <p className="notice">
            Register your SMS sender ID with {providerName}. Voice messages can
            be sent without a custom caller ID.
            {g.provider === "mnotify" &&
              " Phone verification also requires an approved OTP sender ID with your app URL registered in mNotify."}
            Configuration status does not verify provider credentials or
            balance.
          </p>
          <a
            className="text-link"
            href={
              g.provider === "mnotify"
                ? "https://bms.mnotify.com"
                : "https://sms.arkesel.com"
            }
            target="_blank"
            rel="noreferrer"
          >
            Open {providerName} dashboard <ArrowUpRight size={15} />
          </a>
        </section>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="stat-icon blue">
              <Settings size={22} />
            </span>
            <div>
              <h3>Platform services</h3>
              <p>Authentication and processing</p>
            </div>
          </div>
          <dl>
            <div>
              <dt>Google sign-in</dt>
              <dd>
                <Status value={g.google ? "active" : "pending"} />
              </dd>
            </div>
            <div>
              <dt>Campaign worker</dt>
              <dd>
                <Status value={heartbeat < 90000 ? "active" : "unknown"} />
              </dd>
            </div>
            <div>
              <dt>Last worker heartbeat</dt>
              <dd>
                {g.worker
                  ? new Date(g.worker.created_at + "Z").toLocaleString()
                  : "Not seen yet"}
              </dd>
            </div>
            <div>
              <dt>SQLite version</dt>
              <dd>{g.sqlite}</dd>
            </div>
            <div>
              <dt>Database mode</dt>
              <dd>WAL · full durability</dd>
            </div>
          </dl>
          <p className="notice">
            Service credentials are managed in the server environment. See the
            project README for setup and deployment instructions.
          </p>
        </section>
      </div>
    </>
  );
}
export function Audit() {
  const q = useQuery({
    queryKey: ["audit"],
    queryFn: () => api("/admin/audit"),
  });
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  return (
    <>
      <PageHeading
        eyebrow="A CLEAR RECORD"
        title="Activity log"
        description="The latest 200 account, campaign, and administration events."
      />
      <section className="panel">
        {q.data.events.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Performed by</th>
                  <th>Details</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {q.data.events.map((e: Row) => (
                  <tr key={e.id}>
                    <td>
                      <Badge>{e.action}</Badge>
                    </td>
                    <td>{e.actor_name || "System"}</td>
                    <td className="audit-detail">{e.detail || e.target_id}</td>
                    <td>{new Date(e.created_at + "Z").toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Activity}
            title="A fresh start"
            description="Platform events will be recorded here."
          />
        )}
      </section>
    </>
  );
}
export function Suppressions() {
  const q = useQuery({
    queryKey: ["suppressions"],
    queryFn: () => api("/admin/suppressions"),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      await post("/admin/suppressions", b);
      setOpen(false);
      void q.refetch();
      toast.success("Number excluded from future sending.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="RESPECT EVERY CONNECTION"
        title="Opt-out register"
        description="Exclude these numbers from every campaign, across all lists."
      >
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Add opt-out
        </Button>
      </PageHeading>
      <section className="panel">
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <QueryError error={q.error} retry={() => void q.refetch()} />
        ) : q.data.suppressions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Phone number</th>
                  <th>Reason</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {q.data.suppressions.map((s: Row) => (
                  <tr key={s.phone}>
                    <td>{s.phone}</td>
                    <td>{s.reason}</td>
                    <td>{new Date(s.created_at + "Z").toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Ban}
            title="No opted-out numbers yet"
            description="Record an opt-out here to stop messages to that number, including queued messages that have not been submitted."
          />
        )}
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record an opt-out"
        description="This phone number will be excluded from future dispatch across the platform."
      >
        <form onSubmit={add}>
          <Field label="Phone number">
            <Input
              type="tel"
              name="phone"
              required
              placeholder="024 123 4567"
            />
          </Field>
          <Field label="Reason">
            <Input
              name="reason"
              required
              minLength={2}
              maxLength={200}
              placeholder="e.g. Recipient requested no further messages"
            />
          </Field>
          <Button className="full" busy={busy}>
            Add to opt-out register
          </Button>
        </form>
      </Dialog>
    </>
  );
}
export function Profile({ user }: { user: Row }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE, YOUR WAY"
        title="My account"
        description="Keep your details up to date and find your way around."
      />
      <div className="settings-grid">
        <section className="panel settings-panel">
          <div className="profile-heading">
            <span className="avatar large">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <h3>{user.name}</h3>
              <p>{user.phone || user.email}</p>
            </div>
            <Badge tone="green">{user.role}</Badge>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await patch("/profile", { name });
                await client.invalidateQueries({ queryKey: ["me"] });
                toast.success("Profile updated.");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Display name">
              <Input
                value={name}
                minLength={2}
                maxLength={100}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Account contact">
              <Input value={user.phone || user.email || ""} readOnly />
            </Field>
            <Button busy={busy}>
              <Save size={16} /> Save changes
            </Button>
          </form>
          <div className="section-separator" />
          <h3>Messaging allowance</h3>
          <p>
            <strong>{number(user.allowance)}</strong> send units available
          </p>
          <p className="muted">
            Ask your administrator to allocate more units. One SMS part or one
            voice recipient uses one unit. Cancelled, unsent campaigns return
            their reserved allowance.
          </p>
          {user.phone && (
            <a className="text-link" href="/reset-password">
              <LockKeyhole size={15} /> Change password using phone verification
            </a>
          )}
        </section>
        <section className="panel settings-panel">
          <h3>A little help getting started</h3>
          <div className="help-steps">
            {[
              [
                "1",
                "Bring your people",
                "Create a list in My contacts, then upload a CSV with a phone column and an optional name column.",
                "/contacts",
              ],
              [
                "2",
                "Grow your audience",
                "Browse approved shared lists. Use them in campaigns while their contact details remain protected.",
                "/leads",
              ],
              [
                "3",
                "Start a conversation",
                "Choose SMS or voice, select your lists, and review your campaign before sending.",
                "/compose",
              ],
            ].map(([step, title, copy, href]) => (
              <a key={step} href={href}>
                <span>{step}</span>
                <div>
                  <h4>{title}</h4>
                  <p>{copy}</p>
                </div>
                <ArrowUpRight size={16} />
              </a>
            ))}
          </div>
          <p className="notice">
            New accounts start with no send allowance. Your administrator can
            grant units in People & access.
          </p>
        </section>
      </div>
    </>
  );
}
