/**
 * 除外するフォルダ（要件 10.6）。
 *
 * Pulsar を参考にした見た目・操作感（専用画面、＋で選択画面を開く、
 * チェックボックスで複数選択してOK）にしているが、フォルダの候補は
 * 生のファイルシステムを直接ブラウズしない。それには MANAGE_EXTERNAL_STORAGE
 * （すべてのファイルへのアクセス）が要り、音楽プレイヤーでは Google Play の
 * 審査で基本的に却下される権限のため。代わりに MediaStore が既に認識している
 * フォルダ（= 曲が入っているフォルダ）を候補にする。曲が無いフォルダを
 * 除外する意味は無いので、実用上はこれで困らない。
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../src/playback';
import { useSettings } from '../src/settings';
import { colors } from '../src/theme';

export default function ExcludedFoldersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { folders } = usePlayback();
  const { excludedFolderIds, setExcludedFolderIds } = useSettings();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  // excludedFolderIds（保存側の正本）に無いフォルダを行として出さない、
  // という事故は避けたいが、並び順は excludedFolderIds（追加した順）ではなく
  // 名前順にしたい。folders は既に sortByField 済みなので、見つかった行は
  // その順序をそのまま使い、見つからない行（SDカード未マウント等で一時的に
  // folders に出てこないもの。normalizeExcludedFolderIds は未知のIDを
  // 捨てない方針なので、保存自体は残っている）だけ末尾に付け足す。
  const excludedFolders = useMemo(() => {
    const excludedIdSet = new Set(excludedFolderIds);
    const found = folders
      .filter((f) => excludedIdSet.has(f.id))
      .map((f) => ({ id: f.id, name: f.name, trackCount: f.trackCount as number | null, found: true }));
    const foundIdSet = new Set(found.map((f) => f.id));
    const notFound = excludedFolderIds
      .filter((id) => !foundIdSet.has(id))
      .map((id) => ({ id, name: id, trackCount: null as number | null, found: false }));
    return [...found, ...notFound];
  }, [folders, excludedFolderIds]);

  const openPicker = () => {
    setDraft(new Set(excludedFolderIds));
    setPickerOpen(true);
  };

  const toggleDraft = (id: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitPicker = () => {
    setExcludedFolderIds([...draft]);
    setPickerOpen(false);
  };

  const removeFolder = (id: string) => {
    setExcludedFolderIds((prev) => prev.filter((x) => x !== id));
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.excludedFoldersTitle')}</Text>
        <Pressable
          hitSlop={12}
          onPress={openPicker}
          accessibilityLabel={t('settings.excludedFoldersAddA11y')}
        >
          <Ionicons name="add-outline" size={22} color={colors.text} />
        </Pressable>
      </View>

      {excludedFolders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('settings.excludedFoldersEmpty')}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {excludedFolders.map((folder) => (
            <View key={folder.id} style={styles.row}>
              <View style={styles.rowText}>
                <Text
                  style={[styles.rowLabel, !folder.found && styles.rowLabelDim]}
                  numberOfLines={1}
                >
                  {folder.name}
                </Text>
                <Text style={styles.rowHint}>
                  {folder.found
                    ? t('common.songCount', { count: folder.trackCount ?? 0 })
                    : t('settings.excludedFoldersNotFound')}
                </Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => removeFolder(folder.id)}
                accessibilityLabel={t('settings.excludedFoldersRemoveA11y')}
              >
                <Text style={styles.removeIcon}>✕</Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('settings.excludedFoldersTitle')}</Text>
            {folders.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.excludedFoldersPickerEmpty')}</Text>
            ) : (
              <ScrollView style={styles.modalList}>
                {folders.map((folder) => {
                  const checked = draft.has(folder.id);
                  return (
                    <Pressable
                      key={folder.id}
                      style={styles.pickerRow}
                      onPress={() => toggleDraft(folder.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={folder.name}
                    >
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked && <Text style={styles.checkboxMark}>✓</Text>}
                      </View>
                      <View style={styles.rowText}>
                        <Text style={styles.rowLabel}>{folder.name}</Text>
                        <Text style={styles.rowHint}>
                          {t('common.songCount', { count: folder.trackCount })}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setPickerOpen(false)}>
                <Text style={styles.modalActionText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={commitPicker}>
                <Text style={[styles.modalActionText, styles.modalActionPrimary]}>
                  {t('common.ok')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
  },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  body: { padding: 16, gap: 4, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 14 },
  rowLabelDim: { color: colors.textDim, fontFamily: 'monospace' },
  rowHint: { color: colors.textDim, fontSize: 12 },
  removeIcon: { color: colors.textDim, fontSize: 16, paddingHorizontal: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxHeight: '75%',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  modalList: { flexGrow: 0 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxMark: { color: '#1a1206', fontSize: 13, fontWeight: '700' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    paddingTop: 4,
  },
  modalActionText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  modalActionPrimary: { color: colors.accent },
});
