import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Image, PixelRatio, StyleSheet, Text, View, requireNativeComponent, type ViewProps} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {useIsFocused} from '@react-navigation/native';
import Animated, {runOnJS, useAnimatedStyle, useSharedValue} from 'react-native-reanimated';

import {Icon} from './Icon';
import {PressableScale, haptic} from './motion';
import {Field, SkeletonBlock, ToggleRow} from './ui';
import {useInBackground} from '@/hooks/useInBackground';
import {MediaTools, onThumbStrip, type MediaProbe} from '@/native/Tools';
import {radius, spacing, tints, type, useTheme, type TintName} from '@/theme';

type PlayerProps = ViewProps & {
  src: string;
  startMs: number;
  endMs: number;
  previewMs: number;
  previewExact: boolean;
  playing: boolean;
  onProgress?: (e: {nativeEvent: {positionMs: number; playing: boolean}}) => void;
};

/** TrimPlayerView.kt: ExoPlayer drawing the clip, no bitmaps held. */
const TrimPlayer = requireNativeComponent<PlayerProps>('TrimPlayer');

/** Shortest part that can be kept. */
const MIN_MS = 1000;
const HANDLE_W = 16;
const STRIP_H = 52;
/** A handle this close to either end of the video snaps onto it. */
const SNAP_PX = 10;

/** m:ss.s */
export const fmt = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 100)) / 10;
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** m:ss.s, ss.s or plain seconds back to ms; NaN when it is not a time. */
const parse = (text: string) => {
  const m = text.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000);
};

/**
 * Trim Video, the way a phone's status editor does it: the video at the top,
 * which shows the frame under whichever handle is being dragged and plays just
 * the kept part; a strip of frames over the whole video beneath it; and a bracket
 * on the strip whose two handles set the start and the end. The strip's frames
 * are small JPEGs made one by one on the native side and arrive as they are made.
 */
