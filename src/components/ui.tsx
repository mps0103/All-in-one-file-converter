import React, {useEffect, useRef, useState} from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  SlideInDown,
  ZoomIn,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Circle, Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {radius, spacing, tints, type, useTheme, type TintName} from '@/theme';
import {Icon, type IconName} from './Icon';
import {AnimatedNumber, PressableScale, haptic} from './motion';

// ------------------------------------------------------------------ layout

/**
 * Every screen draws edge to edge. Tab screens leave the bottom to the tab bar;
 * stack screens pass `bottom` so their buttons clear the gesture/navigation bar.
 */
export function Screen({children, style, bottom = false}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; bottom?: boolean}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[{flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: bottom ? insets.bottom : 0}, style]}>
      {/* Transparent bars come from enableEdgeToEdge in MainActivity; only the icon colour is set here. */}
      <StatusBar barStyle={t.isDark ? 'light-content' : 'dark-content'} />
      {children}
    </View>
  );
}

export function ScreenHeader({title, subtitle, onBack, right}: {title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode}) {
  const t = useTheme();
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={14} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBtn}>
          <Icon name="back" color={t.text} size={24} />
        </Pressable>
      ) : null}
      <View style={{flex: 1, alignItems: onBack ? 'center' : 'flex-start'}}>
        <Text numberOfLines={1} style={[type.h1, {color: t.text}]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[type.caption, {color: t.textMuted, marginTop: 2}]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.headerBtn, {alignItems: 'flex-end'}]}>{right}</View>
    </View>
  );
}

export function Card({children, style, onPress, accessibilityLabel}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string}) {
  const t = useTheme();
  const base = [styles.card, {backgroundColor: t.card, borderColor: t.border}, style];
  if (onPress) {
    return (
      <PressableScale onPress={onPress} style={base} accessibilityLabel={accessibilityLabel}>
        {children}
      </PressableScale>
    );
  }
  return <View style={base}>{children}</View>;
}

