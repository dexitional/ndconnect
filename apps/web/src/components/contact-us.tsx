import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Field, Input, Textarea } from "@ndc/ui";
import { toast } from "sonner";
import { api, patch } from "../lib/api";
import { CircleHelp } from "lucide-react";

function useContactDetails() {
  return useQuery({
    queryKey: ["contact-details"],
    queryFn: () => api("/contact-details"),
  });
}

export function ContactUs({ icon = false }: { icon?: boolean }) {
  const [open, setOpen] = useState(false);
  const q = useContactDetails();
  const contact = q.data?.contact;
  return (
    <>
      <button
        type="button"
        className={icon ? "top-icon help-link" : "contact-us-link"}
        aria-label={icon ? "Workspace help" : undefined}
        title={icon ? "Contact support" : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {icon ? <CircleHelp size={20} /> : "Contact us"}
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Contact us"
        description="Get in touch with the NDC Connect team."
      >
        {q.isLoading ? (
          <p role="status">Loading contact details…</p>
        ) : q.isError ? (
          <div role="alert">
            <p>Contact details could not be loaded.</p>
            <Button variant="outline" onClick={() => void q.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="contact-details">
            {contact?.email && (
              <div>
                <strong>Email</strong>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </div>
            )}
            {contact?.phone && (
              <div>
                <strong>Phone</strong>
                <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}>
                  {contact.phone}
                </a>
              </div>
            )}
            {contact?.address && (
              <div>
                <strong>Address</strong>
                <p>{contact.address}</p>
              </div>
            )}
            {contact?.hours && (
              <div>
                <strong>Office hours</strong>
                <p>{contact.hours}</p>
              </div>
            )}
            {!Object.values(contact || {}).some(Boolean) && (
              <p>Contact details will be available soon.</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

export function ContactSettings() {
  const q = useContactDetails();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel settings-panel">
      <div className="settings-title">
        <div>
          <h3>Contact us details</h3>
          <p>Shown on the sign-in page and workspace footer.</p>
        </div>
      </div>
      {q.isLoading ? (
        <p>Loading contact details…</p>
      ) : q.isError ? (
        <Button variant="outline" onClick={() => void q.refetch()}>
          Retry contact settings
        </Button>
      ) : (
        <form
          key={JSON.stringify(q.data.contact)}
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            try {
              await patch("/admin/contact-details", data);
              await client.invalidateQueries({ queryKey: ["contact-details"] });
              toast.success("Contact details saved.");
            } catch (error) {
              toast.error((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Contact email">
            <Input
              name="email"
              type="email"
              defaultValue={q.data.contact.email}
            />
          </Field>
          <Field label="Contact phone">
            <Input
              name="phone"
              type="tel"
              maxLength={40}
              defaultValue={q.data.contact.phone}
            />
          </Field>
          <Field label="Contact address">
            <Textarea
              name="address"
              maxLength={500}
              defaultValue={q.data.contact.address}
            />
          </Field>
          <Field label="Office hours">
            <Input
              name="hours"
              maxLength={200}
              defaultValue={q.data.contact.hours}
            />
          </Field>
          <Button busy={busy}>Save contact details</Button>
        </form>
      )}
    </section>
  );
}
