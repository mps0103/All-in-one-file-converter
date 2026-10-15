import {PermissionsAndroid, Platform} from 'react-native';
import {FileBridge, type PickedFile} from '@/native/FileBridge';
import {Workbench, type OutFile} from '@/native/Tools';
import {textToB64} from '@/convert/util';

export const base = (name: string) => name.replace(/\.[^./\\]+$/, '').trim() || 'file';

export const ext = (name: string) => (name.match(/\.([^./\\]+)$/)?.[1] ?? '').toLowerCase();

/** "report.pdf", "compressed" → "report-compressed.pdf". */
export const named = (src: string, suffix: string, extension: string) =>
  `${base(src)}${suffix ? `-${suffix}` : ''}.${extension}`;

export const sum = (files: {size?: number}[]) => files.reduce((a, f) => a + (Number(f.size) || 0), 0);

/** Moves a finished cache file into Downloads (or Ringtones). */
export const publish = (path: string, name: string, kind: 'download' | 'ringtone' = 'download', folder = '') =>
  Workbench.publish(path, name, kind, folder);

/**
 * Android 9 and older write into Downloads by path, which needs the storage
 * permission granted at run time; declaring it in the manifest is not enough.
 * Android 10 and up go through MediaStore and need nothing.
 */
export async function ensureStorageAccess() {
  if (Platform.OS !== 'android' || Number(Platform.Version) >= 29) return;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  if (res !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Allow storage access so the file can be saved to Downloads.');
  }
}

/** Saves base64 straight to Downloads and reports the size. */
export async function saveB64(b64: string, name: string, mime: string): Promise<OutFile> {
  const saved = await FileBridge.saveToDownloads(b64, name, mime);
  return {...saved, size: Math.floor((b64.length * 3) / 4)};
}

export const saveText = (text: string, name: string) => saveB64(textToB64(text), name, 'text/plain');

/** Copies a picked file into the cache, for engines that need a real path. */
export const stage = (f: PickedFile) => Workbench.stage(f.uri);

export const temp = (name: string) => Workbench.tempFile(name);

export const humanBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

export const clock = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
};

/** Friendly message for anything a native engine throws. */
export const errorText = (e: unknown) => {
  const msg = (e as {message?: string})?.message ?? '';
  if (/encrypt|password/i.test(msg) && !/wrong/i.test(msg)) {
    return 'This PDF is password protected. Use Remove Password first.';
  }
  return msg || 'Something went wrong with this file.';
};

export const MIME_GROUPS = {
  pdf: ['application/pdf'],
  image: ['image/*'],
  video: ['video/*'],
  audio: ['audio/*'],
  audioOrVideo: ['audio/*', 'video/*'],
  any: ['*/*'],
};
