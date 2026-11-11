import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CreditCard, Smartphone, Check, Save } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Textarea, Select, Field, Dialog, Badge } from "@ndc/ui";
import { api, post, patch, type Row } from "../lib/api";
import { money } from "../lib/billing";
import { number } from "../lib/shared";
import { PageHeading, Loading, QueryError, Empty, Status } from "./workspace";

const networks = ["MTN MoMo", "Telecel Cash", "AT Money"];
const when = (value: string) =>
  new Date(value.includes("T") ? value : value + "Z").toLocaleString();
const localTime = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function PaymentSummary({ order }: { order: Row }) {
  return (
    <div className="payment-summary">
      <div>
        <span>Voice credits</span>
        <strong>{number(order.credits)}</strong>
      </div>
      <div>
        <span>Quoted rate</span>
        <strong>{money(order.rate_pesewas)} / credit</strong>
      </div>
      <div>
        <span>Amount to pay</span>
        <strong>{money(order.total_pesewas)}</strong>
      </div>
      <div>
        <span>Payment number</span>
        <strong>{order.payment_phone}</strong>
      </div>
      <div>
        <span>Account name</span>
        <strong>{order.payment_name}</strong>
      </div>
      <div>
        <span>Payment network</span>
        <strong>{order.payment_network}</strong>
      </div>
    </div>
  );
}
export function VoiceCredits({ user }: { user: Row }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-settings"],
    queryFn: () => api("/billing/settings"),
    refetchInterval: 15000,
  });
  const orders = useQuery({
    queryKey: ["payment-orders"],
    queryFn: () => api("/billing/orders"),
    refetchInterval: 10000,
  });
  const [credits, setCredits] = useState(25);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(
    () => setSelectedId(new URLSearchParams(window.location.search).get("id")),
    [],
  );
  if (settings.isLoading || orders.isLoading) return <Loading />;
  if (settings.isError || orders.isError)
    return (
      <QueryError
        error={settings.error || orders.error}
        retry={() => {
          void settings.refetch();
          void orders.refetch();
        }}
      />
    );
  const config = settings.data.settings;
  const selected = orders.data.orders.find((row: Row) => row.id === selectedId);
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["payment-orders"] }),
      client.invalidateQueries({ queryKey: ["billing-settings"] }),
      client.invalidateQueries({ queryKey: ["me"] }),
    ]);
  }
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE CONVERSATION GOING"
        title="Voice credits"
        description="Pay with Mobile Money, submit your transaction details, and receive credits after administrator confirmation."
      />
      <div className="settings-grid payment-overview">
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="stat-icon green">
              <CreditCard size={22} />
            </span>
            <div>
              <h3>Buy voice credits</h3>
              <p>
                {number(settings.data.voiceCredits)} purchased credits available
              </p>
            </div>
          </div>
          <p className="notice">
            One voice recipient uses one credit. Purchased credits are used
            before your general send allowance and cannot be spent on SMS.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const result = await post("/billing/orders", { credits });
                await refresh();
                setSelectedId(result.order.id);
              } catch (error) {
                toast.error((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Number of voice credits">
              <Input
                type="number"
                min={1}
                max={100000}
                step={1}
                required
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value))}
              />
            </Field>
            <div className="payment-price">
              <span>{money(config.ratePesewas)} per credit</span>
              <strong>
                {money(
                  config.ratePesewas * (Number.isFinite(credits) ? credits : 0),
                )}
              </strong>
            </div>
            <Button busy={busy} className="full">
              Create payment request
            </Button>
          </form>
        </section>
        <section className="panel settings-panel">
          <div className="settings-title">
            <span className="stat-icon blue">
              <Smartphone size={22} />
            </span>
            <div>
              <h3>Pay with Mobile Money</h3>
              <p>Manual payment confirmation</p>
            </div>
          </div>
          <ol className="payment-steps">
            <li>
              Create a request to lock in the amount and payment destination.
            </li>
            <li>Send the exact amount to the number shown on that request.</li>
            <li>
              Enter the transaction ID and payment details. An administrator
              will be notified to review your payment.
            </li>
          </ol>
          <dl>
            <div>
              <dt>Current payment number</dt>
              <dd>{config.phone}</dd>
            </div>
            <div>
              <dt>Account name</dt>
              <dd>{config.name}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{config.network}</dd>
            </div>
          </dl>
          <p className="muted">
            Credits appear after approval. Check your notifications or payment
            history for updates.
          </p>
        </section>
      </div>
      <section className="panel settings-panel">
        <h3>Payment history</h3>
        {orders.data.orders.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Credits</th>
                  <th>Amount</th>
                  <th>Transaction ID</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.data.orders.map((order: Row) => (
                  <tr key={order.id}>
                    <td>{when(order.created_at)}</td>
                    <td>{number(order.credits)}</td>
                    <td>{money(order.total_pesewas)}</td>
                    <td>{order.transaction_id || "Not submitted"}</td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedId(order.id)}
                      >
                        {order.status === "approved"
                          ? "View payment"
                          : "Payment details"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={CreditCard}
            title="Your first voice credits"
            description="Create a payment request above to get started."
          />
        )}
      </section>
      {selected && (
        <Dialog
          open
          onOpenChange={() => setSelectedId(null)}
          title="Voice credit payment"
          description="Use the payment destination and amount saved with this request."
        >
          <Status value={selected.status} />
          <PaymentSummary order={selected} />
          {selected.review_note && (
            <p className="notice">Administrator: {selected.review_note}</p>
          )}
          {selected.status === "approved" ? (
            <p className="notice">
              {number(selected.credits)} voice credits were added on{" "}
              {when(selected.reviewed_at)}. Transaction:{" "}
              {selected.transaction_id}.
            </p>
          ) : (
            <form
              key={`${selected.id}:${selected.version}`}
              onSubmit={async (e) => {
                e.preventDefault();
                const values = Object.fromEntries(
                  new FormData(e.currentTarget),
                );
                setBusy(true);
                try {
                  await patch("/billing/orders/" + selected.id, {
                    ...values,
                    version: selected.version,
                    paidAt: new Date(String(values.paidAt)).toISOString(),
                  });
                  await refresh();
                  setSelectedId(null);
                  toast.success(
                    "Payment details submitted. Administrators have been notified.",
                  );
                } catch (error) {
                  toast.error((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="notice">
                After sending the payment, enter its details below. Submission
                does not automatically add credits.
              </p>
              <Field label="Mobile Money transaction ID">
                <Input
                  name="transactionId"
                  required
                  minLength={5}
                  maxLength={80}
                  defaultValue={selected.transaction_id || ""}
                />
              </Field>
              <div className="payment-form-grid">
                <Field label="Payer name">
                  <Input
                    name="payerName"
                    required
                    minLength={2}
                    maxLength={120}
                    defaultValue={selected.payer_name || user.name}
                  />
                </Field>
                <Field label="Payer phone number">
                  <Input
                    name="payerPhone"
                    type="tel"
                    required
                    maxLength={30}
                    defaultValue={selected.payer_phone || user.phone || ""}
                  />
                </Field>
                <Field label="Payer network">
                  <Select
                    name="payerNetwork"
                    defaultValue={selected.payer_network || networks[0]}
                  >
                    {networks.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount paid (GHC)">
                  <Input
                    name="paidAmount"
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    defaultValue={(
                      (selected.paid_pesewas || selected.total_pesewas) / 100
                    ).toFixed(2)}
                  />
                </Field>
              </div>
              <Field label="Payment date and time">
                <Input
                  name="paidAt"
                  type="datetime-local"
                  required
                  defaultValue={localTime(selected.paid_at)}
                />
              </Field>
              <Field label="Additional payment details (optional)">
                <Textarea
                  name="note"
                  maxLength={500}
                  defaultValue={selected.note}
                />
              </Field>
              <Button busy={busy} className="full">
                {selected.status === "pending"
                  ? "Update payment details"
                  : "Submit payment for confirmation"}
              </Button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

export function AdminPayments() {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-payments"],
    queryFn: () => api("/admin/payments"),
    refetchInterval: 10000,
  });
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<Row | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  useEffect(
    () => setDeepLink(new URLSearchParams(window.location.search).get("id")),
    [],
  );
  useEffect(() => {
    if (deepLink && q.data) {
      setSelected(q.data.payments.find((p: Row) => p.id === deepLink) || null);
      setDeepLink(null);
    }
  }, [deepLink, q.data]);
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const config = q.data.settings;
  const rows = q.data.payments.filter(
    (p: Row) => filter === "all" || p.status === filter,
  );
  async function review(decision: string, note: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await post(`/admin/payments/${selected.id}/review`, {
        decision,
        note,
        version: selected.version,
      });
      setSelected(null);
      await q.refetch();
      await client.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(
        decision === "approved"
          ? "Payment approved. Voice credits added."
          : "Payment rejected. The user has been notified.",
      );
    } catch (error) {
      toast.error((error as Error).message);
      const result = await q.refetch();
      setSelected(
        result.data.payments.find((p: Row) => p.id === selected.id) || null,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="REVIEW, CONFIRM, CREDIT"
        title="Mobile Money payments"
        description="Confirm received payments before adding voice credits to member accounts."
      >
        <Button variant="outline" onClick={() => setSettingsOpen(true)}>
          Payment settings
        </Button>
      </PageHeading>
      <div className="panel payment-admin-summary">
        <Badge tone={q.data.pending ? "amber" : "green"}>
          {q.data.pending} awaiting confirmation
        </Badge>
        <span>
          Rate: <strong>{money(config.ratePesewas)} / credit</strong>
        </span>
        <span>
          Receive at <strong>{config.phone}</strong> · {config.name}
        </span>
      </div>
      <div className="toolbar">
        <div className="segmented">
          {["pending", "approved", "rejected", "all"].map((status) => (
            <button
              key={status}
              className={filter === status ? "selected" : ""}
              onClick={() => setFilter(status)}
            >
              {status[0].toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <section className="panel">
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Transaction</th>
                  <th>Amount</th>
                  <th>Credits</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p: Row) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.user_name}</b>
                      <small className="table-sub">{p.payer_phone}</small>
                    </td>
                    <td>{p.transaction_id}</td>
                    <td>{money(p.total_pesewas)}</td>
                    <td>{number(p.credits)}</td>
                    <td>
                      <Status value={p.status} />
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(p)}
                      >
                        {p.status === "pending"
                          ? "Review payment"
                          : "View payment"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={CreditCard}
            title="No payments to show"
            description="Submitted payment details will appear here for review."
          />
        )}
      </section>
      <Dialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Voice credit payment settings"
        description="Changes apply to new requests. Existing requests keep their quoted rate and payment destination."
      >
        <form
          key={`${settingsOpen}:${config.ratePesewas}:${config.phone}:${config.name}`}
          onSubmit={async (e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            try {
              await patch("/admin/payment-settings", values);
              await q.refetch();
              await client.invalidateQueries({
                queryKey: ["billing-settings"],
              });
              setSettingsOpen(false);
              toast.success("Payment settings saved.");
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Price per voice credit (GHC)">
            <Input
              name="rate"
              type="number"
              min="0.01"
              max="1000"
              step="0.01"
              required
              defaultValue={(config.ratePesewas / 100).toFixed(2)}
            />
          </Field>
          <Field label="Mobile Money payment number">
            <Input
              name="phone"
              type="tel"
              required
              maxLength={30}
              defaultValue={config.phone}
            />
          </Field>
          <Field label="Payment account name">
            <Input
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={config.name}
            />
          </Field>
          <Field label="Receiving network">
            <Select name="network" defaultValue={config.network}>
              {["Mobile Money", ...networks].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </Field>
          <Button busy={busy} className="full">
            <Save size={16} /> Save payment settings
          </Button>
        </form>
      </Dialog>
      {selected && (
        <Dialog
          open
          onOpenChange={() => setSelected(null)}
          title="Review Mobile Money payment"
          description={`Submitted by ${selected.user_name}. Review revision ${selected.version}.`}
        >
          <Status value={selected.status} />
          <PaymentSummary order={selected} />
          <dl className="payment-details">
            <div>
              <dt>Transaction ID</dt>
              <dd>{selected.transaction_id}</dd>
            </div>
            <div>
              <dt>Payer</dt>
              <dd>
                {selected.payer_name} · {selected.payer_phone}
              </dd>
            </div>
            <div>
              <dt>Payer network</dt>
              <dd>{selected.payer_network}</dd>
            </div>
            <div>
              <dt>Amount reported</dt>
              <dd>{money(selected.paid_pesewas)}</dd>
            </div>
            <div>
              <dt>Payment time</dt>
              <dd>{when(selected.paid_at)}</dd>
            </div>
          </dl>
          {selected.note && (
            <p className="notice">Member details: {selected.note}</p>
          )}
          {selected.status === "pending" ? (
            <form
              key={`${selected.id}:${selected.version}`}
              onSubmit={(e) => {
                e.preventDefault();
                void review(
                  "approved",
                  String(new FormData(e.currentTarget).get("note") || ""),
                );
              }}
            >
              <p className="notice">
                Verify this transaction and amount in the receiving Mobile Money
                account before approving. A submitted transaction ID is not
                proof that payment was received.
              </p>
              <Field label="Review note / rejection reason">
                <Textarea name="note" maxLength={500} />
              </Field>
              <div className="dialog-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={(e) => {
                    const form = e.currentTarget.closest("form")!;
                    void review(
                      "rejected",
                      String(new FormData(form).get("note") || ""),
                    );
                  }}
                >
                  Reject payment
                </Button>
                <Button busy={busy}>
                  <Check size={16} /> Confirm payment & add{" "}
                  {number(selected.credits)} credits
                </Button>
              </div>
            </form>
          ) : (
            <p className="notice">
              Reviewed by {selected.reviewer_name || "administrator"} on{" "}
              {when(selected.reviewed_at)}. {selected.review_note}
            </p>
          )}
        </Dialog>
      )}
    </>
  );
}

export function NotificationBell() {
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api("/notifications"),
    refetchInterval: 15000,
  });
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className="notification-trigger"
        aria-label={`Notifications (${q.data?.unread || 0} unread)`}
        onClick={() => setOpen(true)}
      >
        <Bell size={20} />
        {q.data?.unread > 0 && (
          <Badge tone="red">{q.data.unread > 99 ? "99+" : q.data.unread}</Badge>
        )}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Notifications"
        description="Payment updates and account activity."
      >
        {q.isLoading ? (
          <Loading />
        ) : q.isError ? (
          <QueryError error={q.error} retry={() => void q.refetch()} />
        ) : (
          <>
            {q.data.unread > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await post("/notifications/read-all");
                    await q.refetch();
                  } catch (error) {
                    toast.error((error as Error).message);
                  }
                }}
              >
                Mark all as read
              </Button>
            )}
            <div className="notification-list">
              {q.data.notifications.map((n: Row) => (
                <a
                  className={!n.read_at ? "unread" : ""}
                  key={n.id}
                  href={n.href}
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      await post(`/notifications/${n.id}/read`);
                      window.location.assign(n.href);
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}
                >
                  <strong>{n.title}</strong>
                  <span>{n.message}</span>
                  <small>{when(n.created_at)}</small>
                </a>
              ))}
            </div>
            {!q.data.notifications.length && (
              <Empty
                icon={Bell}
                title="You’re up to date"
                description="Payment notifications will appear here."
              />
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
