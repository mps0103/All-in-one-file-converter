import DocumentScanner, {ScanDocumentResponseStatus} from 'react-native-document-scanner-plugin';
import type {PickedFile} from './FileBridge';

/**
 * Google's ML Kit document scanner: edge detection, crop, retake and several pages,
 * all in Play services' own activity, so there is no camera UI to build here and
 * no camera permission to ask for.
 *
 * Pages come back as ordinary picked files, so they sit in the same list as
 * gallery images and are reordered and turned into a PDF the same way.
 */
export async function scanPages(maxPages = 20): Promise<PickedFile[]> {
  const res = await DocumentScanner.scanDocument({maxNumDocuments: maxPages, croppedImageQuality: 90});
  if (res.status === ScanDocumentResponseStatus.Cancel || !res.scannedImages?.length) return [];
  const stamp = Date.now();
  return res.scannedImages.map((uri, i) => ({uri, name: `scan-${stamp}-${i + 1}.jpg`, size: 0, mime: 'image/jpeg'}));
}
