/**
 * アルバム詳細。収録曲を並べ、タップで再生する。
 */

import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../../src/playback';
import { compareByTrackOrder } from '../../src/library';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';

export default function AlbumScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, title, artist } = useLocalSearchParams<{
    id: string;
    title?: string;
    artist?: string;
  }>();
  const { tracks: allTracks, playFrom, playTracks, currentTrack } = usePlayback();

  // id はアルバムの実ID、またはそれを持たない曲向けのアルバム名のどちらか
  // （→ deriveAlbums()）。プレイヤー画面からはアルバムIDを持たず名前だけで
  // 遷移してくることもあるため、名前一致もあわせて見る。
  const tracks = useMemo(
    () => allTracks.filter((t) => t.albumId === id || t.album === id).sort(compareByTrackOrder),
    [allTracks, id]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ?? t('album.fallbackTitle')}
          </Text>
          {artist ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {artist}
            </Text>
          ) : null}
        </View>
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <Text style={styles.summary}>{t('common.songCount', { count: tracks.length })}</Text>
            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={async () => {
                  await playFrom(tracks, 0);
                  router.push('/player');
                }}
              >
                <Text style={styles.actionText}>{`▶ ${t('common.playInOrder')}`}</Text>
              </Pressable>
              <Pressable
                style={[styles.action, styles.actionPrimary]}
                onPress={async () => {
                  await playTracks('album', [id], tracks);
                  router.push('/player');
                }}
              >
                <Text style={styles.actionPrimaryText}>{`⤮ ${t('common.shufflePlay')}`}</Text>
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
            // 曲を直接タップしたときは画面を移さない
            onPress={() => void playFrom(tracks, index)}
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
    height: 56,
    gap: 12,
  },
  headerText: { flex: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
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
