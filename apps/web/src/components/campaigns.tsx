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
} from "lucide-react";
import { Button, Input, Textarea, Select, Field, Dialog, Badge } from "@ndc/ui";
import { api, post, type Row } from "../lib/api";
import { smsParts, number } from "../lib/shared";
import { audioFormats } from "../lib/billing";
import { Empty, Loading, QueryError, PageHeading, Status } from "./workspace";
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
          id={selected}
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
  close,
  onChange,
}: {
  id: string;
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
  async function act(action: string) {
    setBusy(true);
    try {
      await post(`/campaigns/${id}/${action}`);
      toast.success(
        action === "cancel"
          ? "Campaign cancelled."
          : "Campaign queued for sending.",
      );
      setConfirm(false);
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
          <div className="dialog-actions">
            {c.status === "attention" &&
              q.data.breakdown.some((r: Row) => r.status === "pending") && (
                <Button busy={busy} onClick={() => void act("resume")}>
                  Resume unsent recipients
                </Button>
              )}
            {c.status === "draft" && (
              <Button busy={busy} onClick={() => setConfirm(true)}>
                <Send size={15} /> Send campaign
              </Button>
            )}
            {["draft", "queued", "scheduled", "attention"].includes(
              c.status,
            ) && (
              <Button
                variant="outline"
                busy={busy}
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
          {confirm && (
            <div className="confirm-send">
              <h3>Ready to send?</h3>
              <p>
                This will submit your campaign to the selected audience and use
                your send allowance.
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
export function Composer({ user }: { user: Row }) {
  const [channel, setChannel] = useState("sms");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [ids, setIds] = useState<string[]>([]);
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
      setAudio(await post("/audio", form));
      toast.success("Recording uploaded.");
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
                  <label
                    key={l.id}
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
                ))}
              </div>
            ) : (
              <Empty
                icon={Users}
                title="Your audience is waiting"
                description="Create a list and import contacts before sending."
                action={
                  <Button asChild variant="outline">
                    <a href="/contacts">
                      Add contacts <ArrowRight size={15} />
                    </a>
                  </Button>
                }
              />
            )}
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
                  <Input value={config.data?.sender || "NDC"} readOnly />
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
                    {audio ? audio.filename : "Upload your voice recording"}
                  </strong>
                  <span>MP3, WAV, FLAC, AAC, WMA, M4A, OGG · up to 10 MB</span>
                  <input
                    aria-label="Voice recording"
                    disabled={busy}
                    type="file"
                    accept={audioFormats}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        setDraftId(null);
                        void upload(e.target.files[0]);
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
              <strong>{config.data?.sender || "NDC"}</strong>
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
                  : "Your allowance"}
              </span>
              <b>
                {number(
                  user.allowance +
                    (channel === "voice" ? user.voice_credits || 0 : 0),
                )}
              </b>
            </div>
            <p>
              {channel === "voice" ? (
                <>
                  {number(user.voice_credits || 0)} purchased voice credits plus{" "}
                  {number(user.allowance)} general send units.{" "}
                  <a href="/credits">Buy voice credits</a>.
                </>
              ) : (
                "SMS uses your administrator-managed send allowance."
              )}
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
          your send allowance.
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
