import { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import { AD_UNIT_ID } from '../adConfig';
import { getIsPro, onProStatusChange } from '../purchases';
import { canShowAds, onAdsAllowedChange } from '../adInit';

/**
 * 全画面共通の固定バナー広告（Android専用。iOS版は AdBanner.ios.tsx）。
 * Pro版では表示しない。常に非パーソナライズ広告のみをリクエストする。
 * EEA/UKの同意状況は `canShowAds()` が見る（同意が無ければ広告を出さない）。
 * RootLayoutで常時マウントされる（画面遷移で再マウントされない）ため、
 * 判定は初回マウント時に一度行い、以降の変化は購読で追従する。
 */
export function AdBanner() {
  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [adsAllowed, setAdsAllowed] = useState<boolean | null>(null);

  // Pro状態と広告可否は互いに無関係な非同期処理（後者は同意フォーム分だけ
  // 時間がかかりうる）なので、別々のeffectにする。ひとつのPromise.allにまとめると、
  // 購入完了で先に届いたリスナー通知を、後から解決した古い判定値が上書きしてしまう
  useEffect(() => {
    let cancelled = false;
    getIsPro().then((pro) => {
      if (!cancelled) setIsPro(pro);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    canShowAds()
      .then((allowed) => {
        if (!cancelled) setAdsAllowed(allowed);
      })
      .catch(() => {
        // 判定できないときは出さない（安全側に倒す）
        if (!cancelled) setAdsAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 購入・復元・失効でPro状態が変わったら即座に反映する（双方向）
  useEffect(() => onProStatusChange(setIsPro), []);
  // 同意設定フォームで同意状況が変わったら即座に反映する
  useEffect(() => onAdsAllowedChange(setAdsAllowed), []);

  // 判定前(null)・Pro版・同意なしでは出さない
  if (isPro !== false || adsAllowed !== true) return null;

  return (
    <View style={styles.container}>
      <BannerAd
        unitId={AD_UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
});
