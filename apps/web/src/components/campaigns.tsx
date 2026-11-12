import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Send,
  Plus,
  Search,
  MessageSquare,
  Mic,
  Users,
  Check,
  ArrowLeft,
  ArrowRight,
  Upload,
  CalendarDays,
  Download,
  Ban,
  FileText,
  Radio,
  Copy,
  RefreshCw,
  Pencil,
  X,
} from "lucide-react";
import { Button, Input, Textarea, Select, Field, Dialog, Badge } from "@ndc/ui";
import { api, post, patch, type Row } from "../lib/api";
import { smsParts, number } from "../lib/shared";
import { audioFormats } from "../lib/billing";
import { Empty, Loading, QueryError, PageHeading, Status } from "./workspace";
import { ContactManager, CreateContactList } from "./contacts";
export function Campaigns({ admin = false }: { admin?: boolean }) {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["campaigns", admin],
    queryFn: () => api("/campaigns" + (admin ? "?admin=true" : "")),
    refetchInterval: 10000,
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setSearch(p.get("q") || "");
    setSelected(p.get("id"));
  }, []);
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const campaigns = q.data.campaigns.filter(
    (c: Row) =>
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || c.channel === filter),
  );
  return (
    <>
      <PageHeading
        eyebrow={
          admin ? "MESSAGING ACROSS THE PLATFORM" : "MEANINGFUL MESSAGES"
        }
        title={admin ? "All campaigns" : "Your campaigns"}
        description="Create, track, and learn from every conversation."
      >
        <Button asChild>
          <a href="/compose">
            <Plus size={17} /> New campaign
          </a>
        </Button>
      </PageHeading>
      {!q.data.workerActive &&
        q.data.campaigns.some((c: Row) => c.status === "queued") && (
          <p className="notice" role="status">
            Queued campaigns are waiting for the sending service, which has not
            checked in recently.
            {admin
              ? " Start the campaign worker to send them; see Gateway settings for service status."
              : " Contact your administrator to restore sending."}
          </p>
        )}
      <div className="toolbar">
        <div className="segmented">
          {[
            ["all", "All campaigns"],
            ["sms", "SMS"],
            ["voice", "Voice"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <Input
            aria-label="Search campaign list"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <section className="panel">
        {campaigns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  {admin && <th>Owner</th>}
                  <th>Channel</th>
                  <th>Recipients</th>
                  <th>Delivered</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c: Row) => (
                  <tr key={c.id}>
                    <td>
                      <button
                        className="table-title text-button"
                        onClick={() => setSelected(c.id)}
                      >
                        <span className={`channel-icon ${c.channel}`}>
                          {c.channel === "sms" ? (
                            <MessageSquare size={18} />
                          ) : (
                            <Mic size={18} />
                          )}
                        </span>
                        <b>{c.name}</b>
                      </button>
                    </td>
                    {admin && <td>{c.owner_name}</td>}
                    <td>{c.channel === "sms" ? "SMS" : "Voice"}</td>
                    <td>{number(c.recipients)}</td>
                    <td>{number(c.delivered)}</td>
                    <td>
                      <Status value={c.status} />
                    </td>
                    <td>
                      {new Date(c.created_at + "Z").toLocaleDateString("en-GB")}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(c.id)}
                      >
                        View <ArrowRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={Send}
            title={
              search
                ? "No matching campaigns"
                : "Your next conversation starts here"
            }
            description="Send a message or let your community hear your voice."
            action={
              <Button asChild>
                <a href="/compose">
                  <Plus size={16} /> Create a campaign
                </a>
              </Button>
            }
          />
        )}
      </section>
      {selected && (
        <CampaignDetail
          key={selected}
          id={selected}
          openCampaign={setSelected}
          close={() => setSelected(null)}
          onChange={() =>
            void client.invalidateQueries({ queryKey: ["campaigns"] })
          }
        />
      )}
    </>
  );
}
function CampaignDetail({
  id,
  openCampaign,
  close,
  onChange,
}: {
  id: string;
  openCampaign: (id: string) => void;
  close: () => void;
  onChange: () => void;
}) {
  const q = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api("/campaigns/" + id),
    refetchInterval: 5000,
  });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [retryConfirm, setRetryConfirm] = useState(false);
  const [editingAudience, setEditingAudience] = useState(false);
  async function act(action: string) {
    setBusy(true);
    try {
      const result = await post(`/campaigns/${id}/${action}`);
      if (action === "clone") {
        onChange();
        openCampaign(result.id);
        toast.success("Campaign copy created. Review it before sending.");
        return;
      }
      toast.success(
        action === "cancel"
          ? "Campaign cancelled."
          : "Campaign queued for sending.",
      );
      setConfirm(false);
      setRetryConfirm(false);
      void q.refetch();
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = q.data?.campaign;
  return (
    <Dialog
      open
      onOpenChange={close}
      title={c?.name || "Campaign details"}
      description="Track this campaign and review recipient results."
    >
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <QueryError error={q.error} retry={() => void q.refetch()} />
      ) : (
        <>
          <div className="detail-summary">
            <Status value={c.status} />
            <Badge>{c.channel === "sms" ? "SMS" : "Voice"}</Badge>
            <Badge>{c.provider === "mnotify" ? "mNotify" : "Arkesel"}</Badge>
            <span>{number(c.recipients)} recipients</span>
            {c.channel === "sms" && <span>Sender: {c.sender}</span>}
          </div>
          {c.error && <p className="error">{c.error}</p>}
          {c.status === "queued" && !q.data.workerActive && (
            <p className="notice" role="status">
              This campaign has not been sent. The sending service has not
              checked in recently; an administrator needs to start the campaign
              worker.
            </p>
          )}
          {c.message && (
            <blockquote className="message-preview">{c.message}</blockquote>
          )}
          {c.scheduled_at && (
            <p className="notice">
              <CalendarDays size={16} /> Scheduled for{" "}
              {new Date(c.scheduled_at).toLocaleString()}
            </p>
          )}
          <div className="breakdown">
            {q.data.breakdown.map((r: Row) => (
              <div key={r.status}>
                <strong>{number(r.count)}</strong>
                <Status value={r.status} />
              </div>
            ))}
          </div>
          <p className="muted">
            Accepted means the provider received the message. Delivered means a
            delivery report confirmed it. Unknown results need reconciliation
            before resending.
          </p>
          {c.source_campaign_id && (
            <p className="notice">
              This is a new copy. Sending uses the selected lists’ current
              eligible contacts and deducts{" "}
              {c.channel === "sms" ? "SMS" : "voice"} credits.
            </p>
          )}
          <div className="dialog-actions">
            {["draft", "cancelled"].includes(c.status) && (
              <Button
                variant="outline"
                disabled={busy || editingAudience}
                onClick={() => {
                  setConfirm(false);
                  setEditingAudience(true);
                }}
              >
                <Users size={15} /> Edit contact lists
              </Button>
            )}
            {["completed", "cancelled"].includes(c.status) && (
              <Button
                variant="outline"
                busy={busy}
                disabled={editingAudience}
                onClick={() => void act("clone")}
              >
                <Copy size={15} />{" "}
                {c.status === "cancelled"
                  ? "Resend campaign"
                  : "Clone and resend"}
              </Button>
            )}
            {["attention", "completed", "failed", "rejected"].includes(
              c.status,
            ) &&
              q.data.breakdown.some((r: Row) =>
                ["failed", "rejected"].includes(r.status),
              ) && (
                <Button busy={busy} onClick={() => setRetryConfirm(true)}>
                  <RefreshCw size={15} /> Retry failed recipients
                </Button>
              )}
            {c.status === "attention" &&
              q.data.breakdown.some((r: Row) => r.status === "pending") && (
                <Button busy={busy} onClick={() => void act("resume")}>
                  Resume unsent recipients
                </Button>
              )}
            {c.status === "draft" && (
              <Button
                busy={busy}
                disabled={editingAudience}
                onClick={() => setConfirm(true)}
              >
                <Send size={15} /> Send campaign
              </Button>
            )}
            {["draft", "queued", "scheduled", "attention"].includes(
              c.status,
            ) && (
              <Button
                variant="outline"
                busy={busy}
                disabled={editingAudience}
                onClick={() => void act("cancel")}
              >
                <Ban size={15} /> Cancel campaign
              </Button>
            )}
            <Button variant="outline" asChild>
              <a href={`/api/campaigns/${id}/export`}>
                <Download size={15} /> Export report
              </a>
            </Button>
          </div>
          {c.status === "cancelled" && (
            <p className="notice">
              Resend creates a new draft using these contact lists. Review it
              before sending to the entire selected audience again, including
              anyone who received an earlier attempt. The cancelled campaign’s
              report is preserved.
            </p>
          )}
          {editingAudience && (
            <CampaignAudience
              campaign={c}
              close={() => setEditingAudience(false)}
              saved={() => {
                setEditingAudience(false);
                void q.refetch();
                onChange();
              }}
            />
          )}
          {retryConfirm && (
            <div className="confirm-send">
              <h3>Retry failed recipients?</h3>
              <p>
                Failed and rejected recipients will be retried using new{" "}
                {c.channel === "sms" ? "SMS" : "voice"} credits. Unsent
                recipients keep their existing reservation. Delivered, accepted,
                unknown, and opted-out recipients will not be retried.
              </p>
              <Button busy={busy} onClick={() => void act("retry")}>
                Confirm retry
              </Button>
              <Button variant="ghost" onClick={() => setRetryConfirm(false)}>
                Go back
              </Button>
            </div>
          )}
          {confirm && (
            <div className="confirm-send">
              <h3>Ready to send?</h3>
              <p>
                This will submit your campaign to the selected audience and use
                your {c.channel === "sms" ? "SMS" : "voice"} credits.
              </p>
              <Button busy={busy} onClick={() => void act("queue")}>
                Confirm and queue
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Go back
              </Button>
            </div>
          )}
          <div className="contacts-scroll">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data.deliveries.map((d: Row) => (
                  <tr key={d.id}>
                    <td>
                      {d.phone}
                      {d.error && (
                        <small className="table-sub">{d.error}</small>
                      )}
                    </td>
                    <td>
                      <Status value={d.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.recipients > 100 && (
            <p className="muted">
              Showing the latest 100 recipients. Export for the full report.
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
function CampaignAudience({
  campaign,
  close,
  saved,
}: {
  campaign: Row;
  close: () => void;
  saved: () => void;
}) {
  const [ids, setIds] = useState<string[]>(JSON.parse(campaign.list_ids));
  const [busy, setBusy] = useState(false);
  const [editingList, setEditingList] = useState<Row | null>(null);
  const lists = useQuery({
    queryKey: ["campaign-audience", campaign.id],
    queryFn: () => api(`/campaigns/${campaign.id}/audience`),
  });
  const unavailable =
    lists.data &&
    ids.filter((id) => !lists.data.lists.some((list: Row) => list.id === id));
  async function save() {
    setBusy(true);
    try {
      await patch(`/campaigns/${campaign.id}/audience`, { listIds: ids });
      toast.success("Campaign contact lists updated.");
      saved();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="campaign-audience"
      aria-label="Edit campaign contact lists"
    >
      <h3>Campaign contact lists</h3>
      <p className="muted">
        Choose the lists to use when this campaign is sent. Contacts are
        refreshed at sending time.
      </p>
      {lists.isLoading ? (
        <Loading />
      ) : lists.isError ? (
        <QueryError error={lists.error} retry={() => void lists.refetch()} />
      ) : (
        <>
          {!!unavailable?.length && (
            <p className="notice">
              Some previously selected lists are no longer available.{" "}
              <button
                type="button"
                className="contact-us-link"
                onClick={() =>
                  setIds(ids.filter((id) => !unavailable.includes(id)))
                }
              >
                Remove unavailable lists
              </button>
            </p>
          )}
          <div className="audience-list">
            {lists.data.lists.map((list: Row) => (
              <div className="audience-row" key={list.id}>
                <label
                  className={`audience-option ${ids.includes(list.id) ? "checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={ids.includes(list.id)}
                    disabled={busy}
                    onChange={(e) =>
                      setIds((current) =>
                        e.target.checked
                          ? [...current, list.id]
                          : current.filter((id) => id !== list.id),
                      )
                    }
                  />
                  <span>
                    <strong>{list.name}</strong>
                    <small>
                      {number(list.contact_count)} contacts ·{" "}
                      {list.visibility === "shared" ? "Shared" : "Private"}
                    </small>
                  </span>
                </label>
                {list.canEdit && (
                  <div className="audience-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setEditingList(list)}
                    >
                      <Pencil size={14} /> Manage contacts
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {!lists.data.lists.length && (
            <p className="notice">
              Create a contact list in My contacts, then return here to select
              it.
            </p>
          )}
        </>
      )}
      <div className="dialog-actions">
        <Button
          busy={busy}
          disabled={
            !ids.length ||
            ids.length > 50 ||
            !lists.data ||
            !!unavailable?.length
          }
          onClick={() => void save()}
        >
          Save contact lists
        </Button>
        <Button variant="ghost" disabled={busy} onClick={close}>
          Discard changes
        </Button>
      </div>
      {editingList && (
        <ContactManager
          list={editingList}
          close={() => {
            setEditingList(null);
            void lists.refetch();
          }}
        />
      )}
    </section>
  );
}
export function Composer({ user }: { user: Row }) {
  const [channel, setChannel] = useState("sms");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [senderId, setSenderId] = useState("");
  const senderIds = useQuery({
    queryKey: ["my-sender-ids"],
    queryFn: () => api("/sender-ids"),
    refetchInterval: 15000,
  });
  const selectedSender = senderIds.data?.senders.find(
    (s: Row) => s.id === senderId,
  );
  const [ids, setIds] = useState<string[]>([]);
  const [createList, setCreateList] = useState(false);
  const [editingList, setEditingList] = useState<Row | null>(null);
  const [audio, setAudio] = useState<Row | null>(null);
  const [scheduled, setScheduled] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [consent, setConsent] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const lists = useQuery({
    queryKey: ["compose-lists"],
    queryFn: async () => {
      const [own, shared] = await Promise.all([
        api("/lists"),
        api("/lists?shared=true"),
      ]);
      return [
        ...new Map(
          [...own.lists, ...shared.lists].map((r: Row) => [r.id, r]),
        ).values(),
      ] as Row[];
    },
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/config"),
  });
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("channel") === "voice") setChannel("voice");
    if (p.get("list")) setIds([p.get("list")!]);
  }, []);
  const recipients = (lists.data || [])
    .filter((l) => ids.includes(l.id))
    .reduce((a, l) => a + l.contact_count, 0);
  const parts = smsParts(message);
  const units = recipients * (channel === "sms" ? parts.parts : 1);
  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const recording = await post("/audio", form);
      setAudio(recording);
      toast.success(
        recording.converted
          ? "Recording converted to WAV and uploaded."
          : "Recording uploaded.",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function validate() {
    if (name.trim().length < 2) throw new Error("Give your campaign a name.");
    if (!ids.length) throw new Error("Choose at least one audience.");
    if (channel === "sms" && !message.trim())
      throw new Error("Write a message.");
    if (channel === "voice" && !audio)
      throw new Error("Upload a voice recording.");
    if (scheduled && new Date(scheduled).getTime() <= Date.now())
      throw new Error("Choose a future delivery time.");
  }
  async function save(send: boolean) {
    setBusy(true);
    try {
      validate();
      let current = draftId;
      if (!current) {
        const result = await post("/campaigns", {
          name,
          channel,
          senderId: channel === "sms" ? senderId || null : null,
          message,
          audioId: audio?.id || null,
          listIds: ids,
          scheduledAt: scheduled ? new Date(scheduled).getTime() : null,
        });
        current = result.id;
        setDraftId(current);
      }
      if (send) await post(`/campaigns/${current}/queue`);
      toast.success(
        send ? "Your campaign is queued." : "Campaign saved as a draft.",
      );
      window.location.assign("/campaigns?id=" + current);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {createList && (
        <CreateContactList
          close={() => setCreateList(false)}
          onCreated={(list) => {
            setIds((current) => [...current, list.id]);
            setDraftId(null);
            setEditingList({ ...list, owner_id: user.id });
          }}
        />
      )}
      {editingList && (
        <ContactManager
          list={
            lists.data?.find((list) => list.id === editingList.id) ||
            editingList
          }
          close={() => {
            setEditingList(null);
            setDraftId(null);
          }}
        />
      )}
      <a href="/campaigns" className="back-link">
        <ArrowLeft size={15} /> Back to campaigns
      </a>
      <PageHeading
        eyebrow="START A CONVERSATION"
        title="Make your message matter."
        description="The right message. The right people. A stronger connection."
      />
      <div className="composer-grid">
        <div>
          <section className="panel form-panel">
            <div className="step-heading">
              <span>01</span>
              <div>
                <h3>Choose your channel</h3>
                <p>How would you like to reach your people?</p>
              </div>
            </div>
            <div className="channel-options">
              {[
                {
                  value: "sms",
                  title: "SMS message",
                  sub: "A few words. A lasting impact.",
                  icon: MessageSquare,
                },
                {
                  value: "voice",
                  title: "Voice message",
                  sub: "Let them hear it from you.",
                  icon: Mic,
                },
              ].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`channel-option ${channel === o.value ? "chosen" : ""}`}
                  onClick={() => {
                    setChannel(o.value);
                    setDraftId(null);
                  }}
                >
                  <o.icon size={23} />
                  <strong>{o.title}</strong>
                  <span>{o.sub}</span>
                  <i>{channel === o.value && <Check size={11} />}</i>
                </button>
              ))}
            </div>
            <Field
              label="Campaign name"
              hint="Only you can see this. Make it easy to recognise."
            >
              <Input
                value={name}
                maxLength={120}
                onChange={(e) => {
                  setName(e.target.value);
                  setDraftId(null);
                }}
                placeholder="e.g. Community meeting reminder"
              />
            </Field>
          </section>
          <section className="panel form-panel">
            <div className="step-heading">
              <span>02</span>
              <div>
                <h3>Bring your audience</h3>
                <p>Select your own lists or approved shared leads.</p>
              </div>
            </div>
            {lists.isError ? (
              <QueryError
                error={lists.error}
                retry={() => void lists.refetch()}
              />
            ) : lists.isLoading ? (
              <Loading />
            ) : lists.data?.length ? (
              <div className="audience-list">
                {lists.data.map((l) => (
                  <div
                    key={l.id}
                    className={`audience-row ${ids.includes(l.id) ? "attached" : ""}`}
                  >
                    <label
                      className={`audience-option ${ids.includes(l.id) ? "checked" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={ids.includes(l.id)}
                        onChange={() => {
                          setIds(
                            ids.includes(l.id)
                              ? ids.filter((i) => i !== l.id)
                              : [...ids, l.id],
                          );
                          setDraftId(null);
                        }}
                      />
                      <span className="list-icon small-icon">
                        <Users size={18} />
                      </span>
                      <span>
                        <strong>{l.name}</strong>
                        <small>
                          {l.owner_id === user.id
                            ? "Your list"
                            : "Shared by " + l.owner_name}{" "}
                          · {l.category}
                        </small>
                      </span>
                      <Badge>{number(l.contact_count)}</Badge>
                    </label>
                    {ids.includes(l.id) && (
                      <div className="audience-actions">
                        {(l.owner_id === user.id || user.role === "admin") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${l.name}`}
                            onClick={() => setEditingList(l)}
                          >
                            <Pencil size={14} /> Edit
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${l.name} from campaign`}
                          onClick={() => {
                            setIds((current) =>
                              current.filter((id) => id !== l.id),
                            );
                            setDraftId(null);
                          }}
                        >
                          <X size={14} /> Remove
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                icon={Users}
                title="Your audience is waiting"
                description="Create a list and import contacts before sending."
              />
            )}
            <Button
              className="new-audience"
              variant="outline"
              onClick={() => setCreateList(true)}
            >
              <Plus size={16} /> New contact list
            </Button>
            <p className="field-hint">
              Duplicate numbers and opted-out contacts are removed automatically
              before sending.
            </p>
          </section>
          <section className="panel form-panel">
            <div className="step-heading">
              <span>03</span>
              <div>
                <h3>
                  {channel === "sms"
                    ? "Find the right words"
                    : "Give your message a voice"}
                </h3>
                <p>
                  {channel === "sms"
                    ? "Keep it clear, warm, and relevant."
                    : "Upload your recorded message and listen before sending."}
                </p>
              </div>
            </div>
            {channel === "sms" ? (
              <>
                <Field label="Sender ID">
                  <Select
                    value={senderId}
                    onChange={(e) => {
                      setSenderId(e.target.value);
                      setDraftId(null);
                    }}
                  >
                    <option value="">
                      {config.data?.sender || "NDC"} (platform default)
                    </option>
                    {(senderIds.data?.senders || [])
                      .filter(
                        (s: Row) =>
                          s.status === "approved" &&
                          s.provider === config.data?.provider,
                      )
                      .map((s: Row) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                  <a className="text-link" href="/sender-ids">
                    Request a Sender ID
                  </a>
                </Field>
                <Field label="Your message">
                  <Textarea
                    rows={6}
                    value={message}
                    maxLength={1600}
                    placeholder="Hello! We’d love to see you at…"
                    onChange={(e) => {
                      setMessage(e.target.value);
                      setDraftId(null);
                    }}
                  />
                </Field>
                <div className="message-count">
                  <span>
                    {parts.encoding} · {parts.parts} SMS{" "}
                    {parts.parts === 1 ? "part" : "parts"} per recipient
                  </span>
                  <span>{message.length}/1,600</span>
                </div>
              </>
            ) : (
              <>
                <label className="upload-zone">
                  <Upload size={28} />
                  <strong>
                    {busy
                      ? "Preparing your recording…"
                      : audio
                        ? audio.filename
                        : "Upload your voice recording"}
                  </strong>
                  <span>Audio recordings · up to 10 MB</span>
                  <span>Other formats are automatically converted to WAV.</span>
                  <input
                    aria-label="Voice recording"
                    disabled={busy}
                    type="file"
                    accept={audioFormats}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setDraftId(null);
                        void upload(e.target.files[0]);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                {audio && (
                  <>
                    <audio className="audio-player" controls src={audio.url} />
                    <p className="muted">
                      If your browser cannot preview this format,{" "}
                      <a href={audio.url} download={audio.filename}>
                        download the recording
                      </a>{" "}
                      to listen.
                    </p>
                  </>
                )}
              </>
            )}
            <Field
              label="Delivery time"
              hint="Leave blank to send as soon as the worker picks up your campaign. Times use your device timezone."
            >
              <Input
                type="datetime-local"
                value={scheduled}
                onChange={(e) => {
                  setScheduled(e.target.value);
                  setDraftId(null);
                }}
              />
            </Field>
          </section>
        </div>
        <aside className="compose-aside">
          <section className="phone-preview">
            <div className="phone-notch" />
            <div className="phone-header">
              <span>9:41</span>
              <span>••• ▰</span>
            </div>
            <div className="phone-contact">
              <span className="phone-avatar">
                {channel === "sms" ? (
                  <MessageSquare size={22} />
                ) : (
                  <Mic size={22} />
                )}
              </span>
              <strong>
                {selectedSender?.name || config.data?.sender || "NDC"}
              </strong>
              <small>
                {channel === "sms" ? "Text message" : "Voice message"}
              </small>
            </div>
            <span className="phone-today">TODAY</span>
            <div className="phone-message">
              {channel === "sms" ? (
                message ||
                "Your message will appear here. A few words can bring a whole community closer."
              ) : (
                <>
                  <Radio size={24} />
                  <span>
                    {audio?.filename || "Your voice, their next connection."}
                  </span>
                </>
              )}
            </div>
            <p className="phone-preview-label">RECIPIENT PREVIEW</p>
          </section>
          <section className="panel campaign-summary">
            <h3>Campaign summary</h3>
            <div>
              <span>Channel</span>
              <b>{channel === "sms" ? "SMS" : "Voice"}</b>
            </div>
            <div>
              <span>Selected lists</span>
              <b>{ids.length}</b>
            </div>
            <div>
              <span>Contacts before deduplication</span>
              <b>{number(recipients)}</b>
            </div>
            <div>
              <span>Maximum send units</span>
              <b>{number(units)}</b>
            </div>
            <div>
              <span>
                {channel === "voice"
                  ? "Available voice sends"
                  : "Available SMS credits"}
              </span>
              <b>
                {number(
                  channel === "voice"
                    ? user.voice_credits || 0
                    : user.allowance,
                )}
              </b>
            </div>
            <p>
              {channel === "voice"
                ? "Voice campaigns use voice credits only."
                : "Text broadcasts use SMS credits only, one per SMS part per recipient."}{" "}
              <a href="/credits">Buy credits</a>.
            </p>
            <Button
              className="full"
              busy={busy}
              onClick={() => {
                try {
                  validate();
                  setReview(true);
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              Review campaign <ArrowRight size={16} />
            </Button>
            <Button
              variant="ghost"
              className="full"
              busy={busy}
              onClick={() => void save(false)}
            >
              <FileText size={15} /> Save as draft
            </Button>
          </section>
        </aside>
      </div>
      <Dialog
        open={review}
        onOpenChange={setReview}
        title="Ready to connect?"
        description="Review your campaign before submitting it to the sending queue."
      >
        <div className="review-summary">
          <h3>{name}</h3>
          <p>
            {channel === "sms" ? "SMS message" : "Voice recording"} · up to{" "}
            {number(recipients)} recipients
          </p>
          <p>
            {scheduled
              ? "Scheduled for " + new Date(scheduled).toLocaleString()
              : "Send as soon as possible"}
          </p>
          {channel === "sms" ? (
            <blockquote className="message-preview">{message}</blockquote>
          ) : (
            audio && <audio controls src={audio.url} />
          )}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          I have reviewed the audience and message and am ready to send this
          campaign.
        </label>
        <p className="muted">
          Repeated numbers and opted-out contacts will be excluded. Queuing uses
          your {channel === "sms" ? "SMS" : "voice"} credits.
        </p>
        <Button
          className="full"
          disabled={!consent}
          busy={busy}
          onClick={() => void save(true)}
        >
          <Send size={16} />{" "}
          {scheduled ? "Schedule campaign" : "Confirm and send"}
        </Button>
      </Dialog>
    </>
  );
}
