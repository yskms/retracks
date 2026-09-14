const { withAppDelegate } = require('@expo/config-plugins');

/**
 * Expo SDK 57 + precompiled React Native on Xcode 26 generates a legacy
 * sourceURL(for: RCTBridge) override for expo-dev-client. RCTBridge is not
 * exposed to the app target by the precompiled framework, so App Store builds
 * fail before linking. bundleURL() is the active entry point for the new
 * architecture and remains in place.
 */
module.exports = function withIosAppDelegateFix(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') return mod;

    const before = mod.modResults.contents;
    const after = before.replace(
      /\n  override func sourceURL\(for bridge: RCTBridge\) -> URL\? \{\n(?:.*\n)*?  \}\n\n  override func bundleURL\(\)/,
      '\n  override func bundleURL()'
    );
    if (before.includes('sourceURL(for bridge: RCTBridge)') && after === before) {
      throw new Error('Could not remove the legacy RCTBridge sourceURL override from AppDelegate.swift');
    }
    mod.modResults.contents = after;
    return mod;
  });
};
