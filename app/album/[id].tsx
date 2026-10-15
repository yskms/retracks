/**
 * アルバム詳細。収録曲を並べ、タップで再生する。
 * 長押しで複数選択に入り、まとめて再生・削除できる。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback } from '../../src/playback';
import { compareByTrackOrder, tracksForSelection } from '../../src/library';
import { colors, formatDuration } from '../../src/theme';
import { Row } from '../../src/components/Row';
import { useSelection } from '../../src/useSelection';
import { CAN_DELETE_TRACKS, useDeleteTracks } from '../../src/useDeleteTracks';

export default function AlbumScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, title, artist } = useLocalSearchParams<{
    id: string;
    title?: string;
    artist?: string;
  }>();
  const { tracks: allTracks, playFrom, playTracks, currentTrack, rescan } = usePlayback();
  const { selection, active: inSelection, toggle, clear, isSelected } = useSelection<'songs'>();
  const { deleting, confirmAndDelete } = useDeleteTracks(rescan);

  // id はアルバムの実ID、またはそれを持たない曲向けのアルバム名のどちらか
  // （→ deriveAlbums()）。プレイヤー画面からはアルバムIDを持たず名前だけで
  // 遷移してくることもあるため、名前一致もあわせて見る。
  const tracks = useMemo(
    () => allTracks.filter((t) => t.albumId === id || t.album === id).sort(compareByTrackOrder),
    [allTracks, id]
  );

  // このアルバムからの再生は、曲の増減があっても、キュータブでは1つの項目に保つ
  // （→ buildOriginKey）。
  const albumOrigin = useMemo(() => ({ kind: 'album' as const, id }), [id]);

  // このアルバムの曲を全削除すると tracks が 0 になる。空の詳細画面が
  // 残り続けるのを避けるため自動で戻る（→ app/artist/[id].tsx の同コメント）。
  // isFocused を見ているのは、このスタック下に積まれた状態（他の画面へ進んだ
  // 後ろで、ここの tracks が裏の再走査などで 0 になった場合）で発火すると、
  // router.back() が自分ではなく今まさに見ている画面を閉じてしまうため
  // （2026-10、レビュー指摘）。
  const isFocused = useIsFocused();
  const hadTracksRef = useRef(false);
  useEffect(() => {
    if (tracks.length > 0) {
      hadTracksRef.current = true;
      return;
    }
    if (hadTracksRef.current && isFocused) router.back();
  }, [tracks.length, isFocused, router]);

  /** 選択した曲を端末から削除する（Android 10 以降のみ。→ src/useDeleteTracks.ts）。 */
  const deleteSelection = useCallback(() => {
    if (!selection) return;
    const picked = tracksForSelection(tracks, 'songs', selection.ids);
    confirmAndDelete(picked, clear);
  }, [selection, tracks, confirmAndDelete, clear]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {inSelection ? (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={clear}>
            <Ionicons name="close-outline" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.headerTitle, styles.headerTitleFlex]} numberOfLines={1}>
            {t('album.selectedCount', { count: selection?.ids.length ?? 0 })}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={styles.action}
              onPress={async () => {
                if (!selection) return;
                const picked = tracksForSelection(tracks, 'songs', selection.ids);
                clear();
                await playFrom(picked, 0);
                router.push('/player');
              }}
            >
              <Text style={styles.actionText}>{`▶ ${t('common.playInOrder')}`}</Text>
            </Pressable>
            <Pressable
              style={[styles.action, styles.actionPrimary]}
              onPress={async () => {
                if (!selection) return;
                const ids = selection.ids;
                const picked = tracksForSelection(tracks, 'songs', ids);
                clear();
                await playTracks('songs', ids, picked);
                router.push('/player');
              }}
            >
              <Ionicons name="shuffle-outline" size={14} color="#1a1206" />
              <Text style={styles.actionPrimaryText}>{t('common.shufflePlay')}</Text>
            </Pressable>
            {CAN_DELETE_TRACKS && (
              <Pressable
                hitSlop={10}
                disabled={deleting}
                onPress={deleteSelection}
                accessibilityLabel={t('library.deleteA11y')}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={deleting ? colors.textDim : colors.text}
                />
              </Pressable>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title ?? t('album.fallbackTitle')}
            </Text>
            {artist ? (
              <Pressable
                hitSlop={10}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: '/artist/[id]',
                    params: {
                      // ヘッダーに出している artist（deriveAlbums() がタイトル順で
                      // 最初に見つけた曲の名前）と同じ曲から id を引く。tracks[0]
                      // （ディスク・トラック番号順の先頭曲）だと、コンピレーション
                      // アルバムのように曲ごとにアーティストが違う場合、表示している
                      // 名前と遷移先のアーティストがずれてしまう。
                      id: tracks.find((t) => t.artist === artist)?.artistId ?? artist,
                      name: artist,
                    },
                  })
                }
              >
                <Text style={styles.headerSub} numberOfLines={1}>
                  {artist}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.summaryRow}>
            <Text style={styles.summary}>{t('common.songCount', { count: tracks.length })}</Text>
            {/* 選択中はヘッダー側に再生/削除操作が出るので、こちらは隠す。
                ListHeaderComponent ごと null にすると、長押しした行の位置が
                指の下からずれて跳ねる（2026-10、レビュー指摘）。行の形は
                保ったままボタンだけ消す（→ app/artist/[id].tsx と同じ扱い）。 */}
            {!inSelection && (
              <View style={styles.actions}>
                <Pressable
                  style={styles.action}
                  onPress={async () => {
                    await playFrom(tracks, 0, { origin: albumOrigin });
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
                  <Ionicons name="shuffle-outline" size={14} color="#1a1206" />
                  <Text style={styles.actionPrimaryText}>{t('common.shufflePlay')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          <Row
            title={item.title}
            subtitle={item.artist}
            trailing={formatDuration(item.durationMs)}
            artworkUri={item.artworkUri}
            trackNumber={item.trackNumber}
            selected={isSelected('songs', item.id)}
            playing={currentTrack?.id === item.id}
            onPress={() =>
              inSelection ? toggle('songs', item.id) : void playFrom(tracks, index, { origin: albumOrigin })
            }
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
    paddingHorizontal: 16,
    height: 56,
    gap: 12,
  },
  headerText: { flex: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerTitleFlex: { flex: 1 },
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
  // gap はゴミ箱アイコンの hitSlop（10）以上にする（→ app/index.tsx の同注記）。
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
  },
  actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  actionPrimary: { backgroundColor: colors.accent },
  actionPrimaryText: { color: '#1a1206', fontSize: 12, fontWeight: '700' },
});
