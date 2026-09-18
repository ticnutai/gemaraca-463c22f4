// Admin credentials for the local maintenance scripts (migrations, imports, uploads).
// They live in .env.migrations.local at the project root, which is gitignored.
// Same format as the lovable-supabase-migrations skill:
//   MIGRATION_PROJECT_REF=<must equal VITE_SUPABASE_PROJECT_ID in .env>
//   MIGRATION_ADMIN_EMAIL=...
//   MIGRATION_ADMIN_PASSWORD=...
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const local = readEnvFile(path.join(ROOT, '.env.migrations.local'));
const projectRef = readEnvFile(path.join(ROOT, '.env')).VITE_SUPABASE_PROJECT_ID;

if (!local.MIGRATION_ADMIN_EMAIL || !local.MIGRATION_ADMIN_PASSWORD) {
  console.error('❌ Missing admin credentials. Create .env.migrations.local in the project root with');
  console.error('   MIGRATION_PROJECT_REF, MIGRATION_ADMIN_EMAIL and MIGRATION_ADMIN_PASSWORD.');
  process.exit(1);
}
if (local.MIGRATION_PROJECT_REF && projectRef && local.MIGRATION_PROJECT_REF !== projectRef) {
  console.error(`❌ .env.migrations.local is for project ${local.MIGRATION_PROJECT_REF}, but .env points to ${projectRef}.`);
  process.exit(1);
}

export const ADMIN_EMAIL = local.MIGRATION_ADMIN_EMAIL;
export const ADMIN_PASSWORD = local.MIGRATION_ADMIN_PASSWORD;
