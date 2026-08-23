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
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import Animated, { FadeInDown } from 'react-native-reanimated';

import type { ExportArtifact, ExportJob } from '@/../packages/contracts/src';
import {
  Card,
  Chip,
  Eyebrow,
  PrimaryButton,
  Segmented,
  Toggle,
  type SegmentOption,
} from '@/components/menu/primitives';
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
import { makeStyles, useColors } from '@/theme/appearance';
import { radius, spacing, typography, type ColorTokens } from '@/theme/tokens';

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

/** The two export formats, as segments. See the header note on why there is no CSV.
 *  A function of the theme rather than a constant: the segment accents are
 *  themed, and a module-level array would freeze them at the light values. */
const formatOptions = (colors: ColorTokens): SegmentOption<ExportFormat>[] => [
  { key: 'pdf', label: 'PDF Report', icon: 'file-text', activeColor: colors.danger },
  { key: 'xlsx', label: 'Excel Sheet', icon: 'grid', activeColor: colors.accent },
];

export function ExportScreen() {
  const styles = useStyles();
  const colors = useColors();
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
            {PRESETS.map((option) => (
              <Chip
                key={option.key}
                label={option.label}
                selected={option.key === preset}
                onPress={() => applyPreset(option.key)}
              />
            ))}
          </ScrollView>

          <View style={{ marginTop: spacing.lg, marginBottom: spacing.lg, gap: spacing.sm }}>
            <Eyebrow style={{ marginLeft: spacing.xs }}>Receipts to include</Eyebrow>
            <Pressable
              style={({ pressed }) => [styles.filterBtn, pressed && { backgroundColor: colors.border }]}
              onPress={() => setFiltersOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Edit export filters. Currently ${summary}`}
            >
              <View style={styles.filterLeft}>
                <View style={styles.filterChip}>
                  <Feather name="sliders" size={14} color={colors.textSecondary} />
                </View>
                <Text style={styles.filterValue} numberOfLines={2}>{summary}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.textFaint} />
            </Pressable>
          </View>

          <Eyebrow style={{ marginLeft: spacing.xs, marginBottom: spacing.sm }}>Format</Eyebrow>
          <Segmented value={format} options={formatOptions(colors)} onChange={setFormat} />

          <View style={styles.scansRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.scansTitle}>Include Receipt Scans</Text>
              <Text style={styles.scansSub}>Combine original images into a PDF</Text>
            </View>
            <Toggle label="Include receipt scans" value={includeScans} onValueChange={setIncludeScans} />
          </View>
        </View>

        <View style={styles.footer}>
          <PrimaryButton
            label="Generate Export"
            icon="download"
            busy={starting}
            busyLabel="Starting…"
            onPress={() => void onGenerate()}
          />
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
  const styles = useStyles();
  const colors = useColors();
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
          <Feather name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.jobTitle}>Export failed</Text>
        </View>
        <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
        <Text style={styles.jobMeta}>{job.error ?? 'Something went wrong building this export.'}</Text>
        <Pressable style={styles.retryBtn} onPress={onRetry} accessibilityRole="button">
          <Feather name="refresh-cw" size={14} color={colors.textPrimary} />
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (state === 'queued' || state === 'running') {
    return (
      <View style={styles.jobCard}>
        <View style={styles.jobHead}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
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
          <Feather name="clock" size={16} color={colors.textFaint} />
          <Text style={[styles.jobTitle, { color: colors.textSecondary }]}>Download expired</Text>
        </View>
        <Text style={styles.jobContents} numberOfLines={2}>{contents}</Text>
        <Text style={styles.jobMeta}>
          {describe} · {job.receipt_count ?? 0} receipt{job.receipt_count === 1 ? '' : 's'}
        </Text>
        <Text style={styles.jobMeta}>Downloads stay available for 7 days after an export is made.</Text>
        <Pressable style={styles.retryBtn} onPress={onRepeat} accessibilityRole="button">
          <Feather name="refresh-cw" size={14} color={colors.textPrimary} />
          <Text style={styles.retryText}>Export again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.jobCard}>
      <View style={styles.jobHead}>
        <Feather name="check-circle" size={16} color={colors.accent} />
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
          style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: colors.surfaceSubtle }]}
        >
          <View style={styles.resultLeft}>
            <View style={[styles.resultIcon, { backgroundColor: artifact.kind === 'images' ? colors.infoSurface : artifact.kind === 'workbook' ? colors.accentSurface : colors.dangerSurface }]}>
              <Feather
                name={artifact.kind === 'images' ? 'image' : artifact.kind === 'workbook' ? 'grid' : 'file-text'}
                size={18}
                color={artifact.kind === 'images' ? colors.info : artifact.kind === 'workbook' ? colors.accent : colors.danger}
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
          <Feather name="download" size={18} color={colors.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors, elevation) => ({
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xl },
  subtitle: { ...typography.subtitle, color: colors.textSecondary, marginBottom: spacing.lg },

  mainCard: {},

  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },

  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm + 6,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginRight: spacing.sm },
  filterChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterValue: { flex: 1, ...typography.row, color: colors.textPrimary },

  scansRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scansTitle: { ...typography.row, color: colors.textPrimary },
  scansSub: { ...typography.meta, color: colors.textSecondary, marginTop: 2 },

  footer: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  results: { marginTop: spacing.lg, gap: spacing.md },
  resultsHeading: { ...typography.row, color: colors.textPrimary, marginLeft: spacing.xs },
  emptyText: { marginTop: spacing.lg, textAlign: 'center', ...typography.meta, color: colors.textSecondary },
  errorText: { marginTop: spacing.md, textAlign: 'center', ...typography.meta, color: colors.danger },

  jobCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: elevation.card,
  },
  jobCardFailed: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerSurface },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  jobTitle: { ...typography.row, color: colors.textPrimary },
  jobContents: { ...typography.label, color: colors.textSecondary, marginTop: -2 },
  jobMeta: { ...typography.meta, fontSize: 12, color: colors.textFaint },
  retryBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: { ...typography.label, color: colors.textPrimary },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderRadius: radius.md,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginRight: spacing.sm },
  resultIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultName: { ...typography.row, color: colors.textPrimary },
  resultMeta: { ...typography.meta, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
}));
