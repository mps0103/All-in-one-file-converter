import React, {memo, useEffect, useRef, useState} from 'react';
import {Pressable, Text, Vibration, type PressableProps, type StyleProp, type TextStyle, type ViewStyle} from 'react-native';
import Animated, {FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming} from 'react-native-reanimated';

/**
 * The in-app motion language of Market IQ, carried over as-is:
 *  - PressableScale: every tappable card dips to 97% on a stiff spring and fades a touch
 *  - enter(i): list items rise in one after another (FadeInDown, 60 ms stagger)
 *  - AnimatedNumber: numbers tween instead of jumping
 *  - haptic(): a very short tick on toggles and tab changes
 */

const APressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children?: React.ReactNode;
}

export function PressableScale({style, scaleTo = 0.97, children, onPressIn, onPressOut, ...rest}: PressableScaleProps) {
  const s = useSharedValue(1);
  const o = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({transform: [{scale: s.value}], opacity: o.value}));
  return (
    <APressable
      {...rest}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      onPressIn={e => {
        s.value = withSpring(scaleTo, {damping: 20, stiffness: 420});
        o.value = withTiming(0.92, {duration: 90});
        onPressIn?.(e);
      }}
      onPressOut={e => {
        s.value = withSpring(1, {damping: 16, stiffness: 320});
        o.value = withTiming(1, {duration: 160});
        onPressOut?.(e);
      }}
      style={[style, anim]}>
      {children}
    </APressable>
  );
}

/** Staggered entrance for the i-th item of a list or grid. */
export const enter = (i: number, step = 60) => FadeInDown.delay(Math.min(i, 12) * step).duration(360);

/** Very short tick. Keep usage sparse: toggles, tab changes, success. */
export function haptic(ms = 8): void {
  // A tick is decoration. A phone that refuses it (no vibrator, vibration blocked
  // by a battery or focus mode) must never turn a tap into an error.
  try {
    Vibration.vibrate(ms);
  } catch {
    // ignore
  }
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

type AnimatedNumberProps = {
  value: number;
  format: (v: number) => string;
  style?: StyleProp<TextStyle>;
  duration?: number;
  /** Count up from 0 on first mount. */
  countUp?: boolean;
};

function AnimatedNumberImpl({value, format, style, duration = 520, countUp = false}: AnimatedNumberProps) {
  const [shown, setShown] = useState(countUp ? 0 : value);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const from = Number.isFinite(shownRef.current) ? shownRef.current : value;
    if (from === value) return;
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      setShown(from + (value - from) * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <Text style={style} accessibilityLabel={format(value)}>
      {format(shown)}
    </Text>
  );
}

export const AnimatedNumber = memo(AnimatedNumberImpl);
