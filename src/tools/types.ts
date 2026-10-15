import type {PickedFile} from '@/native/FileBridge';
import type {MediaProbe, OutFile} from '@/native/Tools';
import type {IconName} from '@/components/Icon';
import type {TintName} from '@/theme';

export type CategoryId = 'pdf' | 'convert' | 'image' | 'video' | 'audio' | 'more';
export type ConvertTab = 'Documents' | 'Images' | 'Audio' | 'Video';

export type Choice = {value: string | number; label: string};

type OptBase = {key: string; label: string; hint?: string; show?: (o: Opts) => boolean};

export type Opt =
  | (OptBase & {kind: 'segment'; choices: Choice[]; def: string | number})
  | (OptBase & {kind: 'text' | 'password'; placeholder?: string; def?: string; required?: boolean})
  | (OptBase & {kind: 'number'; placeholder?: string; def?: string})
  | (OptBase & {kind: 'slider'; min: number; max: number; step: number; def: number; format: (v: number) => string})
  | (OptBase & {kind: 'switch'; def: boolean})
  /** Start and end handles over the media's length. Writes startMs and endMs. */
  | (OptBase & {kind: 'trim'; defaultLengthMs?: number})
  /**
   * A window of fixed length slid over the media, for ringtones. The chosen length
   * (ms, one of lengths) is stored under key; the window writes startMs and endMs.
   */
  | (OptBase & {kind: 'window'; lengths: number[]; def: number});

export type Opts = Record<string, any>;

export type RunContext = {
  files: PickedFile[];
  o: Opts;
  progress: (percent: number, label: string) => void;
  /** Probe of the first file, for audio and video tools. */
  probe?: MediaProbe;
};

export type RunResult = {
  files: OutFile[];
  note?: string;
  /** For the "x MB → y MB, n% smaller" card. */
  beforeBytes?: number;
  afterBytes?: number;
  /** Text read by OCR, shown on the result screen so it can be copied. */
  text?: string;
  /** Rows for File Info, which writes nothing. */
  info?: {label: string; value: string}[];
  /** Folder the outputs landed in, when there are several. */
  folder?: string;
};

export type Tool = {
  id: string;
  title: string;
  subtitle: string;
  category: CategoryId;
  tint: TintName;
  icon: IconName;
  /** MIME types for the system picker. */
  accept: string[];
  multi?: boolean;
  minFiles?: number;
  options?: Opt[];
  /** Which tab of Convert Files lists it, when it is a format conversion. */
  convertTab?: ConvertTab;
  /** Media tools get a probe before options show, and a Stop button while running. */
  media?: boolean;
  /** Writes nothing, so it does not use up a free conversion. */
  free?: boolean;
  /** Shown under the options: what the tool keeps and what it cannot do. */
  note?: string;
  run: (ctx: RunContext) => Promise<RunResult>;
};

export type Category = {
  id: CategoryId;
  title: string;
  tint: TintName;
  icon: IconName;
  /** Grid of tiles (PDF) or list of rows (everything else), as in the design. */
  layout: 'grid' | 'list';
};
