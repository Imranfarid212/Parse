/**
 * ExportScreen — the Export tab.
 *
 * The card keeps the finance-app shape it was designed with (presets, format,
 * include-scans, one footer button), but nothing under it is a mock any more:
 * Generate starts a real export job, and everything below the button is the
 * live state of the user's `export_jobs` rows arriving over Realtime.
 *
 * Two product rules show through the UI. Formats are Excel and PDF — there is
 * no CSV, because a CSV cannot carry the per-currency subtotal blocks the
 * export is required to produce (Blueprint §12). And the filters here are the
 * same sheet Search uses, so "what I searched" and "what I exported" cannot
 * mean two different things.
 */
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import type { ExportArtifact, ExportJob } from '@/../packages/contracts/src';
import { Card, Eyebrow, GRAY, Toggle } from '@/components/menu/primitives';
import {
  describeFilters,
  formatFilterDate,
  ReceiptFilterSheet,
  toIsoDate,
  type ReceiptFilters,
} from '@/components/receipt/ReceiptFilterSheet';
import { useAuth } from '@/lib/auth/auth-context';
import { searchManagedReceipts } from '@/lib/receipts/management';
import {
  createExportDownloadUrl,
  exportState,
  repeatExport,
  retryExportJob,
  startExport,
  useExportJobs,
  type ExportFormat,
} from '@/lib/receipts/exports';
import { fontFamily, spacing } from '@/theme/tokens';

type Preset = 'this' | 'last' | 'quarter' | 'all';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this', label: 'This Month' },
  { key: 'last', label: 'Last Month' },
  { key: 'quarter', label: 'Last 3 Months' },
  { key: 'all', label: 'All Time' },
];

/** Presets are a shortcut into the same date fields the filter sheet edits. */
function rangeFor(preset: Preset, today = new Date()): { date_from?: string; date_to?: string } {
  const year = today.getFullYear();
  const month = today.getMonth();
  switch (preset) {
    case 'last':
      return { date_from: toIsoDate(new Date(year, month - 1, 1)), date_to: toIsoDate(new Date(year, month, 0)) };
    case 'quarter':
      return { date_from: toIsoDate(new Date(year, month - 2, 1)), date_to: toIsoDate(today) };
    case 'all':
      return { date_from: undefined, date_to: undefined };
    case 'this':
    default:
      return { date_from: toIsoDate(new Date(year, month, 1)), date_to: toIsoDate(today) };
  }
}

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const ARTIFACT_LABEL: Record<ExportArtifact['kind'], string> = {
  workbook: 'Data & totals',
  statement: 'Statement',
  images: 'Receipt scans',
};

/** Segmented Excel / PDF control with a sliding white indicator. */
const SEG_PAD = 6;
function FormatToggle({ value, onChange }: { value: ExportFormat; onChange: (format: ExportFormat) => void }) {
  const [trackW, setTrackW] = useState(0);
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / 2 : 0;
  const p = useDerivedValue(() => withTiming(value === 'xlsx' ? 1 : 0, { duration: 200 }));
  const indicator = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: p.value * segW }] }));

  return (
    <View style={styles.segTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 && <Animated.View style={[styles.segIndicator, indicator]} />}
      <Pressable style={styles.segBtn} onPress={() => onChange('pdf')} accessibilityRole="button">
        <Feather name="file-text" size={16} color={value === 'pdf' ? '#EF4444' : GRAY[500]} />
        <Text style={[styles.segLabel, { color: value === 'pdf' ? GRAY[900] : GRAY[500] }]}>PDF Report</Text>
      </Pressable>
      <Pressable style={styles.segBtn} onPress={() => onChange('xlsx')} accessibilityRole="button">
        <Feather name="grid" size={16} color={value === 'xlsx' ? '#16A34A' : GRAY[500]} />
        <Text style={[styles.segLabel, { color: value === 'xlsx' ? GRAY[900] : GRAY[500] }]}>Excel Sheet</Text>
      </Pressable>
    </View>
  );
}

