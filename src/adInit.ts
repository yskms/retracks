import MobileAds, {
  AdsConsentPrivacyOptionsRequirementStatus,
  MaxAdContentRating,
  AdsConsent,
} from 'react-native-google-mobile-ads';

/**
 * 広告SDKの初期化（Android専用。iOSはまだ導入していない → adInit.ios.ts）。
 *
 * 1. UMP（User Messaging Platform）で同意情報を取得し、必要なら同意フォームを出す
 * 2. 広告をリクエストしてよい状態（canRequestAds）なら初期化する
 *
 * **なぜ同意取得が必須か**: Googleの「EU ユーザーの同意ポリシー」により、EEA/UK/
 * スイスのユーザーには、Cookie・ローカルストレージ・個人データの広告利用について
 * 開示と同意取得が求められる（2024-01-16以降、認定CMPの利用が必須化）。
 * `requestNonPersonalizedAdsOnly: true` だけでは要件を満たさない。
 *
 * `gatherConsent()` はEEA/UK圏外のユーザーには何も表示せず、そのまま
 * canRequestAds=true を返すので、日本など他地域のUXには影響しない。
 *
 * TODO: AdMobコンソールの「プライバシーとメッセージ」でGDPRメッセージを作成・公開する。
 * 未公開だと同意フォームが表示されず、EEA/UKユーザーには広告が出ない
 * （canRequestAds=false のまま）。
 */

/** 初期化中/初期化済みの結果（広告を表示してよいか）を共有する。失敗はキャッシュしない */
let adsReadyPromise: Promise<boolean> | null = null;
// MobileAds().initialize()は一度でよい。同意を後から得た経路（showAdPrivacyOptions）
// でも重複初期化しないためのフラグ
let sdkInitialized = false;
// 同意設定の再表示（撤回・変更）導線が必要か（EEA/UK/スイス等、対象地域のユーザーのみtrue）
let privacyOptionsRequired = false;
// 同意状況が変わるたびに呼ばれる（設定画面の「同意設定」フォームを閉じた後など）
const listeners = new Set<(allowed: boolean) => void>();

function applyConsentInfo(consentInfo: {
  canRequestAds: boolean;
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus;
}): boolean {
  privacyOptionsRequired =
    consentInfo.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED;
  return consentInfo.canRequestAds;
}

/**
 * 広告リクエストの設定・SDK初期化。canRequestAds=trueと判明した経路
 * （起動時のsetupAds()、同意を後から付与したshowAdPrivacyOptions()の両方）から
 * 必ず呼ぶこと。二重に呼んでも安全（sdkInitializedで一度きりに制限）。
 */
async function ensureSdkInitialized(): Promise<void> {
  if (sdkInitialized) return;
  // 最大コンテンツレーティングをG（全年齢向け）に固定し、きわどい広告を除外する。
  await MobileAds().setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.G });
  await MobileAds().initialize();
  sdkInitialized = true;
}

async function setupAds(): Promise<boolean> {
  // 同意情報の更新＋必要なら同意フォーム表示（圏外なら何も出ない）
  const consentInfo = await AdsConsent.gatherConsent();
  const canRequestAds = applyConsentInfo(consentInfo);

  // 同意が得られていない場合は広告をリクエストしない
  if (!canRequestAds) return false;

  await ensureSdkInitialized();
  return true;
}

/**
 * setupAds()をやり直し、結果を購読者へ通知する。
 * 実行中に他のrefreshが割り込んだ場合、後発を古い結果で上書きしないよう
 * 「自分が今もadsReadyPromiseの主か」を都度確認する（世代チェック）。
 */
