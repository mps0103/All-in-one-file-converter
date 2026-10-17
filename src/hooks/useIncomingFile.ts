import {useEffect} from 'react';
import {Linking} from 'react-native';

import {FileBridge, type PickedFile} from '@/native/FileBridge';
import {navigate} from '@/navigation/navigationRef';

const nameFromUri = (url: string) => decodeURIComponent(url.split('?')[0].split('/').pop() ?? '') || 'file';

const ARCHIVE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i;

/**
 * A file handed over by "Open with" or "Share to" opens the list of tools that
 * can take it. Archives go straight to the extractor.
 *
 * The file is copied into the app's own storage first, because the borrowed uri
 * usually stops working once the sending app's grant lapses.
 */
export const useIncomingFile = (ready: boolean) => {
  useEffect(() => {
    if (!ready) return;
    let alive = true;

    const handle = async (url: string | null | undefined) => {
      if (!url || !alive) return;
      let file: PickedFile;
      try {
        file = await FileBridge.keepIncoming(url);
      } catch {
        file = {uri: url, name: nameFromUri(url), size: 0, mime: ''};
      }
      if (!alive) return;

      let mime = file.mime;
      if (!mime || mime === 'application/octet-stream') {
        try {
          const sniffed = await FileBridge.sniffFormat(file.uri);
          if (['zip', '7z', 'rar', 'gz', 'bz2', 'xz', 'tar'].includes(sniffed)) mime = 'application/zip';
          else if (sniffed === 'pdf') mime = 'application/pdf';
        } catch {
          // Name-based routing below still works.
        }
      }

      if (ARCHIVE.test(file.name) || /zip|7z|rar|tar|gzip|bzip|x-xz/.test(mime)) {
        navigate('Tool', {toolId: 'extract-archive', files: [file]});
        return;
      }
      navigate('OpenWith', {file: {...file, mime}});
    };

    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', event => handle(event.url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, [ready]);
};
