/**
 * アーティスト詳細。アルバムを並べ、その下に全曲を出す。
 * アルバムをタップするとアルバム詳細へ、曲をタップすると再生する。
 * 長押しで複数選択に入り、まとめて再生できる。
 */

import { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../../src/playback';
import { deriveAlbums, type Album, type Track } from '../../src/library';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';
import { Tile } from '../../src/components/Tile';
import { LAYOUT_ICON, tileSizeOf, useLayouts } from '../../src/layout';
import { useSelection } from '../../src/useSelection';

/**
 * 選択の単位は常に曲。アルバムを選んだときは収録曲をまとめて選ぶ。
 * こうするとアルバムと曲が混ざった選択も自然に扱える。
 */
type Kind = 'songs';

/** アルバムの並び順。年が新しい方を先に、無ければタイトル順で後ろへ。 */
function compareAlbumByYear(a: Album, b: Album): number {
  if (a.year && b.year && a.year !== b.year) return b.year - a.year;
  if (a.year && !b.year) return -1;
  if (!a.year && b.year) return 1;
  return a.title.localeCompare(b.title);
}

export default function ArtistScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const {
    tracks: allTracks,
    albums: allAlbums,
    playFrom,
    playTracks,
    currentTrack,
  } = usePlayback();
  const {
    selection,
    active: inSelection,
    toggle,
    toggleMany,
    clear,
    isSelected,
    areAllSelected,
  } = useSelection<Kind>();

  const { layouts, cycle } = useLayouts();
  const albumLayout = layouts.artistAlbums;
  const tileSize = tileSizeOf(width, albumLayout, 16, 10);

  // このアーティストの曲だけを曲一覧から抜き出す（deriveArtists() と同じ
  // グループ化キー）。曲一覧のフィルタ・並び順をそのまま引き継ぐので、
  // 除外設定がここにも一様に効く。
  const tracks = useMemo(
    () => allTracks.filter((t) => (t.artistId || t.artist) === id),
    [allTracks, id]
  );

  // アルバムの年は曲単位では持っていないため、全体のアルバム一覧
  // （年計算済み）から albumId ごとに引く。
  const albumYears = useMemo(() => {
    const years: Record<string, number> = {};
    for (const a of allAlbums) {
      if (a.year != null) years[a.id] = a.year;
    }
    return years;
  }, [allAlbums]);

  const albums = useMemo(
    () => deriveAlbums(tracks, albumYears).sort(compareAlbumByYear),
    [tracks, albumYears]
  );

  /** アルバムID（無ければ名前）→ 収録曲。アルバム行の選択に使う。 */
  const tracksByAlbum = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const track of tracks) {
      const key = track.albumId || track.album;
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(track);
      else map.set(key, [track]);
    }
    return map;
  }, [tracks]);

  const albumTrackIds = useCallback(
    (album: Album) => (tracksByAlbum.get(album.id) ?? []).map((t) => t.id),
    [tracksByAlbum]
  );

  /** 選択した曲をまとめて再生する。 */
  const playSelection = useCallback(
    async (shuffled: boolean) => {
      if (!selection) return;
      const ids = selection.ids;
      // 一覧の並び順を保つため、選択順ではなく表示順で拾う
      const picked = tracks.filter((t) => ids.includes(t.id));

      if (shuffled) await playTracks('selection', ids, picked);
      else await playFrom(picked, 0);

      clear();
      router.push('/player');
    },
    [selection, tracks, playTracks, playFrom, clear, router]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={clear}>
            <Ionicons name="close-outline" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>
            {t('artist.selectedCount', { count: selection?.ids.length ?? 0 })}
          </Text>
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => void playSelection(false)}>
              <Text style={styles.actionText}>{`▶ ${t('common.playInOrder')}`}</Text>
            </Pressable>
            <Pressable
              style={[styles.action, styles.actionPrimary]}
              onPress={() => void playSelection(true)}
            >
              <Text style={styles.actionPrimaryText}>{`⤮ ${t('common.shufflePlay')}`}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name ?? t('artist.fallbackTitle')}
          </Text>
          <Pressable hitSlop={10} onPress={() => cycle('artistAlbums')}>
            <Ionicons name={LAYOUT_ICON[albumLayout]} size={20} color={colors.text} />
          </Pressable>
        </View>
      )}

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
                {t('common.albumCount', { count: albums.length })} ·{' '}
                {t('common.songCount', { count: tracks.length })}
              </Text>
              {/* 選択中はヘッダー側に再生操作が出るので、こちらは隠す */}
              {!inSelection && (
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
                      await playTracks('artist', [id], tracks);
                      router.push('/player');
                    }}
                  >
                    <Text style={styles.actionPrimaryText}>{`⤮ ${t('common.shufflePlay')}`}</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {albums.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('artist.albumsSectionTitle')}</Text>
                <View style={albumLayout === 'list' ? undefined : styles.albumGrid}>
                  {albums.map((album) => {
                    const subtitle = album.year
                      ? `${album.year}`
                      : t('common.songCount', { count: album.trackCount });
                    const open = () => {
                      // 選択中はアルバムの収録曲をまとめて選ぶ／外す
                      if (inSelection) {
                        return toggleMany('songs', albumTrackIds(album));
                      }
                      router.push({
                        pathname: '/album/[id]',
                        params: {
                          id: album.id,
                          title: album.title,
                          artist: album.artist,
                        },
                      });
                    };
                    return albumLayout === 'list' ? (
                      <Row
                        key={album.id}
                        title={album.title}
                        subtitle={subtitle}
                        artworkUri={album.artworkUri}
                        selected={areAllSelected('songs', albumTrackIds(album))}
                        chevron
                        onPress={open}
                        onLongPress={() => toggleMany('songs', albumTrackIds(album))}
                      />
                    ) : (
                      <Tile
                        key={album.id}
                        title={album.title}
                        subtitle={subtitle}
                        artworkUri={album.artworkUri}
                        size={tileSize}
                        selected={areAllSelected('songs', albumTrackIds(album))}
                        onPress={open}
                        onLongPress={() => toggleMany('songs', albumTrackIds(album))}
                      />
                    );
                  })}
                </View>
              </>
            )}

            <Text style={styles.sectionTitle}>{t('artist.songsSectionTitle')}</Text>
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
            onPress={() => (inSelection ? toggle('songs', item.id) : void playFrom(tracks, index))}
            onLongPress={() => toggle('songs', item.id)}
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
    justifyContent: 'space-between',
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
  albumGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
});
