## iOSビルド

- Xcode 26.3では、このプロジェクトに影響する既知のビルド問題がある。
- 2026-09-14のEAS Buildで、Xcode 26.6（17F113）＋パッチなしのオリジナルヘッダーでビルド成功を確認済み。
- Xcode 26.3の問題を回避するために、Apple SDKのヘッダーへパッチを当てないこと。
- この問題の影響を受けるiOSビルドには、EAS BuildのXcode 26.6環境を使用すること。
- 既にストア審査を通過したバージョン（例: 1.0.0）に対して新しいビルドをTestFlight/審査へ
  提出する場合は、`app.json`の`version`（マーケティングバージョン）を必ず引き上げること。
  `eas.json`が`appVersionSource: "remote"`でbuildNumberを自動採番していても、
  versionが同じままだとApple側で`ITMS-90186`/`ITMS-90062`によりリジェクトされる
  （2026-09-24、1回分のビルド・提出を無駄にして判明）。

## iOSウィジェット（`'widget'`ディレクティブの制約）

- `expo-widgets`の`createWidget()`に渡す、関数本体先頭に`'widget';`と書く関数は、
  `babel-preset-expo`のwidgets-pluginによって**関数本体だけがソース文字列化**される
  （クロージャ捕捉もスコープ巻き上げも無い）。この文字列がネイティブ側で
  `JSContext`に単独evaluateされて実行される（`WidgetsJSRuntime.swift`）。
- そのため、**関数の外にあるものは一切参照できない**。import・モジュールスコープの
  定数やヘルパー関数を参照すると、実機で`ReferenceError`になる。使えるのは
  `props`/`environment`と、ウィジェットランタイムが`globalThis`へ載せる
  `@expo/ui/swift-ui`のコンポーネント・modifiers・React・react-nativeスタブだけ。
  色などの定数は関数の中で完結させて定義すること（例: `widgets/NowPlayingWidget.tsx`）。
- この失敗はRELEASEビルドでは無言で`EmptyView()`になり（`expo-widgets`の
  `DynamicView.swift`）、ホーム画面のウィジェットが真っ黒になる以外の手がかりが
  一切出ない。`tsc`はこの種の失敗を検出できない（型としては正しいimportのため）。
- 事前チェック方法：変換後の関数文字列に、使っている変数の定義が実際に含まれているかを
  babelで直接確認できる（正規表現でその場所だけ抜き出そうとすると、コメントや文字列に
  バッククォートが含まれた時に途中で切れて誤判定するので、変換結果全体をそのまま出力する）。
  ```
  node -e "
  const babel = require('@babel/core');
  const { widgetsPlugin } = require('babel-preset-expo/build/plugins/widgets-plugin');
  const src = require('fs').readFileSync('widgets/NowPlayingWidget.tsx', 'utf8');
  const out = babel.transformSync(src, {
    filename: 'w.tsx',
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [widgetsPlugin], babelrc: false, configFile: false,
  }).code;
  console.log(out);
  "
  ```
  出力全体を目視し、参照している変数がすべて`props`/`environment`／この中で定義した
  もの／ランタイム提供のAPIであることを確認する。
- 2026-09-24、この制約に気づかずEASビルドを3回消費して原因特定した
  （`containerBackground`のiOS 17未満での挙動という別の実在する問題と重なっていたため
  特定が長引いた。詳細はdocs/ios-release-checklist.md「実機確認の経緯」参照）。
