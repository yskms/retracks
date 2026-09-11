/**
 * プレイヤー画面（要件 10.2）。
 * 再生操作、RUSH の区間設定、再生キューをここに集約する。
 */

import { memo, useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { usePlayback, usePlaybackStatus } from '../src/playback';
import { RepeatMode } from '../modules/retracks-player/src';
import type { Track } from '../src/library';
import { resolveSegment, type SegmentSetting } from '../src/rush';
import { colors, formatDuration } from '../src/theme';
import { Artwork } from '../src/components/Artwork';

type SegmentLabelKey =
  | 'player.segmentStart'
  | 'player.segmentLength'
  | 'player.segmentFadeIn'
  | 'player.segmentFadeOut';

const SEGMENT_ROWS: {
  key: keyof SegmentSetting;
  labelKey: SegmentLabelKey;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'startSec', labelKey: 'player.segmentStart', min: 0, max: 180, step: 1 },
  { key: 'lengthSec', labelKey: 'player.segmentLength', min: 5, max: 180, step: 1 },
  { key: 'fadeInSec', labelKey: 'player.segmentFadeIn', min: 0, max: 10, step: 0.5 },
  { key: 'fadeSec', labelKey: 'player.segmentFadeOut', min: 0, max: 10, step: 0.5 },
];

/** キューの行の高さ。scrollToIndex を正確に効かせるため固定する。 */
const QUEUE_ROW_HEIGHT = 54;

/**
 * 再生位置のシークバー。250msごとの再生位置更新のたびに PlayerScreen 全体が
 * 再レンダーされる（→ usePlaybackStatus()）ため、React.memo で包んで
 * props が実際に変わっていないときは再レンダーしないようにする。
 *
 * 直接 <Slider> を使っていたときは、value が同じでも毎レンダーごとに
 * ネイティブ側の処理が走り、ネイティブヒープが再生中ずっと増え続けて
 * OSに強制終了される不具合があった（2026-09-11、実機で確認）。
 */
const PositionSlider = memo(function PositionSlider({
  value,
  maximumValue,
  onValueChange,
  onSlidingComplete,
}: {
  value: number;
  maximumValue: number;
  onValueChange: (value: number) => void;
  onSlidingComplete: (value: number) => void;
}) {
  return (
    <Slider
      style={styles.seek}
      minimumValue={0}
      maximumValue={maximumValue}
      value={value}
      minimumTrackTintColor={colors.accent}
      maximumTrackTintColor={colors.border}
      thumbTintColor={colors.accent}
      onValueChange={onValueChange}
      onSlidingComplete={onSlidingComplete}
    />
  );
});

type RepeatLabelKey = 'player.repeatOff' | 'player.repeatAll' | 'player.repeatOne';

/** 読み上げ用のリピートの状態名（キー）。 */
const REPEAT_LABEL_KEY: Record<number, RepeatLabelKey> = {
  [RepeatMode.Off]: 'player.repeatOff',
  [RepeatMode.All]: 'player.repeatAll',
  [RepeatMode.One]: 'player.repeatOne',
};

