# RevenueCat / AdMob 導入セットアップ（Android）

`feat/revenuecat-admob-android` で組み込んだRevenueCat（課金）とAdMob（広告）は、
コード側はプレースホルダーのままで実装済み。ストア審査に出す前に、以下のダッシュボード
作業と値の差し替えが必要。

## 方針

- 無料版: ライブラリ画面などにバナー広告を表示する。
- Pro（月額課金）: 広告を非表示にする。それ以外の機能差はない。
- 現時点ではAndroidのみ。iOSは`purchases.ios.ts`等のno-opのままで、課金・広告を
  提供しない（理由は `CLAUDE.md` の「RevenueCat / AdMob（Android専用）」参照）。

## 1. Google Play Console 側

1. ✅ 定期購入商品を作成・有効化済み（2026-09-28）。
   - アイテムID: `pro`
   - 名前: `RE:TR4CKS Pro`
   - 基本プランID: `monthly`（1か月ごと自動更新、175か国・地域で有効）
   - 価格: 米国 USD 0.99を基準に自動生成。日本のみ意図的にJPY 100へ手動調整
     （自動生成値も偶然JPY 100だったが、念のため明示的に固定）。同じ開発者の
     filto（RevenueCatサンドボックスデータで確認）と同一の価格帯に揃えている。
   - 定期購入商品の作成は、Billing権限（Play Billing Library、
     `react-native-purchases`が自動で含める）を含むビルドをどこかのトラックへ
     一度アップロードするまで作成自体がブロックされる。1.1.0(versionCode 3)の
     内部テスト用AABアップロードで解消した。
2. 課金情報のテストには、Play Consoleの「ライセンステスト」にテスト用アカウントを
   登録しておく（本番決済を発生させずに購入フローを確認できる）。**未実施**。

## 2. AdMob 側

1. ✅ AdMobコンソールでアプリ（`com.yskms.retracks`、Android）を登録し、確認完了
   （2026-09-29）。**アプリID**`ca-app-pub-7366086915275961~6357812712`を
   `app.json`へ反映済み。
   - アプリ登録直後は「アプリの確認ができません（app-ads.txt）」で止まることがある。
     ストアの「ウェブサイト」欄が自分で管理できないドメイン（例:
     `github.com/ユーザー名/リポジトリ名`）になっていないか確認すること
     （詳細は `~/.claude/CLAUDE.md` 共通ナレッジ「AdMob導入時のapp-ads.txt認証の
     落とし穴」参照。retracksでは`https://github.com/yskms/retracks`から
     `https://yskms.github.io/retracks/`へ変更して解決した）。
2. ✅ バナー広告ユニットを1つ作成済み（名称"Banner"）。**広告ユニットID**
   `ca-app-pub-7366086915275961/6086419785`を`src/adConfig.ts`へ反映済み
   （2026-09-29）。作成直後は広告表示が始まるまで1時間程度かかることがある。
3. ✅ 「プライバシーとメッセージ」でのGDPR同意メッセージ対応完了（2026-09-29）。
   （訂正: 当初「アカウント既定のフォールバックがあるので任意」と記載したが
   誤りだった。）メッセージを1つも作成・公開していないと、日本などEEA/UK/
   スイス圏外のユーザーに対しても`AdsConsent.gatherConsent()`
   （`requestInfoUpdate`内部）が
   `Publisher misconfiguration: ... no form(s) configured for the input app ID`
   で失敗し、広告が一切初期化されない（`src/adInit.ts`の`setupAds()`が例外を
   投げ、`canShowAds()`が常にfalseを返す）。実機ログ（`adb logcat`の
   UserMessagingPlatformタグ）で特定した。
   filtoと同じ既存のGDPRメッセージ（欧州の規制）に、対象アプリとして
   RE:TR4CKS（Android）を追加・公開して解消。設定変更の反映に体感で
   10〜30分程度かかった（即座には直らない）。

## 3. RevenueCat 側

1. ✅ RevenueCatダッシュボードでプロジェクトを作成し、Google Playの「App」
   （`com.yskms.retracks`）を追加。サービスアカウントJSONもアップロード済み
   （2026-09-27）。「Google developer notifications」（購入イベントのリアルタイム
   通知）は未接続だが、自前バックエンドが無いため未接続のままでよい
   （アプリ側は`Purchases.getCustomerInfo()`とリスナーで直接状態を取得する）。
2. ✅ 公開APIキー（`goog_`接頭辞）を`src/purchasesConfig.ts`へ反映済み
   （2026-09-27）。
3. ✅ Products → `RE:TR4CKS Music Player (Play Store)`アプリ配下に商品を登録
   （Subscription Id: `pro`、Base plan Id: `monthly` → RevenueCat側の識別子は
   自動的に`pro:monthly`になる）。Entitlement `pro`を作成し、この商品と紐付け済み
   （2026-09-28）。
4. ✅ Offering `current`を作成し、Packageを追加して`pro:monthly`商品と紐付け済み
   （2026-09-28）。**Packageの識別子は独自の`monthly`ではなく、RevenueCatの予約
   識別子`$rc_monthly`にすること。** `src/purchases.ts`の`getMonthlyPriceString`/
   `purchaseMonthly`が参照する`offerings.current?.monthly`は、SDK側で
   `$rc_monthly`識別子のPackageだけを拾う仕様になっている（`monthly`という独自の
   識別子を付けるとCUSTOM種別になり、`.monthly`には載らない）。RevenueCat
   ダッシュボードでPackage作成時のデフォルト値が`$rc_monthly`なので、それを
   変更しなければ問題ない。

## 4. コード側で差し替える値

| ファイル | 定数 | 状態 |
|---|---|---|
| `app.json` | `plugins`内 `react-native-google-mobile-ads` の `androidAppId` | ✅ 反映済み |
| `src/adConfig.ts` | `AD_UNIT_ID`の`__DEV__ ? TestIds.BANNER : '...'`の`'...'`部分（本番用の値） | ✅ 反映済み |
| `src/purchasesConfig.ts` | `REVENUECAT_API_KEY_ANDROID` | ✅ 反映済み |
| `src/purchasesConfig.ts` | `ENTITLEMENT_ID` | ✅ `pro`のままでOK（RevenueCat側のEntitlementも`pro`で作成済み） |

コード側・ダッシュボード側とも必要な設定はすべて完了（2026-09-28〜29）。

## 5. 実機での動作確認

内部テストトラック（AAB 1.1.0 / versionCode 3、Pixel 11）で確認済み（2026-09-29）:

- ✅ バナー広告の表示
- ✅ 月額プランの購入
- ✅ 購入後に広告が消えること

未実施: ライセンステストへのテスト用Googleアカウント登録（1章2.）。今回は
未登録のまま購入を確認したため、実際の決済が発生している可能性がある
（要確認）。今後、課金を伴わずに購入フローを再テストしたい場合はライセンス
テスターの登録を行うこと。

広告ユニットIDは本番の実際の値のため、確認端末では引き続き実際の広告を
不用意にタップしないこと（無効なクリックのポリシー違反を避けるため。
AdMobコンソールでテストデバイス登録すればテスト広告に切り替えられる）。
