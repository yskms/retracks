/**
 * プレイヤー画面（要件 10.2）。
 * 再生操作、RUSH の区間設定、再生キューをここに集約する。
 */

import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayback } from '../src/playback';
import type { Track } from '../src/library';
import { resolveSegment, type SegmentSetting } from '../src/rush';
import { colors, formatDuration } from '../src/theme';
import { Artwork } from '../src/components/Artwork';

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

/** キューの行の高さ。scrollToIndex を正確に効かせるため固定する。 */
const QUEUE_ROW_HEIGHT = 54;

export default function PlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    currentTrack,
    status,
    progress,
    queue,
    setting,
    setSetting,
    rushOn,
    setRushOn,
    toggle,
    next,
    previous,
    seekTo,
    skipTo,
    playCurrentToEnd,
  } = usePlayback();

  const listRef = useRef<FlatList<Track>>(null);
  const { width } = useWindowDimensions();

  // シークバーをつまんでいる間は、再生位置の自動更新で戻らないようにする
  const [seeking, setSeeking] = useState<number | null>(null);

  // 区間設定は、つまんでいる間の値を表示に反映する。native への送信は指を
  // 離したときだけ（毎フレーム送るとキューを作り直してしまう）。
  const [dragging, setDragging] = useState<Partial<Record<keyof SegmentSetting, number>>>(
    {}
  );

  /** スライダーの微調整用。段はスライダーと同じ刻みに合わせる。 */
  const bump = (key: keyof SegmentSetting, delta: number) => {
    const row = SEGMENT_ROWS.find((r) => r.key === key);
    setSetting((prev) => {
      const raw = prev[key] + delta;
      const clamped = Math.min(row?.max ?? raw, Math.max(row?.min ?? 0, raw));
      return { ...prev, [key]: Math.round(clamped * 2) / 2 };
    });
  };

  const positionMs = seeking ?? status?.positionMs ?? 0;
  const durationMs = status?.durationMs ?? 0;
  const preview = durationMs > 0 ? resolveSegment(durationMs / 1000, setting) : null;

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

      <FlatList
        ref={listRef}
        data={queue}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        windowSize={11}
        getItemLayout={(_, index) => ({
          length: QUEUE_ROW_HEIGHT,
          offset: QUEUE_ROW_HEIGHT * index,
          index,
        })}
        renderItem={({ item, index }) => (
          <QueueRow
            track={item}
            index={index}
            active={status?.index === index}
            onPress={() => skipTo(index)}
          />
        )}
        ListHeaderComponent={
          <View style={styles.body}>
            <Pressable
              disabled={!currentTrack?.album}
              onPress={() =>
                router.push({
                  pathname: '/album/[id]',
                  params: {
                    // アルバムIDは持っていないのでタイトルで辿る。
                    // アルバム詳細側がIDで引けない場合の経路を持っている
                    id: currentTrack?.album ?? '',
                    title: currentTrack?.album ?? '',
                    artist: currentTrack?.artist ?? '',
                  },
                })
              }
            >
              <Artwork uri={currentTrack?.artworkUri} size={width - 40} radius={14} />
            </Pressable>

            <View style={styles.meta}>
              <Text style={styles.title} numberOfLines={2}>
                {currentTrack?.title ?? '再生していません'}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {currentTrack?.artist ?? ''}
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
                onValueChange={setSeeking}
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

            <View style={styles.modeRow}>
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

              {/* RUSH を切らずに、この曲だけ通しで聴きたいとき */}
              {rushOn && (
                <Pressable
                  style={[styles.oneShot, status?.fullPlayback && styles.oneShotOn]}
                  onPress={playCurrentToEnd}
                  disabled={status?.fullPlayback}
                >
                  <Text
                    style={[
                      styles.oneShotLabel,
                      status?.fullPlayback && styles.oneShotLabelOn,
                    ]}
                  >
                    {status?.fullPlayback ? 'この曲は最後まで' : 'この曲だけ最後まで'}
                  </Text>
                  <Text style={styles.rushHint}>
                    {status?.fullPlayback ? '次の曲から元に戻ります' : 'RUSH はそのまま'}
                  </Text>
                </Pressable>
              )}
            </View>

            {rushOn && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>区間設定</Text>
                {SEGMENT_ROWS.map((row) => (
                  <View key={row.key} style={styles.segmentRow}>
                    <View style={styles.segmentHead}>
                      <Text style={styles.segmentLabel}>{row.label}</Text>
                      <View style={styles.steppers}>
                        <Pressable
                          style={styles.stepper}
                          hitSlop={6}
                          onPress={() => bump(row.key, -row.step)}
                        >
                          <Text style={styles.stepperText}>−</Text>
                        </Pressable>
                        <Text style={styles.segmentValue}>
                          {(dragging[row.key] ?? setting[row.key]).toFixed(1)}s
                        </Text>
                        <Pressable
                          style={styles.stepper}
                          hitSlop={6}
                          onPress={() => bump(row.key, row.step)}
                        >
                          <Text style={styles.stepperText}>＋</Text>
                        </Pressable>
                      </View>
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
                      onValueChange={(value) =>
                        setDragging((prev) => ({ ...prev, [row.key]: value }))
                      }
                      onSlidingComplete={(value) => {
                        setSetting((prev) => ({ ...prev, [row.key]: value }));
                        setDragging((prev) => {
                          const rest = { ...prev };
                          delete rest[row.key];
                          return rest;
                        });
                      }}
                    />
                  </View>
                ))}
                {preview && (
                  <Text style={styles.previewText}>
                    この曲での実効区間 {preview.start.toFixed(1)}〜
                    {preview.end.toFixed(1)}s{'\n'}
                    fadeIn {preview.fadeIn.toFixed(1)}s / fadeOut{' '}
                    {preview.fade.toFixed(1)}s
                  </Text>
                )}
                <Text style={styles.note}>
                  開始位置と再生時間の変更は次の曲から反映されます
                </Text>
              </View>
            )}

            {queue.length > 0 && (
              <View style={styles.queueHeader}>
                <Text style={styles.queueHeaderTitle}>再生キュー {queue.length}曲</Text>
                <View style={styles.queueHeaderActions}>
                  <Pressable
                    style={styles.queueHeaderButton}
                    hitSlop={6}
                    onPress={() =>
                      listRef.current?.scrollToOffset({ offset: 0, animated: true })
                    }
                  >
                    <Text style={styles.queueHeaderAction}>先頭へ</Text>
                  </Pressable>
                  {status && status.index >= 0 && (
                    <Pressable
                      style={styles.queueHeaderButton}
                      hitSlop={6}
                      onPress={() =>
                        listRef.current?.scrollToIndex({
                          index: status.index,
                          viewPosition: 0.3,
                          animated: true,
                        })
                      }
                    >
                      <Text style={styles.queueHeaderAction}>再生中へ</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </View>
        }
      />
    </View>
  );
}

function QueueRow({
  track,
  index,
  active,
  onPress,
}: {
  track: Track;
  index: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.queueRow, active && styles.queueRowActive]} onPress={onPress}>
      <Text style={[styles.queueIndex, active && styles.queueTextActive]}>
        {index + 1}
      </Text>
      <Artwork uri={track.artworkUri} size={38} />
      <View style={styles.queueText}>
        <Text
          style={[styles.queueTitle, active && styles.queueTextActive]}
          numberOfLines={1}
        >
          {track.title}
        </Text>
        <Text style={styles.queueArtist} numberOfLines={1}>
          {track.artist}
        </Text>
      </View>
      <Text style={styles.queueDuration}>{formatDuration(track.durationMs)}</Text>
    </Pressable>
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
  listContent: { paddingBottom: 32 },
  body: { padding: 20, paddingBottom: 4, gap: 20 },
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
  modeRow: { flexDirection: 'row', gap: 10 },
  rush: { flex: 1, borderRadius: 12, padding: 14, gap: 2, borderWidth: 1 },
  oneShot: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  oneShotOn: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  oneShotLabel: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  oneShotLabelOn: { color: colors.text },
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
  segmentValue: { color: colors.text, fontSize: 12, width: 44, textAlign: 'center' },
  segmentSlider: { width: '100%', height: 32 },
  previewText: { color: colors.textDim, fontSize: 11, lineHeight: 17 },
  note: { color: colors.textDim, fontSize: 10 },
  queueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  queueHeaderTitle: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  queueHeaderActions: { flexDirection: 'row', gap: 6 },
  queueHeaderButton: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  queueHeaderAction: { color: colors.text, fontSize: 11 },
  steppers: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepper: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  queueRow: {
    height: QUEUE_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },
  queueRowActive: { backgroundColor: colors.surface },
  queueIndex: { color: colors.textDim, fontSize: 11, width: 34 },
  queueText: { flex: 1 },
  queueTitle: { color: colors.text, fontSize: 13 },
  queueArtist: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  queueDuration: { color: colors.textDim, fontSize: 11 },
  queueTextActive: { color: colors.accent, fontWeight: '700' },
});
