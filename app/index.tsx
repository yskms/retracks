/**
 * ライブラリ画面（要件 10.4）。
 *
 * タブは設定で並び替え・表示非表示ができる想定のため、ファイルベースの静的な
 * タブ構成ではなく、配列から組み立てるページャにしている。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../src/playback';
import { artworkByArtist, countAlbumsByArtist, type Track } from '../src/library';
import { colors } from '../src/theme';
import {
  AlbumsPage,
  ArtistsPage,
  FAB_BOTTOM_OFFSET,
  FAB_HEIGHT,
  SongsPage,
} from '../src/components/LibraryPages';
import { useSelection } from '../src/useSelection';
import { LAYOUT_ICON, tileSizeOf, useLayouts } from '../src/layout';
import { TAB_LABEL_KEY, TAB_LAYOUT_KEY, TAB_SORT_KEY, type TabId } from '../src/tabs';
import { useSettings } from '../src/settings';
import {
  sortAlbums,
  sortTracks,
  useSortOrders,
  type AlbumSortField,
  type SongSortField,
  type SortDirection,
} from '../src/sortOrder';

/**
 * 下線をネイティブ側で動かすためのラッパ。
 * JS スレッドで値を更新すると、イベントのたびに段付きの動きになる。
 */
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

type SortFieldLabelKey =
  | 'library.sortFieldTitle'
  | 'library.sortFieldAlbum'
  | 'library.sortFieldArtist'
  | 'library.sortFieldDuration'
  | 'library.sortFieldYear';

const GRID_PADDING = 12;
const GRID_GAP = 10;