export default function PlayerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    currentTrack,
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
    playCurrentFromStart,
    repeatMode,
    cycleRepeat,
  } = usePlayback();
  const status = usePlaybackStatus();

  const listRef = useRef<FlatList<Track>>(null);
  const { width } = useWindowDimensions();

  // scrollToIndex は getItemLayout の offset をそのまま使う。ヘッダー
  // （プレイヤーUI）の高さを足しておかないと、まだ描画されていない行では
  // ヘッダー分まるごと手前で止まる。実測して足す。
  const [headerHeight, setHeaderHeight] = useState(0);

  // キューのバーが画面上端を通り過ぎたら、貼り付けた同じバーに差し替える
  const [barTop, setBarTop] = useState(0);
  const [pinned, setPinned] = useState(false);
  const pinnedRef = useRef(false);

  const jumpToTop = () => listRef.current?.scrollToOffset({ offset: 0, animated: true });
  const jumpToCurrent = () => {
    if (!status || status.index < 0) return;
    listRef.current?.scrollToIndex({
      index: status.index,
      viewPosition: 0.3,
      animated: true,
    });
  };

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

  // Slider の value を短い間隔でそのまま更新すると、ネイティブ側（
  // @react-native-community/slider）の描画コストが実機でネイティブヒープを
  // 分単位でGB級まで増やし続け、OSに強制終了される不具合につながった
  // （2026-09-11）。曲名や時刻表示は秒単位でしか見えないので、精度を落とさず
  // 秒単位に丸めて Slider への value 変化を間引く。ポーリング自体を
  // 250ms→1秒にした（src/playback.tsx）ため今は実質的に冗長だが、将来
  // ポーリングを速める変更をしたときの保険として残している。「二重にやって
  // いる」ように見えても消さないこと。
  const positionMs = seeking ?? (status ? Math.floor(status.positionMs / 1000) * 1000 : 0);
  const durationMs = status?.durationMs ?? 0;
  const preview = durationMs > 0 ? resolveSegment(durationMs / 1000, setting) : null;

  const handleSeekComplete = useCallback(
    (value: number) => {
      seekTo(value);
      setSeeking(null);
    },
    [seekTo]
  );

  // renderItem に status をまるごと渡すと、250msごとの再生位置更新のたびに
  // 関数の参照が変わり、キュー内の表示中の行（initialNumToRender/windowSize
  // 分、数十行）が丸ごと再レンダーされ続けてしまう（2026-09-11、実機で
  // ネイティブヒープが再生中ずっと増え続ける不具合の主因の一つと判明）。
  // 実際に必要なのは currentIndex（プリミティブ）だけなので、それだけを
  // 依存にして、曲が切り替わったとき以外は renderItem の参照を固定する。
  const currentIndex = status?.index ?? -1;
  // QueueRow へ渡す onPress もここで1つに固定する。インラインで
  // (index) => () => skipTo(index) のように行ごとに新しい関数を作ると、
  // QueueRow 側の React.memo が onPress の変化で毎回失敗してしまう。
  const handleQueuePress = useCallback((index: number) => skipTo(index), [skipTo]);
  const renderQueueItem = useCallback(
    ({ item, index }: { item: Track; index: number }) => (
      <QueueRow
        track={item}
        index={index}
        active={currentIndex === index}
        onPress={handleQueuePress}
      />
    ),
    [currentIndex, handleQueuePress]
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>▾</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {progress
            ? t('player.roundProgress', { played: progress.played, total: progress.total })
            : t('player.nowPlayingHeader')}
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
          offset: headerHeight + QUEUE_ROW_HEIGHT * index,
          index,
        })}
        scrollEventThrottle={16}
        onScroll={(e) => {
          // バーの貼り付きが切り替わる瞬間だけ描画し直す
          const shouldPin = e.nativeEvent.contentOffset.y >= barTop;
          if (shouldPin !== pinnedRef.current) {
            pinnedRef.current = shouldPin;
            setPinned(shouldPin);
          }
        }}
        renderItem={renderQueueItem}
        ListHeaderComponent={
          <View
            style={styles.body}
            onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
          >
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
                {currentTrack?.title ?? t('player.noTrack')}
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
              <PositionSlider
                value={positionMs}
                maximumValue={Math.max(durationMs, 1)}
                onValueChange={setSeeking}
                onSlidingComplete={handleSeekComplete}
              />
              <View style={styles.times}>
                <Text style={styles.time}>{formatDuration(positionMs)}</Text>
                <Text style={styles.time}>{formatDuration(durationMs)}</Text>
              </View>
            </View>

            <View style={styles.controls}>
              <Pressable
                style={styles.control}
                onPress={cycleRepeat}
                hitSlop={10}
                accessibilityLabel={t('player.repeatA11y', {
                  label: REPEAT_LABEL_KEY[repeatMode] ? t(REPEAT_LABEL_KEY[repeatMode]) : '',
                })}
              >
                <Image
                  source={
                    repeatMode === RepeatMode.One
                      ? require('../assets/ic-repeat-one.png')
                      : require('../assets/ic-repeat.png')
                  }
                  style={[
                    styles.repeatIcon,
                    {
                      tintColor:
                        repeatMode === RepeatMode.Off ? colors.textDim : colors.accent,
                    },
                  ]}
                />
              </Pressable>
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
              {/* 左のリピートと釣り合わせ、再生ボタンを画面の中心に置く */}
              <View style={styles.controlSpacer} />
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
                  {rushOn ? t('player.rushHintOn') : t('player.rushHintOff')}
                </Text>
              </Pressable>

              {/* RUSH を切らずに、この曲だけ通しで聴きたいとき */}
              {rushOn && (
                <Pressable
                  style={[styles.oneShot, status?.fullPlayback && styles.oneShotOn]}
                  onPress={playCurrentFromStart}
                  disabled={status?.fullPlayback}
                >
                  <View style={styles.oneShotHead}>
                    {/* ウィジェットの同じ操作と同じ絵にして、見て分かるようにする */}
                    <Image
                      source={require('../assets/ic-fulltrack.png')}
                      style={[
                        styles.oneShotIcon,
                        {
                          tintColor: status?.fullPlayback ? colors.text : colors.textDim,
                        },
                      ]}
                    />
                    <Text
                      style={[
                        styles.oneShotLabel,
                        status?.fullPlayback && styles.oneShotLabelOn,
                      ]}
                    >
                      {status?.fullPlayback
                        ? t('player.oneShotActiveLabel')
                        : t('player.oneShotLabel')}
                    </Text>
                  </View>
                  <Text style={styles.rushHint}>
                    {status?.fullPlayback
                      ? t('player.oneShotHintActive')
                      : t('player.oneShotHint')}
                  </Text>
                </Pressable>
              )}
            </View>

            {rushOn && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('player.segmentCardTitle')}</Text>
                {SEGMENT_ROWS.map((row) => (
                  <View key={row.key} style={styles.segmentRow}>
                    <View style={styles.segmentHead}>
                      <Text style={styles.segmentLabel}>{t(row.labelKey)}</Text>
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
                    {t('player.previewText', {
                      start: preview.start.toFixed(1),
                      end: preview.end.toFixed(1),
                      fadeIn: preview.fadeIn.toFixed(1),
                      fade: preview.fade.toFixed(1),
                    })}
                  </Text>
                )}
                <Text style={styles.note}>{t('player.segmentNote')}</Text>
              </View>
            )}

            {queue.length > 0 && (
              <View onLayout={(e) => setBarTop(e.nativeEvent.layout.y)}>
                <QueueBar
                  count={queue.length}
                  showCurrent={!!status && status.index >= 0}
                  onTop={jumpToTop}
                  onCurrent={jumpToCurrent}
                />
              </View>
            )}
          </View>
        }
      />

      {/* 上端に貼り付いたバー。中身は一覧の中のものと同じ */}
      {pinned && queue.length > 0 && (
        <View style={styles.queueBarPinned}>
          <QueueBar
            count={queue.length}
            showCurrent={!!status && status.index >= 0}
            onTop={jumpToTop}
            onCurrent={jumpToCurrent}
          />
        </View>
      )}
    </View>
  );
}