export function VideoTrimmer({uri, probe, start, end, onChange, tint}: {
  uri: string;
  probe: MediaProbe;
  start: number;
  end: number;
  onChange: (startMs: number, endMs: number) => void;
  tint: TintName;
}) {
  const t = useTheme();
  // Out of sight (background, or the Processing screen over this one): no player, no strip.
  const focused = useIsFocused();
  const hidden = useInBackground() || !focused;
  const [, deep] = tints[tint];
  const dur = probe.durationMs;
  const minLen = Math.min(MIN_MS, dur);

  const [w, setW] = useState(0);
  const sw = Math.max(0, w - HANDLE_W * 2);
  const count = w > 380 ? 12 : 10;

  // ----------------------------------------------------------------- strip
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  useEffect(() => {
    if (!w || hidden) return;
    let alive = true;
    setThumbs(Array(count).fill(null));
    const off = onThumbStrip(p => {
      if (!alive || p.index >= count) return;
      setThumbs(prev => {
        const next = prev.length === count ? [...prev] : Array(count).fill(null);
        next[p.index] = p.uri;
        return next;
      });
    });
    MediaTools.thumbnails(uri, count, Math.round(STRIP_H * PixelRatio.get()))
      .then(r => alive && setThumbs(prev => r.uris.map((u, i) => u ?? prev[i] ?? null)))
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [uri, count, w, hidden]);
  useEffect(() => () => MediaTools.clearThumbnails(), []);

  // ---------------------------------------------------------------- player
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [previewMs, setPreviewMs] = useState(start);
  const [exact, setExact] = useState(true);
  useEffect(() => {
    if (hidden) setPlaying(false);
  }, [hidden]);

  // ---------------------------------------------------------------- bracket
  const toPx = (ms: number) => (dur > 0 ? (ms / dur) * sw : 0);
  const sx = useSharedValue(0);
  const ex = useSharedValue(0);
  const span = useSharedValue({sw: 0, min: 0});
  const grab = useSharedValue(0);
  const edge = useSharedValue(0);
  useEffect(() => {
    span.value = {sw, min: dur > 0 ? (minLen / dur) * sw : 0};
    sx.value = toPx(start);
    ex.value = toPx(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sw, start, end, dur]);

  // Dragging: the frame follows the handle (nearest key frame, quick), and the
  // range is reported at most every 60 ms; on release the exact frame is shown.
  const last = useRef(0);
  const live = useRef({start, end});
  live.current = {start, end};
  const step = (v: number) => Math.round(v / 100) * 100;
  const drag = (which: number, px: number) => {
    const ms = Math.max(0, Math.min(dur, step((px / Math.max(1, sw)) * dur)));
    setPlaying(false);
    setExact(false);
    setPreviewMs(ms);
    const now = Date.now();
    if (now - last.current < 60) return;
    last.current = now;
    if (which === 0) onChange(Math.min(ms, live.current.end - minLen), live.current.end);
    else onChange(live.current.start, Math.max(ms, live.current.start + minLen));
  };
  const release = (which: number, px: number) => {
    let ms = Math.max(0, Math.min(dur, step((px / Math.max(1, sw)) * dur)));
    if (px >= sw - 0.5) ms = dur;
    if (which === 0) {
      const s = Math.max(0, Math.min(ms, live.current.end - minLen));
      onChange(s, live.current.end);
      setPreviewMs(s);
    } else {
      const e = Math.min(dur, Math.max(ms, live.current.start + minLen));
      onChange(live.current.start, e);
      setPreviewMs(e);
    }
    setExact(true);
  };
  const tick = () => haptic(5);
  // The gestures are made once a width is known and read only shared values; the
  // latest drag and release are reached through refs.
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const onDrag = useRef((which: number, px: number) => dragRef.current(which, px)).current;
  const onRelease = useRef((which: number, px: number) => releaseRef.current(which, px)).current;

  const handle = (which: 0 | 1) =>
    Gesture.Pan()
      .hitSlop({horizontal: 14, vertical: 10})
      .onBegin(() => {
        grab.value = which === 0 ? sx.value : ex.value;
        edge.value = 0;
      })
      .onUpdate(e => {
        const S = span.value;
        let v = grab.value + e.translationX;
        let limit = false;
        if (which === 0) {
          const hi = ex.value - S.min;
          if (v <= SNAP_PX) v = 0;
          if (v >= hi) {
            v = hi;
            limit = true;
          }
          if (v <= 0) limit = true;
          sx.value = Math.max(0, v);
        } else {
          const lo = sx.value + S.min;
          if (v >= S.sw - SNAP_PX) v = S.sw;
          if (v <= lo) {
            v = lo;
            limit = true;
          }
          if (v >= S.sw) limit = true;
          ex.value = Math.min(S.sw, v);
        }
        // A tick once each time a handle meets the end, the other handle or a snap.
        if (limit && edge.value === 0) runOnJS(tick)();
        edge.value = limit ? 1 : 0;
        runOnJS(onDrag)(which, which === 0 ? sx.value : ex.value);
      })
      .onEnd(() => {
        runOnJS(onRelease)(which, which === 0 ? sx.value : ex.value);
      });
  const gestures = useMemo(() => ({s: handle(0), e: handle(1)}), [sw]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = useAnimatedStyle(() => ({left: sx.value}));
  const right = useAnimatedStyle(() => ({left: HANDLE_W + ex.value}));
  const dimL = useAnimatedStyle(() => ({width: sx.value}));
  const dimR = useAnimatedStyle(() => ({left: HANDLE_W + ex.value, right: HANDLE_W}));
  const frame = useAnimatedStyle(() => ({left: HANDLE_W + sx.value, width: Math.max(0, ex.value - sx.value)}));

  // ---------------------------------------------------------------- times
  const [editTimes, setEditTimes] = useState(false);
  const [startText, setStartText] = useState(fmt(start));
  const [endText, setEndText] = useState(fmt(end));
  useEffect(() => {
    if (parse(startText) !== start) setStartText(fmt(start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);
  useEffect(() => {
    if (parse(endText) !== end) setEndText(fmt(end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end]);
  const typed = (which: 0 | 1, text: string) => {
    if (which === 0) setStartText(text);
    else setEndText(text);
    const ms = parse(text);
    if (Number.isNaN(ms)) return;
    if (which === 0 && ms >= 0 && ms <= end - minLen) {
      onChange(ms, end);
      setPreviewMs(ms);
    } else if (which === 1 && ms <= dur && ms >= start + minLen) {
      onChange(start, ms);
      setPreviewMs(ms);
    }
  };

  // The video's shape on screen, upright.
  const turned = probe.rotation === 90 || probe.rotation === 270;
  const vw = (turned ? probe.height : probe.width) || 16;
  const vh = (turned ? probe.width : probe.height) || 9;
  const boxH = w ? Math.min(w * 0.75, 300) : 220;
  const pw = Math.min(w, (boxH * vw) / vh);
  const ph = (pw * vh) / vw;

  const playX = position != null && playing && dur > 0 ? HANDLE_W + (position / dur) * sw : null;

  return (
    <View style={{marginTop: spacing.md}}>
      <View style={[styles.stage, {height: boxH}]} onLayout={e => setW(e.nativeEvent.layout.width)}>
        {w && !hidden ? (
          <TrimPlayer
            src={uri}
            startMs={start}
            endMs={end}
            previewMs={previewMs}
            previewExact={exact}
            playing={playing}
            onProgress={e => {
              setPosition(e.nativeEvent.positionMs);
              if (!e.nativeEvent.playing) setPlaying(false);
            }}
            style={{width: pw, height: ph}}
          />
        ) : null}
        <PressableScale
          onPress={() => {
            haptic(6);
            setPlaying(p => !p);
          }}
          scaleTo={0.92}
          style={[styles.play, {backgroundColor: deep, shadowColor: deep}]}
          accessibilityLabel={playing ? 'Pause' : 'Play the kept part'}>
          <Icon name={playing ? 'pause' : 'play'} color="#FFFFFF" size={22} strokeWidth={2.4} />
        </PressableScale>
      </View>

      <View style={[styles.strip, {height: STRIP_H + 8}]}>
        <View style={[styles.thumbs, {left: HANDLE_W, right: HANDLE_W, backgroundColor: t.cardAlt}]}>
          {thumbs.length && !hidden
            ? thumbs.map((u, i) =>
                u ? <Image key={i} source={{uri: u}} style={styles.thumb} resizeMode="cover" fadeDuration={120} /> : <SkeletonBlock key={i} width={sw / count} height={STRIP_H} r={0} />,
              )
            : null}
        </View>
        <Animated.View pointerEvents="none" style={[styles.dim, {left: HANDLE_W}, dimL]} />
        <Animated.View pointerEvents="none" style={[styles.dim, dimR]} />
        <Animated.View pointerEvents="none" style={[styles.frame, {borderColor: deep}, frame]} />
        {playX != null ? <View pointerEvents="none" style={[styles.playhead, {left: playX}]} /> : null}
        <GestureDetector gesture={gestures.s}>
          <Animated.View style={[styles.handle, styles.handleL, {backgroundColor: deep}, left]} accessibilityLabel="Start handle">
            <View style={styles.grip} />
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={gestures.e}>
          <Animated.View style={[styles.handle, styles.handleR, {backgroundColor: deep}, right]} accessibilityLabel="End handle">
            <View style={styles.grip} />
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.times}>
        <View>
          <Text style={[type.label, {color: t.textMuted}]}>START</Text>
          <Text style={[type.bodyNum, {color: t.text}]}>{fmt(start)}</Text>
        </View>
        <View style={{alignItems: 'center'}}>
          <Text style={[type.label, {color: t.textMuted}]}>LENGTH</Text>
          <Text style={[type.bodyNum, {color: deep}]}>{fmt(end - start)}</Text>
        </View>
        <View style={{alignItems: 'flex-end'}}>
          <Text style={[type.label, {color: t.textMuted}]}>END</Text>
          <Text style={[type.bodyNum, {color: t.text}]}>{fmt(end)}</Text>
        </View>
      </View>

      <ToggleRow label="Edit times" hint="Type the start and end, as m:ss.s" value={editTimes} onChange={setEditTimes} />
      {editTimes ? (
        <View style={styles.fields}>
          <View style={{flex: 1}}>
            <Field label="Start" value={startText} onChangeText={v => typed(0, v)} placeholder="0:00.0" />
          </View>
          <View style={{flex: 1, marginLeft: spacing.sm}}>
            <Field label="End" value={endText} onChangeText={v => typed(1, v)} placeholder={fmt(dur)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center'},
  play: {position: 'absolute', right: 12, bottom: 12, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: {width: 0, height: 3}},
  strip: {marginTop: spacing.md, justifyContent: 'center'},
  thumbs: {position: 'absolute', top: 4, height: STRIP_H, flexDirection: 'row', overflow: 'hidden', borderRadius: 4},
  thumb: {flex: 1, height: STRIP_H},
  dim: {position: 'absolute', top: 4, height: STRIP_H, backgroundColor: 'rgba(0,0,0,0.6)'},
  frame: {position: 'absolute', top: 0, height: STRIP_H + 8, borderTopWidth: 4, borderBottomWidth: 4},
  playhead: {position: 'absolute', top: 0, width: 2, height: STRIP_H + 8, marginLeft: -1, backgroundColor: '#fff', borderRadius: 1},
  handle: {position: 'absolute', top: 0, width: HANDLE_W, height: STRIP_H + 8, alignItems: 'center', justifyContent: 'center'},
  handleL: {borderTopLeftRadius: 6, borderBottomLeftRadius: 6},
  handleR: {borderTopRightRadius: 6, borderBottomRightRadius: 6},
  grip: {width: 3, height: 20, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.9)'},
  times: {flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.xs},
  fields: {flexDirection: 'row'},
});
