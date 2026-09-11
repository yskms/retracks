import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors } from '../theme';
import type { SortDirection, SortFieldLabelKey } from '../sortOrder';

/**
 * 並べ替え軸・方向を選ぶモーダル（要件 10.4）。
 *
 * ライブラリ画面（曲・アルバムタブ）で最初に作ったものを、アーティスト詳細の
 * 曲一覧でも使うために切り出した。軸の集合は呼び出し側の `fields` で決まる
 * ジェネリックな作りにしてあるので、新しい並べ替え対象を足すときはこれを
 * そのまま再利用できる。
 */
export function SortMenu<F extends string>({
  visible,
  onClose,
  direction,
  onDirectionChange,
  fields,
  activeField,
  onSelectField,
}: {
  visible: boolean;
  onClose: () => void;
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
  fields: { value: F; labelKey: SortFieldLabelKey }[];
  activeField: F;
  onSelectField: (value: F) => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.modalTitle}>{t('library.sortTitle')}</Text>
          <View style={styles.sortDirectionRow}>
            {(['asc', 'desc'] as const).map((d) => {
              const active = direction === d;
              return (
                <Pressable
                  key={d}
                  style={[styles.sortDirectionPill, active && styles.sortDirectionPillActive]}
                  onPress={() => onDirectionChange(d)}
                >
                  <Text
                    style={[styles.sortDirectionText, active && styles.sortDirectionTextActive]}
                  >
                    {t(d === 'asc' ? 'library.sortDirectionAsc' : 'library.sortDirectionDesc')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {fields.map(({ value, labelKey }) => {
            const checked = activeField === value;
            return (
              <Pressable
                key={value}
                style={styles.pickerRow}
                onPress={() => {
                  onSelectField(value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
              >
                <View style={[styles.radio, checked && styles.radioChecked]}>
                  {checked ? <View style={styles.radioDot} /> : null}
                </View>
                <Text style={styles.rowLabel}>{t(labelKey)}</Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  sortDirectionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sortDirectionPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceHigh,
  },
  sortDirectionPillActive: { backgroundColor: colors.accent },
  sortDirectionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sortDirectionTextActive: { color: '#1a1206' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  rowLabel: { color: colors.text, fontSize: 14 },
});