/** 再生キューの見出しと移動ボタン。一覧の中と、上端に貼り付いたときの両方で使う。 */
function QueueBar({
  count,
  showCurrent,
  onTop,
  onCurrent,
}: {
  count: number;
  showCurrent: boolean;
  onTop: () => void;
  onCurrent: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.queueHeader}>
      <Text style={styles.queueHeaderTitle}>{t('player.queueTitle', { count })}</Text>
      <View style={styles.queueHeaderActions}>
        <Pressable style={styles.queueHeaderButton} hitSlop={6} onPress={onTop}>
          <Text style={styles.queueHeaderAction}>{t('player.jumpToTop')}</Text>
        </Pressable>
        {showCurrent && (
          <Pressable style={styles.queueHeaderButton} hitSlop={6} onPress={onCurrent}>
            <Text style={styles.queueHeaderAction}>{t('player.jumpToCurrent')}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const QueueRow = memo(function QueueRow({
  track,
  index,
  active,
  onPress,
}: {
  track: Track;
  index: number;
  active: boolean;
  // index を受け取って親（安定した1つの useCallback）へ渡す形にしている。
  // ここが onPress: () => void で「onPress={() => skipTo(index)}」のように
  // 行ごと・レンダーごとに新しい関数を親から渡されると、React.memo の浅い
  // 比較が毎回失敗し、このコンポーネントが memo 化されていないのと同じに
  // なる（2026-09-11、表示中の十数行が毎秒まるごと再レンダーされる原因の
  // 一つだった）。
  onPress: (index: number) => void;
}) {
  return (
    <Pressable
      style={[styles.queueRow, active && styles.queueRowActive]}
      onPress={() => onPress(index)}
    >
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
});

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
  queueBarPinned: {
    position: 'absolute',
    top: 48,
    left: 0,
    right: 0,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
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
    gap: 20,
  },
  control: { padding: 12 },
  controlSpacer: { width: 48 },
  controlGlyph: { color: colors.text, fontSize: 22 },
  /**
   * リピートの記号。↻ は「やり直し」に読めて「この曲を最初から」と紛らわしいので、
   * ウィジェットと同じ Material のループ記号を使う（assets/ic-repeat*.png）。
   */
  repeatIcon: { width: 24, height: 24, opacity: 0.9 },
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
  oneShotHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  oneShotIcon: { width: 15, height: 15 },
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
  queueHeaderActions: { flexDirection: 'row', gap: 10 },
  queueHeaderButton: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
  },
  queueHeaderAction: { color: colors.text, fontSize: 13, fontWeight: '600' },
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
