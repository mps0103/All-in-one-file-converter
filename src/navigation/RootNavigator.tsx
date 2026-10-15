import React, {useMemo, useState} from 'react';
import {NavigationContainer, DarkTheme, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';

import {HomeScreen} from '@/screens/HomeScreen';
import {FilesScreen} from '@/screens/FilesScreen';
import {PremiumScreen} from '@/screens/PremiumScreen';
import {SettingsScreen} from '@/screens/SettingsScreen';
import {CategoryScreen} from '@/screens/CategoryScreen';
import {ToolScreen} from '@/screens/ToolScreen';
import {ProcessingScreen} from '@/screens/ProcessingScreen';
import {ResultScreen} from '@/screens/ResultScreen';
import {OpenWithScreen} from '@/screens/OpenWithScreen';
import {ViewerScreen} from '@/screens/ViewerScreen';
import {useTheme} from '@/theme';
import {useIncomingFile} from '@/hooks/useIncomingFile';
import {navigationRef} from './navigationRef';
import {TabBar} from './TabBar';
import type {RootStackParamList, TabParamList} from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();

const MainTabs = () => (
  // animation and lazy as in Market IQ: screens shift slightly as the indicator springs.
  <Tabs.Navigator screenOptions={{headerShown: false, animation: 'shift', lazy: true}} tabBar={props => <TabBar {...props} />}>
    <Tabs.Screen name="Home" component={HomeScreen} />
    <Tabs.Screen name="Files" component={FilesScreen} />
    <Tabs.Screen name="Premium" component={PremiumScreen} />
    <Tabs.Screen name="Settings" component={SettingsScreen} />
  </Tabs.Navigator>
);

export const RootNavigator = () => {
  const t = useTheme();
  const [ready, setReady] = useState(false);
  useIncomingFile(ready);

  const navTheme = useMemo(() => {
    const baseTheme = t.isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {...baseTheme.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.info},
    };
  }, [t]);

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef} onReady={() => setReady(true)}>
      <Stack.Navigator screenOptions={{headerShown: false, animation: 'slide_from_right', contentStyle: {backgroundColor: t.bg}}}>
        <Stack.Screen name="Tabs" component={MainTabs} />
        <Stack.Screen name="Category" component={CategoryScreen} />
        <Stack.Screen name="Tool" component={ToolScreen} />
        <Stack.Screen name="Processing" component={ProcessingScreen} options={{animation: 'fade', gestureEnabled: false}} />
        <Stack.Screen name="Result" component={ResultScreen} options={{animation: 'fade_from_bottom'}} />
        <Stack.Screen name="OpenWith" component={OpenWithScreen} options={{animation: 'slide_from_bottom'}} />
        <Stack.Screen name="Viewer" component={ViewerScreen} />
        <Stack.Screen name="PremiumModal" component={PremiumScreen} options={{animation: 'slide_from_bottom'}} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
