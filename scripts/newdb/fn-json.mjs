#!/usr/bin/env node
/**
 * מייצר את מערך ה-files להעברת פונקציית קצה.
 * הייבוא מ-"../_shared/" מוסב ל-"./_shared/" כי בפריסה הקבצים שטוחים
 * תחת שורש אחד — אותו קוד בדיוק, רק נתיב ייבוא אחר.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.mjs';

const name = process.argv[2];
const dir = join(ROOT, 'supabase', 'functions', name);
if (!existsSync(join(dir, 'index.ts'))) { console.error(`אין פונקציה ${name}`); process.exit(1); }

let src = readFileSync(join(dir, 'index.ts'), 'utf8');
const files = [];
const shared = [...src.matchAll(/from\s+"\.\.\/_shared\/([\w.]+)"/g)].map((m) => m[1]);
for (const s of new Set(shared)) {
  files.push({ name: `_shared/${s}`, content: readFileSync(join(ROOT, 'supabase', 'functions', '_shared', s), 'utf8') });
}
src = src.replace(/from\s+"\.\.\/_shared\//g, 'from "./_shared/');
files.unshift({ name: 'index.ts', content: src });

process.stdout.write(JSON.stringify(files));
