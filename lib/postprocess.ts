import { join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import type {
  IdentityNormalizedRecord,
  IdentityRecord,
  PhonebookResultResponse,
  SearchRecordNormalized,
  SearchResultResponse,
  Selector,
  TreeViewItem,
} from "./types";

const TRANSITION_FIELDS = [
  "system_id",
  "storage_id",
  "owner",
  "indexfile",
  "group",
  "randomid",
  "target",
] as const;
type TransitionField = (typeof TRANSITION_FIELDS)[number];

const TRANSITION_SET = new Set<string>(TRANSITION_FIELDS);
const MAX_MAP_SIZE = 10_000;
const PRUNE_FRACTION = 0.25;

// --- Persistence ---
// ID mappings live in SQLite so they survive restarts, writes are incremental
// and atomic, and several server processes can share the store safely.
// AUTOINCREMENT guarantees an evicted ID is never reassigned to another file.
const STORE_DIR = dirname(import.meta.dir);
const DB_PATH = join(STORE_DIR, ".id-store.sqlite");
const LEGACY_JSON_PATH = join(STORE_DIR, ".id-store.json");

type IdEntry = { uuid: string; field: TransitionField };

const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");
db.run(`CREATE TABLE IF NOT EXISTS ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  field TEXT NOT NULL,
  uuid TEXT NOT NULL,
  last_used INTEGER NOT NULL,
  UNIQUE (field, uuid)
)`);
db.run("CREATE INDEX IF NOT EXISTS ids_last_used ON ids (last_used)");

const upsertStmt = db.query<{ id: number }, [string, string, number]>(
  `INSERT INTO ids (field, uuid, last_used) VALUES (?1, ?2, ?3)
   ON CONFLICT (field, uuid) DO UPDATE SET last_used = excluded.last_used
   RETURNING id`,
);
const byIdStmt = db.query<IdEntry, [number]>("SELECT uuid, field FROM ids WHERE id = ?1");
const byKeyStmt = db.query<{ id: number }, [string, string]>(
  "SELECT id FROM ids WHERE field = ?1 AND uuid = ?2",
);
const touchStmt = db.query<null, [number, number]>("UPDATE ids SET last_used = ?2 WHERE id = ?1");
const countStmt = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ids");
const pruneStmt = db.query<null, [number]>(
  "DELETE FROM ids WHERE id IN (SELECT id FROM ids ORDER BY last_used ASC LIMIT ?1)",
);

// One-time import of the old JSON store so previously issued IDs keep resolving.
function migrateLegacyJson(): void {
  if (countStmt.get()!.n > 0 || !existsSync(LEGACY_JSON_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(LEGACY_JSON_PATH, "utf8"));
    if (!raw || typeof raw.counter !== "number" || !Array.isArray(raw.entries)) return;
    const insert = db.query<null, [number, string, string, number]>(
      "INSERT OR IGNORE INTO ids (id, field, uuid, last_used) VALUES (?1, ?2, ?3, ?4)",
    );
    db.transaction(() => {
      // Entries are in insertion order; preserve that as recency.
      raw.entries.forEach(([id, entry]: [number, IdEntry], i: number) => {
        insert.run(id, entry.field, entry.uuid, i);
      });
      // Make sure new IDs continue after the old counter.
      db.run("DELETE FROM sqlite_sequence WHERE name = 'ids'");
      db.run("INSERT INTO sqlite_sequence (name, seq) VALUES ('ids', ?)", [raw.counter - 1]);
    })();
  } catch {
    // Corrupt legacy store — start fresh
  }
}

migrateLegacyJson();

function pruneIfNeeded(): void {
  const n = countStmt.get()!.n;
  if (n <= MAX_MAP_SIZE) return;
  pruneStmt.run(n - MAX_MAP_SIZE + Math.floor(MAX_MAP_SIZE * PRUNE_FRACTION));
}

let insertsSincePruneCheck = 0;

function assignId(field: TransitionField, uuid: string): number {
  const id = upsertStmt.get(field, uuid, Date.now())!.id;
  if (++insertsSincePruneCheck >= 100) {
    insertsSincePruneCheck = 0;
    pruneIfNeeded();
  }
  return id;
}

function lookupEntry(id: number): IdEntry | undefined {
  const entry = byIdStmt.get(id) ?? undefined;
  if (entry) touchStmt.run(id, Date.now());
  return entry;
}

function normalizeIntelxId<T>(results: T): T {
  function scan(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) scan(obj[i]);
      return obj;
    }
    for (const key in obj) {
      const val = obj[key];
      if (TRANSITION_SET.has(key) && typeof val === "string") {
        obj[key] = assignId(key as TransitionField, val);
      } else if (val !== null && typeof val === "object") {
        scan(val);
      }
    }
    return obj;
  }
  return db.transaction(() => scan(results))() as T;
}

