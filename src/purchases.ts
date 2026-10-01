import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL, CustomerInfo, PURCHASES_ERROR_CODE } from 'react-native-purchases';
import { REVENUECAT_API_KEY_ANDROID, REVENUECAT_API_KEY_IOS, ENTITLEMENT_ID } from './purchasesConfig';
import type { PurchaseResult } from './purchasesTypes';

const REVENUECAT_API_KEY = Platform.select({
  ios: REVENUECAT_API_KEY_IOS,
  default: REVENUECAT_API_KEY_ANDROID,
});

let configured = false;
// 直近に判明しているPro状態。configure前・失敗時はfalse
// （安全側＝無料版として扱う。広告表示の判定はこれをそのまま使う）
let cachedIsPro = false;
// 初回のgetCustomerInfo()問い合わせ。getIsPro()はこれの完了を待ってから
// cachedIsProを返すことで、起動直後にPro済みユーザーが一瞬無料版と誤判定
// されるのを防ぐ（一度解決した後は待つコストはほぼ無い）
let initialFetchPromise: Promise<void> | null = null;
const listeners = new Set<(isPro: boolean) => void>();

function hasEntitlement(info: CustomerInfo): boolean {
  return info.entitlements.active[ENTITLEMENT_ID] !== undefined;
}

function updateCache(info: CustomerInfo): void {
  cachedIsPro = hasEntitlement(info);
  listeners.forEach((cb) => cb(cachedIsPro));
}

/**
 * SDK初期化は一度だけ行う（複数箇所から呼ばれても安全なように）。
 * Purchases.configure() はネイティブモジュール未リンク時（依存追加直後で
 * dev client を作り直していない等）に同期的にthrowするため、ここで必ず
 * 捕まえる。失敗時は configured を立てないため、次回呼び出し時に再試行
 * される（アプリを落とさず、無料版のまま動き続けられる）。
 */
function ensureConfigured(): void {
  if (configured) return;
  try {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey: REVENUECAT_API_KEY });
    configured = true;
    Purchases.addCustomerInfoUpdateListener(updateCache);
    initialFetchPromise = Purchases.getCustomerInfo().then(updateCache).catch(() => {});
  } catch {
    // ネイティブモジュール未リンク等。configured を立てないので次回再試行する
  }
}

export async function initPurchases(): Promise<void> {
  ensureConfigured();
}

/**
 * 現在Pro版かどうか。初回問い合わせが完了するまで待ってから、直近にリスナー/
 * 問い合わせで判明している状態を返す（起動直後の一瞬だけ無料版と誤判定される
 * 競合状態を防ぐ）。2回目以降は既に解決済みのPromiseを待つだけなので、
 * 呼び出しのたびにネイティブブリッジへ問い合わせるコストは発生しない。
 */
export async function getIsPro(): Promise<boolean> {
  ensureConfigured();
  if (initialFetchPromise) await initialFetchPromise;
  return cachedIsPro;
}

/**
 * Pro状態が変化するたびに呼ばれる（購入・復元・失効など、双方向）。
 * 戻り値の関数を呼ぶと購読解除する。
 */
export function onProStatusChange(cb: (isPro: boolean) => void): () => void {
  ensureConfigured();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** 月額プランのローカライズ済み価格文字列（例: "¥480"）。取得できなければnull */
export async function getMonthlyPriceString(): Promise<string | null> {
  ensureConfigured();
  try {
    const offerings = await Purchases.getOfferings();
    const monthly = offerings.current?.monthly;
    if (!monthly) {
      console.warn(
        '[Purchases] no monthly package. current offering:',
        offerings.current?.identifier ?? 'null',
        'all offerings:',
        Object.keys(offerings.all)
      );
      return null;
    }
    return monthly.product.priceString;
  } catch (error) {
    console.warn('[Purchases] getOfferings failed:', error);
    return null;
  }
}

/** 月額プランを購入する。ユーザーがキャンセルした場合もエラーではなくcancelled:trueで返す */
export async function purchaseMonthly(): Promise<PurchaseResult> {
  ensureConfigured();
  try {
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.monthly;
    if (!pkg) {
      return { success: false, cancelled: false, errorMessage: 'offering not available' };
    }
    const result = await Purchases.purchasePackage(pkg);
    updateCache(result.customerInfo);
    return { success: true };
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
      return { success: false, cancelled: true };
    }
    return {
      success: false,
      cancelled: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 購入を復元する（機種変更・再インストール後など） */
export async function restorePurchases(): Promise<PurchaseResult> {
  ensureConfigured();
  try {
    const info = await Purchases.restorePurchases();
    updateCache(info);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      cancelled: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
