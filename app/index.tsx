/**
 * ライブラリ画面（要件 10.4）。
 *
 * タブは設定で並び替え・表示非表示ができる想定のため、ファイルベースの静的な
 * タブ構成ではなく、配列から組み立てるページャにしている。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { TAB_LABEL_KEY, TAB_LAYOUT_KEY, type TabId } from '../src/tabs';
import { useSettings } from '../src/settings';

/**
 * 下線をネイティブ側で動かすためのラッパ。
 * JS スレッドで値を更新すると、イベントのたびに段付きの動きになる。
 */
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

const GRID_PADDING = 12;
const GRID_GAP = 10;

export default function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { tabs: tabSettings } = useSettings();
  // 非表示のタブはページャに載せない。順序はそのまま設定の並びを使う。
  const tabs: { id: TabId; label: string }[] = useMemo(
    () =>
      tabSettings
        .filter((tab) => tab.visible)
        .map((tab) => ({ id: tab.id, label: t(TAB_LABEL_KEY[tab.id]) })),
    [tabSettings, t]
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
  // page はここから導出する値であって、真実の情報源ではない。タブの並びや
  // 表示が設定側で変わると同じインデックスが別のタブを指すことになるため、
  // 「今どのタブを見ているか」は activeTabId（タブID）で持つ。
  const [activeTabId, setActiveTabId] = useState<TabId>(tabs[0]?.id ?? 'songs');
  const page = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
  // タブの構成（並び・表示）が変わるたびに変化する文字列。ページャの子の
  // 増減・並べ替えは react-native-pager-view（Android は ViewPager2）側で
  // ずれることがあるため、変わったら key を変えてページャごと作り直す。
  const pagerKey = tabs.map((tab) => tab.id).join(',');
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
  // レイアウト切替アイコンは「そのタブに表示形式があるか」で出す。
  // 曲タブだから出さない、という決め打ちにしないので、タブが増えても
  // TAB_LAYOUT_KEY に1件足すだけで済む。
  const layoutKeyForActiveTab = TAB_LAYOUT_KEY[activeTabId];
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

  // タブの構成が変わってページャを作り直すときの後始末。
  // - 今見ていたタブが消えていたら、先頭のタブへ切り替える
  // - 下線（position/offset）は onPageScroll でしか動かないので、
  //   スワイプせずに構成が変わると古い位置に取り残される。作り直した
  //   ページャの今のページへ合わせておく
  // - 隠したタブの選択が残ったまま選択ヘッダーだけ出る、という状態を避ける
  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? 'songs');
    }
    position.setValue(page);
    offset.setValue(0);
    clear();
    // pagerKey が変わったとき（＝ページャを作り直すとき）だけ実行したい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerKey]);

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
            {layoutKeyForActiveTab && (
              <Pressable hitSlop={10} onPress={() => cycle(layoutKeyForActiveTab)}>
                <Text style={styles.headerIcon}>
                  {LAYOUT_ICON[layouts[layoutKeyForActiveTab]]}
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
        key={pagerKey}
        ref={pagerRef}
        style={styles.pager}
        initialPage={page}
        onPageScroll={Animated.event(
          [{ nativeEvent: { position, offset } }],
          { useNativeDriver: true }
        )}
        onPageSelected={(event) => {
          const next = tabs[event.nativeEvent.position];
          if (next) setActiveTabId(next.id);
          // タブを移ると選択対象の種類が変わってしまうので解除する
          clear();
        }}
      >
        {tabs.map((tab) => (
          <View key={tab.id}>
            {tab.id === 'songs' && (
              <SongsPage
                tracks={tracks}
                currentTrack={currentTrack}
                inSelection={inSelection}
                isSelected={isSelected}
                toggle={toggle}
                playFrom={playFrom}
                refreshControl={refreshControl}
              />
            )}
            {tab.id === 'artists' && (
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
            )}
            {tab.id === 'albums' && (
              <AlbumsPage
                albums={albums}
                layout={layouts.albums}
                inSelection={inSelection}
                isSelected={isSelected}
                toggle={toggle}
                tileSizeFor={tileSizeFor}
                refreshControl={refreshControl}
              />
            )}
          </View>
        ))}
      </AnimatedPagerView>

      {/* 全曲シャッフルの導線。曲一覧が空でも、選択中でもない限り、
          どのタブを見ていても押せる（タブの表示/非表示の影響を受けない）。 */}
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
});
