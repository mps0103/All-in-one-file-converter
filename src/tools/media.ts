import type {PickedFile} from '@/native/FileBridge';
import {ImageTools, MediaTools, onMediaProgress, type AudioOptions, type ImageOptions, type MediaProbe, type VideoOptions} from '@/native/Tools';
import {base, ext, humanBytes, named, publish, sum, temp} from './helpers';
import type {Opts, RunResult} from './types';

type Progress = (p: number, l: string) => void;

const track = async <T>(progress: Progress, label: string, job: () => Promise<T>): Promise<T> => {
  progress(3, label);
  const off = onMediaProgress(p => progress(Math.max(3, p.percent), p.stage || label));
  try {
    return await job();
  } finally {
    off();
  }
};

/** Bits per second the source runs at, from the container or worked out from size and length. */
const sourceBitrate = (p: MediaProbe | undefined, f: PickedFile) => {
  if (p?.bitrate) return p.bitrate;
  if (p?.durationMs && f.size) return Math.round((f.size * 8 * 1000) / p.durationMs);
  return 4_000_000;
};

// --------------------------------------------------------------------- video

/** Lowest video rate a compress asks for, unless the source itself is lower. */
const MIN_VIDEO_BPS = 100_000;

export async function video(files: PickedFile[], o: Opts, probe: MediaProbe | undefined, suffix: string, progress: Progress): Promise<RunResult> {
  const dest = await temp(named(files[0].name, suffix, 'mp4'));
  const opts: VideoOptions = {outPath: dest};

  if (o.startMs != null && files.length === 1) {
    opts.startMs = o.startMs;
    if (o.endMs && probe?.durationMs && o.endMs < probe.durationMs - 50) opts.endMs = o.endMs;
  }
  if (o.rotate) opts.rotate = Number(o.rotate);
  if (o.mute) opts.mute = true;
  if (o.height && Number(o.height) > 0) opts.maxHeight = Number(o.height);

  if (o.level) {
    const src = sourceBitrate(probe, files[0]);
    const plan: Record<string, [number, number]> = {light: [0.7, 0], balanced: [0.45, 1080], strong: [0.25, 720]};
    const [factor, cap] = plan[o.level] ?? plan.balanced;
    // Never above ~90% of the source. A fixed 500 kbps floor used to sit above the
    // rate of small or simple videos, so "compressing" them made them bigger.
    opts.videoBitrate = Math.round(Math.min(src * 0.9, Math.max(MIN_VIDEO_BPS, src * factor)));
    const shortSide = probe ? Math.min(probe.width, probe.height) : 0;
    if (cap && shortSide > cap) opts.maxHeight = cap;
  }

  if (files.length > 1) {
    // Every clip is fitted into the first clip's frame.
    const first = probe ?? (await MediaTools.probe(files[0].uri));
    const turned = first.rotation === 90 || first.rotation === 270;
    let w = turned ? first.height : first.width;
    let h = turned ? first.width : first.height;
    if (w > 1920 || h > 1920) {
      const s = 1920 / Math.max(w, h);
      w *= s;
      h *= s;
    }
    opts.mergeWidth = Math.round(w / 2) * 2 || 1280;
    opts.mergeHeight = Math.round(h / 2) * 2 || 720;
  }

  const res = await track(progress, 'Processing video', () => MediaTools.transformVideo(files.map(f => f.uri), opts));

  // Compressing can still come out no smaller — the sound is re-encoded too, and a
  // video already near its floor has nothing left to give. Then the original stays
  // the best copy: nothing is saved and no free conversion is used.
  const before = sum(files);
  if (o.level && files.length === 1 && before > 0 && res.size >= before) {
    return {
      files: [],
      title: 'Already well compressed',
      note: `The original is ${humanBytes(before)}, and no smaller copy could be made, so it was kept as it is and nothing new was saved.`,
    };
  }

  progress(98, 'Saving');
  const out = await publish(res.path, files.length > 1 ? `${base(files[0].name)}-merged.mp4` : named(files[0].name, suffix, 'mp4'));
  return {files: [out], beforeBytes: before, afterBytes: res.size};
}

