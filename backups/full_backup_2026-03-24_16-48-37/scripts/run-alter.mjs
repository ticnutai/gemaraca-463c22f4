#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const sqls = [
  'ALTER TABLE public.user_books ADD COLUMN IF NOT EXISTS edited_text TEXT',
  'ALTER TABLE public.user_books ADD COLUMN IF NOT EXISTS edited_text_updated_at TIMESTAMPTZ',
  'ALTER TABLE public.talmud_references ADD COLUMN IF NOT EXISTS corrected_normalized text DEFAULT NULL',
  'CREATE INDEX IF NOT EXISTS idx_talmud_refs_source ON public.talmud_references(source)',
  'CREATE INDEX IF NOT EXISTS idx_talmud_refs_validated ON public.talmud_references(validation_status, source)',
  'ALTER TABLE public.psakei_din ADD COLUMN IF NOT EXISTS search_vector tsvector',
  'CREATE INDEX IF NOT EXISTS idx_psakei_din_fts ON public.psakei_din USING gin(search_vector)',
];

async function main() {
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'jj1212t@gmail.com', password: 'REDACTED-see-.env.migrations.local',
  });
  if (authErr) { console.error('Auth failed:', authErr.message); return; }
  console.log('Logged in as admin\n');

  const session = (await supabase.auth.getSession()).data.session;

  // Try each SQL via edge function one at a time, checking actual result
  for (const sql of sqls) {
    const label = sql.substring(0, 75);
    process.stdout.write(`Running: ${label}... `);
    
    // Wrap SQL in a DO block so exec_sql runs it via EXECUTE
    const wrappedSql = `SELECT exec_sql('${sql.replace(/'/g, "''")}')`;
    
    const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/run-migration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        action: 'execute',
        sql: wrappedSql,
        name: 'alter-column',
        description: 'Column addition via exec_sql wrapper',
      }),
    });

    const body = await edgeRes.json();
    if (body.success && (!body.result || (body.result && body.result.success !== false))) {
      console.log('✅');
    } else {
      console.log(`❌ ${JSON.stringify(body.result || body.error)}`);
    }
  }
}

main().catch(console.error);