export default function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const {
    tabs: tabSettings,
    ready: settingsReady,
    ignoreLeadingThe,
    ignoreLeadingAAn,
  } = useSettings();
  const articleOptions = useMemo(
    () => ({ ignoreLeadingThe, ignoreLeadingAAn }),
    [ignoreLeadingThe, ignoreLeadingAAn]
  );
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
  //
  // 初期値を tabs[0] で決め打ちにできない。設定の読み込みは非同期なので、
  // 最初のレンダー時点では tabSettings がまだ既定値（曲・アーティスト・
  // アルバムの順）で、保存済みの並び順（例：アルバムが先頭）を確定前に
  // 曲タブへ決め打ちしてしまう。読み込みが終わるまでは null のままにし、
  // 下の resolvedActiveTabId で「まだ確定していない間だけ tabs[0] を見せる」
  // 形にして、実際の状態確定は settingsReady を待つ（→下の useEffect）。
  const [activeTabId, setActiveTabId] = useState<TabId | null>(null);
  const resolvedActiveTabId =
    activeTabId != null && tabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : (tabs[0]?.id ?? 'songs');
  const page = Math.max(0, tabs.findIndex((tab) => tab.id === resolvedActiveTabId));
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
  //
  // 参照元は tabs[page]（今まさに表示しているタブ）であって activeTabId
  // ではない。構成が変わった直後の1レンダーだけ activeTabId が「もう
  // 表示されていないタブ」を指すことがあり（後始末の useEffect が直すまでの
  // 一瞬）、そこで直接 activeTabId を見るとその一瞬だけ違うタブのアイコンが
  // 出てしまう。tabs[page] は page 自体が resolvedActiveTabId 経由で
  // 常に存在するタブへフォールバックした値なので、この問題が起きない。
  const layoutKeyForActiveTab = tabs[page] ? TAB_LAYOUT_KEY[tabs[page].id] : undefined;
  const tileSizeFor = (layout: (typeof layouts)['artists']) =>
    tileSizeOf(width, layout, GRID_PADDING, GRID_GAP);

  // 曲・アルバムタブの並べ替え（要件 10.4）。プロバイダの tracks/albums
  // （タイトル順の正本）は触らず、タブごとの表示用に並べ替えた配列を
  // ここで別に持つ。sortKeyForActiveTab の考え方は layoutKeyForActiveTab
  // と同じ（＝「そのタブに並べ替えメニューがあるか」で出し分ける）。
  const { sortOrders, setSongSort, setAlbumSort } = useSortOrders();
  const sortKeyForActiveTab = tabs[page] ? TAB_SORT_KEY[tabs[page].id] : undefined;
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortedTracks = useMemo(
    () => sortTracks(tracks, sortOrders.songs.field, sortOrders.songs.direction, articleOptions),
    [tracks, sortOrders.songs, articleOptions]
  );
  const sortedAlbums = useMemo(
    () => sortAlbums(albums, sortOrders.albums.field, sortOrders.albums.direction, articleOptions),
    [albums, sortOrders.albums, articleOptions]
  );

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
  // - activeTabId がまだ未確定（起動直後、設定の読み込み待ち）なら、
  //   読み込みが終わった時点で先頭のタブに確定させる
  // - 今見ていたタブが消えていたら、先頭のタブへ切り替える
  // - 下線（position/offset）は onPageScroll でしか動かないので、
  //   スワイプせずに構成が変わると古い位置に取り残される。作り直した
  //   ページャの今のページへ合わせておく
  // - 隠したタブの選択が残ったまま選択ヘッダーだけ出る、という状態を避ける
  useEffect(() => {
    if (activeTabId == null) {
      // 読み込み前に確定させると、保存済みの並び順の先頭が曲タブでなくても
      // 常に曲タブへ着地してしまう。読み込みが終わるまでは何もしない
      // （resolvedActiveTabId が見た目上は tabs[0] を出してくれている）。
      if (settingsReady) setActiveTabId(tabs[0]?.id ?? 'songs');
      return;
    }
    if (!tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0]?.id ?? 'songs');
    }
    position.setValue(page);
    offset.setValue(0);
    clear();
    // pagerKey が変わったとき（＝ページャを作り直すとき）と、設定の読み込みが
    // 終わったときだけ実行したい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagerKey, settingsReady]);

  /** 選択したものからキューを作って再生する（要件 10.3）。 */
  const playSelection = useCallback(async (shuffled: boolean) => {
    if (!selection) return;
    const { kind, ids } = selection;

    if (kind === 'songs' && !shuffled) {
      // 一覧の並び順のまま先頭から（曲タブの並べ替えを反映した順）
      const picked = sortedTracks.filter((t) => ids.includes(t.id));
      await playFrom(picked, 0);
    } else if (kind === 'songs') {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const picked = ids.map((id) => byId.get(id)).filter((t): t is Track => t != null);
      // 'all' を使うと全曲シャッフルの1巡状態を上書きしてしまうため専用のキーにする
      await playTracks('selection', ids, picked);
    } else if (kind === 'artists') {
      // artists/albums の id は artistId||artist（→ deriveArtists()）と同じ
      // キーなので、tracks を直接絞り込める
      const picked = tracks.filter((t) => ids.includes(t.artistId || t.artist));
      if (shuffled) await playTracks('artist', ids, picked);
      else await playFrom(picked, 0);
    } else {
      const picked = tracks.filter((t) => ids.includes(t.albumId || t.album || ''));
      if (shuffled) await playTracks('album', ids, picked);
      else await playFrom(picked, 0);
    }

    clear();
    router.push('/player');
  }, [selection, tracks, sortedTracks, playTracks, playFrom, clear, router]);

  // 並べ替えメニューの中身は、今表示しているタブ（sortKeyForActiveTab）で
  // 出し分ける。軸の並びは Row の項目数がそこまで多くないため、useMemo に
  // せず毎レンダー組み立てる（layoutKeyForActiveTab と同じ扱い）。
  const activeSortOrder =
    sortKeyForActiveTab === 'songs'
      ? sortOrders.songs
      : sortKeyForActiveTab === 'albums'
        ? sortOrders.albums
        : null;
  const sortFieldOptions: { value: SongSortField | AlbumSortField; labelKey: SortFieldLabelKey }[] =
    sortKeyForActiveTab === 'songs'
      ? [
          { value: 'title', labelKey: 'library.sortFieldTitle' },
          { value: 'album', labelKey: 'library.sortFieldAlbum' },
          { value: 'artist', labelKey: 'library.sortFieldArtist' },
          { value: 'duration', labelKey: 'library.sortFieldDuration' },
        ]
      : sortKeyForActiveTab === 'albums'
        ? [
            { value: 'title', labelKey: 'library.sortFieldTitle' },
            { value: 'artist', labelKey: 'library.sortFieldArtist' },
            { value: 'year', labelKey: 'library.sortFieldYear' },
          ]
        : [];
  const applySortField = (value: SongSortField | AlbumSortField) => {
    if (sortKeyForActiveTab === 'songs') setSongSort(value as SongSortField, sortOrders.songs.direction);
    else if (sortKeyForActiveTab === 'albums')
      setAlbumSort(value as AlbumSortField, sortOrders.albums.direction);
  };
  const applySortDirection = (direction: SortDirection) => {
    if (sortKeyForActiveTab === 'songs') setSongSort(sortOrders.songs.field, direction);
    else if (sortKeyForActiveTab === 'albums') setAlbumSort(sortOrders.albums.field, direction);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={clear}>
            <Ionicons name="close-outline" size={22} color={colors.text} />
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
              <Ionicons name="shuffle-outline" size={14} color="#1a1206" />
              <Text style={styles.headerActionPrimaryText}>{t('common.shufflePlay')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Text style={styles.brand}>RE:TR4CKS</Text>
          <View style={styles.headerRight}>
            {sortKeyForActiveTab && (
              <Pressable
                hitSlop={10}
                onPress={() => setSortMenuOpen(true)}
                accessibilityLabel={t('library.sortA11y')}
              >
                <Ionicons name="swap-vertical-outline" size={20} color={colors.text} />
              </Pressable>
            )}
            {layoutKeyForActiveTab && (
              <Pressable hitSlop={10} onPress={() => cycle(layoutKeyForActiveTab)}>
                <Ionicons
                  name={LAYOUT_ICON[layouts[layoutKeyForActiveTab]]}
                  size={20}
                  color={colors.text}
                />
              </Pressable>
            )}
            <Pressable
              hitSlop={10}
              onPress={() => router.push('/search')}
              accessibilityLabel={t('search.openA11y')}
            >
              <Ionicons name="search-outline" size={20} color={colors.text} />
            </Pressable>
            <Pressable
              hitSlop={10}
              onPress={() => router.push('/settings')}
              accessibilityLabel={t('settings.openA11y')}
            >
              <Ionicons name="settings-outline" size={20} color={colors.text} />
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
                tracks={sortedTracks}
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
                albums={sortedAlbums}
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
          <Ionicons name="shuffle-outline" size={18} color="#1a1206" />
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

      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSortMenuOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{t('library.sortTitle')}</Text>
            {activeSortOrder && (
              <View style={styles.sortDirectionRow}>
                {(['asc', 'desc'] as const).map((direction) => {
                  const active = activeSortOrder.direction === direction;
                  return (
                    <Pressable
                      key={direction}
                      style={[styles.sortDirectionPill, active && styles.sortDirectionPillActive]}
                      onPress={() => applySortDirection(direction)}
                    >
                      <Text
                        style={[
                          styles.sortDirectionText,
                          active && styles.sortDirectionTextActive,
                        ]}
                      >
                        {t(direction === 'asc' ? 'library.sortDirectionAsc' : 'library.sortDirectionDesc')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {sortFieldOptions.map(({ value, labelKey }) => {
              const checked = activeSortOrder?.field === value;
              return (
                <Pressable
                  key={value}
                  style={styles.pickerRow}
                  onPress={() => {
                    applySortField(value);
                    setSortMenuOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.radio, checked && styles.radioChecked]}>
                    {checked ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={styles.rowLabel}>{t(labelKey)}</Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  fab: {
    position: 'absolute',
    right: 16,
    bottom: FAB_BOTTOM_OFFSET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    height: FAB_HEIGHT,
    borderRadius: FAB_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  fabLabel: { color: '#1a1206', fontSize: 13, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  modalTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  sortDirectionRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sortDirectionPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surfaceHigh,
  },
  sortDirectionPillActive: { backgroundColor: colors.accent },
  sortDirectionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  sortDirectionTextActive: { color: '#1a1206' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  rowLabel: { color: colors.text, fontSize: 14 },
});
