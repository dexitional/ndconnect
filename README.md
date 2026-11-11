# NDC Connect

A full-stack communications workspace for bulk SMS and recorded voice campaigns through Arkesel or mNotify. Built from `AGENT.md`, using the supplied NDC branding, the split-panel administrator login reference, and Capevars’ workspace and lead-moderation conventions.

## What is implemented

- Responsive member and administrator dashboards with database-backed activity and delivery statistics.
- Phone registration with provider-based OTP verification; password login and verified password reset; Google OpenID Connect sign-in.
- Private contact lists, individual contact entry, CSV imports with normalization/deduplication and invalid-row reports, contact removal, and list deletion.
- Shared lead library, consent confirmation, administrator approval/rejection, and automatic re-review after members add contacts to shared lists.
- SMS composition with GSM-7/Unicode segmentation, voice recording upload/playback, audience selection, previews, review, draft saving, and scheduling. Voice uploads accept MP3, WAV, FLAC, AAC, WMA, M4A, and OGG (up to 10 MB), with file-signature checks. Browser playback depends on codec support; a download link is available.
- Manual Mobile Money purchases of separate SMS and voice credits, editable receiving details and rates, in-app payment notifications, and administrator approval with duplicate-credit protection.
- Durable queue with recipient snapshots, 100-recipient gateway batches, transactional SMS/voice credit reservations, atomic claims, cancellation, and recovery of interrupted work.
- Recipient status reports and CSV export. Numbers available only through shared lists are masked for members in both reports and exports.
- Signed Arkesel callbacks, replay protection, and an inbox for delivery callbacks received before the send response.
- Account suspension, SMS/voice credit allocation, global opt-outs, gateway configuration status, and audit history.
- SQLite migrations, WAL, full commit durability, busy timeout, indexed access, online backups, and a separate campaign worker.

## Requirements and local startup

Use Node **22.12 or newer** (Node 24 LTS recommended). Dependencies are pinned by `package-lock.json`. The default Node 20.3 installation on this machine is too old for the current TanStack/Vite toolchain; select the installed Node 24 version first.

```sh
npm ci
# Only on a fresh checkout; preserve an existing .env.
cp .env.example .env
npm run db:migrate
npm run dev
```

Open **http://localhost:3100**. The supplied Arkesel and mNotify keys have already been placed in this workspace’s ignored, permission-restricted `.env`; do not overwrite that file during local setup. `APP_URL` must match the browser’s origin, including hostname and port. Using `127.0.0.1` instead of `localhost` requires the matching `APP_URL`.

In another terminal, start the queue worker:

```sh
npm run worker
```

The web server saves campaigns; the worker submits them. Both processes must use the same environment, database, and upload directory. Use the same OS service account for both. Root-owned IDE previews save new private recordings with the upload directory owner, so the workspace worker can read them without making files public. Unreadable recordings stop before submission and preserve pending recipients for a safe resume. The campaigns screen warns when queued work has no recent worker heartbeat. IDE previews that run as a different OS account have separate build caches, but the actual database must remain owned by your service account.

### First administrator

There is no default production password or public administrator registration. Set `ADMIN_PHONE`, `ADMIN_PASSWORD` (at least 12 characters, at most 72 UTF-8 bytes), and optionally `ADMIN_NAME` in your shell or secret manager, then run:

```sh
npm run admin:create
```

Sign in at `/admin/login`. The command creates a verified administrator with 100,000 SMS credits and refuses to overwrite an existing account. The operator must control the supplied phone number. New members start with zero SMS and voice credits. Administrators can allocate either credit type under **People & access**, or members can buy credits using Mobile Money. Existing normal units remain SMS credits; voice credits are a separate balance. Platform balances do not top up the provider account.

Run this command **on the production server**, with the same `DATABASE_PATH` and environment as the web service. Git does not contain your local database or administrator credentials. A fresh deployment therefore needs its own administrator setup; setting `ADMIN_PHONE` and `ADMIN_PASSWORD` alone does not create an account. If the account already exists, use phone-verified password reset or inspect the existing account before changing it.

### Buy SMS or voice credits with Mobile Money

Members open **SMS & voice credits**, select SMS or voice, enter a credit quantity, and create a payment request. Initial prices are **GHC 0.06 per SMS credit** and **GHC 0.40 per voice credit**, payable to **0558641826 — Ebenezer Kwabena Blay Ackah**. Administrators can edit both rates independently, the receiving number, account name, and network under **Payments & credits → Payment settings**. Each request preserves its quoted rate, total, and payment destination even if settings change later.

Send the exact quoted amount using your Mobile Money service, then enter the transaction ID, payer name and phone, network, amount, payment time, and any additional details. Submitting or updating these details alerts active administrators through the workspace notification bell (refreshed every 15 seconds). This is a manual transfer workflow; the application does not initiate the transfer or automatically verify a transaction ID.