export function SectionHeader({title, action, onAction}: {title: string; action?: string; onAction?: () => void}) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[type.label, {color: t.textMuted}]}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} accessibilityRole="button">
          <Text style={[type.caption, {color: t.info, fontWeight: '700'}]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------- colour tiles

let gradSeq = 0;
const useGradId = () => useRef(`g${++gradSeq}`).current;

/** Rounded gradient square with a white icon: the colourful tool icon of the design. */
export function GradientTile({tint, icon, size = 44, iconSize, r}: {tint: TintName; icon: IconName; size?: number; iconSize?: number; r?: number}) {
  const id = useGradId();
  const [a, b] = tints[tint];
  const rr = r ?? size * 0.3;
  return (
    <View style={{width: size, height: size, shadowColor: b, shadowOpacity: 0.45, shadowRadius: 10, shadowOffset: {width: 0, height: 4}, elevation: 6, borderRadius: rr}}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={a} />
            <Stop offset="1" stopColor={b} />
          </LinearGradient>
          <LinearGradient id={`${id}h`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
            <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} rx={rr} fill={`url(#${id})`} />
        <Rect x={0} y={0} width={size} height={size} rx={rr} fill={`url(#${id}h)`} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Icon name={icon} color="#FFFFFF" size={iconSize ?? size * 0.5} strokeWidth={2} />
      </View>
    </View>
  );
}

/**
 * Full-bleed gradient background for a big card or button.
 *
 * The parent is measured and the drawing laid out in those units through the
 * viewBox, while the Svg view itself takes the card's bounds from absoluteFill.
 * With width and height "100%", Android sized the Svg from its own default
 * whenever the card took its height from its content, so the Premium cards showed
 * a gradient over only their top-left part. Passing the measured size as width and
 * height props instead rounded the view a few pixels short and clipped the right
 * corners; the viewBox scales to the view's real pixel size, so nothing is lost.
 */
export function GradientFill({tint, colors, r = radius.lg, vertical}: {tint?: TintName; colors?: readonly [string, string] | readonly string[]; r?: number; vertical?: boolean}) {
  const id = useGradId();
  const [a, b] = colors ?? tints[tint ?? 'blue'];
  const [size, setSize] = useState<{w: number; h: number} | null>(null);
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={e => {
        const {width, height} = e.nativeEvent.layout;
        setSize(prev => (prev && prev.w === width && prev.h === height ? prev : {w: width, h: height}));
      }}>
      {size && size.w > 0 && size.h > 0 ? (
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2="1">
              <Stop offset="0" stopColor={a} />
              <Stop offset="1" stopColor={b} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} rx={r} ry={r} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

export function GradientButton({label, onPress, tint = 'blue', icon, disabled, style}: {label: string; onPress: () => void; tint?: TintName; icon?: IconName; disabled?: boolean; style?: StyleProp<ViewStyle>}) {
  const [, b] = tints[tint];
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityState={{disabled}}
      style={[styles.button, {opacity: disabled ? 0.5 : 1, shadowColor: b}, style]}>
      <GradientFill tint={tint} r={radius.md + 2} />
      {icon ? <Icon name={icon} color="#fff" size={20} strokeWidth={2.2} /> : null}
      <Text style={[type.title, {color: '#fff', fontWeight: '700', marginLeft: icon ? 8 : 0}]}>{label}</Text>
    </PressableScale>
  );
}

export function GhostButton({label, onPress, icon, tone, style}: {label: string; onPress: () => void; icon?: IconName; tone?: 'danger'; style?: StyleProp<ViewStyle>}) {
  const t = useTheme();
  const c = tone === 'danger' ? t.negative : t.text;
  return (
    <PressableScale onPress={onPress} style={[styles.ghost, {backgroundColor: t.cardAlt, borderColor: t.border}, style]}>
      {icon ? <Icon name={icon} color={c} size={19} /> : null}
      <Text style={[type.title, {color: c, marginLeft: icon ? 8 : 0}]}>{label}</Text>
    </PressableScale>
  );
}

// ------------------------------------------------------------ list pieces

export function ToolRow({title, subtitle, tint, icon, onPress, right, badge}: {title: string; subtitle?: string; tint: TintName; icon: IconName; onPress?: () => void; right?: React.ReactNode; badge?: string}) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={styles.row} accessibilityLabel={title}>
      <GradientTile tint={tint} icon={icon} size={46} />
      <View style={{flex: 1, marginLeft: spacing.md}}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text numberOfLines={1} style={[type.title, {color: t.text, flexShrink: 1}]}>
            {title}
          </Text>
          {badge ? (
            <View style={[styles.badge, {backgroundColor: t.warningSoft}]}>
              <Text style={[type.label, {color: t.warning, fontSize: 9}]}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={[type.caption, {color: t.textMuted, marginTop: 3}]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron" color={t.textDim} size={20} /> : null)}
    </Card>
  );
}

export function SearchBar({value, onChangeText, placeholder = 'Search tools...'}: {value: string; onChangeText: (s: string) => void; placeholder?: string}) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={[styles.search, {backgroundColor: t.card, borderColor: focus ? t.info : t.border}]}>
      <Icon name="search" color={t.textMuted} size={19} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.textDim}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[type.body, {flex: 1, color: t.text, marginLeft: spacing.sm, paddingVertical: 0}]}
        returnKeyType="search"
        autoCorrect={false}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} hitSlop={10} accessibilityLabel="Clear search">
          <Icon name="close" color={t.textMuted} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------ segmented

/**
 * Market IQ's segmented control: the indicator glides under each tab's measured
 * layout on a 180 ms ease-out.
 */
