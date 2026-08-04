import { useCallback, useEffect, useRef, useState } from 'react';

import type { SearchQuery } from '@/../packages/contracts/src';
import { useAuth } from '@/lib/auth/auth-context';
import { supabase } from '@/lib/auth/supabase';
import { searchManagedReceipts, type ManagedReceipt } from '@/lib/receipts/management';
import { syncFromServer } from '@/lib/receipts/server-sync';

export function useRealtimeReceipts(query: SearchQuery) {
  const auth = useAuth();
  const userId = auth.user?.id;
  const [receipts, setReceipts] = useState<ManagedReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const next = await searchManagedReceipts(queryRef.current, userId);
      if (request !== requestRef.current) return;
      setReceipts(next);
      setError(null);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load receipts.');
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [query, reload]);

  useEffect(() => {
    if (!userId || !auth.configured) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const reconcile = async () => {
      try {
        await syncFromServer(userId, auth.categories);
        if (!disposed) await reload();
      } catch (cause) {
        // Keep the already-rendered local mirror available. The next launch,
        // foreground event or realtime signal retries reconciliation.
        console.warn('[receipts] background reconciliation failed', cause);
      }
    };
    void reconcile();
    const channel = supabase
      .channel(`receipt-management:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'receipts', filter: `user_id=eq.${userId}` },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => void reconcile(), 100);
        },
      )
      .subscribe();
    return () => {
      disposed = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [auth.categories, auth.configured, userId, reload]);

  return { receipts, setReceipts, loading, error, reload };
}