export function ExportScreen() {
  const auth = useAuth();
  const [preset, setPreset] = useState<Preset>('this');
  const [filters, setFilters] = useState<ReceiptFilters>(() => rangeFor('this'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [includeScans, setIncludeScans] = useState(false);
  const [starting, setStarting] = useState(false);

  const { jobs, loading, error } = useExportJobs(auth.user?.id);

  const categories = useMemo(
    () => auth.categories.filter((category) => auth.selectedCategoryIds.includes(category.id) || category.is_system),
    [auth.categories, auth.selectedCategoryIds],
  );
  const summary = describeFilters(filters, categories);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    setFilters((current) => ({ ...current, ...rangeFor(next) }));
  };

  const onGenerate = async () => {
    setStarting(true);
    try {
      // Check before asking the server to build anything. An export of nothing
      // is a file the user opens to find empty, several seconds after tapping —
      // the answer is better delivered now. This runs the app's own search, so
      // it counts exactly the receipts the export would have contained.
      const matches = await searchManagedReceipts(filters, auth.user?.id);
      if (matches.length === 0) {
        Alert.alert(
          'Nothing to export',
          'No receipts match these filters. Try a wider date range, or clear some filters.',
        );
        return;
      }
      await startExport({ filters, format, include_images: includeScans });
    } catch (cause) {
      Alert.alert('Export not started', cause instanceof Error ? cause.message : 'Try again in a moment.');
    } finally {
      setStarting(false);
    }
  };

  const openArtifact = async (artifact: ExportArtifact) => {
    try {
      const url = await createExportDownloadUrl(artifact);
      await WebBrowser.openBrowserAsync(url);
    } catch (cause) {
      Alert.alert('Download failed', cause instanceof Error ? cause.message : 'That file is no longer available.');
    }
  };

  const shareArtifact = async (artifact: ExportArtifact) => {
    try {
      const url = await createExportDownloadUrl(artifact);
      await Share.share({ url, message: artifact.file_name });
    } catch (cause) {
      Alert.alert('Share failed', cause instanceof Error ? cause.message : 'That file is no longer available.');
    }
  };

  const onRetry = async (job: ExportJob) => {
    try {
      await retryExportJob(job.id);
    } catch (cause) {
      Alert.alert('Retry failed', cause instanceof Error ? cause.message : 'Try again in a moment.');
    }
  };

  const onRepeat = async (job: ExportJob) => {
    try {
      await repeatExport(job);
    } catch (cause) {
      Alert.alert('Export not started', cause instanceof Error ? cause.message : 'Try again in a moment.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.subtitle}>Generate expense reports.</Text>

      <Card style={styles.mainCard}>
        <View style={{ padding: spacing.lg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {PRESETS.map((option) => {
              const on = option.key === preset;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => applyPreset(option.key)}
                  style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, { color: on ? '#FFFFFF' : GRAY[600] }]}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ marginTop: 20, marginBottom: 24, gap: 8 }}>
            <Eyebrow style={{ marginLeft: 4 }}>Receipts to include</Eyebrow>
            <Pressable
              style={({ pressed }) => [styles.filterBtn, pressed && { backgroundColor: GRAY[100] }]}
              onPress={() => setFiltersOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Edit export filters. Currently ${summary}`}
            >
              <View style={styles.filterLeft}>
                <View style={styles.filterChip}>
                  <Feather name="sliders" size={14} color={GRAY[500]} />
                </View>
                <Text style={styles.filterValue} numberOfLines={2}>{summary}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={GRAY[400]} />
            </Pressable>
          </View>

          <Eyebrow style={{ marginLeft: 4, marginBottom: 8 }}>Format</Eyebrow>
          <FormatToggle value={format} onChange={setFormat} />

          <View style={styles.scansRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scansTitle}>Include Receipt Scans</Text>
              <Text style={styles.scansSub}>Combine original images into a PDF</Text>
            </View>
            <Toggle value={includeScans} onValueChange={setIncludeScans} />
          </View>
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={() => void onGenerate()}
            disabled={starting}
            accessibilityRole="button"
            style={({ pressed }) => [styles.generateBtn, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            {starting ? (
              <Animated.View entering={FadeIn} style={styles.generateInner}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
                <Text style={styles.generateText}>Starting…</Text>
              </Animated.View>
            ) : (
              <Animated.View entering={FadeIn} style={styles.generateInner}>
                <Feather name="download" size={18} color="#FFFFFF" />
                <Text style={styles.generateText}>Generate Export</Text>
              </Animated.View>
            )}
          </Pressable>
        </View>
      </Card>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {jobs.length > 0 ? (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.results}>
          <Text style={styles.resultsHeading}>Your exports</Text>
          {jobs.map((job) => (
            <ExportJobRow
              key={job.id}
              job={job}
              categories={categories}
              onOpen={(artifact) => void openArtifact(artifact)}
              onShare={(artifact) => void shareArtifact(artifact)}
              onRetry={() => void onRetry(job)}
              onRepeat={() => void onRepeat(job)}
            />
          ))}
        </Animated.View>
      ) : loading ? null : (
        <Text style={styles.emptyText}>Exports you generate will appear here.</Text>
      )}

      <ReceiptFilterSheet
        visible={filtersOpen}
        value={filters}
        categories={categories}
        defaultCurrency={auth.profile?.default_currency ?? 'USD'}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => { setFilters(next); setFiltersOpen(false); }}
        applyLabel="Use these filters"
      />
    </ScrollView>
  );
}

/**
 * One export, in whichever of four states it is actually in.
 *
 * "Ready to download" is only ever shown when there are files to download. A
 * finished export whose seven days are up keeps its row — it is a record of what
 * was exported and when — but says so plainly and offers to run it again with
 * the same filters, which is the thing the user wants at that point anyway.
 */
function ExportJobRow({ job, categories, onOpen, onShare, onRetry, onRepeat }: {
  job: ExportJob;
  categories: { id: number; name: string }[];
  onOpen: (artifact: ExportArtifact) => void;
  onShare: (artifact: ExportArtifact) => void;
  onRetry: () => void;
  onRepeat: () => void;
}) {
  const state = exportState(job);
  const describe = `${job.format === 'xlsx' ? 'Excel sheet' : 'PDF report'}${job.include_images ? ' · with receipt scans' : ''}`;
  // What was exported, in the user's own terms. Without this a past export is
  // unidentifiable, and "Export again" asks them to re-run something they
  // cannot see.
  const contents = describeFilters(job.filters ?? {}, categories);

  if (state === 'failed') {
    return (
      <View style={[styles.jobCard, styles.jobCardFailed]}>
        <View style={styles.jobHead}>
          <Feather name="alert-circle" size={16} color="#B42318" />
          <Text style={styles.jobTitle}>Export failed</Text>
        </View>
        <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
        <Text style={styles.jobMeta}>{job.error ?? 'Something went wrong building this export.'}</Text>
        <Pressable style={styles.retryBtn} onPress={onRetry} accessibilityRole="button">
          <Feather name="refresh-cw" size={14} color={GRAY[900]} />
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (state === 'queued' || state === 'running') {
    return (
      <View style={styles.jobCard}>
        <View style={styles.jobHead}>
          <ActivityIndicator size="small" color={GRAY[500]} />
          <Text style={styles.jobTitle}>{state === 'running' ? 'Building your export…' : 'Queued'}</Text>
        </View>
        <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
        <Text style={styles.jobMeta}>{describe}</Text>
      </View>
    );
  }

  if (state === 'expired') {
    return (
      <View style={styles.jobCard}>
        <View style={styles.jobHead}>
          <Feather name="clock" size={16} color={GRAY[400]} />
          <Text style={[styles.jobTitle, { color: GRAY[600] }]}>Download expired</Text>
        </View>
        <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
        <Text style={styles.jobMeta}>
          {describe} · {job.receipt_count ?? 0} receipt{job.receipt_count === 1 ? '' : 's'}
        </Text>
        <Text style={styles.jobMeta}>Downloads stay available for 7 days after an export is made.</Text>
        <Pressable style={styles.retryBtn} onPress={onRepeat} accessibilityRole="button">
          <Feather name="refresh-cw" size={14} color={GRAY[900]} />
          <Text style={styles.retryText}>Export again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.jobCard}>
      <View style={styles.jobHead}>
        <Feather name="check-circle" size={16} color="#22C55E" />
        <Text style={styles.jobTitle}>Ready to download</Text>
      </View>
      <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
      <Text style={styles.jobMeta}>
        {job.receipt_count ?? 0} receipt{job.receipt_count === 1 ? '' : 's'}
        {job.expires_at ? ` · Available until ${formatFilterDate(job.expires_at.slice(0, 10))}` : ''}
      </Text>
      {job.artifacts.map((artifact) => (
        <Pressable
          key={artifact.file_path}
          onPress={() => onOpen(artifact)}
          onLongPress={() => onShare(artifact)}
          accessibilityRole="button"
          accessibilityLabel={`Download ${artifact.file_name}`}
          style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: GRAY[50] }]}
        >
          <View style={styles.resultLeft}>
            <View style={[styles.resultIcon, { backgroundColor: artifact.kind === 'images' ? '#EFF6FF' : artifact.kind === 'workbook' ? '#F0FDF4' : '#FEF2F2' }]}>
              <Feather
                name={artifact.kind === 'images' ? 'image' : artifact.kind === 'workbook' ? 'grid' : 'file-text'}
                size={18}
                color={artifact.kind === 'images' ? '#3B82F6' : artifact.kind === 'workbook' ? '#16A34A' : '#EF4444'}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.resultName} numberOfLines={1}>{artifact.file_name}</Text>
              <Text style={styles.resultMeta}>
                {formatBytes(artifact.byte_size)} · {ARTIFACT_LABEL[artifact.kind]}
                {artifact.part_count > 1 ? ` · part ${artifact.part} of ${artifact.part_count}` : ''}
              </Text>
            </View>
          </View>
          <Feather name="download" size={18} color={GRAY[400]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: 40 },
  subtitle: { fontFamily: fontFamily.regular, fontSize: 15, color: GRAY[500], marginBottom: 20 },

  mainCard: { borderRadius: 24 },

  chipRow: { gap: 8, paddingRight: spacing.lg },
  chip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 },
  chipOn: {
    backgroundColor: GRAY[900],
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0,0,0,0.12)' }],
  },
  chipOff: { backgroundColor: GRAY[50], borderWidth: 1, borderColor: GRAY[200] },
  chipText: { fontFamily: fontFamily.semibold, fontSize: 13 },

  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    backgroundColor: GRAY[50],
    borderWidth: 1,
    borderColor: GRAY[200],
  },
  filterLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 8 },
  filterChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GRAY[100],
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0,0,0,0.06)' }],
  },
  filterValue: { flex: 1, fontFamily: fontFamily.semibold, fontSize: 14, color: GRAY[900] },

  segTrack: {
    flexDirection: 'row',
    backgroundColor: GRAY[50],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GRAY[200],
    padding: 6,
  },
  segIndicator: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0,0,0,0.08)' }],
  },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  segLabel: { fontFamily: fontFamily.semibold, fontSize: 14 },

  scansRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY[200],
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0,0,0,0.05)' }],
  },
  scansTitle: { fontFamily: fontFamily.semibold, fontSize: 15, color: GRAY[900] },
  scansSub: { fontFamily: fontFamily.regular, fontSize: 13, color: GRAY[500], marginTop: 2 },

  footer: { padding: 16, backgroundColor: 'rgba(249,250,251,0.6)', borderTopWidth: 1, borderTopColor: GRAY[100] },
  generateBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: GRAY[900],
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(0,0,0,0.15)' }],
  },
  generateInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  generateText: { fontFamily: fontFamily.semibold, fontSize: 15, color: '#FFFFFF' },

  results: { marginTop: 24, gap: 12 },
  resultsHeading: { fontFamily: fontFamily.display, fontSize: 14, color: GRAY[900], marginLeft: 4 },
  emptyText: { marginTop: 24, textAlign: 'center', fontFamily: fontFamily.regular, fontSize: 13, color: GRAY[500] },
  errorText: { marginTop: 16, textAlign: 'center', fontFamily: fontFamily.regular, fontSize: 13, color: '#B42318' },

  jobCard: {
    gap: 10,
    padding: 16,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY.ring,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.04)' }],
  },
  jobCardFailed: { borderColor: '#FECDCA', backgroundColor: '#FFFBFA' },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { fontFamily: fontFamily.semibold, fontSize: 14, color: GRAY[900] },
  jobContents: { fontFamily: fontFamily.semibold, fontSize: 13, color: GRAY[700], marginTop: -2 },
  jobMeta: { fontFamily: fontFamily.regular, fontSize: 12, color: GRAY[500] },
  retryBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: GRAY[100],
  },
  retryText: { fontFamily: fontFamily.semibold, fontSize: 13, color: GRAY[900] },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY[200],
  },
  resultLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 8 },
  resultIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultName: { fontFamily: fontFamily.semibold, fontSize: 14, color: GRAY[900] },
  resultMeta: { fontFamily: fontFamily.regular, fontSize: 12, color: GRAY[500], marginTop: 2 },
});
