/**
 * 最近追加の詳細。1つの行（アーティスト × 追加した日）の曲を並べ、順番に／シャッフルで再生する。
 * 曲をタップすると、その曲からこの一覧を順番に再生する。
 *
 * 行の曲は、行を開いた時点の一覧でなく、曲一覧から引き直す（tracksOfGroup）。開いている間に
 * 新しい追加で行が上限から押し出されても、中身が消えない。
 */

import { useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../../src/playback';
import { tracksOfGroup } from '../../src/recentGroups';
import { dayText } from '../../src/recentLabel';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';

export default function RecentDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { day, artist, name } = useLocalSearchParams<{ day: string; artist: string; name?: string }>();
  const { tracks: allTracks, playFrom, playTracks, currentTrack } = usePlayback();

  const tracks = useMemo(() => tracksOfGroup(allTracks, artist, day), [allTracks, artist, day]);

  // キュータブの見出しはアーティスト名（曲名の羅列にしない）。name が空の経路でも、曲の名前で補う
  const queueNames = useMemo(() => {
    const artistName = name || tracks[0]?.artist;
    return artistName ? [artistName] : undefined;
  }, [name, tracks]);

  // 曲を端末から消す等で空になったら戻る。初回ロード中の一瞬（まだ曲が無い）で戻らないよう、
  // 一度でも曲があったことを確かめてから。isFocused の理由は app/artist/[id].tsx と同じ
  const isFocused = useIsFocused();
  const hadTracksRef = useRef(false);
  useEffect(() => {
    if (tracks.length > 0) {
      hadTracksRef.current = true;
      return;
    }
    if (hadTracksRef.current && isFocused) router.back();
  }, [tracks.length, isFocused, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name || tracks[0]?.artist || t('recent.detailFallbackTitle')}
        </Text>
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={14}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <Text style={styles.summary} numberOfLines={1}>
              {t('recent.rowSubtitle', {
                date: dayText(t, day),
                songs: t('common.songCount', { count: tracks.length }),
              })}
            </Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={async () => {
                  await playFrom(tracks, 0, { names: queueNames });
                  router.push('/player');
                }}
              >
                <Text style={styles.actionText}>{`▶ ${t('common.playInOrder')}`}</Text>
              </Pressable>
              <Pressable
                style={[styles.action, styles.actionPrimary]}
                onPress={async () => {
                  // 'artist' にしない。artist: のキューはそのアーティストの全曲の続きで、
                  // 一部の曲だけで始めると、アーティスト詳細のシャッフルを上書きする
                  await playTracks('songs', tracks.map((track) => track.id), tracks, {
                    names: queueNames,
                  });
                  router.push('/player');
                }}
              >
                <Ionicons name="shuffle-outline" size={14} color="#1a1206" />
                <Text style={styles.actionPrimaryText}>{t('common.shufflePlay')}</Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item, index }) => (
          <Row
            title={item.title}
            subtitle={item.album ?? undefined}
            trailing={formatDuration(item.durationMs)}
            artworkUri={item.artworkUri}
            playing={currentTrack?.id === item.id}
            // 曲を直接タップしたときは画面を移さない（アーティスト詳細と同じ）
            onPress={() => void playFrom(tracks, index, { names: queueNames })}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 52,
    gap: 12,
  },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  listContent: { paddingBottom: 24 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  summary: { color: colors.textDim, fontSize: 12, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  actionPrimary: { backgroundColor: colors.accent },
  actionPrimaryText: { color: '#1a1206', fontSize: 12, fontWeight: '700' },
});
