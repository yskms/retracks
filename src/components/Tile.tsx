import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';
import { Artwork } from './Artwork';

/** グリッド表示の1枠。ジャケットを大きく見せたいとき用。 */
export function Tile({
  title,
  subtitle,
  artworkUri,
  size,
  selected,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle?: string;
  artworkUri?: string | null;
  size: number;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      style={[styles.tile, { width: size }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
    >
      <View>
        <Artwork uri={artworkUri} size={size} radius={8} />
        {selected ? (
          <View style={[styles.selectedOverlay, { width: size, height: size }]}>
            <Text style={styles.check}>✓</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { marginBottom: 16 },
  title: { color: colors.text, fontSize: 12, marginTop: 6 },
  subtitle: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  selectedOverlay: {
    position: 'absolute',
    borderRadius: 8,
    backgroundColor: 'rgba(232,145,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: { color: '#1a1206', fontSize: 28, fontWeight: '700' },
});
