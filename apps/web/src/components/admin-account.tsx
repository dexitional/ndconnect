import { useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input, Select } from "@ndc/ui";
import { patch, post, type Row } from "../lib/api";

export function AdminAccountDialog({
  account,
  reset = false,
  close,
  saved,
}: {
  account?: Row;
  reset?: boolean;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const passwordRequired = !account || reset;
  return (
    <Dialog
      open
      onOpenChange={() => {
        if (!busy) close();
      }}
      title={
        reset
          ? `Reset password for ${account!.name}`
          : account
            ? "Manage account"
            : "Add administrator"
      }
      description={
        reset
          ? "Set a new password. Existing sessions will be signed out; account data and credits are kept."
          : account
            ? "Update account details and access. Changes to sign-in details or role sign out existing sessions."
            : "Create an administrator who can sign in with their phone number and password."
      }
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const values = Object.fromEntries(new FormData(e.currentTarget));
          if (passwordRequired && values.password !== values.confirmPassword) {
            toast.error("The passwords do not match.");
            return;
          }
          setBusy(true);
          try {
            if (reset)
              await post(`/admin/users/${account!.id}/reset-password`, {
                password: values.password,
              });
            else if (account) await patch(`/admin/users/${account.id}`, values);
            else {
              const { confirmPassword, ...input } = values;
              await post("/admin/users", input);
            }
            await saved();
            toast.success(
              reset
                ? "Administrator password reset. Existing sessions signed out."
                : account
                  ? "Account updated."
                  : "Administrator created.",
            );
            close();
          } catch (error) {
            toast.error((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!reset && (
          <>
            <Field label="Full name">
              <Input
                name="name"
                defaultValue={account?.name || ""}
                required
                minLength={2}
                maxLength={100}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Phone number"
              hint="Used to sign in. Include a country code for numbers outside Ghana."
            >
              <Input
                name="phone"
                type="tel"
                defaultValue={account?.phone || ""}
                required={!account || !!account.phone}
                maxLength={30}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            <Field label="Email address" hint="Optional.">
              <Input
                name="email"
                type="email"
                defaultValue={account?.email || ""}
                disabled={busy}
                autoComplete="off"
              />
            </Field>
            {account && (
              <div className="form-grid">
                <Field label="Account role">
                  <Select
                    name="role"
                    defaultValue={account.role}
                    disabled={busy}
                  >
                    <option value="admin">Administrator</option>
                    <option value="user">Member</option>
                  </Select>
                </Field>
                <Field label="Account status">
                  <Select
                    name="status"
                    defaultValue={account.status}
                    disabled={busy}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </Select>
                </Field>
              </div>
            )}
          </>
        )}
        {passwordRequired && (
          <>
            <Field
              label="New password"
              hint="At least 12 characters; up to 72 UTF-8 bytes."
            >
              <Input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={busy}
              />
            </Field>
          </>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {reset
              ? "Reset admin password"
              : account
                ? "Save account"
                : "Create administrator"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
