import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  background,
  clipped,
  containerBackground,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  padding,
  resizable,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/**
 * iOSホーム画面ウィジェット（表示専用・v1）。
 *
 * 再生操作は持たない（Lock Screen / Control Centerの標準操作で足りるため）。
 * Androidウィジェット（RetracksWidgetProvider.kt）とは別実装だが、配色は
 * 揃えている。ウィジェットは独立したランタイムで動きi18nextを使えないため、
 * 曲名・アーティスト名（再生していない場合はidle文言）はJS側
 * （src/widgetSync.ios.ts）で言語設定を解決した上でpropsとして渡す。
 */
export type NowPlayingWidgetProps = {
  title: string;
  artist: string;
  /** widgetsDirectory配下に書き出したアートワークのfile://パス。無ければプレースホルダ表示 */
  artworkPath?: string;
};

function NowPlayingWidget(props: NowPlayingWidgetProps, environment: WidgetEnvironment) {
  'widget';

  // 'widget'ディレクティブ付き関数は、babel-preset-expoのwidgets-pluginによって
  // 関数本体だけがソース文字列化され（クロージャ捕捉もスコープ巻き上げも無し）、
  // ネイティブ側でJSContextに単独evaluateされる。importやモジュールスコープの
  // 定数はこの文字列に含まれず参照できない（2026-09-24、実機で
  // ReferenceError（Can't find variable: colors）を確認。関数の外に定義していた
  // ことが、ウィジェットが常に真っ黒だった本当の原因だった）。そのため
  // colorsは関数の中だけで完結させる必要がある。値はsrc/theme.tsのcolorsと揃えること。
  const colors = {
    background: '#121216',
    text: '#f2f2f5',
    textDim: '#9a9aa8',
    surfaceHigh: '#26262e',
  } as const;

  const isMedium = environment.widgetFamily === 'systemMedium';
  // systemSmall（2x2）は正方形に近いのでアートワークを大きめの正方形に、
  // systemMedium（4x2）は左に小さめの正方形＋右にテキストという横並び
  const artworkSide = isMedium ? 64 : 96;

  const artwork = props.artworkPath ? (
    <Image
      uiImage={props.artworkPath}
      modifiers={[
        resizable(),
        aspectRatio({ contentMode: 'fill' }),
        frame({ width: artworkSide, height: artworkSide }),
        clipped(),
        cornerRadius(8),
      ]}
    />
  ) : (
    <Image
      systemName="music.note"
      color={colors.textDim}
      modifiers={[
        frame({ width: artworkSide, height: artworkSide }),
        background(colors.surfaceHigh),
        cornerRadius(8),
      ]}
    />
  );

  const texts = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(colors.text)]}>
        {props.title}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(colors.textDim)]}>
        {props.artist}
      </Text>
    </VStack>
  );

  const content = isMedium ? (
    <HStack spacing={10} alignment="center">
      {artwork}
      {texts}
    </HStack>
  ) : (
    <VStack alignment="leading" spacing={8}>
      {artwork}
      {texts}
    </VStack>
  );

  return (
    <VStack
      modifiers={[
        padding({ all: 12 }),
        frame({ maxWidth: Infinity, maxHeight: Infinity }),
        // containerBackgroundは@expo/uiの現行実装ではiOS 17未満で何もせず、iOS 16実機
        // （iPhone 8）でウィジェットが背景無し＝黒塗りになった（2026-09-24確認）。
        // background()を併用してiOS 17未満でも背景を効かせる。
        // 注意: この2つは常に同じ色でセットにすること。containerBackgroundは
        // frame(Infinity)の外側（iOS 17+の既定content margins分）まで塗るが、
        // background()はframeの内側までしか塗らないため、片方だけ外したり違う色に
        // すると iOS 17+ で縁だけ違う色になる。
        // 未確認: iOS 18のTinted/StandBy表示でbackground()の不透明な塗りが
        // どう見えるか（containerBackgroundが本来担うはずの背景差し替えができない）。
        // 検証できるiOS 18実機/シミュレータが無いため未確認のまま。
        // このbackground()自体はiOS 17未満のための回避なので、将来
        // deployment targetをiOS 17以上に上げたら削除してよい。
        background(colors.background),
        containerBackground(colors.background, 'widget'),
        widgetURL('retracks://player'),
      ]}
    >
      {content}
    </VStack>
  );
}

export default createWidget('NowPlayingWidget', NowPlayingWidget);
