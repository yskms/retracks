/**
 * 検索画面（要件 10.4）。
 *
 * ライブラリ画面のどのタブからも同じ⌕アイコンで開き、常に同じ結果
 * （アーティスト・アルバム・楽曲）を出す。タブに紐付けないことで
 * 「どのタブから開いても同じ結果」を自然に満たしている。
 *
 * ネイティブの検索APIは曲（searchAssetsAsync）しか対象にできないため、
 * PlaybackProvider が保持する曲・アーティスト・アルバムの一覧を
 * クライアント側でフィルタする方式にしている。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../src/playback';
import { artworkByArtist, type Album, type Artist, type Track } from '../src/library';
import { colors, formatDuration } from '../src/theme';
import { Row } from '../src/components/Row';
import { Tile } from '../src/components/Tile';

/** 横並びセクションに出す最大件数。曲は下の縦リストが仮想化されるので上限なし。 */
const SECTION_LIMIT = 10;

const TILE_SIZE = 132;

/** ひらがな→カタカナの畳み込み用レンジ（U+3041-3096）。 */
const HIRAGANA_RANGE = /[ぁ-ゖ]/g;

/**
 * 検索用に文字列を正規化する。
 *
 * NFKC で全角/半角・結合文字の濁点などを寄せ、さらにひらがなをカタカナに
 * 畳み込むことで「ひらがな入力でカタカナ表記の曲がヒットしない」を防ぐ。
 * Hermes が normalize 未対応でも、小文字化とかな畳み込みだけは効くようにする。
 */
function normalizeForSearch(value: string): string {
  let normalized = value;
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // 未対応環境ではそのまま進める
  }
  normalized = normalized.replace(HIRAGANA_RANGE, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
  return normalized.toLowerCase();
}

type Indexed<T> = { item: T; haystacks: string[] };

export default function SearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tracks, artists, albums, playFrom } = usePlayback();

  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  // autoFocus は画面遷移のアニメーション中に効かないことがあるため、
  // 遷移が終わってから明示的にフォーカスする。
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      inputRef.current?.focus();
    });
    return () => task.cancel();
  }, []);

  const trimmed = useMemo(() => normalizeForSearch(query.trim()), [query]);
  const hasQuery = trimmed.length > 0;

  const artistArtwork = useMemo(() => artworkByArtist(albums), [albums]);

  // 1キーストロークごとに全件を正規化し直さないよう、元データが変わったときだけ作る。
  const artistIndex = useMemo<Indexed<Artist>[]>(
    () => artists.map((item) => ({ item, haystacks: [normalizeForSearch(item.name)] })),
    [artists]
  );
  const albumIndex = useMemo<Indexed<Album>[]>(
    () =>
      albums.map((item) => ({
        item,
        haystacks: [normalizeForSearch(item.title), normalizeForSearch(item.artist)],
      })),
    [albums]
  );
  const trackIndex = useMemo<Indexed<Track>[]>(
    () =>
      tracks.map((item) => ({
        item,
        haystacks: [
          normalizeForSearch(item.title),
          normalizeForSearch(item.artist),
          normalizeForSearch(item.album ?? ''),
        ],
      })),
    [tracks]
  );

  const filteredArtists = useMemo<Artist[]>(() => {
    if (!hasQuery) return [];
    return artistIndex
      .filter((entry) => entry.haystacks.some((h) => h.includes(trimmed)))
      .map((entry) => entry.item);
  }, [artistIndex, trimmed, hasQuery]);

  const filteredAlbums = useMemo<Album[]>(() => {
    if (!hasQuery) return [];
    return albumIndex
      .filter((entry) => entry.haystacks.some((h) => h.includes(trimmed)))
      .map((entry) => entry.item);
  }, [albumIndex, trimmed, hasQuery]);

  const filteredTracks = useMemo<Track[]>(() => {
    if (!hasQuery) return [];
    return trackIndex
      .filter((entry) => entry.haystacks.some((h) => h.includes(trimmed)))
      .map((entry) => entry.item);
  }, [trackIndex, trimmed, hasQuery]);

  const hasResults = filteredArtists.length > 0 || filteredAlbums.length > 0 || filteredTracks.length > 0;

  // ライブラリ読み込み中の一瞬も tracks は空になる。ライブラリ画面と同じ基準
  // （tracks.length === 0）で判定し、「読み込み中」と「0件」を区別する。
  const libraryLoading = tracks.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable
            hitSlop={12}
            onPress={() => setQuery('')}
            accessibilityLabel={t('search.clearA11y')}
          >
            <Text style={styles.headerIcon}>✕</Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={filteredTracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          !hasQuery ? null : libraryLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.loadingText}>{t('library.loading')}</Text>
            </View>
          ) : (
            <View>
              {filteredArtists.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{t('library.tabArtists')}</Text>
                    {filteredArtists.length > SECTION_LIMIT && (
                      <Text style={styles.sectionCount}>
                        {t('search.moreCount', { n: filteredArtists.length - SECTION_LIMIT })}
                      </Text>
                    )}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredArtists.slice(0, SECTION_LIMIT).map((item) => (
                      <Tile
                        key={item.id}
                        title={item.name}
                        artworkUri={artistArtwork.get(item.name) ?? null}
                        size={TILE_SIZE}
                        onPress={() =>
                          router.push({
                            pathname: '/artist/[id]',
                            params: { id: item.id, name: item.name },
                          })
                        }
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {filteredAlbums.length > 0 && (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{t('library.tabAlbums')}</Text>
                    {filteredAlbums.length > SECTION_LIMIT && (
                      <Text style={styles.sectionCount}>
                        {t('search.moreCount', { n: filteredAlbums.length - SECTION_LIMIT })}
                      </Text>
                    )}
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {filteredAlbums.slice(0, SECTION_LIMIT).map((item) => (
                      <Tile
                        key={item.id}
                        title={item.title}
                        subtitle={item.artist}
                        artworkUri={item.artworkUri}
                        size={TILE_SIZE}
                        onPress={() =>
                          router.push({
                            pathname: '/album/[id]',
                            params: { id: item.id, title: item.title, artist: item.artist },
                          })
                        }
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {filteredTracks.length > 0 && (
                <Text style={[styles.sectionTitle, styles.sectionTitleStandalone]}>
                  {t('library.tabSongs')}
                </Text>
              )}

              {!hasResults && (
                <Text style={styles.noResults}>{t('search.noResults')}</Text>
              )}
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <Row
            title={item.title}
            subtitle={item.artist}
            trailing={formatDuration(item.durationMs)}
            artworkUri={item.artworkUri}
            onPress={() => void playFrom(filteredTracks, index)}
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
  headerIcon: { color: colors.text, fontSize: 18 },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 8,
  },
  listContent: { paddingBottom: 24 },
  section: { paddingTop: 4, paddingBottom: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionTitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTitleStandalone: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionCount: { color: colors.textDim, fontSize: 11 },
  noResults: {
    color: colors.textDim,
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 40,
  },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  loadingText: { color: colors.textDim, fontSize: 13 },
});
