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
  outPath: string;
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
};

type ImageNative = {
  process(uri: string, opts: ImageOptions): Promise<{path: string; width: number; height: number; size: number; format: string}>;
  imagesToPdf(uris: string[], pageSize: string, margin: number, outPath: string): Promise<string>;
  recognizeText(uri: string): Promise<{text: string; blocks: number}>;
};

type MediaNative = {
  probe(uri: string): Promise<MediaProbe>;
  /** A preview frame as a JPEG in the cache; resolves to its file uri. */
  thumbnail(uri: string, timeMs: number, width: number): Promise<string>;
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
  const sub = emitter.addListener('previewPosition', fn);
  return () => sub.remove();
};

/** Progress from the audio and video engine. */
export const onMediaProgress = (fn: (p: {percent: number; stage: string}) => void) => {
  if (!N.MediaTools) return () => {};
  const emitter = new NativeEventEmitter(N.MediaTools);
  const sub = emitter.addListener('mediaProgress', fn);
  return () => sub.remove();
};
