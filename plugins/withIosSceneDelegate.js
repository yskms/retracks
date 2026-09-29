const { withInfoPlist, withAppDelegate, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Xcode 27 (iOS 27 SDK) 以降、UISceneライフサイクル未対応のアプリは起動直後に
// クラッシュする（"UIScene life cycle is required for apps built with this SDK"。
// Apple: WWDC25で「iOS 26の次のリリース以降、最新SDKでビルドしたUIKitアプリは
// UISceneライフサイクル必須」と予告済みの仕様変更）。
//
// Expo 57 / React Native 0.86.3時点でもExpo・RN本体ともに公式のシーン対応が
// 未実装（2026-09-30、retracksのXcode 27ローカルビルドで実際にこのクラッシュを
// 確認して判明。同種の問題は姉妹プロジェクトfilto-appでも先に確認済み）。
// そのためios/ が `expo prebuild` の自動生成物であることを踏まえ、config plugin
// として恒久的にAppDelegate/SceneDelegateへ手動でシーン対応を注入している。
//
// Expoが公式にUIScene対応した場合は、このプラグインとSceneDelegate.swiftを撤去し、
// 公式の仕組みに乗り換えること。詳細: CLAUDE.md「iOSビルド」
//
// 【重要】AppDelegateのwindow生成・factory.startReactNative呼び出しは意図的に
// 元のまま(didFinishLaunchingWithOptions内)残している。expo-dev-launcher
// （Dev Client、Debugビルドのみ）はdidFinishLaunchingWithOptions時点で
// UIApplication.shared.delegate?.window（またはkeyWindow）が存在することを
// 前提にしており、無いとfatalErrorする
// （node_modules/expo-dev-launcher/ios/ReactDelegateHandler/ExpoDevLauncherAppDelegateSubscriber.swift）。
// windowをSceneDelegate側で新規生成する設計にすると、didFinishLaunching時点では
// まだシーンが接続されておらずwindowが存在しないため、Dev Client(Debugビルド)が
// 起動直後に必ずクラッシュする。SceneDelegateは新しいwindowを作らず、
// AppDelegateが作った既存のwindowにwindowSceneを割り当てるだけにすること。

const SCENE_DELEGATE_CLASS_NAME = 'SceneDelegate';
const SCENE_DELEGATE_FILENAME = `${SCENE_DELEGATE_CLASS_NAME}.swift`;
// AppDelegate.swiftのパッチが既に適用済みかどうかの判定専用マーカー。
// 実装コード（configurationForConnectingなど）の文字列に依存すると、将来Expo側や
// 他のプラグインが同名のメソッドを追加した場合に誤判定するため、専用の文字列にする。
const PATCH_MARKER = '// __withIosSceneDelegate_patched__';

const SCENE_DELEGATE_SOURCE = `// このファイルは plugins/withIosSceneDelegate.js が生成する。
// 手で編集しても \`expo prebuild\` 実行時に上書きされる。
//
// iOS 27 SDK (Xcode 27) のUISceneライフサイクル必須化への対応。
// windowの生成自体はAppDelegate.didFinishLaunchingWithOptionsに残したまま
// （expo-dev-launcher対策。詳細はwithIosSceneDelegate.js冒頭コメント参照）、
// そのwindowにwindowSceneを割り当てる役割だけをここで担う。
//
// URLスキーム/Universal Linksは、シーン採用後はAppDelegateの
// application(_:open:)・application(_:continue:restorationHandler:) が
// 呼ばれなくなるため、ExpoAppDelegateSubscriberManagerへの転送もここで肩代わりする
// （expo-linking / expo-dev-launcher 等のサブスクライバーが動作しなくなるのを防ぐため）。

// AppDelegate.swiftが\`internal import Expo\`で生成されるため、同一モジュール内で
// 暗黙アクセスレベルのimportと混在させるとSwiftが"ambiguous implicit access level"
// でビルドエラーにする。ExpoModulesCoreも同様にexpo-modules-core側の生成物が
// internal importのため揃える。
internal import Expo
internal import ExpoModulesCore
import React
import ReactAppDependencyProvider
import UIKit

class ${SCENE_DELEGATE_CLASS_NAME}: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    guard let window = (UIApplication.shared.delegate as? AppDelegate)?.window else {
      // AppDelegate.application(_:didFinishLaunchingWithOptions:)が必ず先に呼ばれ、
      // その中でwindowを生成しているはずなので、ここがnilになることは想定していない。
      assertionFailure("withIosSceneDelegate: AppDelegate.window が生成されていません")
      return
    }

    window.windowScene = windowScene
    window.makeKeyAndVisible()
    self.window = window

    if !connectionOptions.urlContexts.isEmpty {
      self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    }
    if let userActivity = connectionOptions.userActivities.first {
      self.scene(scene, continue: userActivity)
    }
  }

  // Linking API（旧AppDelegate.application(_:open:options:)相当）
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace,
      ]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }

      _ = RCTLinkingManager.application(UIApplication.shared, open: context.url, options: options)
      _ = ExpoAppDelegateSubscriberManager.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  // Universal Links（旧AppDelegate.application(_:continue:restorationHandler:)相当）
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    let noopRestorationHandler: ([UIUserActivityRestoring]?) -> Void = { _ in }
    _ = RCTLinkingManager.application(UIApplication.shared, continue: userActivity, restorationHandler: noopRestorationHandler)
    _ = ExpoAppDelegateSubscriberManager.application(UIApplication.shared, continue: userActivity, restorationHandler: noopRestorationHandler)
  }
}
`;

// didFinishLaunchingWithOptionsの終端に、configurationForConnecting(シーン設定)を
// 追加するだけの純粋な追記。window生成やstartReactNative呼び出しには一切触れない
// （触れてはいけない理由は本ファイル冒頭コメント参照）。
const DID_FINISH_LAUNCHING_END = `    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }`;

const CONFIGURATION_FOR_CONNECTING = `    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  ${PATCH_MARKER}
  // iOS 27 SDK のUISceneライフサイクル必須化対応。詳細は plugins/withIosSceneDelegate.js を参照。
  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let sceneConfig = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    sceneConfig.delegateClass = SceneDelegate.self
    return sceneConfig
  }`;

// シーン採用後はシステムから呼ばれなくなるため撤去し、同等の処理をSceneDelegate側へ
// 移植する（残したままだと二重発火はしないが、実際には呼ばれない死んだコードとして
// 紛らわしく残ってしまう）。
const OLD_LINKING_OVERRIDES = `

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }`;

function patchAppDelegate(contents) {
  if (contents.includes(PATCH_MARKER)) {
    // 既にパッチ済み（expo prebuildの再実行など）。
    return contents;
  }

  let patched = contents;

  const beforeConfigInsert = patched;
  patched = patched.replace(DID_FINISH_LAUNCHING_END, CONFIGURATION_FOR_CONNECTING);
  if (patched === beforeConfigInsert) {
    throw new Error(
      'withIosSceneDelegate: AppDelegate.swift内にdidFinishLaunchingWithOptionsの終端が' +
        '見つかりませんでした。Expoのテンプレートが変わった可能性があるため ' +
        'plugins/withIosSceneDelegate.js を確認してください。'
    );
  }

  const beforeLinkingRemoval = patched;
  patched = patched.replace(OLD_LINKING_OVERRIDES, '');
  if (patched === beforeLinkingRemoval) {
    throw new Error(
      'withIosSceneDelegate: AppDelegate.swift内のLinking API ' +
        '(open url / continue userActivity)のoverrideが見つかりませんでした。' +
        'Expoのテンプレートが変わった可能性があるため plugins/withIosSceneDelegate.js を確認してください。'
    );
  }

  return patched;
}

function withIosSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: `$(PRODUCT_MODULE_NAME).${SCENE_DELEGATE_CLASS_NAME}`,
          },
        ],
      },
    };
    return config;
  });
}

function withIosSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    config.modResults.contents = patchAppDelegate(config.modResults.contents);
    return config;
  });
}

function withIosSceneDelegateFile(config) {
  return withXcodeProject(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);

    fs.writeFileSync(path.join(sourceRoot, SCENE_DELEGATE_FILENAME), SCENE_DELEGATE_SOURCE);

    const filePath = `${projectName}/${SCENE_DELEGATE_FILENAME}`;
    if (!config.modResults.hasFile(filePath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: filePath,
        groupName: projectName,
        project: config.modResults,
      });
    }

    return config;
  });
}

module.exports = function withIosSceneDelegate(config) {
  config = withIosSceneManifest(config);
  config = withIosSceneAppDelegate(config);
  config = withIosSceneDelegateFile(config);
  return config;
};
