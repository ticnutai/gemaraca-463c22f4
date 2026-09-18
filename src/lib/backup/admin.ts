// Kept apart from engine.ts so checking the role does not pull zip.js into the main bundle.
import { supabase } from "@/integrations/supabase/client";

export async function isCurrentUserAdmin(): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}
