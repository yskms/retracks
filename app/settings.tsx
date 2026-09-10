/**
 * 設定画面（要件 10.6）。
 *
 * デバッグ画面と違い、こちらは製品として公開する画面。
 * 今回実装するのは優先度の低いコストで作れる3点だけ：
 * 短い曲の除外、並べ替え時の冠詞無視、言語の手動切り替え。
 * タブのオンオフ・並べ替えや除外フォルダは次のフェーズで追加する。
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES } from '../src/i18n';
import { THRESHOLD_BOUNDS, useSettings, type LanguagePreference } from '../src/settings';
import { colors } from '../src/theme';

const LANGUAGE_LABEL_KEY = {
  auto: 'settings.languageAuto',
  ja: 'settings.languageJa',
  en: 'settings.languageEn',
} as const satisfies Record<LanguagePreference, string>;

const LANGUAGE_OPTIONS: LanguagePreference[] = ['auto', ...SUPPORTED_LANGUAGES];

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    language,
    excludeShortTracks,
    shortTrackThresholdSec,
    ignoreLeadingThe,
    ignoreLeadingAAn,
    setLanguage,
    setExcludeShortTracks,
    setShortTrackThresholdSec,
    setIgnoreLeadingThe,
    setIgnoreLeadingAAn,
  } = useSettings();

  // ＋／－の表示は毎タップ即座に動かし、実際の適用（曲一覧の絞り込み再計算・
  // 保存）は操作が落ち着いてからにする。連打のたびに1000曲超の一覧を
  // 並べ替え直すと重く、タップ自体が拾われないことがあった
  // （区間設定の連打対策 → src/playback.tsx と同じ考え方）。
  //
  // 値は ref で持つ。state（displayThreshold）だけを見て積み上げる実装だと、
  // 連打の間隔が再レンダーより短いとき、まだ古い値を閉じ込めたままの
  // onPress が呼ばれてしまい、タップした数より加算が少ないことがあった。
  const [displayThreshold, setDisplayThreshold] = useState(shortTrackThresholdSec);
  const displayThresholdRef = useRef(shortTrackThresholdSec);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    displayThresholdRef.current = shortTrackThresholdSec;
    setDisplayThreshold(shortTrackThresholdSec);
  }, [shortTrackThresholdSec]);

  useEffect(() => {
    return () => {
      // タイマーが残っている＝保留中の変更がある状態。単に捨てると、
      // ＋を押した直後に画面を離れたときだけ変更が保存されない。
      // 保留中の値を即座にコミットしてから片付ける。
      if (commitTimer.current) {
        clearTimeout(commitTimer.current);
        setShortTrackThresholdSec(displayThresholdRef.current);
      }
    };
  }, [setShortTrackThresholdSec]);

  const nudgeThreshold = (delta: number) => {
    const next = Math.min(
      THRESHOLD_BOUNDS.max,
      Math.max(THRESHOLD_BOUNDS.min, displayThresholdRef.current + delta)
    );
    displayThresholdRef.current = next;
    setDisplayThreshold(next);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      setShortTrackThresholdSec(next);
    }, 300);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.headerIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.languageSectionTitle')}</Text>
          <View style={styles.segmented}>
            {LANGUAGE_OPTIONS.map((option) => (
              <Pressable
                key={option}
                style={[styles.segment, language === option && styles.segmentActive]}
                onPress={() => setLanguage(option)}
              >
                <Text
                  style={[styles.segmentText, language === option && styles.segmentTextActive]}
                >
                  {t(LANGUAGE_LABEL_KEY[option])}
                </Text>
              </Pressable>
            ))}
          </View>
          {language !== 'auto' && (
            <Text style={styles.rowHint}>{t('settings.languageWidgetHint')}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.filterSectionTitle')}</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.excludeShortTracks')}</Text>
              <Text style={styles.rowHint}>{t('settings.excludeShortTracksHint')}</Text>
            </View>
            <Switch
              value={excludeShortTracks}
              onValueChange={setExcludeShortTracks}
              trackColor={{ true: colors.accentDim, false: colors.surfaceHigh }}
              thumbColor={excludeShortTracks ? colors.accent : colors.textDim}
            />
          </View>
          {excludeShortTracks && (
            <View style={styles.stepperRow}>
              <Pressable
                style={[
                  styles.stepperButton,
                  displayThreshold <= THRESHOLD_BOUNDS.min && styles.stepperButtonDisabled,
                ]}
                hitSlop={10}
                disabled={displayThreshold <= THRESHOLD_BOUNDS.min}
                accessibilityLabel={t('settings.thresholdDecreaseA11y')}
                onPress={() => nudgeThreshold(-THRESHOLD_BOUNDS.step)}
              >
                <Text style={styles.stepperButtonText}>−</Text>
              </Pressable>
              <Text style={styles.stepperValue}>
                {t('settings.thresholdLabel', { sec: displayThreshold })}
              </Text>
              <Pressable
                style={[
                  styles.stepperButton,
                  displayThreshold >= THRESHOLD_BOUNDS.max && styles.stepperButtonDisabled,
                ]}
                hitSlop={10}
                disabled={displayThreshold >= THRESHOLD_BOUNDS.max}
                accessibilityLabel={t('settings.thresholdIncreaseA11y')}
                onPress={() => nudgeThreshold(THRESHOLD_BOUNDS.step)}
              >
                <Text style={styles.stepperButtonText}>＋</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.sortSectionTitle')}</Text>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.ignoreLeadingThe')}</Text>
              <Text style={styles.rowHint}>{t('settings.ignoreLeadingTheHint')}</Text>
            </View>
            <Switch
              value={ignoreLeadingThe}
              onValueChange={setIgnoreLeadingThe}
              trackColor={{ true: colors.accentDim, false: colors.surfaceHigh }}
              thumbColor={ignoreLeadingThe ? colors.accent : colors.textDim}
            />
          </View>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{t('settings.ignoreLeadingAAn')}</Text>
              <Text style={styles.rowHint}>{t('settings.ignoreLeadingAAnHint')}</Text>
            </View>
            <Switch
              value={ignoreLeadingAAn}
              onValueChange={setIgnoreLeadingAAn}
              trackColor={{ true: colors.accentDim, false: colors.surfaceHigh }}
              thumbColor={ignoreLeadingAAn ? colors.accent : colors.textDim}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('settings.developerSectionTitle')}</Text>
          <Pressable style={styles.button} onPress={() => router.push('/debug')}>
            <Text style={styles.buttonText}>{t('settings.openDebug')}</Text>
          </Pressable>
        </View>
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
  headerIcon: { color: colors.text, fontSize: 18 },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 12 },
  cardTitle: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 14 },
  rowHint: { color: colors.textDim, fontSize: 12 },
  segmented: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.surfaceHigh,
  },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#1a1206' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingTop: 4,
  },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { opacity: 0.35 },
  stepperButtonText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  stepperValue: { color: colors.text, fontSize: 13, fontWeight: '600', minWidth: 120, textAlign: 'center' },
  button: {
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
