import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

/**
 * アルバムジャケット。音楽ファイルに埋め込まれているものだけを表示し、
 * ネットワークからの取得はしない。無い場合はプレースホルダを出す。
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

  return <Image source={{ uri }} style={[styles.image, box]} resizeMode="cover" />;
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