export function Segmented<T extends string>({options, value, onChange, labels, style, scrollable = false}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
}) {
  const t = useTheme();
  const {width: winWidth, fontScale} = useWindowDimensions();
  const [layouts, setLayouts] = useState<Record<string, {x: number; w: number}>>({});
  const optionKey = options.join('|');
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  // Measurements go stale when the window, the font size or the options change,
  // so they are cleared then — but only on a real change after mount. Clearing on
  // the first run wiped the positions that onLayout had already reported (with the
  // old architecture those arrive before this effect), so the selected option had
  // no highlight until a tap. w goes back to 0 so the indicator snaps into its new
  // place instead of sliding over from the old one.
  const measuredFor = useRef({winWidth, fontScale, optionKey});
  useEffect(() => {
    const prev = measuredFor.current;
    if (prev.winWidth === winWidth && prev.fontScale === fontScale && prev.optionKey === optionKey) return;
    measuredFor.current = {winWidth, fontScale, optionKey};
    w.value = 0;
    setLayouts({});
  }, [winWidth, fontScale, optionKey, w]);

  const sel = layouts[value];
  useEffect(() => {
    if (!sel) return;
    const first = w.value === 0;
    x.value = first ? sel.x : withTiming(sel.x, {duration: 180, easing: Easing.out(Easing.cubic)});
    w.value = first ? sel.w : withTiming(sel.w, {duration: 180, easing: Easing.out(Easing.cubic)});
  }, [sel, x, w]);
  const ind = useAnimatedStyle(() => ({transform: [{translateX: x.value}], width: w.value}));

  const row = (
    <View style={[styles.segWrap, {backgroundColor: t.cardAlt, borderColor: t.border}, style]} accessibilityRole="tablist">
      {/*
        Always mounted, hidden until there is something to show. Mounted only once
        `sel` existed, the view was created in the same render as the first x/w
        write, and on the old architecture that write was sometimes lost before the
        animated style was attached — the pill then stayed at width 0 until a tap.
      */}
      <Animated.View style={[styles.segInd, {backgroundColor: t.info, opacity: sel ? 1 : 0}, ind]} />
      {options.map(o => (
        <Pressable
          key={o}
          onLayout={e => {
            const {x: lx, width} = e.nativeEvent.layout;
            setLayouts(prev => (prev[o] && prev[o].x === lx && prev[o].w === width ? prev : {...prev, [o]: {x: lx, w: width}}));
          }}
          style={scrollable ? styles.segItemAuto : styles.segItem}
          accessibilityRole="tab"
          accessibilityState={{selected: o === value}}
          onPress={() => {
            if (o !== value) {
              haptic(6);
              onChange(o);
            }
          }}>
          <Text numberOfLines={1} style={[type.caption, {color: o === value ? '#fff' : t.textMuted, fontWeight: o === value ? '700' : '600'}]}>
            {labels?.[o] ?? o}
          </Text>
        </Pressable>
      ))}
    </View>
  );
  if (!scrollable) return row;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {row}
    </ScrollView>
  );
}

// ------------------------------------------------------------- overlays

/** Market IQ's bottom sheet: fades the backdrop in and slides the sheet up. */
export function InfoSheet({visible, onClose, title, children}: {visible: boolean; onClose: () => void; title: string; children: React.ReactNode}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, {backgroundColor: t.overlay}]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.duration(300).easing(Easing.out(Easing.cubic))}
            style={[styles.sheet, {backgroundColor: t.bgElevated, borderColor: t.border, paddingBottom: insets.bottom + spacing.lg}]}>
            <View style={[styles.grabber, {backgroundColor: t.borderStrong}]} />
            <View style={styles.sheetHead}>
              <Text style={[type.h2, {color: t.text, flex: 1}]}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <Icon name="close" color={t.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{flexGrow: 0}} showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

export type DialogAction = {label: string; onPress: () => void; tone?: 'primary' | 'danger' | 'plain'};

/** Market IQ's themed dialog: backdrop fade, card zooms in. */
export function AppDialog({visible, title, message, icon, tint = 'blue', actions, onClose, children}: {
  visible: boolean;
  title: string;
  message?: string;
  icon?: IconName;
  tint?: TintName;
  actions: DialogAction[];
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <View style={StyleSheet.absoluteFill}>
          <Animated.View entering={FadeIn.duration(160)} style={[StyleSheet.absoluteFill, {backgroundColor: t.overlay}]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <View style={styles.centreFill} pointerEvents="box-none">
            <Animated.View entering={ZoomIn.duration(180)} style={[styles.dialog, {backgroundColor: t.bgElevated, borderColor: t.border}]}>
              {icon ? (
                <View style={{alignItems: 'center', marginBottom: spacing.md}}>
                  <GradientTile tint={tint} icon={icon} size={56} />
                </View>
              ) : null}
              <Text style={[type.h2, {color: t.text, textAlign: icon ? 'center' : 'left'}]}>{title}</Text>
              {message ? (
                <Text style={[type.body, {color: t.textMuted, marginTop: spacing.sm, textAlign: icon ? 'center' : 'left'}]}>{message}</Text>
              ) : null}
              {children}
              <View style={styles.dialogActions}>
                {actions.map(a => {
                  const bg = a.tone === 'danger' ? t.negative : a.tone === 'primary' ? t.info : t.cardAlt;
                  const fg = a.tone === 'danger' || a.tone === 'primary' ? '#fff' : t.text;
                  return (
                    <Pressable
                      key={a.label}
                      onPress={a.onPress}
                      accessibilityRole="button"
                      style={({pressed}) => [styles.dialogBtn, {backgroundColor: bg, opacity: pressed ? 0.75 : 1}]}>
                      <Text style={[type.title, {color: fg, fontWeight: '700'}]}>{a.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------ progress

const ACircle = Animated.createAnimatedComponent(Circle);

/** Market IQ's ScoreRing, reused as the processing ring: the arc eases to each new value. */
export function ProgressRing({percent, color, size = 168, stroke = 12, caption}: {percent: number; color: string; size?: number; stroke?: number; caption?: string}) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(100, percent)) / 100, {duration: 500, easing: Easing.out(Easing.cubic)});
  }, [percent, p]);
  const props = useAnimatedProps(() => ({strokeDashoffset: c * (1 - p.value)}));
  return (
    <View style={{width: size, height: size}} accessibilityLabel={`${Math.round(percent)} percent`}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.cardAlt} strokeWidth={stroke} fill="none" />
        <ACircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <AnimatedNumber value={Math.round(percent)} format={v => `${Math.round(v)}%`} style={[type.display, {color: t.text, fontSize: size * 0.2}]} />
        {caption ? <Text style={[type.caption, {color: t.textMuted}]}>{caption}</Text> : null}
      </View>
    </View>
  );
}

/** A thin bar that eases to its value. */
export function ProgressBar({percent, color, height = 8}: {percent: number; color: string; height?: number}) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(Math.max(0, Math.min(100, percent)) / 100, {duration: 450, easing: Easing.out(Easing.cubic)});
  }, [percent, p]);
  const fill = useAnimatedStyle(() => ({width: w * p.value}));
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{height, borderRadius: height, backgroundColor: t.cardAlt, overflow: 'hidden'}}>
      <Animated.View style={[{height, borderRadius: height, backgroundColor: color}, fill]} />
    </View>
  );
}

