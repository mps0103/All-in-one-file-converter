import './polyfills';
import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AppStateProvider} from '@/hooks/AppState';
import {RootNavigator} from '@/navigation/RootNavigator';
import {SplashScreen} from '@/screens/SplashScreen';
import {ThemeProvider, useTheme} from '@/theme';

const Shell = () => {
  const t = useTheme();
  const [splashDone, setSplashDone] = useState(false);
  return (
    <View style={[styles.root, {backgroundColor: t.bg}]}>
      <RootNavigator />
      {!splashDone ? <SplashScreen onDone={() => setSplashDone(true)} /> : null}
    </View>
  );
};

const App = () => (
  <GestureHandlerRootView style={styles.root}>
    <SafeAreaProvider>
      <ThemeProvider>
        <AppStateProvider>
          <Shell />
        </AppStateProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
);

const styles = StyleSheet.create({root: {flex: 1}});

export default App;
