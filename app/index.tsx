/**
 * ライブラリ画面（要件 10.4）。
 *
 * タブは設定で並び替え・表示非表示ができる想定のため、ファイルベースの静的な
 * タブ構成ではなく、配列から組み立てるページャにしている。
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../src/playback';
import {
  artworkByArtist,
  countAlbumsByArtist,
  getTracksForAlbums,
  getTracksForArtists,
  type Track,
} from '../src/library';
import { colors } from '../src/theme';
import { AlbumsPage, ArtistsPage, SongsPage } from '../src/components/LibraryPages';
import { useSelection } from '../src/useSelection';
import { LAYOUT_ICON, tileSizeOf, useLayouts } from '../src/layout';

/**
 * 下線をネイティブ側で動かすためのラッパ。
 * JS スレッドで値を更新すると、イベントのたびに段付きの動きになる。
 */
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

type TabId = 'songs' | 'artists' | 'albums';

const GRID_PADDING = 12;
const GRID_GAP = 10;

export default function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabs: { id: TabId; label: string }[] = useMemo(
    () => [
      { id: 'songs', label: t('library.tabSongs') },
      { id: 'artists', label: t('library.tabArtists') },
      { id: 'albums', label: t('library.tabAlbums') },
    ],
    [t]
  );
  const {
    tracks,
    artists,
    albums,
    playFrom,
    playTracks,
    playAll,
    currentTrack,
    allProgress,
    rescan,
  } = usePlayback();
  const { selection, active: inSelection, toggle, clear, isSelected } =
    useSelection<TabId>();

  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  /** 一覧の一番上から引っ張って更新。裏の自動走査とは別に、明示的に走らせる。 */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await rescan();
    } finally {
      setRefreshing(false);
    }
  }, [rescan]);

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );

  const { layouts, cycle } = useLayouts();
  const currentLayoutKey = page === 1 ? 'artists' : 'albums';
  const tileSizeFor = (layout: (typeof layouts)['artists']) =>
    tileSizeOf(width, layout, GRID_PADDING, GRID_GAP);

  const albumCounts = useMemo(() => countAlbumsByArtist(albums), [albums]);
  // アーティストの写真は持っていないので、そのアーティストのアルバムから流用する
  const artistArtwork = useMemo(() => artworkByArtist(albums), [albums]);

  // 下線はページのスクロール量に追従させる。onPageSelected だけだと
  // 指を離してから動くため、一覧より遅れて見える。
  // position と offset をネイティブ駆動で受け取り、その和で位置を決める。
  const position = useRef(new Animated.Value(0)).current;
  const offset = useRef(new Animated.Value(0)).current;
  const tabWidth = width / tabs.length;

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
          <Text style={styles.headerTitle}>
            {t('library.selectedCount', { count: selection?.ids.length ?? 0 })}
          </Text>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerAction} onPress={() => void playSelection(false)}>
              <Text style={styles.headerActionText}>{`▶ ${t('common.playInOrder')}`}</Text>
            </Pressable>
            <Pressable
              style={[styles.headerAction, styles.headerActionPrimary]}
              onPress={() => void playSelection(true)}
            >
              <Text style={styles.headerActionPrimaryText}>{`⤮ ${t('common.shufflePlay')}`}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Text style={styles.brand}>RE:TR4CKS</Text>
          <View style={styles.headerRight}>
            {page > 0 && (
              <Pressable hitSlop={10} onPress={() => cycle(currentLayoutKey)}>
                <Text style={styles.headerIcon}>
                  {LAYOUT_ICON[layouts[currentLayoutKey]]}
                </Text>
              </Pressable>
            )}
            <Pressable
              hitSlop={10}
              onPress={() => router.push('/search')}
              accessibilityLabel={t('search.openA11y')}
            >
              <Text style={styles.headerIcon}>⌕</Text>
            </Pressable>
            <Pressable
              hitSlop={10}
              onPress={() => router.push('/settings')}
              accessibilityLabel={t('settings.openA11y')}
            >
              <Text style={styles.headerIcon}>⚙</Text>
            </Pressable>
          </View>
        </View>
      )}

      <View>
        <View style={styles.tabBar}>
          {tabs.map((tab, index) => (
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
        <View key="songs">
          <SongsPage
            tracks={tracks}
            currentTrack={currentTrack}
            allProgress={allProgress}
            inSelection={inSelection}
            isSelected={isSelected}
            toggle={toggle}
            playFrom={playFrom}
            playAll={playAll}
            refreshControl={refreshControl}
          />
        </View>

        <View key="artists">
          <ArtistsPage
            artists={artists}
            layout={layouts.artists}
            albumCounts={albumCounts}
            artistArtwork={artistArtwork}
            inSelection={inSelection}
            isSelected={isSelected}
            toggle={toggle}
            tileSizeFor={tileSizeFor}
            refreshControl={refreshControl}
          />
        </View>

        <View key="albums">
          <AlbumsPage
            albums={albums}
            layout={layouts.albums}
            inSelection={inSelection}
            isSelected={isSelected}
            toggle={toggle}
            tileSizeFor={tileSizeFor}
            refreshControl={refreshControl}
          />
        </View>
      </AnimatedPagerView>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
});
