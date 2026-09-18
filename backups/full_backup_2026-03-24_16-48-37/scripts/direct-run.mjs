#!/usr/bin/env node
/**
 * Direct Migration Runner for Gemaraca project
 * Connects to Supabase via Auth + REST API to execute SQL migrations
 * 
 * Usage:
 *   node scripts/direct-run.mjs file "path/to/file.sql"
 *   node scripts/direct-run.mjs sql "SELECT 1"
 *   node scripts/direct-run.mjs pending
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── Config ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://jaotdqumpcfhcbkgtfib.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imphb3RkcXVtcGNmaGNia2d0ZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyNDE0MTAsImV4cCI6MjA3NDgxNzQxMH0.t7kmGMKJvcjudbKxUPgQkqmycrCUPTvv5x4Q7byQcK0';

const ADMIN_EMAIL = 'jj1212t@gmail.com';
const ADMIN_PASSWORD = 'REDACTED-see-.env.migrations.local';

// ─── Helpers ─────────────────────────────────────────────────
function printBanner() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('   🔧 Direct Migration Runner - Gemaraca');
  console.log('══════════════════════════════════════════════════\n');
}

function printSeparator(label) {
  console.log(`\n──────────────────────────────────────────────────`);
  if (label) console.log(`  ${label}`);
  console.log(`──────────────────────────────────────────────────\n`);
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  printBanner();

  const [, , command, arg] = process.argv;

  if (!command) {
    console.log('Usage:');
    console.log('  node scripts/direct-run.mjs file "path/to/migration.sql"');
    console.log('  node scripts/direct-run.mjs sql "SELECT COUNT(*) FROM psakei_din"');
    console.log('  node scripts/direct-run.mjs pending');
    process.exit(1);
  }

  // Create supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Login
  console.log('🔐 Logging in as admin...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });

  if (authError) {
    console.error('❌ Login failed:', authError.message);
    process.exit(1);
  }
  console.log(`✅ Logged in as: ${authData.user.email}\n`);

  // Handle commands
  switch (command) {
    case 'file': {
      if (!arg) {
        console.error('❌ Missing file path. Usage: node scripts/direct-run.mjs file "path/to/file.sql"');
        process.exit(1);
      }
      const filePath = path.resolve(ROOT, arg);
      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
      }
      const sql = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath, '.sql');
      
      console.log(`🚀 Running migration: ${fileName}`);
      printSeparator();
      
      await executeSql(supabase, sql);
      break;
    }

    case 'sql': {
      if (!arg) {
        console.error('❌ Missing SQL. Usage: node scripts/direct-run.mjs sql "SELECT 1"');
        process.exit(1);
      }
      console.log(`🚀 Running SQL command`);
      printSeparator();
      
      await executeSql(supabase, arg);
      break;
    }

    case 'pending': {
      console.log('🚀 Checking for pending migrations...');
      printSeparator();
      await runPending(supabase);
      break;
    }

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('Available commands: file, sql, pending');
      process.exit(1);
  }

  console.log('\n🏁 Done!\n');
}

// ─── Execute SQL via edge function, rpc, or direct statements ───
async function executeSql(supabase, sql) {
  // 1) Try the run-migration edge function (most reliable - uses direct PG connection)
  const session = (await supabase.auth.getSession()).data.session;
  if (session?.access_token) {
    console.log('📡 Trying run-migration edge function...');
    const edgeRes = await fetch(`${SUPABASE_URL}/functions/v1/run-migration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        action: 'execute',
        sql,
        name: 'direct-run-migration',
        description: 'Executed via direct-run.mjs',
      }),
    });

    if (edgeRes.ok) {
      const result = await edgeRes.json();
      if (result.error) {
        console.error('❌ Edge function error:', result.error);
        throw new Error(result.error);
      }
      console.log('✅ Migration completed successfully via edge function!');
      if (result.rows_affected != null) {
        console.log(`📊 Rows affected: ${result.rows_affected}`);
      }
      return;
    }

    const edgeErr = await edgeRes.text();
    console.log(`⚠️  Edge function returned ${edgeRes.status}: ${edgeErr.substring(0, 200)}`);
    console.log('   Falling back to RPC...\n');
  }

  // 2) Try using the execute_safe_migration RPC
  const { data, error } = await supabase.rpc('execute_safe_migration', {
    migration_sql: sql,
  });

  if (error) {
    if (error.message.includes('execute_safe_migration') || error.code === '42883') {
      console.log('ℹ️  RPC not available, running statements directly...\n');
      await executeStatementsDirectly(supabase, sql);
      return;
    }
    console.error('❌ Migration failed:', error.message);
    if (error.details) console.error('   Details:', error.details);
    if (error.hint) console.error('   Hint:', error.hint);
    throw new Error(error.message);
  }

  console.log('✅ Migration completed successfully!');
  if (data) {
    console.log('📊 Result:', JSON.stringify(data, null, 2));
  }
}

async function executeStatementsDirectly(supabase, sql) {
  // Split SQL into individual statements
  // Handle dollar-quoted strings and regular semicolons
  const statements = splitSqlStatements(sql);
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i].trim();
    if (!stmt || stmt.startsWith('--')) continue;
    
    const preview = stmt.substring(0, 80).replace(/\n/g, ' ');
    process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}...`);
    
    // Use supabase rpc to execute raw SQL - try different approaches
    const { error } = await supabase.rpc('exec_sql', { query: stmt });
    
    if (error) {
      // If exec_sql doesn't exist either, we need to use the REST API directly
      if (error.code === '42883') {
        console.log('\n\n⚠️  No SQL execution function found in database.');
        console.log('   Creating execute_safe_migration function first...\n');
        await createExecFunction(supabase);
        // Retry the whole thing
        await executeSql(supabase, sql);
        return;
      }
      console.log(` ❌`);
      console.error(`     Error: ${error.message}`);
      failCount++;
    } else {
      console.log(` ✅`);
      successCount++;
    }
  }
  
  console.log(`\n📊 Results: ${successCount} succeeded, ${failCount} failed`);
  if (failCount > 0) {
    process.exit(1);
  }
}

async function createExecFunction(supabase) {
  // Use the Supabase SQL editor endpoint to create the exec function
  const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
  
  const createFnSql = `
    CREATE OR REPLACE FUNCTION execute_safe_migration(migration_sql text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      EXECUTE migration_sql;
      RETURN jsonb_build_object('success', true);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'detail', SQLSTATE);
    END;
    $$;
  `;

  // Try via PostgREST rpc endpoint directly
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query_text: createFnSql }),
  });

  if (!response.ok) {
    // Last resort: try the management API
    console.log('⚠️  Cannot create function via REST. Trying pg-meta...');
    
    const pgMetaRes = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: createFnSql }),
    });
    
    if (!pgMetaRes.ok) {
      console.error('❌ Cannot create SQL execution function.');
      console.error('   Please create it manually in the Supabase SQL Editor:');
      console.error('   ' + createFnSql.trim());
      process.exit(1);
    }
  }
  
  console.log('✅ Created execute_safe_migration function');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';
  
  const lines = sql.split('\n');
  
  for (const line of lines) {
    // Skip pure comment lines when not in a dollar quote
    if (!inDollarQuote && line.trim().startsWith('--')) {
      continue;
    }
    
    current += line + '\n';
    
    // Check for dollar quoting
    const dollarMatches = line.match(/\$([a-zA-Z_]*)\$/g);
    if (dollarMatches) {
      for (const match of dollarMatches) {
        if (!inDollarQuote) {
          inDollarQuote = true;
          dollarTag = match;
        } else if (match === dollarTag) {
          inDollarQuote = false;
          dollarTag = '';
        }
      }
    }
    
    // If we're not in a dollar quote and the line ends with ; 
    if (!inDollarQuote && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  
  if (current.trim()) {
    statements.push(current.trim());
  }
  
  return statements;
}

async function runPending(supabase) {
  // List all migration files
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.error('❌ Migrations directory not found');
    process.exit(1);
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  console.log(`📁 Found ${files.length} migration files\n`);
  
  // Check which ones already ran by querying the schema
  // We'll try running each one - if it fails due to "already exists", that's ok
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(file, '.sql');
    
    console.log(`\n  📄 ${name}`);
    
    try {
      await executeSql(supabase, sql);
      ran++;
    } catch (e) {
      if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
        console.log('     ⏭️  already applied');
        skipped++;
      } else {
        console.log(`     ❌ ${e.message}`);
        failed++;
      }
    }
  }
  
  console.log(`\n📊 Summary: ${ran} applied, ${skipped} already existed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('💥 Unexpected error:', err.message);
  process.exit(1);
});
