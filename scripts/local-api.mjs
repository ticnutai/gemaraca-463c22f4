#!/usr/bin/env node
/**
 * שרת מקומי שמגיש את `data/gemaraca.db` לאפליקציה
 * ──────────────────────────────────────────────────────────
 * האפליקציה מדברת עם סופהבייס דרך PostgREST. במקום לשכתב כמאה מקומות בקוד,
 * השרת הזה מדבר את אותו פרוטוקול מעל SQLite: אותם נתיבים, אותם פרמטרים,
 * אותה כותרת Range. מבחינת `createClient` אין הבדל — רק הכתובת משתנה.
 *
 * מה נתמך, כי זה מה שהאפליקציה משתמשת בו בפועל:
 *   GET /rest/v1/<table>?select=…&<col>=eq.<v>&order=<col>.desc&limit=&offset=
 *   מסננים: eq, neq, gt, gte, lt, lte, like, ilike, is, in
 *   Range: 0-999        → עימוד, ומחזיר Content-Range
 *   Prefer: count=exact → מחזיר את הספירה המלאה
 *
 * כתיבה (POST/PATCH/DELETE) נתמכת גם היא, כדי שעריכה באפליקציה תעבוד.
 *
 * שימוש:
 *   node scripts/local-api.mjs            → http://localhost:54321
 *   node scripts/local-api.mjs --port 5555
 */

import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PORT = (() => { const i = args.indexOf('--port'); return i >= 0 ? Number(args[i + 1]) : 54321; })();
// שתי מאגרות: המראה מן הענן עדיפה — יש בה גם מה שהועלה ידנית
// וגם אימותי ספריא, שאינם קיימים בקאשים הגולמיים
const DB_FILE = (() => {
  const i = args.indexOf('--db');
  if (i >= 0) return args[i + 1];
  const mirror = join(ROOT, 'data', 'gemaraca-cloud.db');
  return existsSync(mirror) ? mirror : join(ROOT, 'data', 'gemaraca.db');
})();


if (!existsSync(DB_FILE)) {
  console.error(`❌ המסד המקומי אינו קיים: ${DB_FILE}`);
  console.error('   הרץ קודם: node scripts/build-local-db.mjs');
  process.exit(1);
}
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');

/** העמודות שהן JSON במסד ומוחזרות כמערך/אובייקט, כמו בסופהבייס */
const JSON_COLS = new Set(['judges', 'questions', 'tags', 'merged_from']);

const OPS = {
  eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=',
  like: 'LIKE', ilike: 'LIKE',   // SQLite מתעלם מרישיות בלאו הכי ב-LIKE
};

/** `col=eq.value` של PostgREST → תנאי SQL ופרמטר */
function toCondition(col, raw) {
  const dot = String(raw).indexOf('.');
  const op = dot < 0 ? 'eq' : raw.slice(0, dot);
  const val = dot < 0 ? raw : raw.slice(dot + 1);
  const quoted = `"${col.replace(/"/g, '')}"`;

  if (op === 'is') {
    if (val === 'null') return { sql: `${quoted} IS NULL`, params: [] };
    if (val === 'not.null') return { sql: `${quoted} IS NOT NULL`, params: [] };
    return { sql: `${quoted} = ?`, params: [val] };
  }
  if (op === 'in') {
    const items = val.replace(/^\(|\)$/g, '').split(',')
      .map((s) => s.replace(/^"|"$/g, ''));
    if (!items.length) return { sql: '0', params: [] };
    return { sql: `${quoted} IN (${items.map(() => '?').join(',')})`, params: items };
  }
  if (op === 'not') return { sql: `NOT (${quoted} = ?)`, params: [val] };
  const sqlOp = OPS[op];
  if (!sqlOp) return { sql: `${quoted} = ?`, params: [val] };
  const v = (op === 'like' || op === 'ilike') ? val.replace(/\*/g, '%') : val;
  return { sql: `${quoted} ${sqlOp} ?`, params: [v] };
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function buildWhere(params) {
  const parts = [], values = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    const c = toCondition(k, v);
    parts.push(c.sql);
    values.push(...c.params);
  }
  return { where: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', values };
}

/**
 * פירוק `select`. PostgREST מאפשר גם צירוף מקונן —
 * `select=*,psakei_din(title,court)` — והאפליקציה משתמשת בזה כדי
 * להביא את שם הפסק לצד כל מראה מקום. מחזיר את עמודות הבסיס
 * ואת רשימת הצירופים בנפרד.
 */
function parseSelect(sel) {
  if (!sel || sel === '*') return { cols: '*', embeds: [] };
  const embeds = [];
  const plain = [];
  // פיצול בפסיקים שמחוץ לסוגריים
  let depth = 0, cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { if (cur.trim()) plain.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) plain.push(cur.trim());

  const base = [];
  for (const part of plain) {
    const m = part.match(/^([A-Za-z0-9_]+)\s*\(([^)]*)\)$/);
    if (m) embeds.push({ table: m[1], cols: m[2].split(',').map((c) => c.trim()).filter(Boolean) });
    else base.push(part);
  }
  const cols = base.includes('*') || !base.length
    ? '*'
    : base.map((c) => `"${c.replace(/"/g, '')}"`).join(',');
  return { cols, embeds };
}

