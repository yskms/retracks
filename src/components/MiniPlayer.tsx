import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { usePlayback } from '../playback';
import { colors } from '../theme';

/**
 * 全画面共通の簡易プレイヤー（要件 10.5）。
 * タップでプレイヤー画面へ遷移する。
 */
export function MiniPlayer() {
  const router = useRouter();
  const { currentTrack, status, toggle, next } = usePlayback();

  if (!currentTrack) return null;

  const ratio =
    status && status.durationMs > 0
      ? Math.min(1, Math.max(0, status.positionMs / status.durationMs))
      : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
      </View>
      <Pressable style={styles.row} onPress={() => router.push('/player')}>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </View>
        <Pressable
          style={styles.button}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            toggle();
          }}
        >
          <Text style={styles.glyph}>{status?.isPlaying ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          hitSlop={8}
          onPress={(event) => {
            event.stopPropagation();
            next();
          }}
        >
          <Text style={styles.glyph}>▶❙</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  progressTrack: { height: 2, backgroundColor: colors.border },
  progressFill: { height: 2, backgroundColor: colors.accent },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8 },
  info: { flex: 1 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  button: { paddingHorizontal: 12, paddingVertical: 6 },
  glyph: { color: colors.text, fontSize: 15 },
});