export function SkeletonBlock({width = '100%', height = 14, r = radius.sm, style}: {width?: number | `${number}%`; height?: number; r?: number; style?: StyleProp<ViewStyle>}) {
  const t = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, {duration: 900, easing: Easing.inOut(Easing.quad)}), -1, true);
  }, [p]);
  const anim = useAnimatedStyle(() => ({backgroundColor: interpolateColor(p.value, [0, 1], [t.skeleton, t.skeletonHi])}));
  return <Animated.View style={[{width, height, borderRadius: r}, anim, style]} />;
}

// -------------------------------------------------------------- inputs

export function Field({label, value, onChangeText, placeholder, secure, keyboard}: {label: string; value: string; onChangeText: (s: string) => void; placeholder?: string; secure?: boolean; keyboard?: 'default' | 'number-pad'}) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View style={{marginTop: spacing.md}}>
      <Text style={[type.caption, {color: t.textMuted, marginBottom: 6}]}>{label}</Text>
      <View style={[styles.field, {backgroundColor: t.cardAlt, borderColor: focus ? t.info : t.border}]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={t.textDim}
          secureTextEntry={secure && !show}
          keyboardType={keyboard ?? 'default'}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          autoCapitalize="none"
          autoCorrect={false}
          style={[type.body, {flex: 1, color: t.text, paddingVertical: 0}]}
        />
        {secure ? (
          <Pressable onPress={() => setShow(s => !s)} hitSlop={10}>
            <Text style={[type.caption, {color: t.info, fontWeight: '700'}]}>{show ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function ToggleRow({label, hint, value, onChange}: {label: string; hint?: string; value: boolean; onChange: (v: boolean) => void}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic(6);
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{checked: value}}
      style={styles.toggleRow}>
      <View style={{flex: 1}}>
        <Text style={[type.title, {color: t.text}]}>{label}</Text>
        {hint ? <Text style={[type.caption, {color: t.textMuted, marginTop: 2}]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={v => { haptic(6); onChange(v); }} trackColor={{true: t.info, false: t.borderStrong}} thumbColor="#fff" />
    </Pressable>
  );
}

const THUMB = 26;

/** Usable track: the hit area minus half a thumb at each end, so thumbs never hang off the edge. */
function useTrack() {
  const [w, setW] = useState(0);
  const [x0, setX0] = useState(0);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const measure = () => ref.current?.measureInWindow((x, _y, width) => {
    setX0(x + THUMB / 2);
    setW(Math.max(0, width - THUMB));
  });
  return {w, x0, ref, measure};
}

/** A single-value slider. */
export function Slider({value, min, max, step = 1, onChange, color}: {value: number; min: number; max: number; step?: number; onChange: (v: number) => void; color?: string}) {
  const t = useTheme();
  const track = useTrack();
  const c = color ?? t.info;
  const frac = max > min ? (value - min) / (max - min) : 0;
  const latest = useRef({track, min, max, step, onChange});
  latest.current = {track, min, max, step, onChange};

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => move(e.nativeEvent.pageX),
      onPanResponderMove: e => move(e.nativeEvent.pageX),
    }),
  ).current;

  function move(pageX: number) {
    const {track: tr, min: lo, max: hi, step: st, onChange: cb} = latest.current;
    if (tr.w <= 0) return;
    const f = Math.max(0, Math.min(1, (pageX - tr.x0) / tr.w));
    const raw = lo + f * (hi - lo);
    cb(Math.round(raw / st) * st);
  }

  return (
    <View ref={track.ref} onLayout={track.measure} {...pan.panHandlers} style={styles.sliderHit}>
      <View style={[styles.sliderTrack, {backgroundColor: t.cardAlt}]}>
        <View style={{width: `${frac * 100}%`, height: '100%', backgroundColor: c, borderRadius: 4}} />
      </View>
      <View style={[styles.thumb, {left: frac * track.w, borderColor: c, backgroundColor: t.bgElevated}]} />
    </View>
  );
}

/**
 * Two thumbs: a start and an end, for trimming. Values in the same unit as min/max.
 *
 * underlay is drawn behind the track across exactly the thumbs' travel (the audio
 * tools put the waveform there), height makes room for it, and onRelease says
 * which thumb was let go.
 */
export function RangeSlider({start, end, min, max, step = 100, onChange, color, onRelease, underlay, height = 40}: {
  start: number;
  end: number;
  min: number;
  max: number;
  step?: number;
  onChange: (s: number, e: number) => void;
  color?: string;
  onRelease?: (thumb: 'start' | 'end') => void;
  underlay?: React.ReactNode;
  height?: number;
}) {
  const t = useTheme();
  const track = useTrack();
  const c = color ?? t.info;
  const span = Math.max(1, max - min);
  const fs = (start - min) / span;
  const fe = (end - min) / span;
  const latest = useRef({track, min, max, step, onChange, start, end, onRelease});
  latest.current = {track, min, max, step, onChange, start, end, onRelease};
  const active = useRef<'s' | 'e'>('s');

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const L = latest.current;
        const v = valueAt(e.nativeEvent.pageX);
        active.current = Math.abs(v - L.start) <= Math.abs(v - L.end) ? 's' : 'e';
        apply(v);
      },
      onPanResponderMove: e => apply(valueAt(e.nativeEvent.pageX)),
      onPanResponderRelease: () => latest.current.onRelease?.(active.current === 's' ? 'start' : 'end'),
    }),
  ).current;

  function valueAt(pageX: number) {
    const {track: tr, min: lo, max: hi, step: st} = latest.current;
    const f = tr.w > 0 ? Math.max(0, Math.min(1, (pageX - tr.x0) / tr.w)) : 0;
    return Math.round((lo + f * (hi - lo)) / st) * st;
  }
  function apply(v: number) {
    const L = latest.current;
    const gap = L.step;
    if (active.current === 's') L.onChange(Math.min(v, L.end - gap), L.end);
    else L.onChange(L.start, Math.max(v, L.start + gap));
  }

  const thumbTop = {top: (height - THUMB) / 2};
  return (
    <View ref={track.ref} onLayout={track.measure} {...pan.panHandlers} style={[styles.sliderHit, {height}]}>
      {underlay ? <View style={styles.underlay} pointerEvents="none">{underlay}</View> : null}
      <View style={[styles.sliderTrack, {backgroundColor: t.cardAlt}]}>
        <View style={{position: 'absolute', left: `${fs * 100}%`, width: `${(fe - fs) * 100}%`, height: '100%', backgroundColor: c, borderRadius: 4}} />
      </View>
      <View style={[styles.thumb, thumbTop, {left: fs * track.w, borderColor: c, backgroundColor: t.bgElevated}]} />
      <View style={[styles.thumb, thumbTop, {left: fe * track.w, borderColor: c, backgroundColor: t.bgElevated}]} />
    </View>
  );
}

