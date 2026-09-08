/**
 * 開発用の画面。技術検証の名残で、計測ログと保存データの操作をまとめてある。
 * 製品の画面ではないので、設定の奥に置く想定。
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Localization from 'expo-localization';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../src/playback';
import { RetracksPlayer } from '../modules/retracks-player/src';
import { colors } from '../src/theme';

export default function DebugScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, queue, status, progress, log, rescan, clearStorage, playAll } =
    usePlayback();

  // 再生が勝手に止まる症状の調査用。Android が記録している終了理由を読む。
  const [exits, setExits] = useState<
    { timestamp: number; reason: string; description: string }[]
  >([]);

  useEffect(() => {
    void RetracksPlayer.getExitReasons()
      .then(setExits)
      .catch(() => setExits([]));
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('debug.title')}</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>i18n（一時デバッグ表示）</Text>
          <Text style={styles.mono}>
            i18next.language: {i18next.language}
            {'\n'}
            getLocales(): {JSON.stringify(Localization.getLocales())}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('debug.stateCardTitle')}</Text>
          <Text style={styles.mono}>
            {t('debug.libraryQueue', { tracks: tracks.length, queue: queue.length })}
            {'\n'}
            {progress
              ? t('debug.roundProgress', { played: progress.played, total: progress.total })
              : t('debug.noRound')}
            {'\n'}
            {status
              ? t('debug.indexStatus', {
                  index: status.index,
                  queueSize: status.queueSize,
                  state: status.isPlaying ? t('debug.playing') : t('debug.paused'),
                })
              : t('debug.notConnected')}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('debug.actionsCardTitle')}</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void playAll()}>
              <Text style={styles.buttonText}>{t('debug.playAll')}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void rescan()}>
              <Text style={styles.buttonText}>{t('debug.rescan')}</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void clearStorage()}>
              <Text style={styles.buttonText}>{t('debug.clearStorage')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('debug.exitHistoryCardTitle')}</Text>
          {exits.length === 0 ? (
            <Text style={styles.mono}>{t('debug.noRecords')}</Text>
          ) : (
            exits.map((exit, index) => (
              <Text key={index} style={styles.logLine}>
                {new Date(exit.timestamp).toLocaleString()}　{exit.reason}
                {exit.description ? `　${exit.description}` : ''}
              </Text>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('debug.logCardTitle')}</Text>
          {log.length === 0 ? (
            <Text style={styles.mono}>{t('debug.noLogsYet')}</Text>
          ) : (
            log.map((line, index) => (
              <Text key={index} style={styles.logLine}>
                {line}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
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
  headerIcon: { color: colors.text, fontSize: 18 },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 8 },
  cardTitle: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  mono: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  logLine: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
});
