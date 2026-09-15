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

import { colors } from '../src/theme';

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
        containerBackground(colors.background, 'widget'),
        widgetURL('retracks://player'),
      ]}
    >
      {content}
    </VStack>
  );
}

export default createWidget('NowPlayingWidget', NowPlayingWidget);
