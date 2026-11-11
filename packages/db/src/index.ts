import Database from "better-sqlite3";
import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function projectRoot() {
  let dir = process.cwd();
  while (dirname(dir) !== dir) {
    const file = resolve(dir, "package.json");
    if (
      existsSync(file) &&
      JSON.parse(readFileSync(file, "utf8")).name === "ndcms"
    )
      return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
export const root = projectRoot();
config({ path: resolve(root, ".env"), quiet: true });
export const uploadDir = resolve(
  root,
  process.env.UPLOAD_DIR || "data/uploads",
);
export const databasePath =
  process.env.DATABASE_PATH === ":memory:"
    ? ":memory:"
    : resolve(root, process.env.DATABASE_PATH || "data/ndcms.sqlite");
if (databasePath !== ":memory:")
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
export const db = new Database(databasePath);
// WAL permits readers during a write. FULL preserves committed queue changes on power loss.
db.pragma("journal_mode = WAL");
db.pragma("synchronous = FULL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("cache_size = -32000");
db.pragma("wal_autocheckpoint = 1000");
db.pragma("journal_size_limit = 67108864");
db.exec(
  `CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
);
if (!db.prepare("SELECT 1 FROM migrations WHERE version=1").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=1").get()) return;
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT UNIQUE,
        google_id TEXT UNIQUE, password_hash TEXT, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), verified INTEGER NOT NULL DEFAULT 0,
        allowance INTEGER NOT NULL DEFAULT 0 CHECK(allowance>=0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE otp_requests (phone TEXT PRIMARY KEY, requested_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE lists (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'General', visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),
        status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','pending','rejected')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX lists_owner ON lists(owner_id,created_at);
      CREATE INDEX lists_shared ON lists(visibility,status);
      CREATE TABLE contacts (id TEXT PRIMARY KEY, list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL, consent INTEGER NOT NULL CHECK(consent=1), UNIQUE(list_id,phone));
      CREATE INDEX contacts_list ON contacts(list_id);
      CREATE TABLE suppressions (phone TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE audio_files (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL);
      CREATE TABLE campaigns (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        channel TEXT NOT NULL CHECK(channel IN ('sms','voice')), message TEXT NOT NULL DEFAULT '', sender TEXT NOT NULL,
        audio_id TEXT REFERENCES audio_files(id), list_ids TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at INTEGER, lease_until INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, queued_at TEXT, error TEXT);
      CREATE INDEX campaigns_owner ON campaigns(owner_id,created_at);
      CREATE INDEX campaigns_queue ON campaigns(status,scheduled_at,lease_until);
      CREATE TABLE deliveries (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', provider_id TEXT, error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(campaign_id,phone));
      CREATE INDEX deliveries_queue ON deliveries(campaign_id,status);
      CREATE INDEX deliveries_provider ON deliveries(provider_id,phone);
      CREATE TABLE webhook_events (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT, detail TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX audit_recent ON audit_log(created_at);
      INSERT INTO migrations(version) VALUES(1);
    `);
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) return;
    db.exec(
      "ALTER TABLE webhook_events ADD COLUMN payload TEXT; ALTER TABLE webhook_events ADD COLUMN processed INTEGER NOT NULL DEFAULT 0; CREATE INDEX webhook_pending ON webhook_events(processed,created_at); INSERT INTO migrations(version) VALUES(2);",
    );
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=3").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=3").get()) return;
    db.exec(
      "ALTER TABLE campaigns ADD COLUMN lease_token TEXT; INSERT INTO migrations(version) VALUES(3);",
    );
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=4").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=4").get()) return;
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings(key,value) VALUES('messaging_provider','arkesel');
      ALTER TABLE campaigns ADD COLUMN provider TEXT NOT NULL DEFAULT 'arkesel' CHECK(provider IN ('arkesel','mnotify'));
      ALTER TABLE otp_requests ADD COLUMN provider TEXT NOT NULL DEFAULT 'arkesel' CHECK(provider IN ('arkesel','mnotify'));
      ALTER TABLE otp_requests ADD COLUMN code_hash TEXT;
      ALTER TABLE deliveries ADD COLUMN report_checked_at INTEGER NOT NULL DEFAULT 0;
      INSERT INTO migrations(version) VALUES(4);
    `);
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=5").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=5").get()) return;
    db.exec(`
      ALTER TABLE users ADD COLUMN voice_credits INTEGER NOT NULL DEFAULT 0 CHECK(voice_credits>=0);
      ALTER TABLE deliveries ADD COLUMN credit_source TEXT NOT NULL DEFAULT 'allowance' CHECK(credit_source IN ('allowance','voice'));
      INSERT INTO settings(key,value) VALUES
        ('voice_rate_pesewas','40'),
        ('payment_phone','0558641826'),
        ('payment_name','Ebenezer Kwabena Blay Ackah'),
        ('payment_network','Mobile Money');
      CREATE TABLE payment_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        credits INTEGER NOT NULL CHECK(credits>0), rate_pesewas INTEGER NOT NULL CHECK(rate_pesewas>0),
        total_pesewas INTEGER NOT NULL CHECK(total_pesewas=credits*rate_pesewas),
        payment_phone TEXT NOT NULL, payment_name TEXT NOT NULL, payment_network TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','pending','approved','rejected')),
        transaction_id TEXT COLLATE NOCASE UNIQUE, payer_name TEXT, payer_phone TEXT, payer_network TEXT,
        paid_pesewas INTEGER, paid_at TEXT, note TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1, reviewer_id TEXT REFERENCES users(id), review_note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT
      );
      CREATE INDEX payments_user ON payment_requests(user_id,created_at);
      CREATE INDEX payments_status ON payment_requests(status,updated_at);
      CREATE TABLE voice_credit_purchases (
        id TEXT PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE REFERENCES payment_requests(id),
        user_id TEXT NOT NULL REFERENCES users(id), credits INTEGER NOT NULL CHECK(credits>0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL, message TEXT NOT NULL, href TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, read_at TEXT
      );
      CREATE INDEX notifications_user ON notifications(user_id,read_at,created_at);
      INSERT INTO migrations(version) VALUES(5);
    `);
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=6").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=6").get()) return;
    db.exec(`
      INSERT INTO settings(key,value) VALUES('sms_rate_pesewas','6');
      ALTER TABLE payment_requests ADD COLUMN credit_type TEXT NOT NULL DEFAULT 'voice' CHECK(credit_type IN ('sms','voice'));
      ALTER TABLE voice_credit_purchases RENAME TO credit_purchases;
      ALTER TABLE credit_purchases ADD COLUMN credit_type TEXT NOT NULL DEFAULT 'voice' CHECK(credit_type IN ('sms','voice'));
      ALTER TABLE campaigns ADD COLUMN source_campaign_id TEXT REFERENCES campaigns(id);
      CREATE TABLE delivery_attempts (
        id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id),
        campaign_id TEXT NOT NULL REFERENCES campaigns(id), phone TEXT NOT NULL,
        status TEXT NOT NULL, provider_id TEXT, error TEXT, credit_source TEXT NOT NULL,
        attempted_at TEXT NOT NULL, archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX attempts_campaign ON delivery_attempts(campaign_id);
      INSERT INTO migrations(version) VALUES(6);
    `);
  }).immediate();
}
if (!db.prepare("SELECT 1 FROM migrations WHERE version=7").get()) {
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM migrations WHERE version=7").get()) return;
    db.exec(`
      CREATE TABLE sender_ids (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
        provider TEXT NOT NULL CHECK(provider IN ('arkesel','mnotify')),
        name TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','revoked')),
        version INTEGER NOT NULL DEFAULT 1, reviewer_id TEXT REFERENCES users(id), review_note TEXT,
        gateway_verified_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,provider,name)
      );
      CREATE INDEX sender_ids_status ON sender_ids(status,provider);
      ALTER TABLE campaigns ADD COLUMN sender_id TEXT REFERENCES sender_ids(id);
      CREATE TABLE sms_notifications (
        id TEXT PRIMARY KEY, event_key TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
        phone TEXT, message TEXT NOT NULL, provider TEXT NOT NULL, sender TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','unknown','skipped')),
        attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, provider_id TEXT, error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_key,user_id)
      );
      CREATE INDEX sms_notifications_queue ON sms_notifications(status,created_at);
      INSERT INTO migrations(version) VALUES(7);
    `);
  }).immediate();
}
export type Row = Record<string, any>;
export function one(sql: string, ...params: any[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
export function all(sql: string, ...params: any[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
export function audit(
  actor: string | null,
  action: string,
  target: string,
  detail = "",
) {
  run(
    "INSERT INTO audit_log(actor_id,action,target_id,detail) VALUES(?,?,?,?)",
    actor,
    action,
    target,
    detail,
  );
}
