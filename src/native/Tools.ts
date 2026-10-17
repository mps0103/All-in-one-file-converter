import {NativeEventEmitter, NativeModules} from 'react-native';
import type {SavedFile} from './FileBridge';

/** A finished file in Downloads (or Ringtones), as the result screen shows it. */
export type OutFile = SavedFile & {size?: number};

export type FileInfo = {
  name: string;
  size: number;
  mime: string;
  extension: string;
  width?: number;
  height?: number;
  durationMs?: number;
  bitrate?: number;
  modified?: number;
};

export type MediaProbe = {
  durationMs: number;
  width: number;
  height: number;
  rotation: number;
  bitrate: number;
  hasVideo: boolean;
  hasAudio: boolean;
  mime: string;
};

export type ImageOptions = {
  format?: 'jpg' | 'png' | 'webp' | 'same';
  quality?: number;
  maxEdge?: number;
  width?: number;
  height?: number;
  keepAspect?: boolean;
  scale?: number;
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  flipV?: boolean;
  grayscale?: boolean;
  aspect?: string;
  /** Fractions of the upright picture after rotate/flip. */
  crop?: {x: number; y: number; w: number; h: number};
  dpi?: number;
  /** Copy the file and change only its DPI; the pixels stay as they are. */
  dpiOnly?: boolean;
  outPath: string;
};

/** What ImageTools.preview made, and the size the real job will be. */
export type ImagePreview = {
  uri: string;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
  estimatedBytes: number;
  /** The picture itself, upright. */
  srcWidth: number;
  srcHeight: number;
  /** The preview is the job itself, so its size is exact. */
  exact: boolean;
};

export type VideoOptions = {
  startMs?: number;
  endMs?: number;
  maxHeight?: number;
  videoBitrate?: number;
  rotate?: number;
  mute?: boolean;
  mergeWidth?: number;
  mergeHeight?: number;
  outPath: string;
};

export type AudioOptions = {
  format: 'mp3' | 'm4a' | 'aac' | 'wav';
  bitrate?: number;
  startMs?: number;
  endMs?: number;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  outPath: string;
};

type WorkbenchNative = {
  stage(uri: string): Promise<string>;
  tempFile(name: string): Promise<string>;
  tempDir(): Promise<string>;
  writeBase64(base64: string, path: string): Promise<string>;
  info(uri: string): Promise<FileInfo>;
  publish(path: string, name: string, kind: string, folder: string): Promise<OutFile>;
  publishDir(dir: string, folder: string): Promise<OutFile[]>;
  fileSize(path: string): Promise<number>;
  cacheSize(): Promise<number>;
  clearCache(): Promise<number>;
  setLauncherIcon(which: 'dark' | 'light'): void;
};

type ImageNative = {
  process(uri: string, opts: ImageOptions): Promise<{path: string; width: number; height: number; size: number; format: string}>;
  imagesToPdf(uris: string[], pageSize: string, margin: number, outPath: string): Promise<string>;
  recognizeText(uri: string): Promise<{text: string; blocks: number}>;
  /** The job at preview size; null when a newer preview for the same slot replaced it. */
  preview(uri: string, opts: Omit<ImageOptions, 'outPath'> & {slot?: string}, maxSide: number): Promise<ImagePreview | null>;
  clearPreviews(): void;
};

type MediaNative = {
  probe(uri: string): Promise<MediaProbe>;
  /** A preview frame as a JPEG in the cache; resolves to its file uri. */
  thumbnail(uri: string, timeMs: number, width: number): Promise<string>;
  /** count frames over the whole video, heightPx tall, also sent one by one (onThumbStrip). */
  thumbnails(uri: string, count: number, heightPx: number): Promise<{job: number; uris: string[]}>;
  clearThumbnails(): void;
  /** count frames over the whole video, heightPx tall, sent one by one as onThumbStrip events. */
  thumbnails(uri: string, count: number, heightPx: number): Promise<{job: number; uris: string[]}>;
  clearThumbnails(): void;
  transformVideo(uris: string[], opts: VideoOptions): Promise<{path: string; size: number; durationMs: number}>;
  transformAudio(uris: string[], opts: AudioOptions): Promise<{path: string; size: number; durationMs: number}>;
  /** Peak level per slice of time, 0..1, for drawing the sound. */
  waveform(uri: string, bars: number): Promise<number[]>;
  cancel(): void;
};

