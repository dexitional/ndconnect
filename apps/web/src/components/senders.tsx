import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Input, Textarea, Select, Field, Dialog } from "@ndc/ui";
import { api, post, type Row } from "../lib/api";
import { PageHeading, Loading, QueryError, Status, Empty } from "./workspace";

export function SenderIds({ admin = false }: { admin?: boolean }) {
  const q = useQuery({
    queryKey: ["sender-ids", admin],
    queryFn: () => api(admin ? "/admin/sender-ids" : "/sender-ids"),
    refetchInterval: 10000,
  });
  const [selected, setSelected] = useState<Row | null>(null);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  async function review(decision: string, form: HTMLFormElement) {
    const data = new FormData(form);
    setBusy(true);
    try {
      await post(`/admin/sender-ids/${selected!.id}/review`, {
        decision,
        version: selected!.version,
        note: data.get("note"),
        gatewayRegistered: data.get("registered") === "on",
      });
      setSelected(null);
      await q.refetch();
      toast.success("Sender ID updated. Notifications have been queued.");
    } catch (e) {
      toast.error((e as Error).message);
      const latest = await q.refetch();
      setSelected(
        latest.data.senders.find((r: Row) => r.id === selected!.id) || null,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={admin ? "Sender ID approvals" : "SMS Sender IDs"}
        description={
          admin
            ? "Register the requested name on its gateway, then confirm approval for the member."
            : "Request a branded sender name for your SMS campaigns. It becomes available after gateway registration and administrator approval."
        }
      >
        {!admin && (
          <Button onClick={() => setCreate(true)}>Request Sender ID</Button>
        )}
      </PageHeading>
      {!admin && (
        <p className="notice">
          Sender IDs are approved separately for Arkesel and mNotify. Requests
          and decisions are sent to your verified phone and workspace
          notifications.
        </p>
      )}
      <section className="panel">
        {q.data.senders.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sender ID</th>
                  {admin && <th>Member</th>}
                  <th>Gateway</th>
                  <th>Status</th>
                  <th>Purpose / review note</th>
                  {admin && <th />}
                </tr>
              </thead>
              <tbody>
                {q.data.senders.map((s: Row) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    {admin && (
                      <td>
                        {s.user_name}
                        <small className="table-sub">{s.user_phone}</small>
                      </td>
                    )}
                    <td>{s.provider === "mnotify" ? "mNotify" : "Arkesel"}</td>
                    <td>
                      <Status value={s.status} />
                    </td>
                    <td>
                      {s.purpose}
                      {s.review_note && (
                        <small className="table-sub">{s.review_note}</small>
                      )}
                    </td>
                    {admin && (
                      <td>
                        {["pending", "approved"].includes(s.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelected(s)}
                          >
                            {s.status === "approved"
                              ? "Manage approval"
                              : "Review request"}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No Sender ID requests"
            description="New requests will appear here."
          />
        )}
      </section>
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title="Request an SMS Sender ID"
        description="Use up to 11 letters and numbers, including at least one letter."
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            try {
              await post("/sender-ids", data);
              setCreate(false);
              await q.refetch();
              toast.success(
                "Sender ID requested. Notifications have been queued.",
              );
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Sender name">
            <Input
              name="name"
              required
              minLength={1}
              maxLength={11}
              pattern="(?=.*[A-Za-z])[A-Za-z0-9]+"
            />
          </Field>
          <Field label="Gateway">
            <Select name="provider" defaultValue={q.data.provider || "arkesel"}>
              <option value="arkesel">Arkesel</option>
              <option value="mnotify">mNotify</option>
            </Select>
          </Field>
          <Field label="Organization and purpose">
            <Textarea
              name="purpose"
              minLength={10}
              maxLength={500}
              required
              placeholder="Your organization and the messages you plan to send"
            />
          </Field>
          <Button className="full" busy={busy}>
            Submit Sender ID request
          </Button>
        </form>
      </Dialog>
      {selected && (
        <Dialog
          open
          onOpenChange={() => setSelected(null)}
          title={`Review ${selected.name}`}
          description={`${selected.user_name} · ${selected.provider} · Revision ${selected.version}`}
        >
          <p className="notice">{selected.purpose}</p>
          <p>
            Register this exact name in the{" "}
            {selected.provider === "mnotify" ? "mNotify" : "Arkesel"} gateway
            account and wait for gateway approval.{" "}
            {selected.provider === "mnotify"
              ? "Approval also checks mNotify’s Sender ID status."
              : "Record the dashboard or support confirmation in your review note."}
          </p>
          <form
            key={`${selected.id}:${selected.version}`}
            onSubmit={(e) => {
              e.preventDefault();
              void review(
                selected.status === "approved" ? "revoked" : "approved",
                e.currentTarget,
              );
            }}
          >
            {selected.status === "pending" && (
              <label className="checkbox-label">
                <input type="checkbox" name="registered" /> I confirmed this
                Sender ID is registered and approved on this gateway.
              </label>
            )}
            <Field label="Gateway confirmation / review note">
              <Textarea name="note" required minLength={3} maxLength={500} />
            </Field>
            <div className="dialog-actions">
              <Button busy={busy}>
                {selected.status === "approved"
                  ? "Revoke approval"
                  : "Approve Sender ID"}
              </Button>
              {selected.status === "pending" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={(e) =>
                    void review("rejected", e.currentTarget.closest("form")!)
                  }
                >
                  Reject request
                </Button>
              )}
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function SmsNotifications() {
  const q = useQuery({
    queryKey: ["sms-notifications"],
    queryFn: () => api("/admin/sms-notifications"),
    refetchInterval: 10000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  return (
    <>
      <PageHeading
        title="SMS notifications"
        description="Sender ID and payment alerts sent through the platform gateway. These alerts do not deduct member credits."
      />
      <p className="notice">
        Accepted means the gateway acknowledged the SMS, not confirmed delivery.
        Unknown results need gateway reconciliation and are not automatically
        resent. Accounts without a verified phone still receive workspace
        notifications.
      </p>
      <section className="panel">
        {q.data.notifications.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Message</th>
                  <th>Gateway / sender</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.notifications.map((n: Row) => (
                  <tr key={n.id}>
                    <td>
                      {n.user_name}
                      <small className="table-sub">
                        {n.phone || "No verified phone"}
                      </small>
                    </td>
                    <td>
                      {n.message}
                      {n.error && (
                        <small className="table-sub">{n.error}</small>
                      )}
                    </td>
                    <td>
                      {n.provider}
                      <small className="table-sub">{n.sender}</small>
                    </td>
                    <td>
                      <Status value={n.status} />
                    </td>
                    <td>
                      {n.status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          busy={busy === n.id}
                          onClick={async () => {
                            setBusy(n.id);
                            try {
                              await post(
                                `/admin/sms-notifications/${n.id}/retry`,
                                { attempts: n.attempts },
                              );
                              await q.refetch();
                              toast.success("Notification queued again.");
                            } catch (e) {
                              toast.error((e as Error).message);
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          Retry notification
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No SMS notifications yet"
            description="New requests and payment updates will appear here."
          />
        )}
      </section>
    </>
  );
}
