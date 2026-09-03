/**
 * ライブラリ画面（要件 10.4）。
 *
 * タブは設定で並び替え・表示非表示ができる想定のため、ファイルベースの静的な
 * タブ構成ではなく、配列から組み立てるページャにしている。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../src/playback';
import {
  getAlbums,
  getArtists,
  getTracksForAlbums,
  getTracksForArtists,
  type Album,
  type Artist,
  type Track,
} from '../src/library';
import { colors, formatDuration } from '../src/theme';

type TabId = 'songs' | 'artists' | 'albums';

const TABS: { id: TabId; label: string }[] = [
  { id: 'songs', label: '楽曲' },
  { id: 'artists', label: 'アーティスト' },
  { id: 'albums', label: 'アルバム' },
];

type Selection = { kind: TabId; ids: string[] } | null;

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, playFrom, playTracks, playAll, currentTrack } = usePlayback();

  const pagerRef = useRef<PagerView>(null);
  const [page, setPage] = useState(0);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    void (async () => {
      try {
        setArtists(await getArtists());
        setAlbums(await getAlbums());
      } catch {
        // 権限が無い場合など。曲一覧側でエラーを出しているのでここでは黙る
      }
    })();
  }, [tracks.length]);

  const toggleSelect = useCallback((kind: TabId, id: string) => {
    setSelection((prev) => {
      if (!prev || prev.kind !== kind) return { kind, ids: [id] };
      const ids = prev.ids.includes(id)
        ? prev.ids.filter((x) => x !== id)
        : [...prev.ids, id];
      return ids.length === 0 ? null : { kind, ids };
    });
  }, []);

  /** 選択したものからキューを作って再生する（要件 10.3）。 */
  const playSelection = useCallback(async () => {
    if (!selection) return;
    const { kind, ids } = selection;

    if (kind === 'songs') {
      const byId = new Map(tracks.map((t) => [t.id, t]));
      const picked = ids.map((id) => byId.get(id)).filter((t): t is Track => t != null);
      await playTracks('all', ids, picked);
    } else if (kind === 'artists') {
      await playTracks('artist', ids, await getTracksForArtists(ids));
    } else {
      await playTracks('album', ids, await getTracksForAlbums(ids));
    }

    setSelection(null);
    router.push('/player');
  }, [selection, tracks, playTracks, router]);

  const inSelection = selection != null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={() => setSelection(null)}>
            <Text style={styles.headerIcon}>✕</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{selection.ids.length}件選択</Text>
          <Pressable hitSlop={10} onPress={playSelection}>
            <Text style={styles.headerAction}>▶ 再生</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <Text style={styles.brand}>RE:TR4CKS</Text>
          <View style={styles.headerRight}>
            <Pressable hitSlop={10} onPress={() => router.push('/debug')}>
              <Text style={styles.headerIcon}>⋮</Text>
            </Pressable>
          </View>
        </View>
      )}

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
            <View style={[styles.tabRule, page === index && styles.tabRuleActive]} />
          </Pressable>
        ))}
      </View>

      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageSelected={(event) => setPage(event.nativeEvent.position)}
      >
        <View key="songs" style={styles.page}>
          {tracks.length === 0 ? (
            <Loading />
          ) : (
            <FlatList
              data={tracks}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.listContent}
              initialNumToRender={20}
              windowSize={11}
              renderItem={({ item, index }) => {
                const selected = selection?.kind === 'songs' && selection.ids.includes(item.id);
                return (
                  <Row
                    title={item.title}
                    subtitle={item.artist}
                    trailing={formatDuration(item.durationMs)}
                    selected={selected}
                    playing={currentTrack?.id === item.id}
                    onPress={() =>
                      inSelection
                        ? toggleSelect('songs', item.id)
                        : void playFrom(tracks, index)
                    }
                    onLongPress={() => toggleSelect('songs', item.id)}
                  />
                );
              }}
            />
          )}
          {!inSelection && (
            <Pressable style={styles.fab} onPress={() => void playAll()}>
              <Text style={styles.fabGlyph}>⤮</Text>
            </Pressable>
          )}
        </View>

        <View key="artists" style={styles.page}>
          <FlatList
            data={artists}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const selected =
                selection?.kind === 'artists' && selection.ids.includes(item.id);
              return (
                <Row
                  title={item.name}
                  subtitle={`${item.trackCount}曲`}
                  selected={selected}
                  onPress={async () => {
                    if (inSelection) return toggleSelect('artists', item.id);
                    await playTracks('artist', [item.id], await getTracksForArtists([item.id]));
                    router.push('/player');
                  }}
                  onLongPress={() => toggleSelect('artists', item.id)}
                />
              );
            }}
          />
        </View>

        <View key="albums" style={styles.page}>
          <FlatList
            data={albums}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const selected =
                selection?.kind === 'albums' && selection.ids.includes(item.id);
              return (
                <Row
                  title={item.title}
                  subtitle={`${item.artist} · ${item.trackCount}曲`}
                  selected={selected}
                  onPress={async () => {
                    if (inSelection) return toggleSelect('albums', item.id);
                    await playTracks('album', [item.id], await getTracksForAlbums([item.id]));
                    router.push('/player');
                  }}
                  onLongPress={() => toggleSelect('albums', item.id)}
                />
              );
            }}
          />
        </View>
      </PagerView>
    </View>
  );
}

function Row({
  title,
  subtitle,
  trailing,
  selected,
  playing,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  selected?: boolean;
  playing?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
    >
      <View style={styles.rowText}>
        <Text
          style={[styles.rowTitle, playing && styles.rowTitlePlaying]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? <Text style={styles.check}>✓</Text> : null}
      {trailing ? <Text style={styles.rowTrailing}>{trailing}</Text> : null}
    </Pressable>
  );
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
  headerRight: { flexDirection: 'row', gap: 18 },
  brand: { color: colors.text, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  headerIcon: { color: colors.text, fontSize: 18 },
  headerAction: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  tabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: 'center' },
  tabLabel: { color: colors.textDim, fontSize: 13, paddingVertical: 12 },
  tabLabelActive: { color: colors.text, fontWeight: '700' },
  tabRule: { height: 2, width: '60%', backgroundColor: 'transparent' },
  tabRuleActive: { backgroundColor: colors.accent },
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
  check: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: { color: '#1a1206', fontSize: 22, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: colors.textDim, fontSize: 13 },
});
