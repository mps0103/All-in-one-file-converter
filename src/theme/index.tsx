import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {AppState, Appearance, NativeModules, useColorScheme, type TextStyle} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Market IQ palette, carried over value for value so the two apps feel like
 * one family: deep navy in dark mode, cool paper in light, green and red for
 * good and bad, blue for information and purple as the accent.
 */
export interface Palette {
  isDark: boolean;
  bg: string;
  bgElevated: string;
  card: string;
  cardAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textDim: string;
  positive: string;
  positiveSoft: string;
  negative: string;
  negativeSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  accent: string;
  accentSoft: string;
  neutral: string;
  skeleton: string;
  skeletonHi: string;
  tabBar: string;
  overlay: string;
}

const dark: Palette = {
  isDark: true,
  bg: '#060A13',
  bgElevated: '#0A101C',
  card: '#0F1626',
  cardAlt: '#141D31',
  border: 'rgba(148,163,184,0.10)',
  borderStrong: 'rgba(148,163,184,0.20)',
  text: '#F1F5F9',
  textMuted: '#8A96AB',
  textDim: '#586378',
  positive: '#2BD17E',
  positiveSoft: 'rgba(43,209,126,0.12)',
  negative: '#F2555A',
  negativeSoft: 'rgba(242,85,90,0.12)',
  warning: '#F5B544',
  warningSoft: 'rgba(245,181,68,0.12)',
  info: '#5B8CFF',
  infoSoft: 'rgba(91,140,255,0.12)',
  accent: '#8B7CFF',
  accentSoft: 'rgba(139,124,255,0.14)',
  neutral: '#94A3B8',
  skeleton: '#131B2C',
  skeletonHi: '#1B2538',
  tabBar: 'rgba(10,16,28,0.96)',
  overlay: 'rgba(2,4,10,0.72)',
};

const light: Palette = {
  isDark: false,
  bg: '#F5F6F9',
  bgElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardAlt: '#F1F3F7',
  border: '#E4E7EE',
  borderStrong: '#D3D8E2',
  text: '#0B1220',
  textMuted: '#5A6478',
  textDim: '#8C95A6',
  positive: '#0E9F5A',
  positiveSoft: 'rgba(14,159,90,0.10)',
  negative: '#D93A3F',
  negativeSoft: 'rgba(217,58,63,0.09)',
  warning: '#B7791F',
  warningSoft: 'rgba(183,121,31,0.10)',
  info: '#2F6BFF',
  infoSoft: 'rgba(47,107,255,0.09)',
  accent: '#6D5BFF',
  accentSoft: 'rgba(109,91,255,0.10)',
  neutral: '#64748B',
  skeleton: '#E9ECF2',
  skeletonHi: '#F4F6FA',
  tabBar: 'rgba(255,255,255,0.97)',
  overlay: 'rgba(11,18,32,0.45)',
};

export const spacing = {xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28} as const;
export const radius = {sm: 8, md: 12, lg: 16, xl: 22, pill: 999} as const;

const num: TextStyle = {fontVariant: ['tabular-nums']};

export const type = {
  display: {fontSize: 34, fontWeight: '700', letterSpacing: -0.8, ...num} as TextStyle,
  h1: {fontSize: 22, fontWeight: '700', letterSpacing: -0.3} as TextStyle,
  h2: {fontSize: 18, fontWeight: '700', letterSpacing: -0.2} as TextStyle,
  title: {fontSize: 15, fontWeight: '600'} as TextStyle,
  body: {fontSize: 14, fontWeight: '400', lineHeight: 20} as TextStyle,
  bodyNum: {fontSize: 14, fontWeight: '600', ...num} as TextStyle,
  caption: {fontSize: 12, fontWeight: '500'} as TextStyle,
  label: {fontSize: 10.5, fontWeight: '700', letterSpacing: 1.3, textTransform: 'uppercase'} as TextStyle,
};

/**
 * Colourful tile gradients from the design: one per tool family, plus a few
 * extra inks so neighbouring rows in a list never share a colour.
 */
export const tints = {
  red: ['#FF6B6E', '#E0313A'],
  blue: ['#4FA3FF', '#2563EB'],
  orange: ['#FFB547', '#FF7A1A'],
  purple: ['#B583FF', '#7C3AED'],
  green: ['#3EE08F', '#0EA968'],
  indigo: ['#7E8CFF', '#4F46E5'],
  pink: ['#FF7AC6', '#DB2777'],
  teal: ['#3FE0D0', '#0D9488'],
  yellow: ['#FFD54A', '#F59E0B'],
  sky: ['#5CC8FF', '#0284C7'],
  gold: ['#FFC24B', '#FF6B6B'],
} as const;

export type TintName = keyof typeof tints;

/** Kept so the document converter catalog from File Converter compiles unchanged. */
export type InkName = 'pdf' | 'word' | 'excel' | 'slides' | 'image' | 'text' | 'archive';

export type ThemeMode = 'system' | 'dark' | 'light';

const MODE_KEY = 'theme.mode';

type ThemeCtxValue = {palette: Palette; mode: ThemeMode; setMode: (m: ThemeMode) => void};

const ThemeCtx = createContext<ThemeCtxValue>({palette: dark, mode: 'dark', setMode: () => {}});

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY)
      .then(v => {
        if (v === 'dark' || v === 'light' || v === 'system') setModeState(v);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(MODE_KEY, m).catch(() => {});
  }, []);

  // The home-screen icon follows the theme, switched only as the app goes to the
  // background: some launchers refresh, or even close the app, when it changes, so
  // it never happens while the app is on screen. System means the phone's dark
  // mode at that moment.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'background') return;
      const m = modeRef.current;
      const want = m === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : m;
      NativeModules.Workbench?.setLauncherIcon?.(want);
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(() => {
    const resolved = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
    return {palette: resolved === 'light' ? light : dark, mode, setMode};
  }, [mode, system, setMode]);

  // Hold the first frame until the saved choice is known, so a light-mode user
  // never sees a dark flash (the native splash covers this moment anyway).
  if (!loaded) return null;
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx).palette;
export const useThemeMode = () => {
  const {mode, setMode} = useContext(ThemeCtx);
  return {mode, setMode};
};
