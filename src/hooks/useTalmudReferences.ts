import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import type { TalmudReference, ValidationStatus } from '@/components/talmud-index/types';
import { extractReferencesFromText, saveReferences } from '@/lib/references/extractAll';



export function useTalmudReferences(psakDinId?: string) {
  return useQuery({
    queryKey: ['talmud_references', psakDinId],
    queryFn: async () => {
      let query = supabase
        .from('talmud_references')
        .select('*')
        .order('tractate', { ascending: true })
        .order('daf', { ascending: true });

      if (psakDinId) {
        query = query.eq('psak_din_id', psakDinId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as TalmudReference[];
    },
  });
}

export function useAllReferencesGrouped(enabled = true) {
  return useQuery({
    queryKey: ['talmud_references', 'grouped'],
    queryFn: async () => {
      const PAGE_SIZE = 1000;
      let all: (TalmudReference & { psakei_din: { title: string; court: string } })[] = [];
      let offset = 0;
      let done = false;

      while (!done) {
        const { data, error } = await supabase
          .from('talmud_references')
          .select('*, psakei_din(title, court)')
          .order('tractate', { ascending: true })
          .order('daf', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) { done = true; break; }
        all = all.concat(data as unknown as typeof all);
        if (data.length < PAGE_SIZE) { done = true; }
        offset += PAGE_SIZE;
      }

      return all;
    },
    enabled,
    staleTime: 5 * 60 * 1000,    // 5 min — avoid refetch on tab switch
    gcTime: 30 * 60 * 1000,       // 30 min — keep in memory
  });
}

export function useExtractReferences() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ text, psakDinId, useAI }: { text: string; psakDinId: string; useAI: boolean }) => {
      const references = await extractReferencesFromText(text, psakDinId, useAI);
      if (!references.length) return { count: 0 };
      const saved = await saveReferences(psakDinId, references, user?.id ?? null);
      return { count: saved };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['talmud_references'] });
      toast.success(`נמצאו ${data.count} הפניות תלמודיות`);
    },
    onError: (e: Error) => toast.error('שגיאה בחילוץ הפניות: ' + e.message),
  });
}

export function useBatchExtractReferences() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ psakim, useAI }: { psakim: { id: string; text: string }[]; useAI: boolean }) => {
      let totalCount = 0;

      for (const psak of psakim) {
        if (!psak.text) continue;
        try {
          const references = await extractReferencesFromText(psak.text, psak.id, useAI);
          if (!references.length) continue;
          totalCount += await saveReferences(psak.id, references, user?.id ?? null);
        } catch {
          // ממשיכים לפסק הבא
        }
      }

      return { count: totalCount };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['talmud_references'] });
      toast.success(`נמצאו ${data.count} הפניות תלמודיות`);
    },
    onError: (e: Error) => toast.error('שגיאה בחילוץ הפניות: ' + e.message),
  });
}

export function useValidateReference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, autoDismissIds }: { id: string; status: ValidationStatus; autoDismissIds?: string[] }) => {
      const { error } = await supabase
        .from('talmud_references')
        .update({ validation_status: status })
        .eq('id', id);
      if (error) throw error;

      if (autoDismissIds && autoDismissIds.length > 0) {
        const { error: err2 } = await supabase
          .from('talmud_references')
          .update({ validation_status: 'ignored' })
          .in('id', autoDismissIds);
        if (err2) throw err2;
      }
    },
    onMutate: async ({ id, status, autoDismissIds }) => {
      await queryClient.cancelQueries({ queryKey: ['talmud_references'] });
      const previousGrouped = queryClient.getQueryData(['talmud_references', 'grouped']);

      queryClient.setQueriesData<TalmudReference[]>(
        { queryKey: ['talmud_references'] },
        (old) => old?.map((ref: TalmudReference) => {
          if (ref.id === id) return { ...ref, validation_status: status };
          if (autoDismissIds?.includes(ref.id)) return { ...ref, validation_status: 'ignored' };
          return ref;
        })
      );

      return { previousGrouped };
    },
    onError: (e: Error, _vars, context) => {
      if (context?.previousGrouped) {
        queryClient.setQueryData(['talmud_references', 'grouped'], context.previousGrouped);
      }
      toast.error('שגיאה בעדכון: ' + e.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['talmud_references'] });
    },
  });
}

export function useCorrectReference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, correctedNormalized }: { id: string; correctedNormalized: string }) => {
      const { error } = await supabase
        .from('talmud_references')
        .update({
          corrected_normalized: correctedNormalized,
          validation_status: 'correct' as ValidationStatus,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async ({ id, correctedNormalized }) => {
      await queryClient.cancelQueries({ queryKey: ['talmud_references'] });
      const previous = queryClient.getQueryData(['talmud_references', 'grouped']);

      queryClient.setQueriesData<TalmudReference[]>(
        { queryKey: ['talmud_references'] },
        (old) => old?.map((ref) =>
          ref.id === id
            ? { ...ref, corrected_normalized: correctedNormalized, validation_status: 'correct' as ValidationStatus }
            : ref
        )
      );

      return { previous };
    },
    onError: (e: Error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['talmud_references', 'grouped'], context.previous);
      }
      toast.error('שגיאה בעדכון התיקון: ' + e.message);
    },
    onSuccess: () => {
      toast.success('ההפניה תוקנה ואושרה בהצלחה');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['talmud_references'] });
    },
  });
}
