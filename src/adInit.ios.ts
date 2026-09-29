/**
 * iOS版フォールバック（no-op）。
 * AdMobはAndroidにのみ導入済みで、react-native-google-mobile-adsはiOSでは
 * autolinkingから除外している（package.jsonのexpo.autolinking.ios.exclude）ため
 * ネイティブモジュールが存在しない。トップレベルimportするだけでクラッシュするので、
 * プラットフォーム別ファイル解決（adInit.ts）で実体を分離する。
 */
export function initAds(): Promise<boolean> {
  return Promise.resolve(false);
}

export function canShowAds(): Promise<boolean> {
  return Promise.resolve(false);
}

export function onAdsAllowedChange(_cb: (allowed: boolean) => void): () => void {
  return () => {};
}

export function isAdPrivacyOptionsRequired(): Promise<boolean> {
  return Promise.resolve(false);
}

export function showAdPrivacyOptions(): Promise<void> {
  return Promise.resolve();
}
