import type {PickedFile} from '@/native/FileBridge';
import type {CategoryId, Opts, RunResult} from '@/tools/types';

export type TabParamList = {
  Home: undefined;
  Files: undefined;
  Premium: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  Category: {id: CategoryId};
  /** files is set when the app was opened from another app with a file. */
  Tool: {toolId: string; files?: PickedFile[]};
  Processing: {toolId: string; files: PickedFile[]; options: Opts};
  Result: {toolId: string; result: RunResult; inputName: string};
  OpenWith: {file: PickedFile};
  /** No file: the viewer opens the system picker first. */
  Viewer: {file?: PickedFile};
  PremiumModal: undefined;
};
