/**
 * iOS版フォールバック（no-op）。
 * AdMobはAndroidにのみ導入済みで、react-native-google-mobile-adsはiOSでは
 * autolinkingから除外しているためネイティブモジュールが存在しない。
 * トップレベルimportするだけでクラッシュするので、プラットフォーム別
 * ファイル解決（AdBanner.tsx）で実体を分離する。
 */
export function AdBanner() {
  return null;
}
