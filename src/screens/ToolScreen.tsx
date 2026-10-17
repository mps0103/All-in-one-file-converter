import React, {useEffect, useMemo, useState} from 'react';
import {Image, PixelRatio, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import Animated, {FadeIn, LinearTransition, ZoomIn} from 'react-native-reanimated';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import {Icon} from '@/components/Icon';
import {PressableScale, enter, haptic} from '@/components/motion';
import {
  AppDialog,
  Card,
  Chip,
  Field,
  GhostButton,
  GradientButton,
  GradientTile,
  RangeSlider,
  Screen,
  ScreenHeader,
  SectionHeader,
  Segmented,
  SkeletonBlock,
  Slider,
  ToggleRow,
  WindowSlider,
} from '@/components/ui';
import {PreviewBar, Waveform, useAudioPreview, useWaveform} from '@/components/audio';
import {CropEditor, ImagePreviewCard, useClearPreviewsOnClose} from '@/components/imageTools';
import {VideoTrimmer} from '@/components/videoTrim';
import {useApp} from '@/hooks/AppState';
import {useInBackground} from '@/hooks/useInBackground';
import {FileBridge, isCancelled, type PickedFile} from '@/native/FileBridge';
import {scanPages} from '@/native/scanner';
import {MediaTools, type MediaProbe} from '@/native/Tools';
import {isRewardedReady, showRewarded} from '@/services/ads';
import {FREE_CONVERSIONS} from '@/services/quota';
import {realId, toolFor} from '@/tools/registry';
import {clock, humanBytes} from '@/tools/helpers';
import {imageOptions} from '@/tools/media';
import type {Opt, Opts} from '@/tools/types';
import {radius, spacing, tints, type, useTheme, type TintName} from '@/theme';
import type {RootStackParamList} from '@/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Tool'>;

const defaults = (opts: Opt[] = []): Opts => {
  const o: Opts = {};
  for (const opt of opts) {
    if (opt.kind === 'trim') continue;
    if ('def' in opt && opt.def !== undefined) o[opt.key] = opt.def;
  }
  return o;
};

/**
 * View File is listed with the tools but is not one: it opens the viewer, from
 * every place a tool can be started (category list, search, quick tiles), so it
 * never reaches the free-conversion gate or the rewarded ad.
 */
export function ToolScreen(props: Props) {
  return realId(props.route.params.toolId) === 'view-file' ? <ToViewer {...props} /> : <ToolScreenBody {...props} />;
}

function ToViewer({route, navigation}: Props) {
  const t = useTheme();
  useEffect(() => {
    navigation.replace('Viewer', {file: route.params.files?.[0]});
  }, [navigation, route.params.files]);
  return <View style={{flex: 1, backgroundColor: t.bg}} />;
}

function ToolScreenBody({route, navigation}: Props) {
  const t = useTheme();
  const tool = toolFor(route.params.toolId);
  const {premium, remaining, earnCredit} = useApp();
  const [files, setFiles] = useState<PickedFile[]>(route.params.files ?? []);
  const [o, setO] = useState<Opts>(() => defaults(tool.options));
  const [probe, setProbe] = useState<MediaProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [thumb, setThumb] = useState('');
  const hidden = useInBackground();
  const [gate, setGate] = useState(false);
  const [error, setError] = useState('');

  // The picture's own size, upright, once its preview has been drawn: what the
  // linked width and height fields of Resize work from.
  const [src, setSrc] = useState<{w: number; h: number} | null>(null);
  const linked = !!tool.options?.some(x => x.key === 'keepAspect');
  const set = (k: string, v: unknown) => setO(prev => linkSides({...prev, [k]: v}, k, linked ? src : null));
  useClearPreviewsOnClose();
  // The part of the media being kept: two handles (trim) or a fixed-length window (ringtone).
  const trimOpt = tool.options?.find(x => x.kind === 'trim' || x.kind === 'window');

  // Audio and video: read length and size of the first file.
  const first = files[0]?.uri;
  useEffect(() => setSrc(null), [first]);
  useEffect(() => {
    if (!tool.media || !first) {
      setProbe(null);
      setThumb('');
      return;
    }
    let alive = true;
    setProbing(true);
    setProbeError('');
    MediaTools.probe(first)
      .then(p => {
        if (!alive) return;
        setProbe(p);
        if (trimOpt && p.durationMs > 0) {
          if (trimOpt.kind === 'window') {
            // A song shorter than the window is covered whole.
            setO(prev => ({...prev, startMs: 0, endMs: Math.min(Number(prev[trimOpt.key] ?? trimOpt.def), p.durationMs)}));
          } else {
            const len = trimOpt.kind === 'trim' && trimOpt.defaultLengthMs ? Math.min(trimOpt.defaultLengthMs, p.durationMs) : p.durationMs;
            setO(prev => ({...prev, startMs: 0, endMs: len}));
          }
        }
        if (p.hasVideo) {
          // Drawn at the size it is shown, in real pixels.
          MediaTools.thumbnail(first, Math.min(1000, p.durationMs / 3), Math.round(styles.thumb.width * PixelRatio.get()))
            .then(b => alive && setThumb(b))
            .catch(() => {});
        }
      })
      .catch(() => alive && setProbeError('This phone cannot read this file as audio or video.'))
      .finally(() => alive && setProbing(false));
    return () => {
      alive = false;
    };
  }, [first, tool.media, trimOpt]);

  // "Listen before you cut": the audio tools that keep a part, fade or change volume
  // get a waveform and a preview player that sounds like what will be written.
  const id = realId(tool.id);
  const listen = tool.category === 'audio' && !!tool.media && (!!trimOpt || id === 'audio-fade' || id === 'audio-volume');
  const dur = probe?.durationMs ?? 0;
  const peaks = useWaveform(first, listen);
  const preview = useAudioPreview(first, listen);
  const from = trimOpt ? Number(o.startMs ?? 0) : 0;
  const to = trimOpt ? Number(o.endMs ?? dur) : dur;

  // The tool's own fades and volume, applied to the preview as they are set.
  const {setEffects} = preview;
  useEffect(() => {
    if (!listen) return;
    if (id === 'audio-fade') setEffects(1, Number(o.fadeIn ?? 0) * 1000, Number(o.fadeOut ?? 0) * 1000, false);
    else if (id === 'audio-volume') setEffects(Number(o.volume ?? 100) / 100, 0, 0, false);
    else if (id === 'ringtone') setEffects(1, o.fade ? 1500 : 0, o.fade ? 2000 : 0, true);
    else setEffects(1, 0, 0, false);
  }, [listen, id, o.fadeIn, o.fadeOut, o.volume, o.fade, setEffects]);

  const togglePreview = () => (preview.playing ? preview.pause() : preview.play(from, to));
  // Let go of a trim handle: hear 3 s from a new start, or the last 3 s before a new end.
  const onTrimRelease = (thumb: 'start' | 'end') =>
    thumb === 'start' ? preview.play(from, Math.min(from + 3000, to)) : preview.play(Math.max(from, to - 3000), to);

  const pick = async (append: boolean) => {
    setError('');
    try {
      const picked = tool.multi ? await FileBridge.pickFiles(tool.accept) : [await FileBridge.pickFile(tool.accept)];
      haptic(6);
      setFiles(prev => (append ? [...prev, ...picked] : picked));
    } catch (e) {
      if (!isCancelled(e)) setError((e as Error).message || 'Could not open the file picker.');
    }
  };

  // Image to PDF can also take pages straight from the camera, through the document scanner.
  const scans = realId(tool.id) === 'image-to-pdf';
  const scan = async () => {
    setError('');
    try {
      const pages = await scanPages();
      if (!pages.length) return;
      haptic(6);
      setFiles(prev => [...prev, ...pages]);
    } catch (e) {
      setError((e as Error).message || 'The camera scanner could not be opened.');
    }
  };

  const move = (i: number, d: -1 | 1) =>
    setFiles(prev => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const visible = (tool.options ?? []).filter(x => !x.show || x.show(o));
  const missing = useMemo(() => {
    const need = tool.minFiles ?? 1;
    if (files.length < need) return need > 1 ? `Choose at least ${need} files` : 'Choose a file';
    for (const x of visible) {
      if ((x.kind === 'text' || x.kind === 'password') && x.required && !String(o[x.key] ?? '').trim()) return `Enter ${x.label.toLowerCase()}`;
    }
    if (tool.media && probeError) return probeError;
    if (trimOpt && probe && !(o.endMs > o.startMs)) return 'Pick a part to keep';
    return '';
  }, [files, visible, o, tool, probe, probeError, trimOpt]);

  const start = () => {
    if (missing) return;
    if (listen && preview.playing) preview.pause();
    if (!tool.free && !premium && remaining <= 0) {
      setGate(true);
      return;
    }
    navigation.navigate('Processing', {toolId: tool.id, files, options: o});
  };

  const watchAd = async () => {
    setGate(false);
    if (!isRewardedReady()) {
      setError('The ad is still loading. Try again in a few seconds.');
      return;
    }
    if (await showRewarded()) {
      await earnCredit();
      navigation.navigate('Processing', {toolId: tool.id, files, options: o});
    }
  };

  const [, deep] = tints[tool.tint];

  return (
    <Screen bottom>
      <ScreenHeader title={tool.title} onBack={navigation.goBack} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View entering={enter(0)}>
          <Card style={styles.hero}>
            <GradientTile tint={tool.tint} icon={tool.icon} size={58} />
            <View style={{flex: 1, marginLeft: spacing.md}}>
              <Text style={[type.h2, {color: t.text}]}>{tool.title}</Text>
              <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>{tool.subtitle}</Text>
            </View>
          </Card>
        </Animated.View>

        <SectionHeader
          title={tool.multi ? 'Files' : 'File'}
          action={scans ? undefined : files.length && tool.multi ? 'Add more' : files.length ? 'Change' : undefined}
          onAction={() => pick(!!tool.multi)}
        />

        {!files.length && scans ? (
          <Animated.View entering={enter(1)} style={styles.sourceRow}>
            {[
              {label: 'Camera', hint: 'Scan pages', icon: 'camera' as const, onPress: scan},
              {label: 'Gallery', hint: 'Pick photos', icon: 'images' as const, onPress: () => pick(true)},
            ].map((s, i) => (
              <PressableScale key={s.label} onPress={s.onPress} style={[styles.drop, styles.source, i ? {marginLeft: spacing.md} : null, {borderColor: deep, backgroundColor: t.card}]} accessibilityLabel={s.label}>
                <Animated.View entering={ZoomIn.delay(200 + i * 80).duration(260)}>
                  <View style={[styles.dropIcon, {backgroundColor: t.infoSoft}]}>
                    <Icon name={s.icon} color={t.info} size={28} />
                  </View>
                </Animated.View>
                <Text style={[type.title, {color: t.text, marginTop: spacing.md}]}>{s.label}</Text>
                <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>{s.hint}</Text>
              </PressableScale>
            ))}
          </Animated.View>
        ) : !files.length ? (
          <Animated.View entering={enter(1)}>
            <PressableScale onPress={() => pick(false)} style={[styles.drop, {borderColor: deep, backgroundColor: t.card}]}>
              <Animated.View entering={ZoomIn.delay(200).duration(260)}>
                <View style={[styles.dropIcon, {backgroundColor: t.infoSoft}]}>
                  <Icon name="upload" color={t.info} size={28} />
                </View>
              </Animated.View>
              <Text style={[type.title, {color: t.text, marginTop: spacing.md}]}>{tool.multi ? 'Choose files' : 'Choose a file'}</Text>
              <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>Works offline · nothing is uploaded</Text>
            </PressableScale>
          </Animated.View>
        ) : (
          files.map((f, i) => (
            <Animated.View key={`${f.uri}-${i}`} entering={enter(i, 40)} layout={LinearTransition.duration(220)}>
              <Card style={styles.fileRow}>
                <View style={[styles.fileIcon, {backgroundColor: t.cardAlt}]}>
                  <Icon name={tool.icon} color={deep} size={20} />
                </View>
                <View style={{flex: 1, marginHorizontal: spacing.md}}>
                  <Text numberOfLines={1} style={[type.title, {color: t.text}]}>
                    {f.name}
                  </Text>
                  <Text style={[type.caption, {color: t.textMuted, marginTop: 2}]}>{humanBytes(f.size)}</Text>
                </View>
                {tool.multi && files.length > 1 ? (
                  <>
                    <Pressable onPress={() => move(i, -1)} hitSlop={8} style={styles.mini} accessibilityLabel="Move up">
                      <View style={styles.turn}>
                        <Icon name="back" color={i ? t.textMuted : t.border} size={18} />
                      </View>
                    </Pressable>
                    <Pressable onPress={() => move(i, 1)} hitSlop={8} style={styles.mini} accessibilityLabel="Move down">
                      <View style={styles.turn}>
                        <Icon name="chevron" color={i < files.length - 1 ? t.textMuted : t.border} size={18} />
                      </View>
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={() => setFiles(prev => prev.filter((_, k) => k !== i))} hitSlop={10} style={styles.mini} accessibilityLabel="Remove">
                  <Icon name="close" color={t.textMuted} size={18} />
                </Pressable>
              </Card>
            </Animated.View>
          ))
        )}

        {scans && files.length ? (
          <Animated.View entering={FadeIn.duration(220)} layout={LinearTransition.duration(220)} style={styles.sourceRow}>
            <GhostButton label="Camera" icon="camera" onPress={scan} style={{flex: 1}} />
            <GhostButton label="Gallery" icon="images" onPress={() => pick(true)} style={{flex: 1, marginLeft: spacing.sm}} />
          </Animated.View>
        ) : null}

        {tool.media && files.length ? (
          <Animated.View entering={FadeIn.duration(220)}>
            {probing ? (
              <Card style={{marginTop: spacing.sm}}>
                <SkeletonBlock width="60%" height={12} />
                <SkeletonBlock width="35%" height={12} style={{marginTop: spacing.md}} />
              </Card>
            ) : probe ? (
              <Card style={[styles.probe, {marginTop: spacing.sm}]}>
                {/* In the background the frame's place is kept, empty, so nothing moves on return. */}
                {thumb ? hidden ? <View style={styles.thumb} /> : <Image source={{uri: thumb}} style={styles.thumb} /> : null}
                <View style={{flex: 1}}>
                  <Text style={[type.bodyNum, {color: t.text}]}>{clock(probe.durationMs)}</Text>
                  <Text style={[type.caption, {color: t.textMuted, marginTop: 3}]}>
                    {probe.hasVideo ? `${probe.width}×${probe.height}` : 'Audio'}
                    {probe.bitrate ? `  ·  ${Math.round(probe.bitrate / 1000)} kbps` : ''}
                  </Text>
                </View>
              </Card>
            ) : null}
          </Animated.View>
        ) : null}

        {listen && !trimOpt && dur > 0 ? (
          // Fade and volume keep the whole file: the waveform is shown whole and played with the effect.
          <Animated.View entering={enter(2, 40)}>
            <SectionHeader title="Listen" />
            <View style={styles.listenWave}>
              <Waveform peaks={peaks} from={0} to={dur} duration={dur} position={preview.position} />
            </View>
            <PreviewBar playing={preview.playing} onToggle={togglePreview} position={preview.position} from={0} to={dur} />
          </Animated.View>
        ) : null}

        {tool.imageOpts && tool.preview && files[0] ? (
          <Animated.View entering={enter(2, 40)}>
            <SectionHeader title="Preview" />
            <ImagePreviewCard
              file={files[0]}
              opts={imageOptions(files[0], tool.imageOpts(o))}
              compare={tool.preview === 'compare'}
              tint={tool.tint}
              onInfo={p => setSrc(prev => (prev && prev.w === p.srcWidth && prev.h === p.srcHeight ? prev : {w: p.srcWidth, h: p.srcHeight}))}
            />
          </Animated.View>
        ) : null}

        {visible.length ? <SectionHeader title="Options" /> : null}
        {visible.map((opt, i) => (
          <Animated.View key={opt.key} entering={enter(i + 2, 40)} layout={LinearTransition.duration(220)}>
            <OptionView
              opt={opt}
              o={o}
              set={set}
              probe={probe}
              file={files[0]}
              tint={tool.tint}
              audio={listen ? {peaks, playing: preview.playing, position: preview.position, toggle: togglePreview, onTrimRelease, playWindow: (s: number, e: number) => preview.play(s, e)} : undefined}
            />
          </Animated.View>
        ))}

        {tool.note ? (
          <View style={[styles.note, {backgroundColor: t.infoSoft}]}>
            <Icon name="info" color={t.info} size={18} />
            <Text style={[type.caption, {color: t.textMuted, flex: 1, marginLeft: spacing.sm, lineHeight: 18}]}>{tool.note}</Text>
          </View>
        ) : null}

        {error ? <Text style={[type.caption, {color: t.negative, marginTop: spacing.md}]}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, {borderTopColor: t.border, backgroundColor: t.bg}]}>
        <GradientButton label={missing || 'Start'} onPress={start} tint={tool.tint} icon={missing ? undefined : 'sparkle'} disabled={!!missing} />
      </View>

      <AppDialog
        visible={gate}
        onClose={() => setGate(false)}
        icon="crown"
        tint="gold"
        title="Free conversions used up"
        message={`Your ${FREE_CONVERSIONS} free conversions are used. Watch a short ad for one more, or go Premium for unlimited.`}
        actions={[
          {label: 'Watch ad (+1)', onPress: watchAd},
          {
            label: 'Go Premium',
            tone: 'primary' as const,
            onPress: () => {
              setGate(false);
              navigation.navigate('PremiumModal');
            },
          },
        ]}
      />
    </Screen>
  );
}

/** The preview player's state and actions, handed to the trim and window options. */
type AudioUi = {
  peaks: number[] | null;
  playing: boolean;
  position: number | null;
  toggle: () => void;
  onTrimRelease: (thumb: 'start' | 'end') => void;
  playWindow: (fromMs: number, toMs: number) => void;
};

/**
 * Resize's width and height with "Keep proportions" on: typing one fills in the
 * other from the picture's own shape, rounded once. What is being typed is kept
 * exactly as typed (only capped at 10000), so the field never jumps under the
 * finger; turning the lock on fills the height in from the width.
 */
function linkSides(o: Opts, k: string, src: {w: number; h: number} | null): Opts {
  if (k === 'width' || k === 'height') {
    const n = parseInt(String(o[k] ?? ''), 10);
    if (n > 10000) o[k] = '10000';
  }
  if (!src || !src.w || !src.h || !o.keepAspect) return o;
  const from = k === 'keepAspect' ? (o.width ? 'width' : o.height ? 'height' : '') : k;
  if (from !== 'width' && from !== 'height') return o;
  const n = Math.min(10000, parseInt(String(o[from] ?? ''), 10));
  const other = from === 'width' ? 'height' : 'width';
  if (!(n >= 1)) return {...o, [other]: ''};
  const v = from === 'width' ? (n * src.h) / src.w : (n * src.w) / src.h;
  return {...o, [other]: String(Math.max(1, Math.min(10000, Math.round(v))))};
}

function OptionView({opt, o, set, probe, file, tint, audio}: {opt: Opt; o: Opts; set: (k: string, v: unknown) => void; probe: MediaProbe | null; file?: PickedFile; tint: TintName; audio?: AudioUi}) {
  const t = useTheme();
  switch (opt.kind) {
    case 'segment':
      return (
        <View style={styles.opt}>
          <Text style={[type.caption, {color: t.textMuted, marginBottom: 8}]}>{opt.label}</Text>
          <Segmented
            options={opt.choices.map(c => String(c.value))}
            value={String(o[opt.key])}
            labels={Object.fromEntries(opt.choices.map(c => [String(c.value), c.label]))}
            onChange={v => {
              const c = opt.choices.find(x => String(x.value) === v);
              set(opt.key, c ? c.value : v);
            }}
            scrollable={opt.choices.length > 5}
          />
        </View>
      );
    case 'text':
    case 'password':
      return <Field label={opt.label} value={String(o[opt.key] ?? '')} onChangeText={v => set(opt.key, v)} placeholder={opt.placeholder} secure={opt.kind === 'password'} />;
    case 'number':
      return <Field label={opt.label} value={String(o[opt.key] ?? '')} onChangeText={v => set(opt.key, v.replace(/[^0-9]/g, ''))} placeholder={opt.placeholder} keyboard="number-pad" />;
    case 'switch':
      return <ToggleRow label={opt.label} hint={opt.hint} value={!!o[opt.key]} onChange={v => set(opt.key, v)} />;
    case 'slider':
      return (
        <View style={styles.opt}>
          <View style={styles.optHead}>
            <Text style={[type.caption, {color: t.textMuted}]}>{opt.label}</Text>
            <Text style={[type.bodyNum, {color: t.text}]}>{opt.format(Number(o[opt.key]))}</Text>
          </View>
          <Slider value={Number(o[opt.key])} min={opt.min} max={opt.max} step={opt.step} onChange={v => set(opt.key, v)} />
        </View>
      );
    case 'crop':
      return file ? <CropEditor file={file} o={o} set={set} tint={tint} /> : null;
    case 'trim': {
      const dur = probe?.durationMs ?? 0;
      if (!dur) return null;
      const s = Number(o.startMs ?? 0);
      const e = Number(o.endMs ?? dur);
      if (probe?.hasVideo && file) {
        return (
          <VideoTrimmer
            uri={file.uri}
            probe={probe}
            start={s}
            end={e}
            tint={tint}
            onChange={(ns, ne) => {
              set('startMs', ns);
              set('endMs', ne);
            }}
          />
        );
      }
      return (
        <View style={styles.opt}>
          <View style={styles.optHead}>
            <Text style={[type.caption, {color: t.textMuted}]}>{opt.label}</Text>
            <Text style={[type.bodyNum, {color: t.text}]}>{clock(e - s)}</Text>
          </View>
          <RangeSlider
            start={s}
            end={e}
            min={0}
            max={dur}
            step={dur > 600000 ? 1000 : 100}
            onChange={(ns, ne) => {
              set('startMs', ns);
              set('endMs', ne);
            }}
            onRelease={audio?.onTrimRelease}
            underlay={audio ? <Waveform peaks={audio.peaks} from={s} to={e} duration={dur} position={audio.position} /> : undefined}
            height={audio ? WAVE_HEIGHT : undefined}
          />
          <View style={styles.optHead}>
            <Text style={[type.caption, {color: t.textMuted}]}>Start {clock(s)}</Text>
            <Text style={[type.caption, {color: t.textMuted}]}>End {clock(e)}</Text>
          </View>
          {audio ? <PreviewBar playing={audio.playing} onToggle={audio.toggle} position={audio.position} from={s} to={e} /> : null}
        </View>
      );
    }
    case 'window': {
      const dur = probe?.durationMs ?? 0;
      if (!dur) return null;
      const len = Math.min(Number(o[opt.key] ?? opt.def), dur);
      const s = Math.min(Number(o.startMs ?? 0), Math.max(0, dur - len));
      const place = (ns: number, l = len) => {
        set('startMs', ns);
        set('endMs', ns + l);
      };
      return (
        <View style={styles.opt}>
          <View style={styles.optHead}>
            <Text style={[type.caption, {color: t.textMuted}]}>{opt.label}</Text>
            <Text style={[type.bodyNum, {color: t.text}]}>{clock(len)}</Text>
          </View>
          <View style={styles.chips}>
            {opt.lengths.map(l => (
              <Chip
                key={l}
                label={`${l / 1000}s`}
                active={Number(o[opt.key] ?? opt.def) === l}
                onPress={() => {
                  set(opt.key, l);
                  // Keep the start where it is unless the longer window would run past the end.
                  const nl = Math.min(l, dur);
                  place(Math.min(s, Math.max(0, dur - nl)), nl);
                }}
              />
            ))}
          </View>
          <WindowSlider
            start={s}
            length={len}
            min={0}
            max={dur}
            step={dur > 600000 ? 500 : 100}
            onChange={ns => place(ns)}
            onRelease={() => audio?.playWindow(s, s + len)}
            underlay={audio ? <Waveform peaks={audio.peaks} from={s} to={s + len} duration={dur} position={audio.position} /> : undefined}
            height={WAVE_HEIGHT}
          />
          <View style={styles.optHead}>
            <Text style={[type.caption, {color: t.textMuted}]}>From {clock(s)}</Text>
            <Text style={[type.caption, {color: t.textMuted}]}>To {clock(s + len)}</Text>
          </View>
          {dur <= len ? <Text style={[type.caption, {color: t.textMuted, marginTop: 4}]}>The song is shorter than this, so all of it is used.</Text> : null}
          {audio ? <PreviewBar playing={audio.playing} onToggle={audio.toggle} position={audio.position} from={s} to={s + len} loop /> : null}
        </View>
      );
    }
  }
}

const WAVE_HEIGHT = 84;

const styles = StyleSheet.create({
  scroll: {paddingHorizontal: spacing.lg, paddingBottom: 32},
  hero: {flexDirection: 'row', alignItems: 'center'},
  drop: {borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.lg, alignItems: 'center', paddingVertical: spacing.xxl},
  dropIcon: {width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center'},
  sourceRow: {flexDirection: 'row', marginTop: spacing.xs},
  // Same inset as a slider's track, so a waveform shown alone lines up with the trim ones.
  listenWave: {height: 84, marginHorizontal: 13},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.sm},
  source: {flex: 1, paddingVertical: spacing.xl},
  fileRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, marginBottom: spacing.sm},
  fileIcon: {width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center'},
  turn: {transform: [{rotate: '90deg'}]},
  mini: {width: 30, height: 30, alignItems: 'center', justifyContent: 'center'},
  probe: {flexDirection: 'row', alignItems: 'center'},
  thumb: {width: 96, height: 56, borderRadius: radius.sm, marginRight: spacing.md, backgroundColor: '#000'},
  opt: {marginTop: spacing.md},
  optHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2},
  note: {flexDirection: 'row', alignItems: 'flex-start', borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xl},
  footer: {paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth},
});