/**
 * מפתח הקישור לצירוף מקונן. שם עמודת המפתח הזר אינו נגזר
 * משם הטבלה באופן מכאני (psakei_din ← psak_din_id), ולכן יש מפה,
 * ואחריה ניסיון להשלים לפי כל עמודה שמסתיימת ב-_id.
 */
const FK_MAP = { psakei_din: 'psak_din_id', sugyot: 'sugya_id', folders: 'folder_id' };
function resolveEmbeds(baseRows, embeds) {
  if (!baseRows.length || !embeds.length) return baseRows;
  for (const em of embeds) {
    const sample = baseRows[0];
    const fk = FK_MAP[em.table] && em.table in FK_MAP && FK_MAP[em.table] in sample
      ? FK_MAP[em.table]
      : Object.keys(sample).find((k) => k.endsWith('_id') && k !== 'id');
    if (!fk) continue;
    const ids = [...new Set(baseRows.map((r) => r[fk]).filter((v) => v !== null && v !== undefined))];
    if (!ids.length) continue;
    const cols = em.cols.length ? ['id', ...em.cols.filter((c) => c !== 'id')] : ['*'];
    const colSql = cols[0] === '*' ? '*' : cols.map((c) => `"${c.replace(/"/g, '')}"`).join(',');
    const byId = new Map();
    // במנות, כדי לא לחרוג ממגבלת הפרמטרים של SQLite
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const rows = db.prepare(`SELECT ${colSql} FROM "${em.table}" WHERE "id" IN (${chunk.map(() => '?').join(',')})`).all(...chunk);
      for (const r of revive(rows)) byId.set(r.id, r);
    }
    for (const r of baseRows) {
      const hit = byId.get(r[fk]);
      r[em.table] = hit ? (em.cols.length ? Object.fromEntries(em.cols.map((c) => [c, hit[c]])) : hit) : null;
    }
  }
  return baseRows;
}

function buildOrder(order) {
  if (!order) return '';
  const parts = order.split(',').map((o) => {
    const [col, ...mods] = o.split('.');
    const dir = mods.includes('desc') ? 'DESC' : 'ASC';
    const nulls = mods.includes('nullslast') ? ' NULLS LAST' : mods.includes('nullsfirst') ? ' NULLS FIRST' : '';
    return `"${col.replace(/"/g, '')}" ${dir}${nulls}`;
  });
  return ` ORDER BY ${parts.join(', ')}`;
}

