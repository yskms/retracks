import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, StyleSheet } from 'react-native';

import { PlaybackProvider } from '../src/playback';
import { MiniPlayer } from '../src/components/MiniPlayer';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
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
              <Stack.Screen name="debug" />
              <Stack.Screen name="artist/[id]" />
              <Stack.Screen name="album/[id]" />
            </Stack>
            <MiniPlayerSlot />
          </View>
        </PlaybackProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
