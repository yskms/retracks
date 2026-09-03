/**
 * ライブラリ画面（要件 10.4）。
 *
 * タブは設定で並び替え・表示非表示ができる想定のため、ファイルベースの静的な
 * タブ構成ではなく、配列から組み立てるページャにしている。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../src/playback';
import {
  artworkByArtist,
  countAlbumsByArtist,
  getAlbums,
  getArtists,
  getTracksForAlbums,
  getTracksForArtists,
  type Album,
  type Artist,
  type Track,
} from '../src/library';
import { colors, formatDuration } from '../src/theme';
import { Row } from '../src/components/Row';
import { useSelection } from '../src/useSelection';

/**
 * 下線をネイティブ側で動かすためのラッパ。
 * JS スレッドで値を更新すると、イベントのたびに段付きの動きになる。
 */
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

type TabId = 'songs' | 'artists' | 'albums';

const TABS: { id: TabId; label: string }[] = [
  { id: 'songs', label: '楽曲' },
  { id: 'artists', label: 'アーティスト' },
  { id: 'albums', label: 'アルバム' },
];

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tracks, playFrom, playTracks, playAll, currentTrack, allProgress } =
    usePlayback();
  const { selection, active: inSelection, toggle, clear, isSelected } =
    useSelection<TabId>();

  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);

  const albumCounts = useMemo(() => countAlbumsByArtist(albums), [albums]);
  // アーティストの写真は持っていないので、そのアーティストのアルバムから流用する
  const artistArtwork = useMemo(() => artworkByArtist(albums), [albums]);

  // 下線はページのスクロール量に追従させる。onPageSelected だけだと
  // 指を離してから動くため、一覧より遅れて見える。
  // position と offset をネイティブ駆動で受け取り、その和で位置を決める。
  const position = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(0)).current;
  const tabWidth = width / TABS.length;

  useEffect(() => {
    void (async () => {
      try {
        setArtists(await getArtists());
        setAlbums(await getAlbums());
      } catch {
        // 権限が無い場合など。曲一覧側で状態が分かるのでここでは黙る
      }
    })();
  }, [tracks.length]);

  /** 選択したものからキューを作って再生する（要件 10.3）。 */
  const playSelection = useCallback(async (shuffled: boolean) => {
    if (!selection) return;
    const { kind, ids } = selection;

    if (kind === 'songs' && !shuffled) {
      // 一覧の並び順のまま先頭から
      const picked = tracks.filter((t) => ids.includes(t.id));
      await playFrom(picked, 0);
    } else if (kind === 'songs') {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const picked = ids.map((id) => byId.get(id)).filter((t): t is Track => t != null);
      // 'all' を使うと全曲シャッフルの1巡状態を上書きしてしまうため専用のキーにする
      await playTracks('selection', ids, picked);
    } else if (kind === 'artists') {
      const picked = await getTracksForArtists(ids);
      if (shuffled) await playTracks('artist', ids, picked);
      else await playFrom(picked, 0);
    } else {
      const picked = await getTracksForAlbums(ids);
      if (shuffled) await playTracks('album', ids, picked);
      else await playFrom(picked, 0);
    }

    clear();
    router.push('/player');
  }, [selection, tracks, playTracks, playFrom, clear, router]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={clear}>
            <Text style={styles.headerIcon}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{selection?.ids.length ?? 0}件選択</Text>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerAction} onPress={() => void playSelection(false)}>
              <Text style={styles.headerActionText}>▶ 順番に</Text>
            </Pressable>
            <Pressable
              style={[styles.headerAction, styles.headerActionPrimary]}
              onPress={() => void playSelection(true)}
            >
              <Text style={styles.headerActionPrimaryText}>⤮ シャッフル</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Text style={styles.brand}>RE:TR4CKS</Text>
          <Pressable hitSlop={10} onPress={() => router.push('/debug')}>
            <Text style={styles.headerIcon}>⋮</Text>
          </Pressable>
        </View>
      )}

      <View>
        <View style={styles.tabBar}>
          {TABS.map((tab, index) => (
            <Pressable
              key={tab.id}
              style={styles.tab}
              onPress={() => pagerRef.current?.setPage(index)}
            >
              <Text style={[styles.tabLabel, page === index && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Animated.View
          style={[
            styles.indicator,
            {
              width: tabWidth * 0.5,
              marginLeft: tabWidth * 0.25,
              transform: [
                {
                  translateX: Animated.multiply(
                    Animated.add(position, offset),
                    tabWidth
                  ),
                },
              ],
            },
          ]}
        />
      </View>

      <AnimatedPagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageScroll={Animated.event(
          [{ nativeEvent: { position, offset } }],
          { useNativeDriver: true }
        )}
        onPageSelected={(event) => {
          setPage(event.nativeEvent.position);
          // タブを移ると選択対象の種類が変わってしまうので解除する
          clear();
        }}
      >
        {/* 楽曲 */}
        <View key="songs" style={styles.page}>
          {tracks.length === 0 ? (
            <Loading />
          ) : (
            <FlatList
              data={tracks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              initialNumToRender={14}
              windowSize={7}
              removeClippedSubviews
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
                  ? `続きから ${allProgress.played}/${allProgress.total}`
                  : '全曲シャッフル'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* アーティスト */}
        <View key="artists" style={styles.page}>
          <FlatList
            data={artists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Row
                title={item.name}
                subtitle={subtitleForArtist(albumCounts.get(item.name), item.trackCount)}
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
            )}
          />
        </View>

        {/* アルバム */}
        <View key="albums" style={styles.page}>
          <FlatList
            data={albums}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Row
                title={item.title}
                subtitle={`${item.artist} · ${item.trackCount}曲`}
                artworkUri={item.artworkUri}
                chevron
                selected={isSelected('albums', item.id)}
                onPress={() => {
                  if (inSelection) return toggle('albums', item.id);
                  router.push({
                    pathname: '/album/[id]',
                    params: { id: item.id, title: item.title, artist: item.artist },
                  });
                }}
                onLongPress={() => toggle('albums', item.id)}
              />
            )}
          />
        </View>
      </AnimatedPagerView>
    </View>
  );
}

/** 「3アルバム · 22曲」のように出す。アルバム数が数えられない場合は曲数だけ。 */
function subtitleForArtist(albumCount: number | undefined, trackCount: number): string {
  const songs = `${trackCount}曲`;
  return albumCount ? `${albumCount}アルバム · ${songs}` : songs;
}

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.loadingText}>ライブラリを読み込んでいます</Text>
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
  },
  brand: { color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headerIcon: { color: colors.text, fontSize: 18 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerAction: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  headerActionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  headerActionPrimary: { backgroundColor: colors.accent },
  headerActionPrimaryText: { color: '#1a1206', fontSize: 12, fontWeight: '700' },
  tabBar: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center' },
  tabLabel: { color: colors.textDim, fontSize: 13, paddingVertical: 12 },
  tabLabelActive: { color: colors.text, fontWeight: '700' },
  indicator: { height: 2, backgroundColor: colors.accent },
  pager: { flex: 1 },
  page: { flex: 1 },
  listContent: { paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 12,
  },
  rowSelected: { backgroundColor: colors.surfaceHigh },
  rowText: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 14 },
  rowTitlePlaying: { color: colors.accent, fontWeight: '700' },
  rowSubtitle: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  rowTrailing: { color: colors.textDim, fontSize: 12 },
  chevron: { color: colors.textDim, fontSize: 20 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
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
