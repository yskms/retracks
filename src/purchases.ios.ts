import type { PurchaseResult } from './purchasesTypes';

/**
 * iOS版フォールバック（no-op）。
 * RevenueCatはAndroidにのみ導入済みで、react-native-purchasesはiOSでは
 * autolinkingから除外している（package.jsonのexpo.autolinking.ios.exclude）ため
 * ネイティブモジュールが存在しない。トップレベルimportするだけでクラッシュしうるので、
 * プラットフォーム別ファイル解決（purchases.ts）で実体を分離する。
 */
export async function initPurchases(): Promise<void> {}

export async function getIsPro(): Promise<boolean> {
  return false;
}

export function onProStatusChange(_cb: (isPro: boolean) => void): () => void {
  return () => {};
}

export async function getMonthlyPriceString(): Promise<string | null> {
  return null;
}

export async function purchaseMonthly(): Promise<PurchaseResult> {
  return { success: false, cancelled: false, errorMessage: 'Not supported on this platform' };
}

export async function restorePurchases(): Promise<PurchaseResult> {
  return { success: false, cancelled: false, errorMessage: 'Not supported on this platform' };
}
