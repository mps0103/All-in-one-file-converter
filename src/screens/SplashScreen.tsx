import React, {useEffect, useMemo} from 'react';
import {Image, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {useTheme} from '@/theme';

const DARK = require('../assets/splash-dark.jpg');
const LIGHT = require('../assets/splash-light.jpg');

/**
 * The launch screen from the design, in a dark and a light version that follow
 * the app theme. The artwork settles in from a slight zoom, a band of light
 * sweeps across it, sparks drift up out of the box, a progress line fills, and
 * the whole thing fades into the home screen.
 */
export function SplashScreen({onDone}: {onDone: () => void}) {
  const t = useTheme();
  const {width, height} = useWindowDimensions();

  const art = useSharedValue(0);
  const sweep = useSharedValue(0);
  const bar = useSharedValue(0);
  const out = useSharedValue(1);

  useEffect(() => {
    art.value = withTiming(1, {duration: 1300, easing: Easing.out(Easing.cubic)});
    sweep.value = withDelay(450, withTiming(1, {duration: 1100, easing: Easing.inOut(Easing.quad)}));
    bar.value = withDelay(250, withTiming(1, {duration: 1750, easing: Easing.inOut(Easing.cubic)}));
    out.value = withDelay(
      2150,
      withTiming(0, {duration: 380, easing: Easing.in(Easing.quad)}, done => {
        if (done) runOnJS(onDone)();
      }),
    );
  }, [art, sweep, bar, out, onDone]);

  const artStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, art.value * 2.2),
    transform: [{scale: 1.08 - 0.08 * art.value}],
  }));
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{translateX: -width * 1.2 + sweep.value * width * 2.4}, {rotate: '18deg'}],
    opacity: sweep.value > 0 && sweep.value < 1 ? 1 : 0,
  }));
  const barStyle = useAnimatedStyle(() => ({width: `${bar.value * 100}%`}));
  const rootStyle = useAnimatedStyle(() => ({opacity: out.value}));

  const sparks = useMemo(
    () =>
      Array.from({length: 14}, (_, i) => ({
        x: width * (0.22 + ((i * 37) % 56) / 100),
        size: 3 + (i % 4),
        delay: (i * 130) % 1200,
        color: ['#4FA3FF', '#FFB547', '#B583FF', '#3EE08F', '#FF6B6E'][i % 5],
      })),
    [width],
  );

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, {backgroundColor: t.isDark ? '#011236' : '#EAF3FD'}, rootStyle]}>
      <Animated.View style={[StyleSheet.absoluteFill, artStyle]}>
        <Image source={t.isDark ? DARK : LIGHT} style={{width, height}} resizeMode="cover" />
      </Animated.View>

      {sparks.map((s, i) => (
        <Spark key={i} x={s.x} y={height * 0.66} size={s.size} delay={s.delay} color={s.color} />
      ))}

      <Animated.View pointerEvents="none" style={[styles.sweep, {height: height * 1.4, top: -height * 0.2}, sweepStyle]}>
        <Svg width={140} height="100%">
          <Defs>
            <LinearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={t.isDark ? '0.16' : '0.45'} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={140} height="100%" fill="url(#sweep)" />
        </Svg>
      </Animated.View>

      <View style={[styles.footer, {bottom: Math.max(36, height * 0.05)}]}>
        <View style={[styles.track, {backgroundColor: t.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(11,18,32,0.10)'}]}>
          <Animated.View style={[styles.fill, barStyle]} />
        </View>
        <Text style={[styles.by, {color: t.isDark ? 'rgba(255,255,255,0.7)' : 'rgba(11,18,32,0.55)'}]}>
          by <Text style={{fontWeight: '800'}}>MPS</Text>
        </Text>
      </View>
    </Animated.View>
  );
}

function Spark({x, y, size, delay, color}: {x: number; y: number; size: number; delay: number; color: string}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      400 + delay,
      withRepeat(withSequence(withTiming(1, {duration: 1500, easing: Easing.out(Easing.quad)}), withTiming(0, {duration: 0})), -1),
    );
  }, [p, delay]);
  const st = useAnimatedStyle(() => ({
    opacity: p.value === 0 ? 0 : Math.sin(p.value * Math.PI),
    transform: [{translateY: -p.value * 220}, {translateX: Math.sin(p.value * 6) * 10}, {scale: 1 - p.value * 0.4}],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: color, shadowColor: color, shadowOpacity: 0.9, shadowRadius: 6, elevation: 2}, st]}
    />
  );
}

const styles = StyleSheet.create({
  root: {zIndex: 100, elevation: 100, overflow: 'hidden'},
  sweep: {position: 'absolute', left: 0, width: 140},
  footer: {position: 'absolute', left: 0, right: 0, alignItems: 'center'},
  track: {width: 160, height: 4, borderRadius: 4, overflow: 'hidden'},
  fill: {height: 4, borderRadius: 4, backgroundColor: '#4FA3FF'},
  by: {marginTop: 10, fontSize: 12.5, letterSpacing: 0.4},
});
