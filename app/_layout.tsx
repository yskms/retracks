import { useCallback, useEffect, useState } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { View, StyleSheet } from 'react-native';

import '../src/i18n';
import { SettingsProvider } from '../src/settings';
import { PlaybackProvider } from '../src/playback';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { AdBanner } from '../src/components/AdBanner';
import { SplashFade } from '../src/components/SplashFade';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { colors } from '../src/theme';
import { initAds } from '../src/adInit';
import { initPurchases } from '../src/purchases';

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);

  // 広告SDKの初期化。EEA/UKユーザーへの同意フォーム表示を含むため、なるべく早い
  // タイミングで開始する（圏外のユーザーには何も表示されない）。内部で失敗を
  // 握って false を返すので、ここでの reject はない。iOS版はadInit.ios.tsの
  // no-opフォールバックが解決される
  useEffect(() => {
    initAds();
  }, []);

  // 課金SDK(RevenueCat)の初期化。iOS版はpurchases.ios.tsのno-opフォールバックが解決される
  useEffect(() => {
    initPurchases();
  }, []);

  // インラインの () => setShowSplash(false) だと毎レンダーで新しい関数になり、
  // SplashFade 側の effect（フェード開始）が依存に持っている。RootLayout が
  // 再レンダーされないうちは実害が無いが、将来ここに state が増えたときに
  // フェード中の再実行でアニメーションが中断されないよう固定しておく。
  const hideSplash = useCallback(() => setShowSplash(false), []);

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <SettingsProvider>
            <PlaybackProvider>
              <StatusBar style="light" />
              <View style={styles.root}>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.background },
                    animation: 'slide_from_right',
                  }}
                >
                  <Stack.Screen name="index" />
                  <Stack.Screen name="player" options={{ animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="search" />
                  <Stack.Screen name="settings" />
                  <Stack.Screen name="excluded-folders" />
                  <Stack.Screen name="debug" />
                  <Stack.Screen name="pro" />
                  <Stack.Screen name="artist/[id]" />
                  <Stack.Screen name="album/[id]" />
                </Stack>
                <BottomBar />
              </View>
              {showSplash && <SplashFade onDone={hideSplash} />}
            </PlaybackProvider>
          </SettingsProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

/** ミニプレイヤーは全画面共通で出す（要件 10.5）。プレイヤー画面では隠す。 */
function MiniPlayerSlot() {
  const pathname = usePathname();
  if (pathname === '/player') return null;
  return <MiniPlayer />;
}

// バナー広告を隠す画面。プレイヤー画面はミニプレイヤーと同じ理由、
// pro画面は購入導線に広告を出す必然性が無いため
const HIDE_AD_BANNER_PATHS = ['/player', '/pro'];

/**
 * バナー広告はミニプレイヤーの上（頻繁にタップする再生/次への操作の
 * すぐ下に置くと誤タップを誘発するため）に、全画面共通で出す。
 */
function AdBannerSlot() {
  const pathname = usePathname();
  if (HIDE_AD_BANNER_PATHS.includes(pathname)) return null;
  return <AdBanner />;
}

/**
 * 画面下部固定のAdBanner/MiniPlayerをまとめ、システムナビゲーションバー分の
 * bottom insetを確保する。Android edge-to-edge（Expo SDK 54〜のデフォルト）では
 * コンテンツがナビゲーションバーの裏まで描画されるため、3ボタンナビゲーション
 * 端末ではこれが無いと広告・ミニプレイヤーがナビゲーションバーと重なる。
 */
function BottomBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.background }}>
      <AdBannerSlot />
      <MiniPlayerSlot />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