type AudioPreviewNative = {
  /** Resolves with the length in ms once the file is ready to play. */
  load(uri: string): Promise<number>;
  /** Plays fromMs..toMs and stops there (or loops, see setEffects). */
  play(fromMs: number, toMs: number): void;
  pause(): void;
  seekTo(ms: number): void;
  stop(): void;
  release(): void;
  /** gain 1 = unchanged (up to 3); fades in ms from the part's start and to its end. */
  setEffects(gain: number, fadeInMs: number, fadeOutMs: number, loop: boolean): void;
};

type PdfCompressNative = {
  rewriteImages(src: string, dest: string, quality: number, maxEdge: number, grayscale: boolean): Promise<{path: string; bytesBefore: number; bytesAfter: number; imagesRewritten: number}>;
};
type PdfCryptoNative = {
  isEncrypted(src: string): Promise<boolean>;
  addPassword(src: string, dest: string, user: string, owner: string, allowPrinting: boolean, allowCopy: boolean): Promise<string>;
  removePassword(src: string, dest: string, password: string): Promise<string>;
};
type PdfExtractNative = {
  extractText(src: string, dest: string): Promise<{path: string; characters: number}>;
  extractImages(src: string, destDir: string): Promise<string[]>;
};
type PdfOcrNative = {
  makeSearchable(src: string, dest: string, dpi: number): Promise<{path: string; words: number; pages: number}>;
  readText(src: string, dpi: number): Promise<string>;
};
type PdfRenderNative = {
  pageCount(src: string): Promise<number>;
  exportPages(src: string, destDir: string, dpi: number, format: 'png' | 'jpg'): Promise<string[]>;
};

const missing = (name: string) =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} is not linked. Rebuild the app.`);
      },
    },
  );

const N = NativeModules;
export const Workbench = (N.Workbench ?? missing('Workbench')) as WorkbenchNative;
export const ImageTools = (N.ImageTools ?? missing('ImageTools')) as ImageNative;
export const MediaTools = (N.MediaTools ?? missing('MediaTools')) as MediaNative;
export const PdfCompress = (N.PdfCompress ?? missing('PdfCompress')) as PdfCompressNative;
export const PdfCrypto = (N.PdfCrypto ?? missing('PdfCrypto')) as PdfCryptoNative;
export const PdfExtract = (N.PdfExtract ?? missing('PdfExtract')) as PdfExtractNative;
export const PdfOcr = (N.PdfOcr ?? missing('PdfOcr')) as PdfOcrNative;
export const PdfRender = (N.PdfRender ?? missing('PdfRender')) as PdfRenderNative;

export const AudioPreview = (N.AudioPreview ?? missing('AudioPreview')) as AudioPreviewNative;

/** Where the preview is, about every 100 ms. positionMs is -1 when the app let the player go. */
export const onPreviewPosition = (fn: (p: {positionMs: number; playing: boolean}) => void) => {
  if (!N.AudioPreview) return () => {};
  const emitter = new NativeEventEmitter(N.AudioPreview);
  const sub = emitter.addListener('previewPosition', p => fn(p as unknown as {positionMs: number; playing: boolean}));
  return () => sub.remove();
};

/** Progress from the audio and video engine. */
export const onMediaProgress = (fn: (p: {percent: number; stage: string}) => void) => {
  if (!N.MediaTools) return () => {};
  const emitter = new NativeEventEmitter(N.MediaTools);
  const sub = emitter.addListener('mediaProgress', p => fn(p as unknown as {percent: number; stage: string}));
  return () => sub.remove();
};

/** Frames of the trim strip as they are written. */
export const onThumbStrip = (fn: (p: {index: number; uri: string; job: number}) => void) => {
  if (!N.MediaTools) return () => {};
  const emitter = new NativeEventEmitter(N.MediaTools);
  const sub = emitter.addListener('thumbStrip', p => fn(p as unknown as {index: number; uri: string; job: number}));
  return () => sub.remove();
};
