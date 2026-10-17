module.exports = {
  presets: ['@react-native/babel-preset'],
  plugins: [
    ['module-resolver', { root: ['./src'], alias: { '@': './src' } }],
    'react-native-worklets/plugin', // must stay last
  ],
};
