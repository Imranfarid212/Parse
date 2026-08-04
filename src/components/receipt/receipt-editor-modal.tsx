import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { EditSheet } from '@/components/receipt/EditSheet';
import type { ManagedReceipt } from '@/lib/receipts/management';
import type { Category, ReceiptFields } from '@/lib/receipts/types';
import { colors, fontFamily, spacing } from '@/theme/tokens';

export function ReceiptEditorModal({
  receipt,
  onClose,
  onSave,
  categoryOptions,
}: {
  receipt: ManagedReceipt | null;
  onClose: () => void;
  onSave: (fields: ReceiptFields) => Promise<void>;
  categoryOptions?: readonly Category[];
}) {
  const [fields, setFields] = useState<ReceiptFields | null>(receipt?.fields ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFields(receipt?.fields ?? null);
    setSaving(false);
    setError(null);
  }, [receipt]);

  const save = async () => {
    if (!fields || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(fields);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this receipt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={Boolean(receipt && fields)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Edit receipt</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={onClose} hitSlop={12} disabled={saving}>
            <Ionicons name="close" size={25} color={colors.textPrimary} />
          </Pressable>
        </View>
        {fields ? (
          <EditSheet
            fields={fields}
            destructiveRetake={false}
            onChange={setFields}
            onDone={() => void save()}
            showRetake={false}
            saving={saving}
            error={error}
            categoryOptions={categoryOptions}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { fontFamily: fontFamily.semibold, fontSize: 18, color: colors.textPrimary },
});
