// נקודת כניסה לגיבוי מהטרמינל.
//
// מנוע הגיבוי (src/lib/backup/engine.ts) נכתב לדפדפן, אך מסלול הגיבוי לענן
// משתמש רק ב-Blob, ב-CompressionStream וב-Storage של Supabase — כולם קיימים
// ב-Node 18 ומעלה. הקובץ הזה נארז ב-esbuild כדי להריץ את אותו מנוע בדיוק
// מסקריפט, ולא לכתוב לוגיקת גיבוי שנייה שתיפרד מהראשונה.

import { supabase } from "@/integrations/supabase/client";
import { createBackup, loadCatalog, listBackups, verifyCloudBackup } from "@/lib/backup/engine";

export { createBackup, loadCatalog, listBackups, verifyCloudBackup, supabase };
