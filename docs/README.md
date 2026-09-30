# ドキュメント案内

このディレクトリには、公開リポジトリで継続的に参照する資料だけを置く。
ストア管理画面の操作記録、リリース時点のビルド情報、一時的な調査メモは
`docs/private/`にローカル保管し、Gitでは管理しない。

## 公開する資料

| ファイル | 用途 | 更新するタイミング |
|---|---|---|
| `requirements.md` | 仕様、設計判断、技術的な調査記録 | 仕様や重要な判断が変わったとき |
| `development-history.md` | 開発の流れ、リリース、現在地の要約 | マイルストーン達成時 |
| `privacy-policy.md` | 公開中のプライバシーポリシー | データの扱いが変わったとき |
| `google-play-listing.md` | Google Play掲載文とリリースノート | Android版の申請時 |
| `ios-app-store-listing.md` | App Store掲載文と審査向け情報 | iOS版の申請時 |
| `ios-release-checklist.md` | iOSで未完了のQA・申請項目 | iOSリリース作業時 |
| `index.html` | GitHub Pagesのサポートページ | 公開情報やリンクが変わったとき |
| `google-play-assets/` | 公開用のGoogle Play画像 | ストア素材を変えたとき |

## 公開しない資料

`docs/private/`は`.gitignore`の対象。次のような、公開しても利用者に価値がなく
古くなりやすい資料を置く。

- Google Play / App Store Connectの作業チェックリストや提出証跡
- ビルド成果物のハッシュ、端末名などを含む個別リリース記録
- RevenueCat / AdMobなど外部サービスのダッシュボード設定記録
- 記事の下書き、実データが写ったスクリーンショット

公開資料から`docs/private/`内のファイルへリンクしない。必要な恒久的知見は、
実装コメント、`requirements.md`、または`CLAUDE.md`へ要点だけ移す。
