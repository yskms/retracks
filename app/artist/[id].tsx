/**
 * アーティスト詳細。アルバムを並べ、その下に全曲を出す。
 * アルバムをタップするとアルバム詳細へ、曲をタップすると再生する。
 * 長押しで複数選択に入り、まとめて再生できる。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../../src/playback';
import {
  getArtistDetail,
  getTracksForAlbums,
  type Album,
  type Track,
} from '../../src/library';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';
import { useSelection } from '../../src/useSelection';

type Kind = 'albums' | 'songs';

export default function ArtistScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { playFrom, playTracks, currentTrack } = usePlayback();
  const { selection, active: inSelection, toggle, clear, isSelected } =
    useSelection<Kind>();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const detail = await getArtistDetail(id);
        setAlbums(detail.albums);
        setTracks(detail.tracks);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /**
   * 選択したものをまとめて再生する。
   * アルバムと曲は同時に選べない（useSelection が種類ごとに切り替える）ので、
   * 混在したときの扱いを考える必要がない。
   */
  const playSelection = useCallback(async () => {
    if (!selection) return;
    const { kind, ids } = selection;

    if (kind === 'albums') {
      await playTracks('album', ids, await getTracksForAlbums(ids));
    } else {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const picked = ids.map((x) => byId.get(x)).filter((t): t is Track => t != null);
      await playTracks('selection', ids, picked);
    }

    clear();
    router.push('/player');
  }, [selection, tracks, playTracks, clear, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={clear}>
            <Text style={styles.headerIcon}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{selection?.ids.length ?? 0}件選択</Text>
          <Pressable style={styles.headerShuffle} onPress={playSelection}>
            <Text style={styles.headerShuffleText}>⤮ シャッフル</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Text style={styles.headerIcon}>←</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name ?? 'アーティスト'}
          </Text>
          <View style={{ width: 20 }} />
        </View>
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          initialNumToRender={14}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <View>
              <View style={styles.summaryRow}>
                <Text style={styles.summary}>
                  {albums.length}アルバム · {tracks.length}曲
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    style={styles.action}
                    onPress={async () => {
                      await playFrom(tracks, 0);
                      router.push('/player');
                    }}
                  >
                    <Text style={styles.actionText}>▶ 順番に</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.action, styles.actionPrimary]}
                    onPress={async () => {
                      await playTracks('artist', [id], tracks);
                      router.push('/player');
                    }}
                  >
                    <Text style={styles.actionPrimaryText}>⤮ シャッフル</Text>
                  </Pressable>
                </View>
              </View>

              {albums.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>アルバム</Text>
                  {albums.map((album) => (
                    <Row
                      key={album.id}
                      title={album.title}
                      subtitle={`${album.trackCount}曲`}
                      artworkUri={album.artworkUri}
                      selected={isSelected('albums', album.id)}
                      chevron
                      onPress={() => {
                        if (inSelection) return toggle('albums', album.id);
                        router.push({
                          pathname: '/album/[id]',
                          params: {
                            id: album.id,
                            title: album.title,
                            artist: album.artist,
                            // アルバムIDが取れない曲もあるため、辿り直せるよう
                            // アーティストIDも渡しておく
                            artistId: id,
                          },
                        });
                      }}
                      onLongPress={() => toggle('albums', album.id)}
                    />
                  ))}
                </>
              )}

              <Text style={styles.sectionTitle}>楽曲</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Row
              title={item.title}
              subtitle={item.album ?? undefined}
              trailing={formatDuration(item.durationMs)}
              artworkUri={item.artworkUri}
              selected={isSelected('songs', item.id)}
              playing={currentTrack?.id === item.id}
              // 曲を直接タップしたときは画面を移さない
              onPress={() =>
                inSelection ? toggle('songs', item.id) : void playFrom(tracks, index)
              }
              onLongPress={() => toggle('songs', item.id)}
            />
          )}
        />
      )}
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
    height: 52,
    gap: 12,
  },
  headerIcon: { color: colors.text, fontSize: 18 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  headerShuffle: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  headerShuffleText: { color: '#1a1206', fontSize: 12, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 24 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  summary: { color: colors.textDim, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  actionPrimary: { backgroundColor: colors.accent },
  actionPrimaryText: { color: '#1a1206', fontSize: 12, fontWeight: '700' },
  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
});
