import {previewKindFor} from '@/convert/preview';
import {FileBridge, type PickedFile} from '@/native/FileBridge';
import {navigate} from './navigationRef';

type Openable = {uri: string; name: string; mime: string; size?: number};

/** Whether the in-app viewer reads this kind of file. Judged from name and type only. */
export const canView = (f: Openable) =>
  previewKindFor({uri: f.uri, name: f.name, mime: f.mime, size: f.size ?? 0}) !== 'unsupported';

/**
 * Opens a file the app made or listed: in the in-app viewer when it reads the
 * format, otherwise in whatever app the phone offers for it.
 */
export function openFile(f: Openable) {
  if (canView(f)) {
    const file: PickedFile = {uri: f.uri, name: f.name, mime: f.mime, size: f.size ?? 0};
    navigate('Viewer', {file});
    return;
  }
  FileBridge.openFile(f.uri, f.mime || '*/*').catch(() => {});
}
