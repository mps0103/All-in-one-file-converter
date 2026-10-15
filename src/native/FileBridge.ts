import {NativeEventEmitter, NativeModules} from 'react-native';

export type PickedFile = {
  uri: string;
  name: string;
  size: number;
  mime: string;
};

export type SavedFile = {
  uri: string;
  path: string;
  name: string;
  mime: string;
};

export type PdfText = {
  pageCount: number;
  pagesWithText: number;
  pages: string[];
};

export type ArchiveResult = {
  files: SavedFile[];
  folder: string;
};

export type ArchiveProgress = {stage: string; done: number; total: number};

export type RenderedPage = {base64: string; width: number; height: number};

export type ArchiveEntryInfo = {name: string; size: number};

/** What the app can write. RAR is deliberately absent — the format is proprietary
 *  and the bundled decoder only reads. */
export type ArchiveFormat = 'zip' | '7z' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz';

export type SniffedFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'zip'
  | '7z'
  | 'rar'
  | 'gz'
  | 'bz2'
  | 'xz'
  | 'tar'
  | 'text'
  | 'unknown';

type Bridge = {
  pickFile(mimeTypes: string[]): Promise<PickedFile>;
  /** The same picker, allowing several files at once. */
  pickFiles(mimeTypes: string[]): Promise<PickedFile[]>;
  /** Metadata for a uri handed over by an "Open with" intent. */
  describeUri(uri: string): Promise<PickedFile>;
  /**
   * Takes a copy of a handed-over file and describes the copy, so it can still be
   * opened after the sending app's temporary permission has lapsed. Falls back to
   * describing the original when it is too large to be worth duplicating.
   */
  keepIncoming(uri: string): Promise<PickedFile>;
  /**
   * What the file actually is, read from its first bytes. Used when the name and
   * the MIME type are both uninformative, which is common for a file handed over
   * by another app.
   */
  sniffFormat(uri: string): Promise<SniffedFormat>;
  readBase64(uri: string): Promise<string>;
  saveToDownloads(base64: string, fileName: string, mime: string): Promise<SavedFile>;
  /** password is '' for an ordinary PDF and the key for a locked one. */
  extractPdfText(uri: string, password: string): Promise<PdfText>;
  /** Page image for the viewer, drawn by the framework's PdfRenderer. */
  renderPdfPage(
    uri: string,
    index: number,
    targetWidth: number,
    password: string,
  ): Promise<RenderedPage>;
  pdfPageCount(uri: string, password: string): Promise<number>;
  openFile(uri: string, mime: string): Promise<boolean>;
  shareFile(uri: string, mime: string): Promise<boolean>;
};

type ArchiveBridgeType = {
  extract(uri: string, password: string): Promise<ArchiveResult>;
  /** Table of contents only — nothing is written to Downloads. */
  listEntries(uri: string, password: string): Promise<ArchiveEntryInfo[]>;
  /**
   * Packs the given files into one archive in Downloads.
   * @param password only a zip can carry one; pass '' for none.
   */
  createArchive(
    uris: string[],
    format: ArchiveFormat,
    password: string,
    baseName: string,
  ): Promise<SavedFile>;
};

const missing = () => {
  throw new Error('The converter engine is not linked. Rebuild the app.');
};

/**
 * True in a debug build of the app, false in anything Play could ship.
 *
 * Deliberately not __DEV__: that only means the JavaScript came from Metro, and a
 * debug APK built to run without Metro has a production bundle inside it. Gating
 * the developer settings on __DEV__ hid them from the one build they exist for.
 */
export const IS_DEBUG_BUILD: boolean =
  (NativeModules.FileBridge as {debugBuild?: boolean} | undefined)?.debugBuild === true;

export const FileBridge: Bridge =
  (NativeModules.FileBridge as Bridge) ?? new Proxy({} as Bridge, {get: () => missing});

export const ArchiveBridge: ArchiveBridgeType =
  (NativeModules.ArchiveBridge as ArchiveBridgeType) ??
  new Proxy({} as ArchiveBridgeType, {get: () => missing});

/** Fires while a large archive is being unpacked, so the ring keeps moving. */
export const onArchiveProgress = (fn: (p: ArchiveProgress) => void) => {
  const emitter = new NativeEventEmitter(NativeModules.ArchiveBridge);
  const sub = emitter.addListener('archiveProgress', fn);
  return () => sub.remove();
};

export const isCancelled = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as {code?: string}).code === 'cancelled';

export const isPasswordError = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as {code?: string}).code === 'password';
