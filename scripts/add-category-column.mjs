import { createClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './lib/admin-credentials.mjs';

const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';
const URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';

const sb = createClient(URL, KEY);

const SQL = `
ALTER TABLE public.psakei_din ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_psakei_din_category ON public.psakei_din(category);
`;

async function main() {
  // Sign in
  const { data: auth, error: ae } = await sb.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (ae) { console.error('Auth error:', ae.message); return; }
  
  const token = auth.session.access_token;
  console.log('Authenticated. Running migration...');

  const r = await fetch(`${URL}/functions/v1/run-migration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': KEY,
    },
    body: JSON.stringify({
      action: 'execute',
      name: 'add_category_column',
      description: 'Add category column to psakei_din for folder classification',
      sql: SQL,
    }),
  });

  const j = await r.json();
  console.log('Status:', r.status);
  console.log('Response:', JSON.stringify(j, null, 2));

  // Verify
  const { data, error } = await sb.from('psakei_din').select('id,category').limit(1);
  if (error) {
    console.log('Column NOT added:', error.message);
  } else {
    console.log('Column verified:', data);
  }
}

main().catch(console.error);
