// הגדרות הפרויקט החדש + פרטי המנהל, נקראים מקבצים מקומיים בלבד.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const neu = readEnvFile(path.join(ROOT, '.env.new-supabase'));
const sec = readEnvFile(path.join(ROOT, '.env.migrations.local'));

if (!neu.NEW_SUPABASE_URL) {
  console.error('❌ חסר .env.new-supabase בשורש הפרויקט');
  process.exit(1);
}
if (!sec.MIGRATION_ADMIN_EMAIL || !sec.MIGRATION_ADMIN_PASSWORD) {
  console.error('❌ חסרים פרטי מנהל ב-.env.migrations.local');
  process.exit(1);
}

export const NEW_URL = neu.NEW_SUPABASE_URL;
export const NEW_REF = neu.NEW_SUPABASE_PROJECT_ID;
export const NEW_KEY = neu.NEW_SUPABASE_LEGACY_ANON_KEY || neu.NEW_SUPABASE_ANON_KEY;
export const ADMIN_EMAIL = sec.MIGRATION_ADMIN_EMAIL;
export const ADMIN_PASSWORD = sec.MIGRATION_ADMIN_PASSWORD;
