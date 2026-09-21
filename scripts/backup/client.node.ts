// לקוח Supabase לריצה ב-Node.
//
// מנוע הגיבוי מייבא את הלקוח של האפליקציה, שקורא את ההגדרות מ-import.meta.env
// של Vite. בריצה מהטרמינל אין Vite, ולכן esbuild ממפה את הייבוא הזה לקובץ הזה,
// שבונה את אותו לקוח מתוך משתני הסביבה שהסקריפט מזריק.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const url = process.env.SB_URL;
const key = process.env.SB_KEY;
if (!url || !key) throw new Error("חסרים SB_URL / SB_KEY בסביבה");

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
