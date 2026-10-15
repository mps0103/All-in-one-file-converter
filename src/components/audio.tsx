import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, StyleSheet, Text, View} from 'react-native';
import Svg, {Rect} from 'react-native-svg';
import {useFocusEffect} from '@react-navigation/native';

import {Icon} from '@/components/Icon';
import {PressableScale} from '@/components/motion';
import {SkeletonBlock} from '@/components/ui';
import {AudioPreview, MediaTools, onPreviewPosition} from '@/native/Tools';
import {clock} from '@/tools/helpers';
import {spacing, type, useTheme} from '@/theme';

export const WAVE_BARS = 200;

/**
 * The sound of a file as bars, drawn behind the trim handles. Bars inside the
 * kept part are in the accent colour, the rest are dimmed, and a line follows the
 * preview while it plays. A skeleton stands in while the file is being read.
 */
export function Waveform({peaks, from, to, duration, position}: {peaks: number[] | null; from: number; to: number; duration: number; position: number | null}) {
  const t = useTheme();
  // One root for both states, measured once. With a separate root per state, the
  // native view was reused when the peaks arrived, onLayout did not fire again,
  // and the height the skeleton never recorded kept the bars from being drawn.
  const [size, setSize] = useState({w: 0, h: 0});
  const {w, h} = size;

  // Scaled to the loudest bar, so a quiet recording still shows its shape.
  const loudest = peaks ? Math.max(0.05, ...peaks) : 1;
  const bw = peaks ? w / peaks.length : 0;
  const fs = duration > 0 ? from / duration : 0;
  const fe = duration > 0 ? to / duration : 1;
  const head = position != null && duration > 0 ? (position / duration) * w : null;

  return (
    <View
      style={styles.fill}
      onLayout={e => {
        const {width, height} = e.nativeEvent.layout;
        setSize(prev => (prev.w === width && prev.h === height ? prev : {w: width, h: height}));
      }}>
      {!peaks ? (
        <View style={styles.skeletonRow}>
          {Array.from({length: 24}, (_, i) => (
            <SkeletonBlock key={i} width={Math.max(2, w / 24 - 4)} height={10 + ((i * 37) % 44)} r={2} />
          ))}
        </View>
      ) : w > 0 && h > 0 ? (
        <Svg width={w} height={h}>
          {peaks.map((p, i) => {
            const f = (i + 0.5) / peaks.length;
            const bh = Math.max(2, (p / loudest) * (h - 8));
            const inside = f >= fs && f <= fe;
            return (
              <Rect
                key={i}
                x={i * bw + bw * 0.18}
                y={(h - bh) / 2}
                width={Math.max(1, bw * 0.64)}
                height={bh}
                rx={Math.min(1.5, bw * 0.3)}
                fill={inside ? t.info : t.textDim}
                opacity={inside ? 0.55 : 0.28}
              />
            );
          })}
          {head != null ? <Rect x={Math.max(0, Math.min(w - 2, head - 1))} y={0} width={2} height={h} rx={1} fill={t.text} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}

type Preview = {
  ready: boolean;
  playing: boolean;
  /** Where the preview is, in ms of the file, or null before it has played. */
  position: number | null;
  /** Plays fromMs..toMs once (or looping, per setEffects). */
  play: (fromMs: number, toMs: number) => void;
  pause: () => void;
  setEffects: (gain: number, fadeInMs: number, fadeOutMs: number, loop: boolean) => void;
};

/**
 * One preview player for a screen. Loads the file, follows its position, and lets
 * it go when the screen loses focus or closes; the native side also lets it go
 * when the app goes to the background, and the next play loads it again.
 */
export function useAudioPreview(uri: string | undefined, enabled: boolean): Preview {
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const loaded = useRef<string | null>(null);
  const effects = useRef<[number, number, number, boolean]>([1, 0, 0, false]);

  const load = useCallback(async () => {
    if (!uri || !enabled) return false;
    if (loaded.current === uri) return true;
    try {
      await AudioPreview.load(uri);
      loaded.current = uri;
      AudioPreview.setEffects(...effects.current);
      setReady(true);
      return true;
    } catch {
      setReady(false);
      return false;
    }
  }, [uri, enabled]);

  useEffect(() => {
    loaded.current = null;
    setReady(false);
    setPosition(null);
    setPlaying(false);
    load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    return onPreviewPosition(p => {
      if (p.positionMs < 0) {
        // The app went to the background and the player was let go.
        loaded.current = null;
        setPlaying(false);
        return;
      }
      setPosition(p.positionMs);
      setPlaying(p.playing);
    });
  }, [enabled]);

  const release = useCallback(() => {
    AudioPreview.release();
    loaded.current = null;
    setPlaying(false);
  }, []);

  // Leaving the screen, or the screen going away, stops the sound.
  useFocusEffect(useCallback(() => release, [release]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => s !== 'active' && setPlaying(false));
    return () => sub.remove();
  }, []);

  const play = useCallback(
    async (fromMs: number, toMs: number) => {
      if (!(await load())) return;
      AudioPreview.play(fromMs, toMs);
      setPlaying(true);
    },
    [load],
  );

  const pause = useCallback(() => {
    AudioPreview.pause();
    setPlaying(false);
  }, []);

  const setEffects = useCallback((gain: number, fadeInMs: number, fadeOutMs: number, loop: boolean) => {
    effects.current = [gain, fadeInMs, fadeOutMs, loop];
    if (loaded.current) AudioPreview.setEffects(gain, fadeInMs, fadeOutMs, loop);
  }, []);

  return {ready, playing, position, play, pause, setEffects};
}

/** Peaks for a file, read once per file. null while loading or if it cannot be read. */
export function useWaveform(uri: string | undefined, enabled: boolean) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!uri || !enabled) return;
    let alive = true;
    MediaTools.waveform(uri, WAVE_BARS)
      .then(p => alive && setPeaks(p))
      .catch(() => alive && setPeaks(Array(WAVE_BARS).fill(0.05)));
    return () => {
      alive = false;
    };
  }, [uri, enabled]);
  return peaks;
}

/** The round play/pause button and the time, under the waveform. */
export function PreviewBar({playing, onToggle, position, from, to, loop}: {playing: boolean; onToggle: () => void; position: number | null; from: number; to: number; loop?: boolean}) {
  const t = useTheme();
  const into = position == null ? 0 : Math.max(0, Math.min(to, position) - from);
  return (
    <View style={styles.bar}>
      <PressableScale onPress={onToggle} scaleTo={0.92} style={[styles.play, {backgroundColor: t.info, shadowColor: t.info}]} accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}>
        <Icon name={playing ? 'pause' : 'play'} color="#FFFFFF" size={22} strokeWidth={2.4} />
      </PressableScale>
      <View style={{marginLeft: spacing.md, flex: 1}}>
        <Text style={[type.bodyNum, {color: t.text}]}>
          {clock(into)} / {clock(to - from)}
        </Text>
        <Text style={[type.caption, {color: t.textMuted, marginTop: 2}]}>{loop ? 'Plays the ringtone on repeat' : 'Plays only the part you keep'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
  skeletonRow: {flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2},
  bar: {flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm},
  play: {width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', elevation: 4, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: {width: 0, height: 3}},
});
