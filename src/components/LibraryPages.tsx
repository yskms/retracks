/**
 * ライブラリ画面（app/index.tsx）の各タブの中身。
 *
 * タブの並び替え・表示非表示ができるよう、ページャの子として1画面ぶんずつ
 * 差し替えられる単位に切り出している。挙動はもともと app/index.tsx に
 * ベタ書きされていたものと同じ。
 */

import type { ReactElement } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  type RefreshControlProps,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { Album, Artist, Track } from '../library';
import { colors, formatDuration } from '../theme';
import { Row } from './Row';
import { Tile } from './Tile';
import { columnsOf, type Layout } from '../layout';

const GRID_PADDING = 12;
const GRID_GAP = 10;

/**
 * 一覧の行の高さ。getItemLayout を与えると、FlatList が各行を測らずに
 * 位置を決められるため、描画範囲の管理が正確になり保持する行数が減る。
 */
const ROW_HEIGHT = 66;

type SelectionHelpers<K extends string> = {
  inSelection: boolean;
  isSelected: (kind: K, id: string) => boolean;
  toggle: (kind: K, id: string) => void;
};

export function SongsPage({
  tracks,
  currentTrack,
  allProgress,
  inSelection,
  isSelected,
  toggle,
  playFrom,
  playAll,
  refreshControl,
}: SelectionHelpers<'songs'> & {
  tracks: Track[];
  currentTrack: { id: string } | null;
  allProgress: { played: number; total: number } | null;
  playFrom: (tracks: Track[], index: number) => Promise<void>;
  playAll: () => Promise<void>;
  refreshControl: ReactElement<RefreshControlProps>;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.page}>
      {tracks.length === 0 ? (
        <Loading />
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          initialNumToRender={12}
          windowSize={4}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT,
            offset: ROW_HEIGHT * index,
            index,
          })}
          refreshControl={refreshControl}
          renderItem={({ item, index }) => (
            <Row
              title={item.title}
              subtitle={item.artist}
              trailing={formatDuration(item.durationMs)}
              artworkUri={item.artworkUri}
              selected={isSelected('songs', item.id)}
              playing={currentTrack?.id === item.id}
              onPress={async () => {
                if (inSelection) return toggle('songs', item.id);
                // 曲を直接タップしたときは画面を移さない。
                // 一覧を見ながら次々選べるようにするため。
                await playFrom(tracks, index);
              }}
              onLongPress={() => toggle('songs', item.id)}
            />
          )}
        />
      )}
      {!inSelection && tracks.length > 0 && (
        <Pressable
          style={styles.fab}
          onPress={async () => {
            await playAll();
            router.push('/player');
          }}
        >
          <Text style={styles.fabGlyph}>⤮</Text>
          <Text style={styles.fabLabel}>
            {allProgress && allProgress.played > 1
              ? t('library.continueFrom', {
                  played: allProgress.played,
                  total: allProgress.total,
                })
              : t('library.shuffleAll')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function ArtistsPage({
  artists,
  layout,
  albumCounts,
  artistArtwork,
  inSelection,
  isSelected,
  toggle,
  tileSizeFor,
  refreshControl,
}: SelectionHelpers<'artists'> & {
  artists: Artist[];
  layout: Layout;
  albumCounts: Map<string, number>;
  artistArtwork: Map<string, string>;
  tileSizeFor: (layout: Layout) => number;
  refreshControl: ReactElement<RefreshControlProps>;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.page}>
      <FlatList
        // numColumns は途中で変えられないので、key を変えて作り直す
        key={layout}
        data={artists}
        keyExtractor={(item) => item.id}
        numColumns={columnsOf(layout)}
        windowSize={4}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        columnWrapperStyle={layout === 'list' ? undefined : styles.gridRow}
        contentContainerStyle={layout === 'list' ? styles.listContent : styles.gridContent}
        refreshControl={refreshControl}
        renderItem={({ item }) =>
          layout !== 'list' ? (
            <Tile
              title={item.name}
              subtitle={subtitleForArtist(t, albumCounts.get(item.name), item.trackCount)}
              artworkUri={artistArtwork.get(item.name) ?? null}
              size={tileSizeFor(layout)}
              selected={isSelected('artists', item.id)}
              onPress={() => {
                if (inSelection) return toggle('artists', item.id);
                router.push({
                  pathname: '/artist/[id]',
                  params: { id: item.id, name: item.name },
                });
              }}
              onLongPress={() => toggle('artists', item.id)}
            />
          ) : (
            <Row
              title={item.name}
              subtitle={subtitleForArtist(t, albumCounts.get(item.name), item.trackCount)}
              artworkUri={artistArtwork.get(item.name) ?? null}
              chevron
              selected={isSelected('artists', item.id)}
              onPress={() => {
                if (inSelection) return toggle('artists', item.id);
                router.push({
                  pathname: '/artist/[id]',
                  params: { id: item.id, name: item.name },
                });
              }}
              onLongPress={() => toggle('artists', item.id)}
            />
          )
        }
      />
    </View>
  );
}

export function AlbumsPage({
  albums,
  layout,
  inSelection,
  isSelected,
  toggle,
  tileSizeFor,
  refreshControl,
}: SelectionHelpers<'albums'> & {
  albums: Album[];
  layout: Layout;
  tileSizeFor: (layout: Layout) => number;
  refreshControl: ReactElement<RefreshControlProps>;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.page}>
      <FlatList
        key={layout}
        data={albums}
        keyExtractor={(item) => item.id}
        numColumns={columnsOf(layout)}
        windowSize={4}
        maxToRenderPerBatch={12}
        removeClippedSubviews
        columnWrapperStyle={layout === 'list' ? undefined : styles.gridRow}
        contentContainerStyle={layout === 'list' ? styles.listContent : styles.gridContent}
        refreshControl={refreshControl}
        renderItem={({ item }) => {
          const subtitle = item.year
            ? `${item.artist} · ${item.year}`
            : `${item.artist} · ${t('common.songCount', { count: item.trackCount })}`;
          const open = () => {
            if (inSelection) return toggle('albums', item.id);
            router.push({
              pathname: '/album/[id]',
              params: { id: item.id, title: item.title, artist: item.artist },
            });
          };
          return layout !== 'list' ? (
            <Tile
              title={item.title}
              subtitle={subtitle}
              artworkUri={item.artworkUri}
              size={tileSizeFor(layout)}
              selected={isSelected('albums', item.id)}
              onPress={open}
              onLongPress={() => toggle('albums', item.id)}
            />
          ) : (
            <Row
              title={item.title}
              subtitle={subtitle}
              artworkUri={item.artworkUri}
              chevron
              selected={isSelected('albums', item.id)}
              onPress={open}
              onLongPress={() => toggle('albums', item.id)}
            />
          );
        }}
      />
    </View>
  );
}

/** 「アルバム数 · 曲数」のように出す。アルバム数が数えられない場合は曲数だけ。 */
function subtitleForArtist(
  t: TFunction,
  albumCount: number | undefined,
  trackCount: number
): string {
  const songs = t('common.songCount', { count: trackCount });
  return albumCount ? `${t('common.albumCount', { count: albumCount })} · ${songs}` : songs;
}

function Loading() {
  const { t } = useTranslation();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.loadingText}>{t('library.loading')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  listContent: { paddingBottom: 24 },
  gridContent: { padding: GRID_PADDING, paddingBottom: 24 },
  gridRow: { gap: GRID_GAP },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  fabGlyph: { color: '#1a1206', fontSize: 18, fontWeight: '700' },
  fabLabel: { color: '#1a1206', fontSize: 13, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textDim, fontSize: 13 },
});
