# R8の最適化（proguard-android-optimize.txt）を有効にしたときに必要な、このアプリ固有のkeepルール。
# plugins/withAndroidR8.js が android/app/ へコピーし、build.gradle の proguardFiles に足す。
# 経緯と確認方法は docs/requirements.md 13.8。

# --- Expo Modules の Record 変換 ---
# expo.modules.kotlin.records.ReflectionRecordConversionStrategy は、Recordの各プロパティの
# @Field 注釈を `fieldAnnotation.key` で読む。@Field は注釈インターフェースで、プログラム内に
# 実装クラスが無い（実体は実行時にJVMが作る）。最適化が有効だと、R8はこれを「実体の無い型の
# メソッド呼び出し」と判断し、呼び出しを `throw null` に置き換えてしまう。
# その結果、Recordを引数に取るネイティブ関数（自前モジュールの setSegment・setQueue、
# expo-music-library の SubQueryOptions・AssetsOptions など）が、リリースビルドだけで
# NullPointerException になり、起動直後にアプリが落ちる。
# （2026-10-18、エミュレータで確認。-dontoptimize のときは起きない。Expoのテンプレートは
# -dontoptimize なので、Expo標準の構成では表に出ない）
# @Required も、同じ読み方（annotations.any { ... }）をするので残す。
-keep class expo.modules.kotlin.records.Field { *; }
-keep class expo.modules.kotlin.records.Required { *; }
