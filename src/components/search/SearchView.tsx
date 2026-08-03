/**
 * SearchView — the Search tab content. A header row (a "filter" pill on the
 * left, a Card/List view toggle on the right), a search bar, then the results:
 * the fan carousel ("Card view") or a plain list ("List view"). When a query
 * matches nothing, the empty state shows instead. Rule: when results
 * exceed 7, the system forces List view and disables the toggle (the card fan
 * shows the latest 5 when there are more receipts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GRAY, Toggle } from '@/components/menu/primitives';
import { FanCarousel, type FanItem } from '@/components/search/FanCarousel';
import { SleuthDog } from '@/components/search/SleuthDog';
import { retryBlockedCapture, retryFailedImageUpload } from '@/lib/receipts/capture';
import { listRecent } from '@/lib/receipts/store';
import type { ReceiptRow, ReceiptStatus } from '@/lib/receipts/types';
import { colors, radius, spacing, typography } from '@/theme/tokens';

const MAX_FAN = 5;

/** Rows the retry queue is still working on — while any are listed, re-read. */
const IN_FLIGHT_STATUSES = new Set<ReceiptStatus>([
  'pending_extract',
  'llm_processing',
  'llm_failed_retryable',
  'image_upload_pending',
]);

const REFRESH_WHILE_IN_FLIGHT_MS = 2_500;

/**
 * Rows that are going nowhere on their own but still hold the user's photo, so
 * there has to be a way back. Without an action these read as a dead end — and
 * blocked_quota used to be worse than a dead end: the capture was deleted
 * outright, with nothing shown.
 */
const ACTIONABLE_STATUSES = new Set<ReceiptStatus>(['blocked_quota', 'llm_failed_final']);
const IMAGE_BACKUP_IN_FLIGHT = new Set<ReceiptRow['imageSyncStatus']>([
  'pending_upload',
  'uploading',
  'upload_failed',
]);

/**
 * A receipt whose extraction succeeded but whose photo never reached Storage.
 *
 * A second axis from `status`, not a third member of the set above: these rows
 * are otherwise fine — fields extracted, receipt saved — so their status says
 * `synced` and nothing about them looks wrong. Under DL-002 the device holds the
 * only copy of that photo, so this is exactly the case the user has to be told
 * about. It was written in one place and read in none; the row sat there looking
 * complete with its photo going nowhere.
 */
const imageUploadFailed = (row: ReceiptRow) => row.imageSyncStatus === 'upload_failed_final';
const imageBackupInFlight = (row: ReceiptRow) => IMAGE_BACKUP_IN_FLIGHT.has(row.imageSyncStatus);

const formatTotal = (row: ReceiptRow) => {
  const fields = row.fields;
  if (!fields) return '...';
  const amount = Number.isFinite(fields.total) ? fields.total.toFixed(2) : '0.00';
  return `${fields.currency || 'USD'} ${amount}`;
};

const receiptTitle = (row: ReceiptRow) => {
  const store = row.fields?.store?.trim();
  if (store) return store;
  if (row.status === 'llm_failed_retryable' || row.status === 'pending_extract') return 'Processing receipt';
  return 'Receipt';
};

/**
 * What a row says before it has any extracted fields. Without this the raw
 * status enum reaches the user — a scan queued offline read "llm failed
 * retryable" on the list, in release builds too.
 *
 * "Waiting to retry" rather than "Waiting for network": the retryable states
 * also cover a slow or 5xx server, so promising connectivity is the fix would
 * sometimes be a lie.
 */
const STATUS_LABELS: Record<ReceiptStatus, string> = {
  local_captured: 'Processing…',
  local_ocr_processing: 'Reading receipt…',
  local_ocr_done: 'Processing…',
  image_upload_pending: 'Waiting to retry',
  image_uploaded: 'Processing…',
  pending_extract: 'Waiting to retry',
  llm_processing: 'Processing…',
  llm_failed_retryable: 'Waiting to retry',
  llm_failed_final: 'Could not be processed',
  blocked_quota: 'Out of scans',
  user_confirmation_pending: 'Needs review',
  extracted: 'Needs review',
  confirmed_local: 'Saved',
  result_sync_pending: 'Saving…',
  synced: 'Saved',
  delete_pending: 'Removing…',
  deleted: 'Removed',
};

const receiptMeta = (row: ReceiptRow) => {
  // Said plainly, and said even when the row has fields to show — the whole
  // point is that a row with a failed photo upload otherwise looks finished.
  if (imageUploadFailed(row)) return 'Photo not backed up';
  if (row.imageSyncStatus === 'missing_local_file') return 'Photo unavailable';
  if (row.imageSyncStatus === 'upload_failed') return 'Photo backup will retry';
  if (imageBackupInFlight(row)) return 'Backing up photo';
  const parts = [row.fields?.date, row.fields?.category].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : STATUS_LABELS[row.status];
};