/**
 * A window of fixed length slid along a range, for the ringtone: drag anywhere to
 * move it, its length never changes. When the range is shorter than the window,
 * the window covers all of it.
 */
export function WindowSlider({start, length, min, max, step = 100, onChange, onRelease, underlay, height = 84, color}: {
  start: number;
  length: number;
  min: number;
  max: number;
  step?: number;
  onChange: (start: number) => void;
  onRelease?: () => void;
  underlay?: React.ReactNode;
  height?: number;
  color?: string;
}) {
  const t = useTheme();
  const track = useTrack();
  const c = color ?? t.info;
  const span = Math.max(1, max - min);
  const len = Math.min(length, span);
  const fs = (start - min) / span;
  const fw = len / span;
  const latest = useRef({track, min, max, step, onChange, onRelease, start, len});
  latest.current = {track, min, max, step, onChange, onRelease, start, len};
  // Where in the window the finger took hold, so the window does not jump to it.
  const grab = useRef(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        const L = latest.current;
        const v = valueAt(e.nativeEvent.pageX);
        // A touch outside the window centres it there; inside, it drags from that point.
        grab.current = v >= L.start && v <= L.start + L.len ? v - L.start : L.len / 2;
        apply(v);
      },
      onPanResponderMove: e => apply(valueAt(e.nativeEvent.pageX)),
      onPanResponderRelease: () => latest.current.onRelease?.(),
    }),
  ).current;

  function valueAt(pageX: number) {
    const {track: tr, min: lo, max: hi} = latest.current;
    const f = tr.w > 0 ? Math.max(0, Math.min(1, (pageX - tr.x0) / tr.w)) : 0;
    return lo + f * (hi - lo);
  }
  function apply(v: number) {
    const L = latest.current;
    const s = Math.round((v - grab.current) / L.step) * L.step;
    L.onChange(Math.max(L.min, Math.min(L.max - L.len, s)));
  }

  return (
    <View ref={track.ref} onLayout={track.measure} {...pan.panHandlers} style={[styles.sliderHit, {height}]}>
      {underlay ? <View style={styles.underlay} pointerEvents="none">{underlay}</View> : null}
      <View
        pointerEvents="none"
        style={[styles.window, {left: THUMB / 2 + fs * track.w, width: Math.max(THUMB, fw * track.w), borderColor: c, backgroundColor: `${c}22`}]}>
        <View style={[styles.windowGrip, {backgroundColor: c}]} />
        <View style={[styles.windowGrip, {backgroundColor: c}]} />
      </View>
    </View>
  );
}

