/**
 * 開発用の画面。技術検証の名残で、計測ログと保存データの操作をまとめてある。
 * 製品の画面ではないので、設定の奥に置く想定。
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../src/playback';
import { colors } from '../src/theme';

export default function DebugScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, queue, status, progress, log, rescan, clearStorage, playAll } =
    usePlayback();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>開発用</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>状態</Text>
          <Text style={styles.mono}>
            ライブラリ {tracks.length}曲 / キュー {queue.length}曲
            {'\n'}
            {progress ? `1巡の進捗 ${progress.played} / ${progress.total}` : '1巡なし'}
            {'\n'}
            {status
              ? `index ${status.index} / ${status.queueSize}　${
                  status.isPlaying ? '再生中' : '停止中'
                }`
              : '未接続'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>操作</Text>
          <View style={styles.row}>
            <Pressable style={styles.button} onPress={() => void playAll()}>
              <Text style={styles.buttonText}>全曲を再生</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void rescan()}>
              <Text style={styles.buttonText}>再走査</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => void clearStorage()}>
              <Text style={styles.buttonText}>保存を消去</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>ログ</Text>
          {log.length === 0 ? (
            <Text style={styles.mono}>まだありません</Text>
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
