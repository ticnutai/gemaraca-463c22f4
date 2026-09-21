import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

/** Kept for the user_preferences.viewer_mode column; the app now has a single viewer. */
type ViewerMode = 'dialog' | 'embedpdf' | 'newwindow';

const VIEWER_PREF_KEY = 'psak_din_viewer_preference';
const RECENT_PSAKIM_KEY = 'recently_viewed_psakim';

/**
 * Syncs user preferences (viewer mode + recently viewed psakim) to Supabase.
 * Falls back to localStorage for unauthenticated users.
 * On login: merges localStorage → cloud, then cloud wins.
 */
export function useCloudPreferences() {
  const { user } = useAuth();
  const syncedRef = useRef(false);

  // On login: pull from cloud, merge with local
  useEffect(() => {
    if (!user || syncedRef.current) return;
    syncedRef.current = true;

    (async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('viewer_mode, recently_viewed_psakim')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        // Cloud → localStorage
        if (data.viewer_mode) {
          localStorage.setItem(VIEWER_PREF_KEY, data.viewer_mode);
        }
        if (Array.isArray(data.recently_viewed_psakim) && data.recently_viewed_psakim.length > 0) {
          // Merge: cloud items first, then local-only items
          const localRecent: string[] = JSON.parse(localStorage.getItem(RECENT_PSAKIM_KEY) || '[]');
          const cloudIds = data.recently_viewed_psakim as string[];
          const merged = [...cloudIds, ...localRecent.filter(id => !cloudIds.includes(id))].slice(0, 20);
          localStorage.setItem(RECENT_PSAKIM_KEY, JSON.stringify(merged));
        }
      } else {
        // First time: push local → cloud
        const viewerMode = localStorage.getItem(VIEWER_PREF_KEY) || 'embedpdf';
        const recentPsakim: string[] = JSON.parse(localStorage.getItem(RECENT_PSAKIM_KEY) || '[]');
        await supabase.from('user_preferences').insert({
          user_id: user.id,
          viewer_mode: viewerMode,
          recently_viewed_psakim: recentPsakim,
        });
      }
    })();
  }, [user]);

  // Reset sync flag on logout
  useEffect(() => {
    if (!user) syncedRef.current = false;
  }, [user]);

  const saveViewerMode = useCallback(async (mode: ViewerMode) => {
    localStorage.setItem(VIEWER_PREF_KEY, mode);
    if (!user) return;
    await supabase
      .from('user_preferences')
      .upsert({ user_id: user.id, viewer_mode: mode, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }, [user]);

  const saveRecentPsakim = useCallback(async (psakimIds: string[]) => {
    localStorage.setItem(RECENT_PSAKIM_KEY, JSON.stringify(psakimIds));
    if (!user) return;
    await supabase
      .from('user_preferences')
      .upsert({ user_id: user.id, recently_viewed_psakim: psakimIds, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }, [user]);

  return { saveViewerMode, saveRecentPsakim };
}