const duplicateBadgeLabel = (row: ReceiptRow, similarDedupeKeys: Set<string>) => {
  const key = similarGroupKey(row);
  if (!row.duplicateOf && (!key || !similarDedupeKeys.has(key))) return null;
  return row.duplicateMatchStrength === 'strong' ? 'Duplicate receipt' : 'Similar receipt';
};

const similarGroupKey = (row: ReceiptRow) => {
  if (row.dedupeKey) return row.dedupeKey;
  const fields = row.fields;
  if (!fields?.date || !fields.currency || !Number.isFinite(fields.total) || fields.total <= 0) return null;
  return [fields.date, fields.currency.toUpperCase(), String(Math.round(fields.total * 100))].join('|');
};

const normalizeMerchant = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(pvt|private|ltd|limited|inc|llc|store|market)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const softSimilarGroupKey = (row: ReceiptRow) => {
  const fields = row.fields;
  if (!fields?.store || !fields.currency || !Number.isFinite(fields.total) || fields.total <= 0) return null;
  const merchant = normalizeMerchant(fields.store);
  if (!merchant) return null;
  return [merchant, fields.currency.toUpperCase(), String(Math.round(fields.total * 100))].join('|');
};

const searchableText = (row: ReceiptRow) =>
  [
    row.fields?.store,
    row.fields?.date,
    row.fields?.currency,
    row.fields?.total,
    row.fields?.category,
    row.fields?.handwritten_notes,
    ...(row.fields?.items ?? []).map((item) => item.name),
    row.status,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();

export function SearchView({ onOpenPlan }: { onOpenPlan?: () => void } = {}) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'card' | 'list'>('card');
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async (initial = false) => {
    try {
      const recent = await listRecent(50);
      if (aliveRef.current) setRows(recent);
    } catch (error) {
      console.warn('[recents] failed to load local receipts', error);
      // Only the first read clears the list; a later failure keeps what we have
      // rather than blanking a screen the user is looking at.
      if (initial && aliveRef.current) setRows([]);
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, []);

  /**
   * Hand a blocked or failed capture back to the queue and re-read, so the row
   * visibly moves to "Waiting to retry" rather than looking like nothing
   * happened. The photo is still on the device; that is what makes this work.
   */
  const onRetryRow = useCallback(
    async (id: string) => {
      // Two different failures wear the same button. A failed photo upload has
      // a perfectly good extraction behind it, so re-running extraction would
      // spend a scan to re-read a receipt the user already has — it needs the
      // backup queue, not the extract queue.
      const row = rows.find((candidate) => candidate.id === id);
      if (row && imageUploadFailed(row)) await retryFailedImageUpload(id);
      else await retryBlockedCapture(id);
      await reload();
    },
    [reload, rows],
  );

  useEffect(() => {
    void reload(true);
  }, [reload]);

  // The retry queue drains in the background (camera's reconnect flush), so a
  // row can finish while this view is open. Nothing pushed those changes here,
  // so a receipt queued offline sat on "Processing receipt" until the view was
  // reopened. Re-read on the events that move rows.
  useEffect(() => {
    const network = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable) void reload();
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => {
      network.remove();
      app.remove();
    };
  }, [reload]);

  const hasInFlightRows = useMemo(
    () => rows.some((row) => IN_FLIGHT_STATUSES.has(row.status) || imageBackupInFlight(row)),
    [rows],
  );

  // Reconnecting starts the retries; it does not finish them. Poll while any
  // row is still in flight so the result lands on its own, and stop the moment
  // none are — this cannot spin on an idle list.
  useEffect(() => {
    if (!hasInFlightRows) return undefined;
    const timer = setInterval(() => void reload(), REFRESH_WHILE_IN_FLIGHT_MS);
    return () => clearInterval(timer);
  }, [hasInFlightRows, reload]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => searchableText(row).includes(q));
  }, [query, rows]);

  const fanItems = useMemo<FanItem[]>(
    () => results.slice(0, MAX_FAN).map((row) => ({ id: row.id, total: formatTotal(row) })),
    [results],
  );
  const similarDedupeKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = similarGroupKey(row);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);
  const softSimilarKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = softSimilarGroupKey(row);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [rows]);

  const empty = results.length === 0;

  return (
    <View style={styles.root}>
      {/* Header row: filter pill + view toggle */}
      <View style={[styles.headerRow, { width: width - spacing.lg * 2 }]}>
        <Pressable style={styles.filterPill} hitSlop={6}>
          <Text style={styles.filterText}>All Receipts</Text>
          <Feather name="chevron-down" size={14} color={GRAY[500]} />
        </Pressable>

        <View style={styles.viewToggle}>
          <Feather
            name={mode === 'card' ? 'grid' : 'list'}
            size={14}
            color={GRAY[500]}
          />
          <Text style={styles.viewLabel}>{mode === 'card' ? 'Card view' : 'List view'}</Text>
          <Toggle
            value={mode === 'card'}
            onValueChange={(v) => setMode(v ? 'card' : 'list')}
          />
        </View>
      </View>

      {/* Search bar */}
      <View style={[styles.searchBar, { width: width - spacing.lg * 2 }]}>
        <Ionicons name="search" size={18} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search receipts"
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Body */}
      <View style={styles.body}>
        {empty ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.emptyWrap}>
            <SleuthDog size={240} fadeColor={colors.background} />
            <Text style={styles.emptyText}>{loaded ? 'No receipts found' : 'Loading receipts'}</Text>
          </Animated.View>
        ) : mode === 'card' ? (
          <FanCarousel items={fanItems} />
        ) : (
          <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={{ paddingHorizontal: spacing.lg }}>
            {results.map((row) => (
              <ReceiptListRow
                key={row.id}
                row={row}
                similarDedupeKeys={similarDedupeKeys}
                softSimilarKeys={softSimilarKeys}
                onRetry={onRetryRow}
                onUpgrade={onOpenPlan}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function ReceiptListRow({
  row,
  similarDedupeKeys,
  softSimilarKeys,
  onRetry,
  onUpgrade,
}: {
  row: ReceiptRow;
  similarDedupeKeys: Set<string>;
  softSimilarKeys: Set<string>;
  onRetry: (id: string) => void;
  onUpgrade?: () => void;
}) {
  const badge = duplicateBadgeLabel(row, similarDedupeKeys) ?? (softSimilarKeys.has(softSimilarGroupKey(row) ?? '') ? 'Similar receipt' : null);
  const uploadFailed = imageUploadFailed(row);
  const actionable = ACTIONABLE_STATUSES.has(row.status) || uploadFailed;
  return (
    <View style={styles.listRow}>
      <View style={styles.listIcon}>
        <Ionicons name="receipt-outline" size={20} color={colors.textPrimary} />
      </View>
      <View style={styles.listText}>
        <View style={styles.titleRow}>
          <Text style={styles.listLabel} numberOfLines={2}>{receiptTitle(row)}</Text>
          {badge && (
            <View style={styles.duplicateBadge}>
              <Text style={styles.duplicateText}>{badge}</Text>
            </View>
          )}
        </View>
        <Text style={styles.listMeta} numberOfLines={1}>{receiptMeta(row)}</Text>
        {actionable && (
          <View style={styles.actionRow}>
            {row.status === 'blocked_quota' && !uploadFailed && onUpgrade && (
              <Pressable style={styles.actionPrimary} onPress={onUpgrade} hitSlop={6}>
                <Text style={styles.actionPrimaryText}>Upgrade</Text>
              </Pressable>
            )}
            <Pressable style={styles.action} onPress={() => onRetry(row.id)} hitSlop={6}>
              <Text style={styles.actionText}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>
      <Text style={styles.listTotal}>{formatTotal(row)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },

  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { fontFamily: typography.button.fontFamily, fontSize: 12, color: colors.textPrimary },
  actionPrimary: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
  },
  actionPrimaryText: { fontFamily: typography.button.fontFamily, fontSize: 12, color: colors.background },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(120,120,128,0.10)',
  },
  filterText: { fontFamily: typography.button.fontFamily, fontSize: 13, color: colors.textPrimary },
  viewToggle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  viewLabel: { fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: GRAY[500] },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY[200],
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0,0,0,0.04)' }],
  },
  searchInput: { flex: 1, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary, padding: 0 },

  body: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -40 },
  emptyText: { fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: GRAY[500], marginTop: -24 },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  listIcon: { width: 32, alignItems: 'center' },
  listText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  listLabel: { flex: 1, minWidth: 0, fontFamily: typography.subtitle.fontFamily, fontSize: 15, color: colors.textPrimary },
  listMeta: { marginTop: 2, fontFamily: typography.subtitle.fontFamily, fontSize: 12, color: colors.textSecondary },
  duplicateBadge: {
    flexShrink: 0,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  duplicateText: { fontFamily: typography.button.fontFamily, fontSize: 10, color: '#92400E' },
  listTotal: { fontFamily: typography.button.fontFamily, fontSize: 15, color: colors.textPrimary },
});
