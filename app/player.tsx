/**
 * プレイヤー画面（要件 10.2）。
 * 再生操作と RUSH の区間設定をここに集約する。
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../src/playback';
import { resolveSegment, type SegmentSetting } from '../src/rush';
import { colors, formatDuration } from '../src/theme';

const SEGMENT_ROWS: {
  key: keyof SegmentSetting;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'startSec', label: '開始位置', min: 0, max: 180, step: 1 },
  { key: 'lengthSec', label: '再生時間', min: 5, max: 180, step: 1 },
  { key: 'fadeInSec', label: 'フェードイン', min: 0, max: 10, step: 0.5 },
  { key: 'fadeSec', label: 'フェードアウト', min: 0, max: 10, step: 0.5 },
];

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    currentTrack,
    status,
    progress,
    setting,
    setSetting,
    rushOn,
    setRushOn,
    toggle,
    next,
    previous,
    seekTo,
  } = usePlayback();

  // スライダー操作中は再生位置の自動更新でつままれた位置が戻らないようにする
  const [seeking, setSeeking] = useState<number | null>(null);

  const positionMs = seeking ?? status?.positionMs ?? 0;
  const durationMs = status?.durationMs ?? 0;

  const preview =
    durationMs > 0 ? resolveSegment(durationMs / 1000, setting) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>▾</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {progress ? `1巡 ${progress.played} / ${progress.total}` : '再生中'}
        </Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.artwork}>
          <Text style={styles.artworkGlyph}>♪</Text>
        </View>

        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {currentTrack?.title ?? '再生していません'}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {currentTrack ? currentTrack.artist : ''}
          </Text>
          {currentTrack?.album ? (
            <Text style={styles.album} numberOfLines={1}>
              {currentTrack.album}
            </Text>
          ) : null}
        </View>

        <View style={styles.seekWrap}>
          <Slider
            style={styles.seek}
            minimumValue={0}
            maximumValue={Math.max(durationMs, 1)}
            value={positionMs}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
            onValueChange={(value) => setSeeking(value)}
            onSlidingComplete={(value) => {
              seekTo(value);
              setSeeking(null);
            }}
          />
          <View style={styles.times}>
            <Text style={styles.time}>{formatDuration(positionMs)}</Text>
            <Text style={styles.time}>{formatDuration(durationMs)}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable style={styles.control} onPress={previous} hitSlop={10}>
            <Text style={styles.controlGlyph}>❙◀</Text>
          </Pressable>
          <Pressable style={[styles.control, styles.controlMain]} onPress={toggle}>
            <Text style={styles.controlMainGlyph}>
              {status?.isPlaying ? '❚❚' : '▶'}
            </Text>
          </Pressable>
          <Pressable style={styles.control} onPress={next} hitSlop={10}>
            <Text style={styles.controlGlyph}>▶❙</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.rush, rushOn ? styles.rushOn : styles.rushOff]}
          onPress={() => setRushOn(!rushOn)}
        >
          <Text style={[styles.rushLabel, rushOn && styles.rushLabelOn]}>
            RUSH {rushOn ? 'ON' : 'OFF'}
          </Text>
          <Text style={styles.rushHint}>
            {rushOn ? '区間だけ再生して次の曲へ' : '曲を最後まで再生'}
          </Text>
        </Pressable>

        {rushOn && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>区間設定</Text>
            {SEGMENT_ROWS.map((row) => (
              <View key={row.key} style={styles.segmentRow}>
                <View style={styles.segmentHead}>
                  <Text style={styles.segmentLabel}>{row.label}</Text>
                  <Text style={styles.segmentValue}>
                    {setting[row.key].toFixed(1)}s
                  </Text>
                </View>
                <Slider
                  style={styles.segmentSlider}
                  minimumValue={row.min}
                  maximumValue={row.max}
                  step={row.step}
                  value={setting[row.key]}
                  minimumTrackTintColor={colors.accent}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.accent}
                  onSlidingComplete={(value) =>
                    setSetting((prev) => ({ ...prev, [row.key]: value }))
                  }
                />
              </View>
            ))}
            {preview && (
              <Text style={styles.previewText}>
                この曲での実効区間 {preview.start.toFixed(1)}〜{preview.end.toFixed(1)}s
                {'\n'}
                fadeIn {preview.fadeIn.toFixed(1)}s / fadeOut {preview.fade.toFixed(1)}s
              </Text>
            )}
            <Text style={styles.note}>
              開始位置と再生時間の変更は次の曲から反映されます
            </Text>
          </View>
        )}
      </ScrollView>
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
    height: 48,
  },
  headerIcon: { color: colors.text, fontSize: 20 },
  headerTitle: { color: colors.textDim, fontSize: 12 },
  body: { padding: 20, paddingBottom: 40, gap: 20 },
  artwork: {
    aspectRatio: 1,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkGlyph: { color: colors.border, fontSize: 72 },
  meta: { gap: 4 },
  title: { color: colors.text, fontSize: 20, fontWeight: '700' },
  artist: { color: colors.textDim, fontSize: 14 },
  album: { color: colors.textDim, fontSize: 12 },
  seekWrap: { gap: 2 },
  seek: { width: '100%', height: 36 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { color: colors.textDim, fontSize: 11 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  control: { padding: 12 },
  controlGlyph: { color: colors.text, fontSize: 22 },
  controlMain: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlMainGlyph: { color: '#1a1206', fontSize: 26, fontWeight: '700' },
  rush: { borderRadius: 12, padding: 14, gap: 2, borderWidth: 1 },
  rushOn: { backgroundColor: colors.accentDim, borderColor: colors.accent },
  rushOff: { backgroundColor: colors.surface, borderColor: colors.border },
  rushLabel: { color: colors.textDim, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  rushLabelOn: { color: colors.text },
  rushHint: { color: colors.textDim, fontSize: 11 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, gap: 12 },
  cardTitle: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  segmentRow: { gap: 2 },
  segmentHead: { flexDirection: 'row', justifyContent: 'space-between' },
  segmentLabel: { color: colors.textDim, fontSize: 12 },
  segmentValue: { color: colors.text, fontSize: 12 },
  segmentSlider: { width: '100%', height: 32 },
  previewText: { color: colors.textDim, fontSize: 11, lineHeight: 17 },
  note: { color: colors.textDim, fontSize: 10 },
});
