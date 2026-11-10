import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Users,
  Search,
  Upload,
  Library,
  ArrowUpRight,
  LockKeyhole,
  Globe,
  Trash2,
  Download,
  Check,
  FileSpreadsheet,
} from "lucide-react";
import { Button, Input, Textarea, Select, Field, Dialog, Badge } from "@ndc/ui";
import { api, post, patch, remove, type Row } from "../lib/api";
import { number } from "../lib/shared";
import { Empty, PageHeading, Loading, QueryError, Status } from "./workspace";
export function Contacts() {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["lists"], queryFn: () => api("/lists") });
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState<Row | null>(null);
  const [deleteList, setDeleteList] = useState<Row | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  async function createList(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await post("/lists", Object.fromEntries(f));
      setCreate(false);
      await client.invalidateQueries({ queryKey: ["lists"] });
      toast.success("Contact list created. Add your contacts to get started.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const lists = q.data.lists.filter((l: Row) =>
    (l.name + " " + l.category).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="A PLACE FOR YOUR PEOPLE"
        title="My contacts"
        description="Build your audience, one connection at a time."
      >
        <Button onClick={() => setCreate(true)}>
          <Plus size={17} /> New contact list
        </Button>
      </PageHeading>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Search contact lists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your contact lists…"
          />
        </div>
        <span className="muted">
          {q.data.lists.length} lists in your workspace
        </span>
      </div>
      <div className="cards-grid">
        {lists.map((l: Row) => (
          <article className="list-card" key={l.id}>
            <div className="list-card-top">
              <span className="list-icon">
                <Users size={23} />
              </span>
              <Badge tone={l.visibility === "shared" ? "green" : "neutral"}>
                {l.visibility === "shared" ? (
                  <Globe size={12} />
                ) : (
                  <LockKeyhole size={12} />
                )}{" "}
                {l.visibility}
              </Badge>
            </div>
            <h3>{l.name}</h3>
            <p>{l.description || "Your community, ready to connect."}</p>
            <div className="list-meta">
              <span>
                <Users size={14} /> {number(l.contact_count)} contacts
              </span>
              <span>{l.category}</span>
            </div>
            {l.visibility === "shared" && (
              <div className="list-status">
                <Status value={l.status} />
              </div>
            )}
            <div className="list-card-footer">
              <Button variant="ghost" onClick={() => setSelected(l)}>
                Manage contacts <ArrowUpRight size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${l.name}`}
                onClick={() => setDeleteList(l)}
              >
                <Trash2 size={16} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {!lists.length && (
        <section className="panel">
          <Empty
            icon={Users}
            title={search ? "No matching lists" : "Your people belong here"}
            description="Create a contact list, then upload a CSV with their names and phone numbers."
            action={
              <Button onClick={() => setCreate(true)}>
                <Plus size={16} /> Create a list
              </Button>
            }
          />
        </section>
      )}
      <Dialog
        open={create}
        onOpenChange={setCreate}
        title="A new home for your contacts"
        description="Keep a list private or share it with your community."
      >
        <form onSubmit={createList}>
          <Field label="List name">
            <Input
              name="name"
              required
              minLength={2}
              maxLength={100}
              placeholder="e.g. Community volunteers"
            />
          </Field>
          <Field label="Description">
            <Textarea
              name="description"
              maxLength={500}
              placeholder="A little about this community…"
            />
          </Field>
          <div className="form-grid">
            <Field label="Category">
              <Select name="category">
                <option>General</option>
                <option>Community</option>
                <option>Volunteers</option>
                <option>Events</option>
                <option>Partners</option>
              </Select>
            </Field>
            <Field label="Visibility">
              <Select name="visibility">
                <option value="private">Private · only you</option>
                <option value="shared">Shared · requires approval</option>
              </Select>
            </Field>
          </div>
          <Button className="full" busy={busy}>
            Create contact list
          </Button>
        </form>
      </Dialog>
      <Dialog
        open={!!deleteList}
        onOpenChange={() => setDeleteList(null)}
        title="Delete this contact list?"
        description={`“${deleteList?.name}” and its contacts will be permanently removed. Existing campaign reports are retained.`}
      >
        <div className="dialog-actions">
          <Button variant="outline" onClick={() => setDeleteList(null)}>
            Keep list
          </Button>
          <Button
            variant="destructive"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await remove("/lists/" + deleteList!.id);
                setDeleteList(null);
                void client.invalidateQueries({ queryKey: ["lists"] });
                toast.success("List deleted.");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete list
          </Button>
        </div>
      </Dialog>
      {selected && (
        <ContactManager list={selected} close={() => setSelected(null)} />
      )}
    </>
  );
}
export function ContactManager({
  list,
  close,
}: {
  list: Row;
  close: () => void;
}) {
  const client = useQueryClient();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Row | null>(null);
  const [entryMode, setEntryMode] = useState<"upload" | "manual">("upload");
  const q = useQuery({
    queryKey: ["contacts", list.id, page],
    queryFn: () => api(`/lists/${list.id}/contacts?page=${page}`),
  });
  async function refreshContacts() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["contacts", list.id] }),
      client.invalidateQueries({ queryKey: ["lists"] }),
      client.invalidateQueries({ queryKey: ["admin-lists"] }),
      client.invalidateQueries({ queryKey: ["shared-lists"] }),
      client.invalidateQueries({ queryKey: ["compose-lists"] }),
      client.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  }
  async function addContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      await post(`/lists/${list.id}/contacts`, {
        name: data.get("name"),
        phone: data.get("phone"),
        consent: data.get("consent") === "true",
      });
      form.reset();
      setPage(0);
      await refreshContacts();
      toast.success("Contact added to this list.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    try {
      const r = await post(`/lists/${list.id}/import`, data);
      setResult(r);
      form.reset();
      await refreshContacts();
      toast.success(`${r.inserted} contacts imported.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={close}
      title={list.name}
      description="Add contacts individually or upload another CSV. Your existing contacts stay in this list."
    >
      <div
        className="segmented contact-entry-mode"
        aria-label="How to add contacts"
      >
        <button
          type="button"
          aria-pressed={entryMode === "upload"}
          className={entryMode === "upload" ? "selected" : ""}
          disabled={busy}
          onClick={() => {
            setEntryMode("upload");
            setResult(null);
          }}
        >
          Upload CSV
        </button>
        <button
          type="button"
          aria-pressed={entryMode === "manual"}
          className={entryMode === "manual" ? "selected" : ""}
          disabled={busy}
          onClick={() => {
            setEntryMode("manual");
            setResult(null);
          }}
        >
          Add contact
        </button>
      </div>
      {entryMode === "manual" ? (
        <form onSubmit={addContact}>
          <Field label="Contact name" hint="Optional.">
            <Input
              name="name"
              maxLength={100}
              placeholder="Full name"
              disabled={busy}
            />
          </Field>
          <Field
            label="Contact phone number"
            hint="Ghana local numbers or an international number with country code."
          >
            <Input
              type="tel"
              name="phone"
              maxLength={30}
              required
              placeholder="024 123 4567"
              disabled={busy}
            />
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name="consent"
              value="true"
              required
              disabled={busy}
            />{" "}
            I have permission to contact this person and to share their details
            if this list is shared.
          </label>
          <Button type="submit" busy={busy} className="full">
            <Plus size={16} /> Save contact
          </Button>
        </form>
      ) : (
        <form onSubmit={upload} className="upload-form">
          <label className="upload-zone">
            <Upload size={26} />
            <strong>Add contacts from a CSV</strong>
            <span>Choose a CSV file · up to 5 MB / 20,000 rows</span>
            <input
              aria-label="Contact CSV"
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
            />
          </label>
          <p className="muted">
            Use phone and optional name columns. New contacts are appended;
            duplicate numbers are skipped.
          </p>
          <a
            className="text-link"
            download="contact-template.csv"
            href="data:text/csv;charset=utf-8,name%2Cphone%0A"
          >
            <Download size={14} /> Download CSV template
          </a>
          <label className="checkbox-label">
            <input type="checkbox" name="consent" value="true" required /> I
            have permission to contact these people and to share their details
            if this list is shared.
          </label>
          <Button busy={busy} className="full">
            <Upload size={16} /> Import contacts
          </Button>
        </form>
      )}
      {result && (
        <div className="notice import-result" role="status">
          <strong>
            {result.inserted} imported · {result.duplicates} duplicates skipped
            · {result.invalidCount} invalid
          </strong>
          {result.invalid?.length > 0 && (
            <details>
              <summary>View invalid rows</summary>
              {result.invalid.map((r: Row) => (
                <div key={r.row}>
                  Row {r.row}: {r.reason}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
      <div className="section-separator" />
      <div className="panel-heading compact">
        <h3>Contacts ({q.data?.total || 0})</h3>
        <Button
          variant="outline"
          size="sm"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await patch("/lists/" + list.id, {
                visibility:
                  list.visibility === "private" ? "shared" : "private",
              });
              void client.invalidateQueries({ queryKey: ["lists"] });
              toast.success(
                list.visibility === "private"
                  ? "List submitted for sharing."
                  : "List is now private.",
              );
              close();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {list.visibility === "private" ? "Share this list" : "Make private"}
        </Button>
      </div>
      {q.isError ? (
        <QueryError error={q.error} retry={() => void q.refetch()} />
      ) : (
        <div className="contacts-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.contacts.map((r: Row) => (
                <tr key={r.id}>
                  <td>{r.name || "Unnamed contact"}</td>
                  <td>{r.phone}</td>
                  <td>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.phone}`}
                      onClick={async () => {
                        try {
                          await remove(`/lists/${list.id}/contacts/${r.id}`);
                          void client.invalidateQueries({
                            queryKey: ["contacts", list.id],
                          });
                          void client.invalidateQueries({
                            queryKey: ["lists"],
                          });
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pagination">
        <Button
          size="sm"
          variant="outline"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>Page {page + 1}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={(page + 1) * 100 >= (q.data?.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </Dialog>
  );
}
export function LeadLibrary() {
  const q = useQuery({
    queryKey: ["shared-lists"],
    queryFn: () => api("/lists?shared=true"),
  });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All lists");
  if (q.isLoading) return <Loading />;
  if (q.isError)
    return <QueryError error={q.error} retry={() => void q.refetch()} />;
  const lists = q.data.lists.filter(
    (l: Row) =>
      (category === "All lists" || l.category === category) &&
      (l.name + " " + l.description)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="GROW YOUR CIRCLE"
        title="Shared lead library"
        description="Discover approved contact lists shared by the community."
      >
        <Button variant="outline" asChild>
          <a href="/contacts">
            <Plus size={16} /> Share a contact list
          </a>
        </Button>
      </PageHeading>
      <div className="library-banner">
        <div className="library-illustration">
          <Library size={34} />
        </div>
        <div>
          <h2>Good connections go further together.</h2>
          <p>
            Use shared audiences in your campaigns. Contact details stay
            protected.
          </p>
        </div>
        <Badge tone="green">
          <Check size={13} /> Admin reviewed
        </Badge>
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <Input
            aria-label="Search shared leads"
            placeholder="Find your next audience…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option>All lists</option>
          {[...new Set<string>(q.data.lists.map((l: Row) => l.category))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </Select>
      </div>
      <div className="cards-grid">
        {lists.map((l: Row) => (
          <article key={l.id} className="list-card lead-card">
            <div className="list-card-top">
              <span className="list-icon">
                <Globe size={23} />
              </span>
              <Badge tone="green">{l.category}</Badge>
            </div>
            <h3>{l.name}</h3>
            <p>{l.description || "Connect with this shared community."}</p>
            <div className="lead-count">
              <strong>{number(l.contact_count)}</strong>
              <span>contacts</span>
            </div>
            <div className="lead-owner">
              <span className="avatar tiny">{l.owner_name.slice(0, 1)}</span>{" "}
              Shared by {l.owner_name}
            </div>
            <Button variant="outline" asChild className="full">
              <a href={`/compose?list=${l.id}`}>
                Use this audience <ArrowUpRight size={16} />
              </a>
            </Button>
          </article>
        ))}
      </div>
      {!lists.length && (
        <section className="panel">
          <Empty
            icon={Library}
            title="New connections are on the way"
            description={
              search
                ? "Try a different search or category."
                : "Approved shared lists will appear here. You can share one of your own from My contacts."
            }
          />
        </section>
      )}
    </>
  );
}