Administrators open **Payments & credits**, verify receipt in the receiving Mobile Money account, and approve or reject the request. Approval adds the quoted credits to the selected SMS or voice balance and notifies the member. Rejection requires a reason; members can correct and resubmit their details. Approved payments cannot be edited. Unique transaction IDs, revision checks, and an atomic purchase ledger prevent duplicate credits and approval of details that changed during review.

Each SMS part per recipient reserves one SMS credit; each voice recipient reserves one voice credit when queued. Balances are strictly separate: a voice campaign cannot use SMS credits and an SMS broadcast cannot use voice credits. Cancellation or a dispatch-time opt-out returns unsent units to the balance they came from. Submitted, rejected, or uncertain provider attempts retain their reservation pending operator reconciliation. Purchasing platform credits does not top up the gateway account: administrators must maintain the provider's separate balance.

### Provider selection and mNotify configuration

Administrators can choose **Arkesel** or **mNotify** in **Gateway settings → Messaging provider → Save provider**. The selection is stored in SQLite, survives restarts, and is audited. Arkesel remains the initial provider. Only configured providers can be selected outside local mock mode. Keys are never sent to the browser.

The selection applies to **new campaigns and new verification codes**. A campaign keeps the provider and sender selected when its draft was created, including scheduled campaigns and resumed unsent recipients. Existing campaigns migrate as Arkesel. Codes already issued remain verifiable after a switch. There is no automatic fallback that might send the same message twice.

| Variable            | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `MNOTIFY_API_KEY`   | Enabled mNotify API v2 key, stored only in the server environment. |
| `MNOTIFY_SENDER_ID` | Approved SMS sender ID, up to 11 characters. Default: `NDC`.       |

mNotify SMS uses JSON at `/api/sms/quick`; recorded voice uses multipart `recipient[]`, `campaign`, and `file` at `/api/voice/quick`. No voice caller ID is needed. mNotify’s `voice_id` means an existing **recording**, so it is omitted when uploading a file. Scheduling stays in the local worker. Recipients are confirmed by `summary.numbers_sent`, or by explicit counts showing every requested contact accepted with zero rejections/dropped recipients. A batch ID alone never proves acceptance; partial or ambiguous responses remain unknown for reconciliation. Quick SMS supports the local destinations allowed by your mNotify account; international template messaging is outside this integration.

Phone verification sends a cryptographically generated six-digit code through mNotify’s SMS endpoint with `sms_type=otp`. Only a salted hash is saved, with the existing five-minute expiry, five-attempt limit, cooldown, and single-use protection. Register the sender for **OTP**, including the app URL in mNotify, before using phone signup or password reset with this provider.

The worker polls mNotify’s authenticated SMS and voice report endpoints for up to seven days after batch submission, checking at most five batches per maintenance cycle and each batch at most once per minute. `received` voice reports count as delivered, `missed` as failed; pending/submitted reports remain accepted. Voice report rows can carry a per-call ID different from the batch UUID; they are matched within the authenticated batch report by recipient. Report outages preserve the previous status and never trigger another send. Keep the worker running for both dispatch and delivery updates. Arkesel’s signed callbacks only update Arkesel campaigns.

