import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

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

  if (!uri) {
    return (
      <View style={[styles.placeholder, box]}>
        <Text style={[styles.glyph, { fontSize: size * 0.42 }]}>♪</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[styles.image, box]}
      contentFit="cover"
      cachePolicy="memory-disk"
      // 一覧では同じ枠が使い回される。曲が変わったことを伝えて
      // 前の絵が残らないようにする
      recyclingKey={uri}
      transition={0}
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
