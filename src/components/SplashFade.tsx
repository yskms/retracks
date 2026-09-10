/**
 * ネイティブのスプラッシュから、フェードでアプリ画面へつなぐオーバーレイ。
 *
 * Android 12+ のスプラッシュAPIは端末によってアイコンの退場アニメーションが
 * 不安定で、ロゴが二重に見えることがある（2026-09-10 実機で確認）。JS側の
 * アニメーションを選べる設定は無いため、ネイティブのスプラッシュは即座に隠し、
 * 同じ見た目のこのビューをフェードアウトさせることで、狙った通りの
 * 「画面全体がフェードしてアプリが出てくる」体験に差し替える。
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Appearance, Image, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

void SplashScreen.preventAutoHideAsync();

const LIGHT_BACKGROUND = '#FFFFFF';
const DARK_BACKGROUND = '#050505';
const FADE_MS = 400;

export function SplashFade({ onDone }: { onDone: () => void }) {
  // useColorScheme() は初回レンダーで null を返すことがあり、それだと
  // ダークモードの端末でもライト背景で描画されてしまう（ネイティブの
  // スプラッシュは values-night で正しく黒なのに、切り替わった瞬間だけ
  // 白くなって見える）。Appearance から同期的に取得して回避する。
  const [scheme] = useState(() => Appearance.getColorScheme());
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // ネイティブのスプラッシュを消した瞬間、見た目が同じこのビューに
    // 差し替わるだけなので体感の変化はない。ここから先はJSが制御する。
    void SplashScreen.hideAsync();

    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start(onDone);
  }, [opacity, onDone]);

  return (
    <Animated.View
      // フェード中もタップを受け止める。消えるまでは下の画面へ抜けさせない。
      pointerEvents="auto"
      style={[
        styles.root,
        {
          opacity,
          backgroundColor: scheme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND,
        },
      ]}
    >
      <Image
        source={require('../../assets/splash-icon.png')}
        style={styles.logo}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
  },
  // app.json の expo-splash-screen プラグイン設定（imageWidth）と揃えている。
  // 共有の定数は無いので、どちらかを変えたらもう一方も直すこと。
  logo: { width: 100, height: 100 },
});