function denormalizeIntelxId<T>(normalized: T): T {
  function scan(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(scan);
    const out: any = {};
    for (const key in obj) {
      const val = obj[key];
      if (TRANSITION_SET.has(key) && typeof val === "number") {
        out[key] = lookupEntry(val)?.uuid ?? val;
      } else {
        out[key] = scan(val);
      }
    }
    return out;
  }
  return scan(normalized) as T;
}

function getOriginalUuid(_field: TransitionField, id: number): string | undefined {
  return lookupEntry(id)?.uuid;
}

function getEntry(id: number): IdEntry | undefined {
  return lookupEntry(id);
}

function getNormalizedId(field: TransitionField, uuid: string): number | undefined {
  return byKeyStmt.get(field, uuid)?.id;
}

function normalizeIdentityRecords(allRecords: IdentityRecord[]): IdentityNormalizedRecord[] {
  const merged: Record<string, IdentityNormalizedRecord> = {};

  for (const r of allRecords) {
    const sid = r.item.storageid;
    const existing = merged[sid];
    if (existing) {
      existing.line += "; " + r.linea;
    } else {
      merged[sid] = {
        line: r.linea,
        system_id: r.item.systemid,
        storage_id: sid,
        bucket: r.item.bucket,
        filename: r.item.name,
        date: r.item.date,
      };
    }
  }

  const results = Object.values(merged);
  for (const rec of results) {
    if (rec.line.length > 512) {
      rec.line = rec.line.slice(0, 512) + `...+${rec.line.length - 512}ch`;
    }
  }
  return normalizeIntelxId(results);
}

function normalizePhoneBookResponse(allRecords: PhonebookResultResponse[]): string[] {
  const out: string[] = [];
  for (const resp of allRecords) {
    for (const sel of resp.selectors) {
      out.push(sel.selectorvalue);
    }
  }
  return out;
}

function normalizeSelectors(allRecords: Selector[]): string[] {
  return allRecords.map((r) => r.selector);
}

function normalizeTreeViewResponse(items: TreeViewItem[] | null | undefined, parentBucket?: string) {
  if (!items?.length) return [];
  return items.map((r) => ({
    system_id: r.systemid,
    name: r.name,
    date: r.date,
    media: r.media,
    type: r.type,
    size: r.size,
    bucket: r.bucket || parentBucket || "",
    ...(r.storageid ? { storage_id: r.storageid } : {}),
  }));
}

function normalizeSearchRecordResponse(response: SearchResultResponse): SearchRecordNormalized[] {
  return response.records.map((r) => ({
    system_id: r.systemid,
    bucket: r.bucket,
    name: r.name,
    indexfile: r.indexfile,
    storage_id: r.storageid,
    media: r.media,
    type: r.type,
    added: r.added,
    date: r.date,
  }));
}

export {
  normalizeSearchRecordResponse,
  normalizeTreeViewResponse,
  normalizePhoneBookResponse,
  normalizeIdentityRecords,
  normalizeSelectors,
  normalizeIntelxId,
  denormalizeIntelxId,
  getOriginalUuid,
  getEntry,
  getNormalizedId,
};
