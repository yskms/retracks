import { Image as ExpoImage } from 'expo-image';
import { useEffect, useState } from 'react';
import { PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';

import { RetracksPlayer } from '../../modules/retracks-player/src';
import { colors } from '../theme';

const artworkCache = new Map<string, string | null>();
const artworkRequests = new Map<string, Promise<string | null>>();
const MAX_CACHE_ENTRIES = 160;

function loadIosArtwork(uri: string, size: number): Promise<string | null> {
  const trackId = uri.slice('music-artwork://'.length);
  // MPMediaItemArtworkへはピクセル相当の大きさを要求する。等倍だとRetina端末で
  // 特にプレイヤーの大きな画像がぼやけるため、端末のscaleを反映する。
  const requestedSize = Math.min(600, Math.max(32, Math.ceil(size * PixelRatio.get())));
  const key = `${trackId}:${requestedSize}`;
  if (artworkCache.has(key)) return Promise.resolve(artworkCache.get(key) ?? null);

  const pending = artworkRequests.get(key);
  if (pending) return pending;

  const request = RetracksPlayer.getArtworkDataUri(trackId, requestedSize)
    .then((result) => {
      if (artworkCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = artworkCache.keys().next().value;
        if (oldest !== undefined) artworkCache.delete(oldest);
      }
      artworkCache.set(key, result);
      return result;
    })
    .catch(() => null)
    .finally(() => artworkRequests.delete(key));
  artworkRequests.set(key, request);
  return request;
}

/**
 * アルバムジャケット。音楽ファイルに埋め込まれているものだけを表示し、
 * ネットワークからの取得はしない。無い場合はプレースホルダを出す。
 *
 * expo-image を使っているのはメモリのため。React Native の Image では
 * 一覧をスクロールしただけでネイティブヒープが 160MB まで膨らみ（実測）、
 * メモリ不足でプロセスごと終了させられていた。
 * こちらは表示サイズに合わせて縮小し、キャッシュの上限も持つ。
 */
export function Artwork({
  uri,
  size,
  radius = 4,
}: {
  uri?: string | null;
  size: number;
  radius?: number;
}) {
  const box = { width: size, height: size, borderRadius: radius };

  // ジャケットの URI はアルバムIDから組み立てているだけで、実体があるとは
  // 限らない（src/library.ts の artworkUriOf）。読めなかったものは
  // プレースホルダに戻す。URI が変われば作り直す。
  const [failed, setFailed] = useState(false);
  const isIosMusicArtwork =
    Platform.OS === 'ios' && Boolean(uri?.startsWith('music-artwork://'));
  const [iosSource, setIosSource] = useState<string | null>(null);
  useEffect(() => setFailed(false), [uri]);
  useEffect(() => {
    let active = true;
    setIosSource(null);
    if (isIosMusicArtwork && uri) {
      loadIosArtwork(uri, size).then((result) => {
        if (active) {
          setIosSource(result);
          if (!result) setFailed(true);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [isIosMusicArtwork, size, uri]);

  if (!uri || failed || (isIosMusicArtwork && !iosSource)) {
    return (
      <View style={[styles.placeholder, box]}>
        <Text style={[styles.glyph, { fontSize: size * 0.42 }]}>♪</Text>
      </View>
    );
  }

  // iOSの独自URIローダーは実機の新アーキテクチャで動作しなかったため、
  // 自前モジュールで必要な表示サイズだけ取得する。data URIならexpo-imageで
  // 読めるので、一覧表示時のキャッシュ・メモリ対策も維持できる。
  if (isIosMusicArtwork && iosSource) {
    return (
      <ExpoImage
        source={{ uri: iosSource }}
        style={[styles.image, box]}
        contentFit="cover"
        cachePolicy="memory"
        recyclingKey={uri}
        transition={0}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <ExpoImage
      source={{ uri }}
      style={[styles.image, box]}
      contentFit="cover"
      cachePolicy="memory-disk"
      // 一覧では同じ枠が使い回される。曲が変わったことを伝えて
      // 前の絵が残らないようにする
      recyclingKey={uri}
      transition={0}
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surface },
  placeholder: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: colors.border },
});
