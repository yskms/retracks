import { Platform } from 'react-native';
import { TestIds } from 'react-native-google-mobile-ads';

/**
 * 広告ユニットID。AdMobコンソールで作成済みのバナー広告ユニット（"Banner"、
 * Android/iOSそれぞれ別アプリ・別広告ユニットとして登録済み）。
 *
 * 開発ビルドではGoogle公式のテスト広告ユニットIDを使う。本番ビルドで実際の広告を
 * 誤タップするとAdMob側のポリシー違反になるため、必ず__DEV__で分岐する。
 */
const AD_UNIT_ID_ANDROID = 'ca-app-pub-7366086915275961/6086419785';
const AD_UNIT_ID_IOS = 'ca-app-pub-7366086915275961/6593166720';

export const AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : Platform.select({ ios: AD_UNIT_ID_IOS, default: AD_UNIT_ID_ANDROID });