const revive = (rows) => rows.map((r) => {
  const o = { ...r };
  for (const k of Object.keys(o)) {
    if (JSON_COLS.has(k) && typeof o[k] === 'string') {
      try { o[k] = JSON.parse(o[k]); } catch { /* נשאר כמחרוזת */ }
    }
  }
  return o;
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Profile',
};

const send = (res, code, body, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(null); } });
});

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const m = url.pathname.match(/^\/rest\/v1\/([A-Za-z0-9_]+)$/);

  // סופהבייס בודק חיים ומבצע התחברות; המסד המקומי פתוח, ולכן תשובה ריקה דיה
  if (url.pathname.startsWith('/auth/v1/')) {
    return send(res, 200, { access_token: 'local', token_type: 'bearer', expires_in: 31536000,
      refresh_token: 'local', user: { id: 'local-user', email: 'local@gemaraca', role: 'authenticated' } });
  }
  if (!m) return send(res, 200, { ok: true, db: DB_FILE });

  const table = m[1];
  const params = [...url.searchParams.entries()];

  try {
    // HEAD הוא GET בלי גוף. הלקוח שולח אותו כשמבקשים ספירה
    // בלבד (`head: true`), והספירה חוזרת בכותרת Content-Range
    if (req.method === 'GET' || req.method === 'HEAD') {
      const { where, values } = buildWhere(params);
      const { cols, embeds } = parseSelect(url.searchParams.get('select'));
      const order = buildOrder(url.searchParams.get('order'));

      // עימוד: גם דרך limit/offset וגם דרך כותרת Range, כמו ב-PostgREST
      let limit = Number(url.searchParams.get('limit')) || null;
      let offset = Number(url.searchParams.get('offset')) || 0;
      const range = req.headers.range;
      if (range) {
        const rm = String(range).match(/(\d+)-(\d+)/);
        if (rm) { offset = Number(rm[1]); limit = Number(rm[2]) - Number(rm[1]) + 1; }
      }

      const wantCount = String(req.headers.prefer || '').includes('count=exact');
      let total = null;
      if (wantCount) total = Object.values(db.prepare(`SELECT COUNT(*) c FROM "${table}"${where}`).get(...values))[0];

      const sql = `SELECT ${cols} FROM "${table}"${where}${order}`
        + (limit !== null ? ` LIMIT ${limit} OFFSET ${offset}` : '');
      const rows = resolveEmbeds(revive(db.prepare(sql).all(...values)), embeds);

      const extra = {};
      if (total !== null) extra['Content-Range'] = `${offset}-${offset + rows.length - 1}/${total}`;
      // `.single()` מבקש אובייקט אחד ולא מערך
      const accept = String(req.headers.accept || '');
      if (accept.includes('vnd.pgrst.object') && req.method !== 'HEAD') {
        if (rows.length !== 1) return send(res, 406, { message: `נמצאו ${rows.length} שורות, נדרשה אחת`, code: 'PGRST116' });
        return send(res, 200, rows[0], extra);
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra });
        return res.end();
      }
      return send(res, 200, rows, extra);
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length || !rows[0]) return send(res, 201, []);
      const onConflict = url.searchParams.get('on_conflict');
      const verb = onConflict ? 'INSERT OR IGNORE' : 'INSERT';
      const out = [];
      db.exec('BEGIN');
      for (const r of rows) {
        const keys = Object.keys(r);
        const vals = keys.map((k) => (JSON_COLS.has(k) || typeof r[k] === 'object') && r[k] !== null
          ? JSON.stringify(r[k]) : r[k]);
        const st = db.prepare(`${verb} INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')})
          VALUES (${keys.map(() => '?').join(',')}) RETURNING *`);
        const got = st.get(...vals);
        if (got) out.push(got);
      }
      db.exec('COMMIT');
      return send(res, 201, revive(out));
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req) ?? {};
      const keys = Object.keys(body);
      if (!keys.length) return send(res, 200, []);
      const { where, values } = buildWhere(params);
      const sets = keys.map((k) => `"${k}" = ?`).join(', ');
      const setVals = keys.map((k) => (JSON_COLS.has(k) || typeof body[k] === 'object') && body[k] !== null
        ? JSON.stringify(body[k]) : body[k]);
      const rows = db.prepare(`UPDATE "${table}" SET ${sets}${where} RETURNING *`).all(...setVals, ...values);
      return send(res, 200, revive(rows));
    }

    if (req.method === 'DELETE') {
      const { where, values } = buildWhere(params);
      if (!where) return send(res, 400, { message: 'מחיקה בלי תנאי נחסמה' });
      const rows = db.prepare(`DELETE FROM "${table}"${where} RETURNING *`).all(...values);
      return send(res, 200, revive(rows));
    }

    return send(res, 405, { message: 'שיטה לא נתמכת' });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* לא הייתה טרנזקציה */ }
    console.error(`שגיאה ב-${req.method} ${url.pathname}${url.search}:`, e.message);
    return send(res, 400, { message: e.message, code: 'LOCAL_ERROR' });
  }
});

server.listen(PORT, () => {
  const n = (t) => Object.values(db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get())[0];
  console.log(`✅ השרת המקומי פועל: http://localhost:${PORT}`);
  console.log(`   מסד: ${DB_FILE}`);
  console.log(`   ${n('psakei_din')} פסקים · ${n('talmud_references')} מראי מקומות · ${n('psak_sources')} מקורות`);
});