// --------------------------------------------------------------------- audio

export async function audio(
  files: PickedFile[],
  o: Opts,
  probe: MediaProbe | undefined,
  suffix: string,
  progress: Progress,
  ringtone = false,
): Promise<RunResult> {
  const format = (o.format ?? 'm4a') as AudioOptions['format'];
  const name = files.length > 1 ? `${base(files[0].name)}-merged.${format}` : named(files[0].name, suffix, format);
  const dest = await temp(name);
  const opts: AudioOptions = {format, outPath: dest};
  if (o.bitrate) opts.bitrate = Number(o.bitrate);
  if (o.volume != null) opts.volume = Number(o.volume) / 100;
  if (o.fadeIn) opts.fadeInMs = Number(o.fadeIn) * 1000;
  if (o.fadeOut) opts.fadeOutMs = Number(o.fadeOut) * 1000;
  if (o.fade === true) {
    opts.fadeInMs = 1500;
    opts.fadeOutMs = 2000;
  }
  if (o.startMs != null && files.length === 1) {
    opts.startMs = o.startMs;
    if (o.endMs && (!probe?.durationMs || o.endMs < probe.durationMs - 50)) opts.endMs = o.endMs;
  }
  const res = await track(progress, 'Processing audio', () => MediaTools.transformAudio(files.map(f => f.uri), opts));
  progress(98, 'Saving');
  const out = await publish(res.path, name, ringtone ? 'ringtone' : 'download');
  return {
    files: [out],
    beforeBytes: sum(files),
    afterBytes: res.size,
    note: ringtone ? 'Saved to Ringtones. Pick it in Settings → Sound → Phone ringtone.' : undefined,
  };
}

// --------------------------------------------------------------------- image

const outExt = (f: PickedFile, format: string) => {
  if (format !== 'same') return format;
  const m = (f.mime || '').toLowerCase();
  const e = ext(f.name);
  if (m.includes('png') || e === 'png') return 'png';
  if (m.includes('webp') || e === 'webp') return 'webp';
  return 'jpg';
};

/** A size typed into a field, as the native side takes it: 1..10000, or none. */
const side = (v: unknown) => {
  const n = parseInt(String(v ?? ''), 10);
  return n > 0 ? Math.min(n, 10000) : undefined;
};

/**
 * The native options for one picture. The live preview and the real job both come
 * from here, so what the preview shows is what is saved.
 */
export function imageOptions(f: PickedFile, o: Opts): Omit<ImageOptions, 'outPath'> & {format: 'jpg' | 'png' | 'webp'} {
  const dpiOnly = !!o.dpiOnly;
  return {
    format: (dpiOnly ? outExt(f, 'same') : outExt(f, o.format ?? 'same')) as 'jpg' | 'png' | 'webp',
    quality: o.quality != null ? Number(o.quality) : 90,
    maxEdge: o.maxEdge ? Number(o.maxEdge) : undefined,
    width: side(o.width),
    height: side(o.height),
    keepAspect: o.keepAspect ?? true,
    scale: o.scale ? Number(o.scale) : undefined,
    rotate: o.rotate ? (Number(o.rotate) as 90 | 180 | 270) : undefined,
    flipH: o.flip === 'h',
    flipV: o.flip === 'v',
    grayscale: !!o.grayscale,
    aspect: o.aspect,
    crop: o.crop,
    dpi: o.dpi ? Number(o.dpi) : undefined,
    dpiOnly,
  };
}

export async function image(files: PickedFile[], o: Opts, suffix: string, progress: Progress): Promise<RunResult> {
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    progress(5 + (i / files.length) * 90, files.length > 1 ? `Image ${i + 1} of ${files.length}` : 'Processing image');
    const opts = imageOptions(f, o);
    const dest = await temp(named(f.name, suffix, opts.format));
    const res = await ImageTools.process(f.uri, {...opts, outPath: dest});
    out.push(await publish(res.path, named(f.name, suffix, opts.format)));
  }
  return {files: out, beforeBytes: sum(files), afterBytes: sum(out)};
}
