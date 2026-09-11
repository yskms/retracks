import { useCallback, useState } from 'react';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet } from 'react-native';

import '../src/i18n';
import { SettingsProvider } from '../src/settings';
import { PlaybackProvider } from '../src/playback';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { SplashFade } from '../src/components/SplashFade';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true);
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
                  <Stack.Screen name="artist/[id]" />
                  <Stack.Screen name="album/[id]" />
                </Stack>
                <MiniPlayerSlot />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
});
