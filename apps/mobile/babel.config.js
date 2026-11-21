module.exports = function (api) {
  api.cache(true);
  return {
    // jsxImportSource: "nativewind" is what makes the className prop work on
    // native components; it is the core of how NativeWind v4 operates.
    // Existing StyleSheet-based components are unaffected: they pass no
    // className, so the transform is a no-op for them.
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      'react-native-reanimated/plugin',
    ],
  };
};
