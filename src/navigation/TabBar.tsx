import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';
import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withSpring} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Icon, type IconName} from '@/components/Icon';
import {haptic} from '@/components/motion';
import {radius, useTheme} from '@/theme';

const ICONS: Record<string, IconName> = {Home: 'home', Files: 'files', Premium: 'crown', Settings: 'settings'};

/**
 * Market IQ's spring, spelled out in full. Market IQ calls withSpring with only
 * damping and stiffness, and on Reanimated 4 every other field comes from
 * GentleSpringConfig — mass 4 in particular. Reanimated 3 fills them with mass 1,
 * which made the same two numbers run twice as fast here, with less overshoot.
 *
 * Reanimated 4 ends a spring by energy (energyThreshold 6e-9 of the start);
 * Reanimated 3 has no such setting, so the equivalent rest thresholds for a
 * one-tab move (~0.02 px left over, ~0.2 px/s) are given instead.
 */
const INDICATOR_SPRING = {
  damping: 20,
  stiffness: 240,
  mass: 4,
  velocity: 0,
  overshootClamping: false,
  restDisplacementThreshold: 0.02,
  restSpeedThreshold: 0.2,
} as const;

/** Market IQ's tab bar: the indicator springs under the active tab. */
export function TabBar({state, navigation}: BottomTabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(0);
  const seg = w / state.routes.length;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withSpring(state.index * seg, INDICATOR_SPRING);
  }, [state.index, seg, x]);
  const ind = useAnimatedStyle(() => ({transform: [{translateX: x.value}]}));

  return (
    <View
      style={[styles.bar, {backgroundColor: t.tabBar, borderTopColor: t.border, paddingBottom: Math.max(insets.bottom, 6)}]}
      onLayout={e => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Animated.View style={[styles.indWrap, {width: seg}, ind]}>
          <View style={[styles.ind, {backgroundColor: t.info}]} />
        </Animated.View>
      ) : null}
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const premium = route.name === 'Premium';
        const tint = premium ? t.warning : t.info;
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            accessibilityRole="tab"
            accessibilityState={{selected: focused}}
            accessibilityLabel={route.name}
            onPress={() => {
              const ev = navigation.emit({type: 'tabPress', target: route.key, canPreventDefault: true});
              if (!focused && !ev.defaultPrevented) {
                haptic(6);
                navigation.navigate(route.name);
              }
            }}>
            <Icon name={ICONS[route.name] ?? 'home'} color={focused || premium ? tint : t.textDim} size={22} />
            <Text style={[styles.label, {color: focused ? t.text : t.textDim}]}>{route.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8},
  item: {flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48},
  label: {fontSize: 11, fontWeight: '600', marginTop: 4},
  indWrap: {position: 'absolute', top: 0, left: 0, alignItems: 'center'},
  ind: {width: 26, height: 3, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm},
});
