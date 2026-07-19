/**
 * ExportScreen — the Export tab content (finance-app reference).
 * A single ringed card: date-range presets, start/end date rows, a PDF/CSV
 * format segmented control, and an "Include Receipt Scans" toggle, capped by a
 * footer "Generate Export" button. Generating (mock, 1.5s) reveals a
 * "Ready to download" list of result files. MenuPanel owns the "Export" title.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

import { Card, Eyebrow, GRAY, Toggle } from '@/components/menu/primitives';
import { fontFamily, spacing } from '@/theme/tokens';

type Preset = 'this' | 'last' | 'q3';
type Format = 'pdf' | 'csv';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

/** Presets resolve to a {start, end} range, shown in the two date rows. */
function rangeFor(preset: Preset, today = new Date('2026-07-18')): { start: string; end: string } {
  const y = today.getFullYear();
  switch (preset) {
    case 'last': {
      const first = new Date(y, today.getMonth() - 1, 1);
      const last = new Date(y, today.getMonth(), 0);
      return { start: fmt(first), end: fmt(last) };
    }
    case 'q3':
      return { start: fmt(new Date(y, 6, 1)), end: fmt(new Date(y, 8, 30)) };
    case 'this':
    default:
      return { start: fmt(new Date(y, today.getMonth(), 1)), end: fmt(today) };
  }
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'this', label: 'This Month' },
  { key: 'last', label: 'Last Month' },
  { key: 'q3', label: 'Q3 2026' },
];

/** Segmented PDF / CSV control with a sliding white indicator. */
const SEG_PAD = 6;
function FormatToggle({ value, onChange }: { value: Format; onChange: (f: Format) => void }) {
  const [trackW, setTrackW] = useState(0);
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / 2 : 0;
  const p = useDerivedValue(() => withTiming(value === 'csv' ? 1 : 0, { duration: 200 }));
  const indicator = useAnimatedStyle(() => ({ width: segW, transform: [{ translateX: p.value * segW }] }));

  return (
    <View style={styles.segTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
      {segW > 0 && <Animated.View style={[styles.segIndicator, indicator]} />}
      <Pressable style={styles.segBtn} onPress={() => onChange('pdf')}>
        <Feather name="file-text" size={16} color={value === 'pdf' ? '#EF4444' : GRAY[500]} />
        <Text style={[styles.segLabel, { color: value === 'pdf' ? GRAY[900] : GRAY[500] }]}>PDF Report</Text>
      </Pressable>
      <Pressable style={styles.segBtn} onPress={() => onChange('csv')}>
        <Feather name="file" size={16} color={value === 'csv' ? '#16A34A' : GRAY[500]} />
        <Text style={[styles.segLabel, { color: value === 'csv' ? GRAY[900] : GRAY[500] }]}>CSV Data</Text>
      </Pressable>
    </View>
  );
}

/** A date row: eyebrow label + a rounded button with a calendar chip + chevron. */
function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow style={{ marginLeft: 4 }}>{label}</Eyebrow>
      <Pressable style={({ pressed }) => [styles.dateBtn, pressed && { backgroundColor: GRAY[100] }]}>
        <View style={styles.dateLeft}>
          <View style={styles.dateChip}>
            <Feather name="calendar" size={14} color={GRAY[500]} />
          </View>
          <Text style={styles.dateValue}>{value}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={GRAY[400]} />
      </Pressable>
    </View>
  );
}

export function ExportScreen() {
  const [preset, setPreset] = useState<Preset>('this');
  const [format, setFormat] = useState<Format>('pdf');
  const [includeScans, setIncludeScans] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [generated, setGenerated] = useState(false);

  const range = rangeFor(preset);

  const onGenerate = () => {
    setExporting(true);
    setGenerated(false);
    setTimeout(() => {
      setExporting(false);
      setGenerated(true);
    }, 1500);
  };

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.subtitle}>Generate expense reports.</Text>

      <Card style={styles.mainCard}>
        <View style={{ padding: spacing.lg }}>
          {/* Preset chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {PRESETS.map((p) => {
              const on = p.key === preset;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => { setPreset(p.key); setGenerated(false); }}
                  style={[styles.chip, on ? styles.chipOn : styles.chipOff]}
                >
                  <Text style={[styles.chipText, { color: on ? '#FFFFFF' : GRAY[600] }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={{ gap: 16, marginTop: 20, marginBottom: 24 }}>
            <DateRow label="Start Date" value={range.start} />
            <DateRow label="End Date" value={range.end} />
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

        {/* Footer / Generate */}
        <View style={styles.footer}>
          <Pressable
            onPress={onGenerate}
            disabled={exporting}
            style={({ pressed }) => [styles.generateBtn, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            {exporting ? (
              <Animated.View entering={FadeIn} style={styles.generateInner}>
                <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
                <Text style={styles.generateText}>Processing…</Text>
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

      {generated && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.results}>
          <View style={styles.resultsHead}>
            <Feather name="check-circle" size={18} color="#22C55E" />
            <Text style={styles.resultsTitle}>Ready to download</Text>
          </View>

          <ResultRow
            icon={format === 'pdf' ? 'file-text' : 'file'}
            iconColor={format === 'pdf' ? '#EF4444' : '#16A34A'}
            iconBg={format === 'pdf' ? '#FEF2F2' : '#F0FDF4'}
            name={`Expense_Report_Jul26.${format}`}
            meta="142 KB · Data & Totals"
          />

          {includeScans && (
            <ResultRow
              icon="image"
              iconColor="#3B82F6"
              iconBg="#EFF6FF"
              name="Receipt_Scans_Part1.pdf"
              meta="8.4 MB · Scans 1–50"
            />
          )}
        </Animated.View>
      )}
    </ScrollView>
  );
}

function ResultRow({
  icon,
  iconColor,
  iconBg,
  name,
  meta,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconColor: string;
  iconBg: string;
  name: string;
  meta: string;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: GRAY[50] }]}>
      <View style={styles.resultLeft}>
        <View style={[styles.resultIcon, { backgroundColor: iconBg }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        <View>
          <Text style={styles.resultName}>{name}</Text>
          <Text style={styles.resultMeta}>{meta}</Text>
        </View>
      </View>
      <Feather name="download" size={18} color={GRAY[400]} />
    </Pressable>
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

  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    backgroundColor: GRAY[50],
    borderWidth: 1,
    borderColor: GRAY[200],
  },
  dateLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateChip: {
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
  dateValue: { fontFamily: fontFamily.semibold, fontSize: 15, color: GRAY[900] },

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
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  resultsTitle: { fontFamily: fontFamily.display, fontSize: 14, color: GRAY[900] },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: GRAY.ring,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0,0,0,0.04)' }],
  },
  resultLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  resultName: { fontFamily: fontFamily.semibold, fontSize: 14, color: GRAY[900] },
  resultMeta: { fontFamily: fontFamily.regular, fontSize: 12, color: GRAY[500], marginTop: 2 },
});
