#!/usr/bin/env node
// יוצר את משתמש המנהל בפרויקט החדש. הסיסמה נקראת מהקובץ המקומי ולא מודפסת.
import { createClient } from '@supabase/supabase-js';
import { NEW_URL, NEW_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } from './env.mjs';

const sb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

const { data, error } = await sb.auth.signUp({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (error && !/already registered/i.test(error.message)) {
  console.error('❌ יצירת המשתמש נכשלה:', error.message);
  process.exit(1);
}
console.log(error ? 'המשתמש כבר קיים' : `נוצר משתמש: ${data.user?.id}`);

const { data: s, error: e2 } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (e2) {
  console.log(`⚠️ ההתחברות עדיין חסומה: ${e2.message}`);
  console.log('   (צריך לאשר את האימייל במסד — השלב הבא)');
  process.exit(2);
}
console.log(`✅ התחברות עובדת. מזהה: ${s.user.id}`);