export function Chip({label, active, onPress}: {label: string; active: boolean; onPress: () => void}) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic(5);
        onPress();
      }}
      style={[styles.chip, {backgroundColor: active ? t.infoSoft : t.cardAlt, borderColor: active ? t.info : t.border}]}>
      <Text style={[type.caption, {color: active ? t.info : t.textMuted, fontWeight: '700'}]}>{label}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', justifyContent: 'center'},
  centreFill: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, minHeight: 52},
  headerBtn: {width: 40, justifyContent: 'center'},
  card: {borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg},
  sectionHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.md},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginBottom: spacing.sm + 2},
  badge: {borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8},
  button: {height: 54, borderRadius: radius.md + 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: {width: 0, height: 6}, elevation: 6},
  ghost: {height: 50, borderRadius: radius.md + 2, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center'},
  search: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md + 2, paddingHorizontal: spacing.md, height: 48},
  segWrap: {flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 3},
  segInd: {position: 'absolute', top: 3, bottom: 3, left: 0, borderRadius: radius.sm},
  segItem: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, minHeight: 36},
  segItemAuto: {alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: spacing.md, minHeight: 36},
  sheet: {position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, paddingHorizontal: spacing.xl},
  grabber: {alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginTop: spacing.sm},
  sheetHead: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md},
  dialog: {width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: radius.xl, padding: spacing.xl},
  dialogActions: {flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xl, flexWrap: 'wrap'},
  dialogBtn: {minWidth: 96, minHeight: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, flexGrow: 1},
  field: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 48},
  toggleRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, minHeight: 52},
  sliderHit: {height: 40, justifyContent: 'center'},
  // The thumbs' travel: inset by half a thumb on each side, like the track.
  underlay: {position: 'absolute', top: 0, bottom: 0, left: THUMB / 2, right: THUMB / 2},
  window: {position: 'absolute', top: 2, bottom: 2, borderWidth: 2, borderRadius: radius.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 3},
  windowGrip: {width: 4, height: 22, borderRadius: 2},
  sliderTrack: {height: 6, borderRadius: 4, overflow: 'hidden', marginHorizontal: THUMB / 2},
  thumb: {position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 3, top: 7, elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: {width: 0, height: 2}},
  chip: {borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7, marginRight: spacing.sm},
});
