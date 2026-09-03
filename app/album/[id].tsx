/**
 * アルバム詳細。収録曲を並べ、タップで再生する。
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../../src/playback';
import { getAlbumTracks, getArtistDetail, type Track } from '../../src/library';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';

export default function AlbumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, title, artist, artistId } = useLocalSearchParams<{
    id: string;
    title?: string;
    artist?: string;
    artistId?: string;
  }>();
  const { playFrom, playTracks, currentTrack } = usePlayback();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const direct = await getAlbumTracks(id);
        if (direct.length > 0) {
          setTracks(direct);
          return;
        }
        // アルバムIDを持たない曲はアルバム名で束ねているため、
        // ID による取得が空になることがある。アーティスト経由で拾い直す。
        if (artistId && title) {
          const detail = await getArtistDetail(artistId);
          setTracks(detail.tracks.filter((t) => t.album === title));
          return;
        }
        setTracks(direct);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, artistId, title]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ?? 'アルバム'}
          </Text>
          {artist ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {artist}
            </Text>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.summaryRow}>
              <Text style={styles.summary}>{tracks.length}曲</Text>
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
                    await playTracks('album', [id], tracks);
                    router.push('/player');
                  }}
                >
                  <Text style={styles.actionPrimaryText}>⤮ シャッフル</Text>
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item, index }) => (
            <Row
              title={item.title}
              subtitle={item.artist}
              trailing={formatDuration(item.durationMs)}
              artworkUri={item.artworkUri}
              playing={currentTrack?.id === item.id}
              onPress={async () => {
                await playFrom(tracks, index);
                router.push('/player');
              }}
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
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
  },
  headerIcon: { color: colors.text, fontSize: 18 },
  headerText: { flex: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
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
});
