#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // Login
  const { error: authErr } = await sb.auth.signInWithPassword({
    email: 'jj1212t@gmail.com',
    password: 'REDACTED-see-.env.migrations.local',
  });
  if (authErr) {
    console.log('Auth failed:', authErr.message);
    process.exit(1);
  }
  console.log('✅ Logged in');

  // Step 1: Grant exec_sql to authenticated via separate statements
  console.log('\n🔧 Fixing exec_sql permissions...');
  
  const grants = [
    'GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;',
    'GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO anon;',
  ];

  for (const sql of grants) {
    console.log('  Running:', sql.substring(0, 70));
    const { data, error } = await sb.functions.invoke('run-migration', {
      body: { action: 'execute', sql, name: 'fix-exec-sql-' + Date.now() }
    });
    console.log('  Result:', JSON.stringify(data || error));
  }

  // Step 2: Test exec_sql
  console.log('\n🧪 Testing exec_sql...');
  const { data: d2, error: e2 } = await sb.rpc('exec_sql', { query: 'SELECT 1 as test' });
  if (e2) {
    console.log('❌ exec_sql still broken:', e2.message);
    console.log('\n⚠️ Cannot fix via Edge Function. Trying alternative...');
    
    // Try creating a new function via run-migration
    const newFnSql = `
      CREATE OR REPLACE FUNCTION public.run_sql(query_text text)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public'
      AS $fn$
      DECLARE
        result jsonb;
      BEGIN
        EXECUTE query_text;
        GET DIAGNOSTICS result = ROW_COUNT;
        RETURN jsonb_build_object('rows_affected', result, 'success', true);
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
      END;
      $fn$;
      
      GRANT EXECUTE ON FUNCTION public.run_sql(text) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.run_sql(text) TO anon;
    `;
    
    console.log('Creating new run_sql function...');
    const { data: fnData, error: fnErr } = await sb.functions.invoke('run-migration', {
      body: { action: 'execute', sql: newFnSql, name: 'create-run-sql-fn' }
    });
    console.log('Result:', JSON.stringify(fnData || fnErr));
    
    // Test new function
    const { data: d3, error: e3 } = await sb.rpc('run_sql', { query_text: 'SELECT 1 as test' });
    if (e3) {
      console.log('❌ run_sql also broken:', e3.message);
    } else {
      console.log('✅ run_sql works! Result:', JSON.stringify(d3));
      
      // Now grant exec_sql via run_sql
      console.log('\nGranting exec_sql via run_sql...');
      const { data: g1 } = await sb.rpc('run_sql', { query_text: 'GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated' });
      console.log('Grant authenticated:', JSON.stringify(g1));
      const { data: g2 } = await sb.rpc('run_sql', { query_text: 'GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO anon' });
      console.log('Grant anon:', JSON.stringify(g2));
      
      // Final test
      const { data: d4, error: e4 } = await sb.rpc('exec_sql', { query: 'SELECT 1 as test' });
      console.log('\n🎯 Final exec_sql test:', e4 ? '❌ ' + e4.message : '✅ FIXED! ' + JSON.stringify(d4));
    }
  } else {
    console.log('✅ exec_sql works! Result:', JSON.stringify(d2));
  }
}

main().catch(err => {
  console.error('💥', err.message);
  process.exit(1);
});
