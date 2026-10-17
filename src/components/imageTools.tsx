import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {useIsFocused} from '@react-navigation/native';
import Animated, {FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';

import {Icon} from './Icon';
import {PressableScale, haptic} from './motion';
import {Card, Chip, SkeletonBlock} from './ui';
import {useInBackground} from '@/hooks/useInBackground';
import type {PickedFile} from '@/native/FileBridge';
import {ImageTools, type ImageOptions, type ImagePreview} from '@/native/Tools';
import {humanBytes} from '@/tools/helpers';
import type {Opts} from '@/tools/types';
import {radius, spacing, tints, type, useTheme, type TintName} from '@/theme';

/** Longest side of a live preview: sharp on a phone screen, a few MB at most. */
const PREVIEW_SIDE = 1080;
/** Wait this long after the last option change before drawing a new preview. */
const DEBOUNCE_MS = 300;

type PreviewOpts = Omit<ImageOptions, 'outPath'>;

/**
 * Draws the job at preview size each time its options settle. Older requests
 * that a newer one overtook come back null and are dropped; the files are
 * deleted when the screen closes.
 */
function useImagePreview(uri: string | undefined, opts: PreviewOpts | null, slot: string, side: number) {
  const [p, setP] = useState<ImagePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = opts ? JSON.stringify(opts) : '';
  useEffect(() => {
    if (!uri || !opts) return;
    let alive = true;
    setBusy(true);
    const timer = setTimeout(() => {
      ImageTools.preview(uri, {...opts, slot}, side)
        .then(r => {
          if (!alive || !r) return;
          setP(r);
          setError('');
        })
        .catch(e => alive && setError((e as Error).message || 'Could not preview this picture.'))
        .finally(() => alive && setBusy(false));
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // key stands for opts, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, key, slot, side]);
  return {p, busy, error};
}

/**
 * True while the pictures should be drawn: the app is in front and the tool screen
 * is not covered (the Processing screen goes over it while a job runs, and the
 * job then has the memory to itself).
 */
function useShowPictures() {
  const hidden = useInBackground();
  const focused = useIsFocused();
  return !hidden && focused;
}

/** Every preview file goes when the tool screen closes. */
export function useClearPreviewsOnClose() {
  useEffect(() => () => ImageTools.clearPreviews(), []);
}

const sizeLabel = (p: ImagePreview) => `${p.exact ? '' : '≈ '}${humanBytes(p.estimatedBytes)}`;

/**
 * The live preview of an image tool, on the tool screen above its options: the
 * picture as it will be saved, its size in pixels and its file size. compare
 * puts the original under it with a slider between the two.
 */
export function ImagePreviewCard({file, opts, compare, tint, onInfo}: {file: PickedFile; opts: Opts; compare: boolean; tint: TintName; onInfo?: (p: ImagePreview) => void}) {
  const t = useTheme();
  const hidden = !useShowPictures();
  const {p, busy, error} = useImagePreview(file.uri, opts as PreviewOpts, 'main', PREVIEW_SIDE);
  const [w, setW] = useState(0);
  const info = useRef(onInfo);
  info.current = onInfo;
  useEffect(() => {
    if (p) info.current?.(p);
  }, [p]);

  const aspect = p ? p.width / p.height : 4 / 3;
  const h = w ? Math.min(w / aspect, 340) : 0;
  const [, deep] = tints[tint];

  return (
    <Card style={styles.previewCard}>
      <View style={[styles.frame, {height: h || 200, backgroundColor: t.cardAlt}]} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {!p || hidden ? (
          !p && !error ? <SkeletonBlock width="100%" height={h || 200} r={radius.md} /> : null
        ) : compare ? (
          <CompareView before={file.uri} after={p.uri} width={w} height={h} color={deep} />
        ) : (
          <Animated.View key={p.uri} entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
            <Image source={{uri: p.uri}} style={StyleSheet.absoluteFill} resizeMode="contain" />
          </Animated.View>
        )}
        {busy && p ? (
          <View style={[styles.badge, {backgroundColor: t.overlay}]}>
            <Text style={[type.label, {color: '#fff'}]}>UPDATING</Text>
          </View>
        ) : null}
      </View>
      {error ? (
        <Text style={[type.caption, {color: t.negative, marginTop: spacing.sm}]}>{error}</Text>
      ) : p ? (
        <View style={styles.previewInfo}>
          <Text style={[type.bodyNum, {color: t.text}]}>
            {p.outWidth} × {p.outHeight} px
          </Text>
          <Text style={[type.bodyNum, {color: t.textMuted}]}>
            {compare && file.size ? `${humanBytes(file.size)} → ` : ''}
            {sizeLabel(p)}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** The original on the left of the line, the result on the right; drag to move the line. */
function CompareView({before, after, width, height, color}: {before: string; after: string; width: number; height: number; color: string}) {
  const x = useSharedValue(width / 2);
  const start = useSharedValue(0);
  useEffect(() => {
    x.value = width / 2;
  }, [width, x]);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({horizontal: 12})
        .onBegin(() => {
          start.value = x.value;
        })
        .onUpdate(e => {
          x.value = Math.max(0, Math.min(width, start.value + e.translationX));
        }),
    [width, x, start],
  );
  const clip = useAnimatedStyle(() => ({width: x.value}));
  const line = useAnimatedStyle(() => ({transform: [{translateX: x.value - 1}]}));
  const knob = useAnimatedStyle(() => ({transform: [{translateX: x.value - 18}]}));
  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        <Image source={{uri: after}} style={StyleSheet.absoluteFill} resizeMode="contain" />
        <Animated.View style={[styles.clip, clip]}>
          {/* resizeMethod resize: the original, however big, is decoded at this size. */}
          <Image source={{uri: before}} style={{width, height}} resizeMode="contain" resizeMethod="resize" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.line, line]} />
        <Animated.View pointerEvents="none" style={[styles.knob, {top: height / 2 - 18, backgroundColor: color}, knob]}>
          <Icon name="back" color="#fff" size={14} strokeWidth={2.6} />
          <Icon name="chevron" color="#fff" size={14} strokeWidth={2.6} />
        </Animated.View>
        <View pointerEvents="none" style={[styles.tag, {left: 8}]}>
          <Text style={[type.label, {color: '#fff'}]}>BEFORE</Text>
        </View>
        <View pointerEvents="none" style={[styles.tag, {right: 8}]}>
          <Text style={[type.label, {color: '#fff'}]}>AFTER</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

// ------------------------------------------------------------------- crop

type Box = {x: number; y: number; w: number; h: number};

const ASPECTS: {key: string; label: string; ratio?: number}[] = [
  {key: 'free', label: 'Free'},
  {key: '1:1', label: '1:1', ratio: 1},
  {key: '4:3', label: '4:3', ratio: 4 / 3},
  {key: '3:4', label: '3:4', ratio: 3 / 4},
  {key: '16:9', label: '16:9', ratio: 16 / 9},
  {key: '9:16', label: '9:16', ratio: 9 / 16},
  {key: 'original', label: 'Original'},
];

const MIN_BOX = 48;
const HANDLE = 26;

/**
 * The crop tool's editor: the picture, turned as chosen, with a box over it.
 * Corners and edges resize the box, the box itself moves, the outside is dimmed,
 * and thirds lines show while dragging. The box is kept as fractions of the
 * upright picture, so it maps to the photo's own pixels whatever size the picture
 * is shown at; the native side applies EXIF rotation before reading them.
 */
export function CropEditor({file, o, set, tint}: {file: PickedFile; o: Opts; set: (k: string, v: unknown) => void; tint: TintName}) {
  const t = useTheme();
  const hidden = !useShowPictures();
  const [, deep] = tints[tint];
  const rotate = Number(o.rotate ?? 0);
  const aspectKey: string = o.cropAspect ?? 'free';

  // The picture to crop, turned, at screen size; outWidth/outHeight is its real size.
  const base = useImagePreview(file.uri, useMemo(() => ({rotate: (rotate || undefined) as PreviewOpts['rotate'], format: 'jpg', quality: 85}), [rotate]), 'cropbase', PREVIEW_SIDE).p;
  // What will be saved, small.
  const result = useImagePreview(
    file.uri,
    base ? {rotate: (rotate || undefined) as PreviewOpts['rotate'], crop: o.crop, format: (o.format === 'same' || !o.format ? undefined : o.format) as PreviewOpts['format'], quality: 85} : null,
    'cropthumb',
    320,
  ).p;

  const [area, setArea] = useState({w: 0, h: 0});
  const bw = base?.width ?? 0;
  const bh = base?.height ?? 0;
  const s = bw && area.w ? Math.min(area.w / bw, area.h / bh) : 0;
  const dw = bw * s;
  const dh = bh * s;
  const ox = (area.w - dw) / 2;
  const oy = (area.h - dh) / 2;
  const ratio = ASPECTS.find(a => a.key === aspectKey)?.ratio ?? (aspectKey === 'original' && bw ? bw / bh : 0);

  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const bW = useSharedValue(0);
  const bH = useSharedValue(0);
  const lim = useSharedValue({w: 0, h: 0, r: 0});
  const start = useSharedValue<Box>({x: 0, y: 0, w: 0, h: 0});
  const dragging = useSharedValue(0);

  // The box follows the stored crop (or the whole picture) whenever the picture's
  // size on screen or the crop changes from outside: a turn, a shape, Reset.
  useEffect(() => {
    if (!dw || !dh) return;
    lim.value = {w: dw, h: dh, r: ratio};
    const c = o.crop as Box | undefined;
    const b = c ? {x: c.x * dw, y: c.y * dh, w: c.w * dw, h: c.h * dh} : {x: 0, y: 0, w: dw, h: dh};
    const anim = (v: number) => withTiming(v, {duration: 180});
    bx.value = anim(b.x);
    by.value = anim(b.y);
    bW.value = anim(b.w);
    bH.value = anim(b.h);
  }, [dw, dh, ratio, o.crop, bx, by, bW, bH, lim]);

  const commit = (x: number, y: number, w: number, h: number) => {
    if (!dw || !dh) return;
    set('crop', {x: x / dw, y: y / dh, w: w / dw, h: h / dh});
  };

  /** Largest box of the ratio, centred on the picture; null for the whole of it. */
  const fitted = (r: number) => {
    if (!r || !dw) return undefined;
    let w = dw;
    let h = dw / r;
    if (h > dh) {
      h = dh;
      w = dh * r;
    }
    return {x: (dw - w) / 2 / dw, y: (dh - h) / 2 / dh, w: w / dw, h: h / dh};
  };

  const chooseAspect = (key: string) => {
    set('cropAspect', key);
    const r = ASPECTS.find(a => a.key === key)?.ratio ?? (key === 'original' && bw ? bw / bh : 0);
    if (r) set('crop', fitted(r));
  };

  const turn = () => {
    haptic(6);
    set('rotate', (rotate + 90) % 360);
    // The box is of the turned picture, so it starts again over the whole of it.
    set('crop', undefined);
    if (aspectKey !== 'free' && aspectKey !== 'original') set('cropAspect', 'free');
  };

  const reset = () => {
    haptic(6);
    set('rotate', 0);
    set('cropAspect', 'free');
    set('crop', undefined);
  };

  // Gestures read only shared values, so they are made once a size is known; the
  // latest commit is reached through a ref.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const commitLatest = useRef((x: number, y: number, w: number, h: number) => commitRef.current(x, y, w, h)).current;

  // sx / sy: which side a handle moves (-1 left/top, 1 right/bottom, 0 not that axis); 0, 0 moves the box.
  const handle = (sx: number, sy: number) =>
    Gesture.Pan()
      .hitSlop(14)
      .onBegin(() => {
        start.value = {x: bx.value, y: by.value, w: bW.value, h: bH.value};
        dragging.value = withTiming(1, {duration: 120});
      })
      .onUpdate(e => {
        const st = start.value;
        const L = lim.value;
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        if (sx === 0 && sy === 0) {
          bx.value = clamp(st.x + e.translationX, 0, L.w - st.w);
          by.value = clamp(st.y + e.translationY, 0, L.h - st.h);
          return;
        }
        // The side opposite the handle stays where it is.
        const ax = sx > 0 ? st.x : st.x + st.w;
        const ay = sy > 0 ? st.y : st.y + st.h;
        const maxW = sx > 0 ? L.w - ax : ax;
        const maxH = sy > 0 ? L.h - ay : ay;
        let w = sx === 0 ? st.w : clamp(st.w + sx * e.translationX, MIN_BOX, maxW);
        let h = sy === 0 ? st.h : clamp(st.h + sy * e.translationY, MIN_BOX, maxH);
        if (L.r > 0) {
          // A fixed shape: the corner follows the larger of the two moves.
          if (w / h > L.r) h = w / L.r;
          else w = h * L.r;
          if (h > maxH) {
            h = maxH;
            w = h * L.r;
          }
          if (w > maxW) {
            w = maxW;
            h = w / L.r;
          }
        }
        bW.value = w;
        bH.value = h;
        bx.value = sx === 0 ? st.x : sx > 0 ? ax : ax - w;
        by.value = sy === 0 ? st.y : sy > 0 ? ay : ay - h;
      })
      .onEnd(() => {
        runOnJS(commitLatest)(bx.value, by.value, bW.value, bH.value);
      })
      .onFinalize(() => {
        dragging.value = withTiming(0, {duration: 200});
      });

  const gestures = useMemo(() => {
    const g = (sx: number, sy: number) => handle(sx, sy);
    return {
      move: g(0, 0),
      tl: g(-1, -1),
      tr: g(1, -1),
      bl: g(-1, 1),
      br: g(1, 1),
      l: g(-1, 0),
      r: g(1, 0),
      t: g(0, -1),
      b: g(0, 1),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dw, dh]);

  const boxStyle = useAnimatedStyle(() => ({left: ox + bx.value, top: oy + by.value, width: bW.value, height: bH.value}));
  const dimTop = useAnimatedStyle(() => ({height: oy + by.value}));
  const dimBottom = useAnimatedStyle(() => ({top: oy + by.value + bH.value}));
  const dimLeft = useAnimatedStyle(() => ({top: oy + by.value, height: bH.value, width: ox + bx.value}));
  const dimRight = useAnimatedStyle(() => ({top: oy + by.value, height: bH.value, left: ox + bx.value + bW.value}));
  const thirds = useAnimatedStyle(() => ({opacity: dragging.value}));
  const corner = (cx: 0 | 1, cy: 0 | 1) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({left: ox + bx.value + cx * bW.value - HANDLE / 2, top: oy + by.value + cy * bH.value - HANDLE / 2}));
  const cTL = corner(0, 0);
  const cTR = corner(1, 0);
  const cBL = corner(0, 1);
  const cBR = corner(1, 1);
  const eL = useAnimatedStyle(() => ({left: ox + bx.value - 12, top: oy + by.value + bH.value / 2 - 18}));
  const eR = useAnimatedStyle(() => ({left: ox + bx.value + bW.value - 12, top: oy + by.value + bH.value / 2 - 18}));
  const eT = useAnimatedStyle(() => ({left: ox + bx.value + bW.value / 2 - 18, top: oy + by.value - 12}));
  const eB = useAnimatedStyle(() => ({left: ox + bx.value + bW.value / 2 - 18, top: oy + by.value + bH.value - 12}));

  const dimColor = 'rgba(0,0,0,0.55)';
  const free = !ratio;

  return (
    <View style={{marginTop: spacing.md}}>
      <View
        style={[styles.cropArea, {backgroundColor: t.cardAlt}]}
        onLayout={e => setArea({w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}>
        {!base || hidden ? (
          !base ? <SkeletonBlock width="100%" height={area.h || 320} r={radius.md} /> : null
        ) : (
          <>
            <Image source={{uri: base.uri}} style={{position: 'absolute', left: ox, top: oy, width: dw, height: dh}} />
            <Animated.View pointerEvents="none" style={[styles.dim, {top: 0, left: 0, right: 0, backgroundColor: dimColor}, dimTop]} />
            <Animated.View pointerEvents="none" style={[styles.dim, {bottom: 0, left: 0, right: 0, backgroundColor: dimColor}, dimBottom]} />
            <Animated.View pointerEvents="none" style={[styles.dim, {left: 0, backgroundColor: dimColor}, dimLeft]} />
            <Animated.View pointerEvents="none" style={[styles.dim, {right: 0, backgroundColor: dimColor}, dimRight]} />
            <GestureDetector gesture={gestures.move}>
              <Animated.View style={[styles.box, {borderColor: '#fff'}, boxStyle]}>
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, thirds]}>
                  <View style={[styles.vLine, {left: '33.33%'}]} />
                  <View style={[styles.vLine, {left: '66.66%'}]} />
                  <View style={[styles.hLine, {top: '33.33%'}]} />
                  <View style={[styles.hLine, {top: '66.66%'}]} />
                </Animated.View>
              </Animated.View>
            </GestureDetector>
            {free ? (
              <>
                <GestureDetector gesture={gestures.l}>
                  <Animated.View style={[styles.edgeV, eL]}>
                    <View style={[styles.edgeBarV, {backgroundColor: deep}]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={gestures.r}>
                  <Animated.View style={[styles.edgeV, eR]}>
                    <View style={[styles.edgeBarV, {backgroundColor: deep}]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={gestures.t}>
                  <Animated.View style={[styles.edgeH, eT]}>
                    <View style={[styles.edgeBarH, {backgroundColor: deep}]} />
                  </Animated.View>
                </GestureDetector>
                <GestureDetector gesture={gestures.b}>
                  <Animated.View style={[styles.edgeH, eB]}>
                    <View style={[styles.edgeBarH, {backgroundColor: deep}]} />
                  </Animated.View>
                </GestureDetector>
              </>
            ) : null}
            {(
              [
                [gestures.tl, cTL],
                [gestures.tr, cTR],
                [gestures.bl, cBL],
                [gestures.br, cBR],
              ] as const
            ).map(([g, st], i) => (
              <GestureDetector key={i} gesture={g}>
                <Animated.View style={[styles.corner, {backgroundColor: deep}, st]} />
              </GestureDetector>
            ))}
          </>
        )}
      </View>

      <View style={styles.chips}>
        {ASPECTS.map(a => (
          <Chip key={a.key} label={a.label} active={aspectKey === a.key} onPress={() => chooseAspect(a.key)} />
        ))}
      </View>

      <View style={styles.cropBar}>
        <PressableScale onPress={turn} style={[styles.cropBtn, {backgroundColor: t.cardAlt, borderColor: t.border}]} accessibilityLabel="Rotate 90 degrees">
          <Icon name="rotate" color={t.text} size={18} />
          <Text style={[type.caption, {color: t.text, marginLeft: 6, fontWeight: '700'}]}>Rotate 90°</Text>
        </PressableScale>
        <PressableScale onPress={reset} style={[styles.cropBtn, {backgroundColor: t.cardAlt, borderColor: t.border, marginLeft: spacing.sm}]} accessibilityLabel="Reset crop">
          <Icon name="refresh" color={t.text} size={18} />
          <Text style={[type.caption, {color: t.text, marginLeft: 6, fontWeight: '700'}]}>Reset</Text>
        </PressableScale>
        <View style={{flex: 1}} />
        {result && !hidden ? (
          <View style={styles.resultWrap}>
            <View style={{alignItems: 'flex-end', marginRight: spacing.sm}}>
              <Text style={[type.label, {color: t.textMuted}]}>RESULT</Text>
              <Text style={[type.bodyNum, {color: t.text, marginTop: 2}]}>
                {result.outWidth} × {result.outHeight}
              </Text>
            </View>
            <Image source={{uri: result.uri}} style={[styles.resultThumb, {aspectRatio: result.width / result.height, borderColor: t.border}]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewCard: {padding: spacing.md, marginTop: spacing.sm},
  frame: {borderRadius: radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center'},
  previewInfo: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm},
  badge: {position: 'absolute', top: 8, right: 8, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3},
  clip: {position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden'},
  line: {position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, backgroundColor: '#fff'},
  knob: {position: 'absolute', left: 0, width: 36, height: 36, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff'},
  tag: {position: 'absolute', bottom: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 3},
  cropArea: {height: 360, borderRadius: radius.md, overflow: 'hidden'},
  dim: {position: 'absolute'},
  box: {position: 'absolute', borderWidth: 1.5},
  vLine: {position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.8)'},
  hLine: {position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.8)'},
  corner: {position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2, borderWidth: 3, borderColor: '#fff'},
  edgeV: {position: 'absolute', width: 24, height: 36, alignItems: 'center', justifyContent: 'center'},
  edgeH: {position: 'absolute', width: 36, height: 24, alignItems: 'center', justifyContent: 'center'},
  edgeBarV: {width: 5, height: 26, borderRadius: 3, borderWidth: 1, borderColor: '#fff'},
  edgeBarH: {width: 26, height: 5, borderRadius: 3, borderWidth: 1, borderColor: '#fff'},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md},
  cropBar: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.md},
  cropBtn: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 40},
  resultWrap: {flexDirection: 'row', alignItems: 'center'},
  resultThumb: {height: 56, maxWidth: 96, borderRadius: radius.sm, borderWidth: 1},
});
