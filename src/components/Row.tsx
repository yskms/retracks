import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../theme';

export function Row({
  title,
  subtitle,
  trailing,
  selected,
  playing,
  chevron,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  selected?: boolean;
  playing?: boolean;
  chevron?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, playing && styles.rowTitlePlaying]} numberOfLines={1}>
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
      {chevron && !selected ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
