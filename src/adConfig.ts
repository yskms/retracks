import { TestIds } from 'react-native-google-mobile-ads';

/**
 * 広告ユニットID（Android専用。iOSはまだ導入していない → adInit.ios.ts）。
 * AdMobコンソールで作成済みのバナー広告ユニット（"Banner"）。
 *
 * 開発ビルドではGoogle公式のテスト広告ユニットIDを使う。本番ビルドで実際の広告を
 * 誤タップするとAdMob側のポリシー違反になるため、必ず__DEV__で分岐する。
 */
export const AD_UNIT_ID = __DEV__ ? TestIds.BANNER : 'ca-app-pub-7366086915275961/6086419785';
