/**
 * Pro画面（Android/iOS共通）。
 * 無料版はバナー広告あり、Pro（月額課金）で広告を非表示にする。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { colors } from '../src/theme';
import { getIsPro, getMonthlyPriceString, purchaseMonthly, restorePurchases } from '../src/purchases';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../src/legalUrls';

/** 価格取得の自動リトライ回数（初回を除く）と、その待ち時間（回を追うごとに伸ばす） */
const PRICE_FETCH_RETRIES = 2;
const PRICE_FETCH_RETRY_DELAY_MS = 1500;

export default function ProScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [priceString, setPriceString] = useState<string | null | undefined>(undefined);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 「再試行」連打やフォーカス再評価との多重実行を防ぐ（stateだと次のレンダーまで
  // 反映されず、素早い連打をすり抜けるためrefで持つ）
  const loadingRef = useRef(false);
  // 「再試行」ボタン（useFocusEffect外）からのload()呼び出し用。
  // 価格取得の再試行ループ（最大約4.5秒）の途中で画面を離れてもsetStateしないように
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // isPro判定→（無料版のときだけ）価格取得の順で行う: 既にPro済みの場合は
  // 表示しない価格を無駄に取得しない。isCancelledで、素早い出入りによる
  // 古い応答での上書きも防ぐ
  const load = useCallback(async (isCancelled?: () => boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const pro = await getIsPro();
      if (isCancelled?.()) return;
      setIsPro(pro);
      if (pro) return;

      // 再試行時にスピナーへ戻す（前回のエラー表示のままボタンが反応しないように見えるのを防ぐ）
      setPriceString(undefined);

      // 価格が取れないと購入ボタンごと消える画面なので、一度の失敗で諦めない
      for (let attempt = 0; ; attempt++) {
        const price = await getMonthlyPriceString();
        if (isCancelled?.()) return;
        if (price !== null || attempt >= PRICE_FETCH_RETRIES) {
          setPriceString(price);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, PRICE_FETCH_RETRY_DELAY_MS * (attempt + 1)));
        if (isCancelled?.()) return;
      }
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // 画面フォーカスのたびに再評価する（購入・復元直後の状態を反映するため）
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  const handleSubscribe = async () => {
    if (purchasing) return;
    setPurchasing(true);
    try {
      const result = await purchaseMonthly();
      if (result.success) {
        // purchaseMonthly成功=決済完了であって、entitlement付与を保証しない
        // （商品とentitlementの紐付けミス等がありうる）。実際のentitlement状態を見る
        const nowPro = await getIsPro();
        setIsPro(nowPro);
        if (!nowPro) {
          console.warn('[Purchases] purchase succeeded but entitlement is not active');
          Alert.alert(t('common.error'), t('pro.purchaseEntitlementMissing'));
        }
      } else if (!result.cancelled) {
        if (result.errorMessage) console.warn('[Purchases] purchase failed:', result.errorMessage);
        Alert.alert(t('common.error'), t('pro.purchaseError'));
      }
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.success) {
        const nowPro = await getIsPro();
        setIsPro(nowPro);
        if (!nowPro) Alert.alert(t('common.error'), t('pro.restoreNotFound'));
      } else if (!result.cancelled) {
        if (result.errorMessage) console.warn('[Purchases] restore failed:', result.errorMessage);
        Alert.alert(t('common.error'), t('pro.restoreError'));
      }
    } finally {
      setRestoring(false);
    }
  };

  /** 外部ブラウザで開く。openURL は開けない場合に reject するため必ず捕まえる */
  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common.error'), t('pro.linkOpenError'));
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="arrow-back-outline" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('pro.title')}</Text>
        <View style={{ width: 20 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {isPro === null ? (
          <ActivityIndicator style={styles.priceLoading} color={colors.accent} />
        ) : isPro ? (
          <View style={styles.centerBlock}>
            <Ionicons name="star" size={48} color={colors.accent} />
            <Text style={styles.alreadyProTitle}>{t('pro.alreadyProTitle')}</Text>
            <Text style={styles.alreadyProDescription}>{t('pro.alreadyProDescription')}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.subtitle}>{t('pro.subtitle')}</Text>

            <View style={styles.card}>
              <View style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                <Text style={styles.featureText}>{t('pro.featureAds')}</Text>
              </View>
            </View>

            {priceString === undefined ? (
              <ActivityIndicator style={styles.priceLoading} color={colors.accent} />
            ) : priceString === null ? (
              <View style={styles.centerBlock}>
                <Text style={styles.errorText}>{t('pro.priceLoadError')}</Text>
                <Pressable onPress={() => load(() => !mountedRef.current)}>
                  <Text style={styles.retryText}>{t('pro.retry')}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.price}>
                  {priceString}
                  <Text style={styles.priceSuffix}>{t('pro.priceSuffix')}</Text>
                </Text>

                <Pressable
                  style={[styles.subscribeButton, purchasing && styles.subscribeButtonDisabled]}
                  onPress={handleSubscribe}
                  disabled={purchasing}
                >
                  {purchasing ? (
                    <ActivityIndicator size="small" color="#1a1206" />
                  ) : (
                    <Text style={styles.subscribeButtonText}>{t('pro.subscribeButton')}</Text>
                  )}
                </Pressable>
              </>
            )}

            <Pressable onPress={handleRestore} disabled={restoring} style={styles.restoreButton}>
              {restoring ? (
                <ActivityIndicator size="small" color={colors.textDim} />
              ) : (
                <Text style={styles.restoreButtonText}>{t('pro.restoreButton')}</Text>
              )}
            </Pressable>

            {/* ストアの定期購入ポリシー: 支払い前に自動更新・価格・解約方法を開示する
                必要がある。価格は上のpriceString（ストアのローカライズ済みの値）が
                担うため、ここに金額を直書きしない ―― 通貨・地域ごとに嘘になる。
                解約先のストア名はAndroid/iOSで異なる（Appleの審査ガイドライン上、
                iOSでGoogle Playの解約導線を案内すると審査に通らない）。
                利用規約（EULA）へのリンクは、ストアメタデータへの記載だけでは
                App Store Reviewガイドライン3.1.2(c)を満たさず、アプリ本体にも
                必要（`src/legalUrls.ts`参照）。TERMS_OF_USE_URLはAppleの標準EULAで
                Google Playの購読には適用されないため、iOS限定で表示する */}
            <View style={styles.legalBlock}>
              <Text style={styles.legalTitle}>{t('pro.subscriptionTermsTitle')}</Text>
              <Text style={styles.legalText}>
                {t('pro.subscriptionTerms', { store: Platform.OS === 'ios' ? 'App Store' : 'Google Play' })}
              </Text>
              <View style={styles.legalLinks}>
                {Platform.OS === 'ios' && (
                  <Pressable onPress={() => openLink(TERMS_OF_USE_URL)}>
                    <Text style={styles.legalLink}>{t('pro.termsOfUse')}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => openLink(PRIVACY_POLICY_URL)}>
                  <Text style={styles.legalLink}>{t('pro.privacyPolicy')}</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
  },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  body: { padding: 24, alignItems: 'center', paddingBottom: 40 },
  centerBlock: { alignItems: 'center', gap: 12, paddingVertical: 40 },
  subtitle: { color: colors.textDim, fontSize: 14, textAlign: 'center', marginBottom: 24 },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureText: { color: colors.text, fontSize: 14, flex: 1 },
  priceLoading: { marginTop: 24 },
  price: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 20,
  },
  priceSuffix: { color: colors.textDim, fontSize: 16, fontWeight: '400' },
  subscribeButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: colors.accent,
  },
  subscribeButtonDisabled: { backgroundColor: colors.accentDim },
  subscribeButtonText: { color: '#1a1206', fontSize: 16, fontWeight: '700' },
  restoreButton: { marginTop: 8, padding: 8 },
  restoreButtonText: { color: colors.textDim, fontSize: 13 },
  errorText: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  retryText: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 8 },
  alreadyProTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  alreadyProDescription: { color: colors.textDim, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  legalBlock: { width: '100%', marginTop: 24, gap: 8 },
  legalTitle: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  legalText: { color: colors.textDim, fontSize: 11, lineHeight: 16 },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 4 },
  legalLink: { color: colors.accent, fontSize: 12, fontWeight: '500' },
});