After adding environment credentials, restart the web process and worker to load them. Switching in the admin screen requires no restart. Configuration status confirms only that a key is present; it does not check credentials, balance, or sender approval. Official reference: [mNotify / BMS API documentation](https://developer.bms.africa/#tag/Voice).

### Arkesel configuration

Set these server-only environment values:

| Variable                 | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `ARKESEL_API_KEY`        | Main Arkesel API key; OTP requires the main key.                                      |
| `ARKESEL_SENDER_ID`      | Registered SMS sender ID, up to 11 characters. Default: `NDC`.                        |
| `ARKESEL_VOICE_ID`       | Optional registered voice caller ID. Leave blank to send without a custom caller ID.  |
| `ARKESEL_WEBHOOK_SECRET` | Account webhook secret used to verify signed callbacks.                               |
| `APP_URL`                | Public HTTPS origin in production. Callback URL is `${APP_URL}/api/webhooks/arkesel`. |

The adapter uses JSON for SMS, multipart `voice_file` and `recipients[]` for voice, and Arkesel’s generation/verification OTP endpoints. Voice retries are explicitly disabled to avoid unrequested repeat calls. SMS and voice requests use a 30-second timeout. Configure Arkesel account balance and an approved SMS sender in the provider dashboard. Arkesel documents `voice_id` as optional: voice campaigns can be created and sent with `ARKESEL_VOICE_ID` unset or blank, and the adapter omits the field entirely. If supplied, a registered custom voice caller ID is included.

A successful request means **accepted**, not delivered. Confirmed SMS delivery or an answered voice call is recorded only from a verified callback. Gateway status shows configuration presence, not live credential or account-balance verification.

Official integration reference: [Arkesel API documentation](https://developers.arkesel.com/), including SMS V2, Voice, OTP, and Webhook Signature Verification.

### Google sign-in

Create an OAuth web client with the callback URI:

```text
http://localhost:3100/api/auth/google/callback
```

Use the equivalent HTTPS URI for production. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The Google button appears when both are configured. The implementation validates state, nonce, token audience/issuer/expiry, and verified email. It does not silently merge existing accounts by email.

### Add contacts to an existing list

Open **My contacts → Manage contacts** on the existing list. Choose **Add contact** to enter an optional name and a phone number, confirm permission, and select **Save contact**. Use **Upload CSV** to append another file to that same list. Existing contacts are preserved, numbers are normalized, and duplicates are rejected for individual entry or skipped during CSV imports. Member additions to shared lists return the list to pending administrator review. Already queued campaigns retain their original recipient snapshots; new contacts are available to subsequent campaigns.

### Contact CSV format

```csv
name,phone
Example Person,+233241234567
Another Person,0201234567
```

These are format examples only. Use actual contacts with permission. `phone` is required and `name` is optional; UTF-8 BOM and case-insensitive headers are supported. Ghana local numbers normalize to `+233`, international numbers to E.164 form. Imports allow 5 MB and 20,000 rows. Shared contacts are available for campaign selection without exposing the underlying list to other members. Adding contacts to a member-owned shared list returns it to pending review.

## Queue and recovery

Queue submission validates current list access, snapshots distinct recipients, excludes opt-outs, reserves credits from the matching channel balance, and changes campaign state in one SQLite transaction. Repeated submission cannot create duplicate deliveries or reserve credits twice. Scheduling is stored as a UTC timestamp; the UI accepts the browser’s local timezone.

The worker processes batches outside database transactions so a provider request does not hold a write lock. Each claim has a 120-second lease and an ownership token, checked before every batch. A recovered or cancelled claim cannot be overwritten by an obsolete worker. Suspended users, revoked lists, and new opt-outs are checked again before dispatch.

If a timeout or process crash makes submission uncertain, in-flight recipients become `unknown` and the campaign becomes `attention`. **No unknown or failed delivery is automatically retried.** After resolving the gateway/account problem, **Resume unsent recipients** submits only recipients still marked `pending`; it never resubmits an uncertain batch. Consult the campaign’s provider dashboard before creating a replacement campaign for unknown results. A campaign requiring attention can be cancelled to release the credits reserved for recipients never submitted. Provider-rejected or uncertain attempts retain their reservation; the platform does not automatically refund attempts already submitted to a provider.

**Retry failed recipients** is an explicit action available for paused/finished campaigns with confirmed failed or rejected deliveries. It reserves fresh credits from that campaign's channel balance, archives previous attempts, and queues eligible failures plus any already-reserved unsent recipients. Delivered, accepted, unknown, and opted-out recipients are excluded from retries. Concurrent retry clicks cannot charge or queue the same attempt twice. Old provider references cannot update the new attempt. A retry retains its original provider.

**Clone and resend** on a completed campaign creates a new draft with a postfix such as `Community broadcast - Copy 1`. The copy keeps the message/recording and selected lists, uses the currently selected gateway, and clears the old schedule and delivery results. Review the draft and confirm sending; it snapshots the lists' current eligible contacts and charges the matching balance. The original campaign and its report remain intact. Creating a draft alone does not charge credits.

Cancelling a waiting campaign returns its unsent reservation. Opt-outs discovered at dispatch also return their unused units. A batch already submitted cannot be recalled. The opt-out register is managed by administrators; automatic parsing of inbound STOP replies is not included because an inbound-number integration is not configured.

Signed callbacks are accepted by GET and POST. SMS uses `sms_id`; voice uses `campaign_id` plus recipient. Signatures use Arkesel’s sorted, PHP-compatible canonical JSON and HMAC-SHA256, with five-minute timestamp tolerance, constant-time comparison, and persisted event IDs. Early receipts are replayed after provider IDs are saved. Receipt replay records are retained for 30 days. Authentication rate-limit and session expiry records are cleaned by the worker.

## Production operation

```sh
npm ci
npm run db:migrate
npm run typecheck
npm test
npm run build
NODE_ENV=production PORT=3100 npm start
# Separate supervised process:
NODE_ENV=production npm run worker
```

`ecosystem.config.cjs` provides an optional PM2 configuration for the two processes. Set `APP_URL` to your HTTPS domain and supply secrets through `.env` or the process environment. Terminate HTTPS at a reverse proxy; pass requests to the Node server and allow request bodies up to 12 MB. Secure session cookies require HTTPS in production. `TRUST_PROXY=true` is appropriate only when your proxy replaces the client’s `X-Forwarded-For` header. Otherwise authentication uses a shared conservative rate-limit bucket.

`npm start` loads the root `.env` when present, keeps externally supplied environment values, and starts from the repository root so database/upload paths stay consistent. Set `PORT` to the port used by your reverse proxy. If unset, an explicit port in `APP_URL` is used for a local preview; otherwise the Node server keeps its default port 3000. The PM2 configuration explicitly uses port 3100. `APP_URL` must match the browser-facing HTTPS origin, not the internal Node address.

Deploy the entire `apps/web/.output/` directory, including `public/`. Branding is explicitly bundled from `apps/web/public/` even though Nitro uses an isolated cache directory. `/brand/logo.png` and `/brand/wordmark.png` must return `Content-Type: image/png`; an HTML response with status 200 means the request reached the application's catch-all route rather than an image.

For production login failures, a `401` response means the credentials/account in the production database were rejected; `403` with an origin error means `APP_URL` does not match the browser origin. A successful login followed by a return to the login page requires checking HTTPS and the session cookie. The production check below now exercises a real browser login, reloads the authenticated page, and verifies decoded images as well as PNG bytes.

Build and run on the same OS/architecture, or rebuild on your target server: `better-sqlite3` contains a native binary. Keep the repository runtime files and production dependencies available to the worker. SQLite and uploaded recordings require a persistent, locally attached disk. Do not put the database on NFS or run independent replicas with separate database files.

WAL permits readers alongside a writer; SQLite still has one writer at a time. This application uses short write transactions, indexes, prepared statements, batches, `synchronous=FULL`, a 5-second busy timeout, a 32 MB page cache per process, and periodic optimization/checkpointing. This is a single-host deployment design, not a claim of unlimited write scalability. Load-test with your expected campaign sizes and request concurrency before sizing a production deployment.

```sh
npm run db:backup
```

Backups use SQLite’s online backup API and go into `backups/`. Schedule backups and copy them off-host with access controls; back up `UPLOAD_DIR` as well. To restore, stop the web server and worker, retain the current database and WAL/SHM files as a recovery set, place the verified backup at `DATABASE_PATH` without stale WAL/SHM companions, restore recordings, then restart both processes. Never copy only an active SQLite main file as a backup.

`GET /api/health` checks database availability. The administrator gateway screen shows worker heartbeat freshness. Keep one worker initially; claims are transactionally coordinated if you later run more against the same local database. Long-term retention of contacts, recordings, campaign reports, and audit events should be set according to your organization’s policy.

## Verification

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:production
```

Backend tests use a temporary SQLite database and mocked provider responses. Browser tests create a separate temporary database, start a mock worker, and cover member login, phone signup, CSV import, SMS and voice submission, shared lists, admin SMS/voice credit allocation, gateway status, Mobile Money submission and approval, editable rates, notifications, and mobile navigation. Backend tests also cover duplicate approvals, changed payment revisions, access controls, separate credit balances, refunds, charged retries, completed campaign copies, and all seven audio formats. They never contact real recipients or use the supplied API key. The browser configuration uses installed Google Chrome on macOS; set `CHROME_PATH` for another installation. Screenshots are written to ignored `test-results/`.

For deliberate manual testing only, set `MOCK_PROVIDER=true` in a non-production environment; OTP is then `123456` and gateway results are explicitly mocked. Production rejects this setting. Keep test fixtures separate from your real database. Google’s live consent flow and actual SMS/voice delivery still require your configured provider accounts and an authorized recipient test.

## Repository layout

```text
apps/web/              TanStack Start routes, React screens, Hono API, Arkesel and mNotify adapters
packages/db/           SQLite connection, migrations, shared database helpers
packages/ui/           Customizable shadcn-style Radix/CVA components and dialogs
scripts/               Administrator bootstrap, worker, migrations, backups, test server
tests/                 Database/API/provider tests and Playwright browser journeys
files/                 Original login reference and supplied logos
```

Brand colors, layout tokens, responsive rules, and reduced-motion behavior live in `apps/web/src/styles.css`; reusable components live in `packages/ui/src/index.tsx`. Framer Motion supplies the page entrance effects. Framework setup follows [TanStack Start’s Vite documentation](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch). Database configuration follows [SQLite’s WAL documentation](https://www.sqlite.org/wal.html).

Secrets, databases, uploads, generated output, and the original credential-bearing `AGENT.md` are ignored by Git. No provider key is embedded in client code.