function refreshAdsReady(): Promise<boolean> {
  let promise: Promise<boolean>;
  promise = setupAds().catch(() => {
    // 同意取得やSDK初期化が失敗したら広告を出さない（安全側に倒す）。
    // 収益より「同意なしに広告を出さない」ことを優先する。
    // 失敗はキャッシュしない（一時的な通信失敗等を次回呼び出しで再試行できるように）。
    // ただし、この呼び出しより後に別のrefreshが始まっていたら、そちらを消さない
    if (adsReadyPromise === promise) adsReadyPromise = null;
    return false;
  });
  adsReadyPromise = promise;
  promise.then((allowed) => {
    // 後発のrefreshに既に置き換わっていたら、この古い結果では通知しない
    if (adsReadyPromise === promise) listeners.forEach((cb) => cb(allowed));
  });
  return promise;
}

export function initAds(): Promise<boolean> {
  return adsReadyPromise ?? refreshAdsReady();
}

/** 広告を表示してよいか（初期化がまだなら開始して待つ） */
export function canShowAds(): Promise<boolean> {
  return initAds();
}

/**
 * 広告を表示してよいかが変わるたびに呼ばれる（同意設定フォームを閉じた後など）。
 * 戻り値の関数を呼ぶと購読解除する。
 */
export function onAdsAllowedChange(cb: (allowed: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * 設定画面に「同意設定」の導線を出すべきか（EEA/UK/スイス等の対象地域のユーザーのみ）。
 * ユーザーがいつでも同意を撤回・変更できる導線（取り消しリンク）の設置が
 * Google側の要件になっている。
 *
 * `requestInfoUpdate()`は同意状況を通信して更新するだけで、同意フォームは表示しない
 * （フォーム表示は`loadAndShowConsentFormIfRequired()`/`showForm()`の責務）。
 * `gatherConsent()`を使うと、初回の取得に失敗していた場合に設定画面を開いただけで
 * 同意フォームが不意に表示されてしまうため、ここでは意図的に使わない。
 * 一方でキャッシュのみを見る`getConsentInfo()`は通信しないため、起動直後の
 * `requestInfoUpdate()`が一度も成功していない（オフライン等）場合に`UNKNOWN`のまま
 * 固定されてしまう。`requestInfoUpdate()`ならフォームを出さずに通信で復旧できる。
 */
export async function isAdPrivacyOptionsRequired(): Promise<boolean> {
  try {
    const consentInfo = await AdsConsent.requestInfoUpdate();
    applyConsentInfo(consentInfo);
  } catch {
    // 通信に失敗しても直近の値をそのまま返す（既定はfalse＝導線を出さない）
  }
  return privacyOptionsRequired;
}

/**
 * 同意設定（撤回・変更）フォームを表示する。
 * フォームを閉じた後、同意状況が変わっている可能性があるため再評価するが、
 * `gatherConsent()`ではなく`requestInfoUpdate()`（通信するがフォームは出さない）で
 * 行う。`gatherConsent()`は同意フォームを表示しうるため、閉じた直後にもう一度呼ぶと、
 * 同意を撤回した場合などにフォームが連続して表示されてしまう。
 *
 * 同意を新たに得た場合（拒否→付与）はSDK初期化がまだのことがあるため、
 * `ensureSdkInitialized()`を必ず経由する（初期化前に`canShowAds()`がtrueを
 * 返してしまうと、未初期化のSDKに広告リクエストが飛ぶ・コンテンツレーティング設定
 * が適用されないままになる）。
 */
export async function showAdPrivacyOptions(): Promise<void> {
  await AdsConsent.showPrivacyOptionsForm();
  try {
    const consentInfo = await AdsConsent.requestInfoUpdate();
    let allowed = applyConsentInfo(consentInfo);
    if (allowed) {
      try {
        await ensureSdkInitialized();
      } catch (error) {
        console.warn('[AdInit] SDK initialization failed after consent change:', error);
        allowed = false;
      }
    }
    adsReadyPromise = Promise.resolve(allowed);
    listeners.forEach((cb) => cb(allowed));
  } catch (error) {
    // 読み取りに失敗しても、現在の広告表示状態は変えない
    console.warn('[AdInit] failed to refresh consent after privacy options form:', error);
  }
}
