import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { isCurrentUserAdmin } from "@/lib/backup/admin";

/** true when the signed-in user has the 'admin' role; null while unknown. */
export function useIsAdmin(): boolean | null {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    setIsAdmin(null);
    isCurrentUserAdmin()
      .then((v) => !cancelled && setIsAdmin(v))
      .catch(() => !cancelled && setIsAdmin(false));
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return isAdmin;
}
