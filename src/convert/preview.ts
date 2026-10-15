import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import {ArchiveBridge, FileBridge, type PickedFile} from '@/native/FileBridge';
import {b64ToBytes, b64ToText, escapeHtml, stripExtension} from './util';

/**
 * Read-only rendering for the viewer.
 *
 * The body HTML is built by the same code the converters use, so a document looks
 * the same on screen as it does in the PDF the app produces — a viewer that
 * disagreed with its own converter would be worse than no viewer.
 *
 * PDFs are the exception: they are drawn page by page by the native renderer
 * rather than turned into HTML, because their layout is the thing worth seeing.
 */
export type PreviewKind = 'pdf' | 'html' | 'sheet' | 'archive' | 'image' | 'unsupported';

export type ArchiveEntry = {name: string; size: number};

export type Preview =
  | {kind: 'pdf'; pageCount: number}
  | {kind: 'html'; html: string; note?: string}
  /**
   * A workbook is its own kind, because its sheet tabs are drawn by the app rather
   * than by the page. Inside the WebView they zoomed along with the sheet and slid
   * away as it scrolled, which is not how a spreadsheet behaves anywhere else.
   */
  | {kind: 'sheet'; sheets: Array<{name: string; html: string}>}
  | {kind: 'archive'; entries: ArchiveEntry[]}
  /** A picture, shown as itself by the platform's image decoder. */
  | {kind: 'image'}
  | {kind: 'unsupported'};

const EXT = (name: string) => (name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '');

const ARCHIVE_EXT = ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz'];

/**
 * The format the viewer will read a file as, which is not the same thing as its
 * extension.
 *
 * Three sources, in order of how far each can be trusted:
 *
 *  1. the file name, right nearly always;
 *  2. the MIME type the provider reports, for a file whose name lost its
 *     extension on the way over;
 *  3. the first bytes of the file itself, the only one that cannot lie.
 *
 * The third exists because of "Open with". Another app can hand over a uri whose
 * display name carries no extension, from a provider that answers
 * application/octet-stream for anything it did not write itself. A spreadsheet
 * arriving that way matched nothing here, and the app opened on the home screen
 * having quietly decided it could not read a file it reads perfectly well.
 */
export type Format = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'text' | 'archive' | 'image' | 'unknown';

const ARCHIVE_MIMES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/gzip',
  'application/x-gzip',
  'application/x-bzip2',
  'application/x-xz',
];

const MIME_FORMATS: Record<string, Format> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'pptx',
  'text/csv': 'csv',
  'text/comma-separated-values': 'csv',
};

const EXT_FORMATS: Record<string, Format> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'docx',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.csv': 'csv',
  '.pptx': 'pptx',
  '.ppt': 'pptx',
  '.txt': 'text',
  '.html': 'text',
  '.htm': 'text',
  '.md': 'text',
  '.json': 'text',
  '.xml': 'text',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.heic': 'image',
  '.heif': 'image',
};

/** Name and MIME only. Synchronous, so it can be used while deciding where to go. */
export const formatFor = (file: PickedFile): Format => {
  const ext = EXT(file.name);
  if (ARCHIVE_EXT.includes(ext)) return 'archive';
  if (EXT_FORMATS[ext]) return EXT_FORMATS[ext];

  const mime = (file.mime ?? '').toLowerCase().split(';')[0].trim();
  if (MIME_FORMATS[mime]) return MIME_FORMATS[mime];
  if (ARCHIVE_MIMES.includes(mime)) return 'archive';
  if (mime.startsWith('text/')) return 'text';
  if (mime.startsWith('image/')) return 'image';
  return 'unknown';
};

const SNIFFED: Record<string, Format> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
  pptx: 'pptx',
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  gz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  tar: 'archive',
  text: 'text',
};

/**
 * As above, but reads the file when the name and the MIME type between them say
 * nothing. Only then, because it costs a read.
 */
export const resolveFormat = async (file: PickedFile): Promise<Format> => {
  const quick = formatFor(file);
  if (quick !== 'unknown') return quick;
  try {
    return SNIFFED[await FileBridge.sniffFormat(file.uri)] ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

const KINDS: Record<Format, PreviewKind> = {
  pdf: 'pdf',
  archive: 'archive',
  docx: 'html',
  xlsx: 'sheet',
  csv: 'sheet',
  pptx: 'html',
  text: 'html',
  image: 'image',
  unknown: 'unsupported',
};

/** What the viewer can open, judged without reading the file. */
export const previewKindFor = (file: PickedFile): PreviewKind => KINDS[formatFor(file)];

/**
 * Screen styling, deliberately different from the print stylesheet: this is read
 * on a phone, so the type is larger, the page is not paginated, and tables scroll
 * sideways instead of being squeezed to the page width.
 */
const screenDocument = (body: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4">
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 16px 14px 40px; background: #FFFFFF; color: #16142A;
         font-family: -apple-system, Roboto, 'Segoe UI', sans-serif;
         font-size: 16px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
  h1 { font-size: 24px; margin: 0 0 12px; letter-spacing: -0.4px; }
  h2 { font-size: 20px; margin: 22px 0 8px; }
  h3 { font-size: 17px; margin: 18px 0 6px; }
  p { margin: 0 0 12px; }
  ul, ol { margin: 0 0 12px 20px; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; margin: 0 0 16px; font-size: 14px; }
  th, td { border: 1px solid #C9C5DA; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #EFEDF7; font-weight: 600; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: 'Roboto Mono', monospace;
        font-size: 14px; margin: 0; }
  .sheet-title { font-size: 15px; font-weight: 600; margin: 20px 0 8px; color: #5B5776; }
  .slide { border: 1px solid #E4E1F0; border-radius: 12px; padding: 14px 16px; margin: 0 0 14px; }
  .slide h2 { margin-top: 0; }
  /* A wide sheet must scroll rather than force the whole page sideways. */
  .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
</style></head><body>${body}</body></html>`;

const wordPreview = async (file: PickedFile) => {
  const bytes = b64ToBytes(await FileBridge.readBase64(file.uri));
  const {value, messages} = await mammoth.convertToHtml({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const dropped = messages.filter(m => m.type === 'warning').length;
  return {
    html: screenDocument(value || '<p><em>This document has no text in it.</em></p>'),
    note: dropped > 8 ? 'Some uncommon formatting was simplified.' : undefined,
  };
};

/**
 * A workbook, drawn the way a spreadsheet is drawn: lettered columns, numbered
 * rows, gridlines, and a tab per sheet along the bottom.
 *
 * The grid is built cell by cell rather than handed to sheet_to_html, because the
 * header row and header column have to be part of the table for their sticky
 * positioning to work, and because a cell's displayed text and its underlying
 * value are different things — a date is a serial number underneath, and a
 * currency cell carries a format. XLSX puts what Excel would show in `w`, so that
 * is what gets shown, with the raw value only as a fallback.
 *
 * The tabs are CSS, not script: radio inputs with labels, so the WebView keeps
 * JavaScript switched off. A viewer that runs script out of a file someone was
 * sent is a viewer with a hole in it.
 */
const sheetGrid = (sheet: XLSX.WorkSheet): string => {
  const ref = sheet['!ref'];
  if (!ref) return '<p class="empty">This sheet is empty.</p>';

  const range = XLSX.utils.decode_range(ref);
  // A runaway range is a real thing in files exported by other tools: a sheet
  // with nine used cells can claim a million rows. The cap keeps the page finite.
  const lastRow = Math.min(range.e.r, range.s.r + 999);
  const lastCol = Math.min(range.e.c, range.s.c + 63);

  // Merged cells: the top-left one spans, the rest are not drawn at all.
  const spans = new Map<string, {rows: number; cols: number}>();
  const covered = new Set<string>();
  for (const m of sheet['!merges'] ?? []) {
    spans.set(`${m.s.r},${m.s.c}`, {rows: m.e.r - m.s.r + 1, cols: m.e.c - m.s.c + 1});
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r !== m.s.r || c !== m.s.c) covered.add(`${r},${c}`);
      }
    }
  }

  const head = [`<th class="corner"></th>`];
  for (let c = range.s.c; c <= lastCol; c++) {
    head.push(`<th class="col">${XLSX.utils.encode_col(c)}</th>`);
  }

  const rows: string[] = [];
  for (let r = range.s.r; r <= lastRow; r++) {
    const cells = [`<th class="rownum">${r + 1}</th>`];
    for (let c = range.s.c; c <= lastCol; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const cell = sheet[XLSX.utils.encode_cell({r, c})];
      const span = spans.get(`${r},${c}`);
      const attrs =
        (span?.rows && span.rows > 1 ? ` rowspan="${span.rows}"` : '') +
        (span?.cols && span.cols > 1 ? ` colspan="${span.cols}"` : '');
      // Numbers and dates sit right, text sits left, exactly as a sheet does.
      const numeric = cell ? cell.t === 'n' || cell.t === 'd' : false;
      const text = cell ? (cell.w ?? String(cell.v ?? '')) : '';
      cells.push(`<td${attrs}${numeric ? ' class="num"' : ''}>${escapeHtml(text)}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }

  const truncated =
    range.e.r > lastRow || range.e.c > lastCol
      ? `<p class="clip">Showing the first ${lastRow - range.s.r + 1} rows and ${lastCol - range.s.c + 1} columns.</p>`
      : '';

  return `<div class="grid"><table><thead><tr>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>${truncated}`;
};

/**
 * One sheet, as a standalone page. No tabs and no script live in here: the tab
 * strip is a real row of buttons in ViewerScreen, so it stays at the bottom of the
 * screen and keeps its size when the sheet is pinched.
 */
const sheetDocument = (grid: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<!-- minimum-scale lets a wide sheet be pinched right out until the whole of it fits. -->
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=0.2, maximum-scale=5, user-scalable=yes">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #FFFFFF; color: #1F1F1F;
         font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; font-size: 13px;
         -webkit-text-size-adjust: 100%; }

  /* The document itself scrolls, rather than a box inside it, so that pinching to
     zoom out reveals more of the sheet instead of shrinking a window. */
  table { border-collapse: separate; border-spacing: 0; }
  th, td { border-right: 1px solid #D4D4D4; border-bottom: 1px solid #D4D4D4;
           padding: 7px 10px; white-space: nowrap; background: #FFFFFF;
           max-width: 280px; overflow: hidden; text-overflow: ellipsis; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }

  /* Lettered columns across the top, numbered rows down the side, both pinned. */
  th.col, th.corner { position: sticky; top: 0; z-index: 2;
                      background: #F2F2F2; color: #5E5E5E; font-weight: 500;
                      text-align: center; min-width: 84px; }
  th.rownum { position: sticky; left: 0; z-index: 1;
              background: #F2F2F2; color: #5E5E5E; font-weight: 500;
              text-align: center; min-width: 42px; }
  th.corner { left: 0; z-index: 3; min-width: 42px; }

  .empty { padding: 20px 16px; color: #5E5E5E; font-style: italic; }
  .clip { padding: 10px 16px; margin: 0; color: #5E5E5E; font-size: 12px; }
</style></head>
<body>${grid}</body></html>`;

const sheetPreview = async (file: PickedFile, fromCsv: boolean): Promise<Preview> => {
  const raw = await FileBridge.readBase64(file.uri);
  const book = fromCsv
    ? XLSX.read(b64ToText(raw), {type: 'string', cellDates: true})
    : XLSX.read(raw, {type: 'base64', cellDates: true});

  if (!book.SheetNames.length) {
    return {kind: 'sheet', sheets: [{name: 'Sheet1', html: sheetDocument('<p class="empty">This file has no sheets in it.</p>')}]};
  }
  return {
    kind: 'sheet',
    sheets: book.SheetNames.map(name => ({
      name,
      html: sheetDocument(sheetGrid(book.Sheets[name])),
    })),
  };
};

const slidesPreview = async (file: PickedFile) => {
  const zip = await JSZip.loadAsync(b64ToBytes(await FileBridge.readBase64(file.uri)));
  const paths = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!paths.length) throw new Error('No slides were found inside this file.');

  const sections: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const xml = await zip.file(paths[i])!.async('string');
    const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1].trim()).filter(Boolean);
    const [heading, ...rest] = lines;
    sections.push(
      `<div class="slide"><h2>${escapeHtml(heading ?? `Slide ${i + 1}`)}</h2>` +
        rest.map(l => `<p>${escapeHtml(l)}</p>`).join('') +
        '</div>',
    );
  }
  return {
    html: screenDocument(sections.join('')),
    note: 'Slide text only — pictures, themes and layouts are not drawn.',
  };
};

const textPreview = async (file: PickedFile) => {
  const text = b64ToText(await FileBridge.readBase64(file.uri));
  const ext = EXT(file.name);
  const isHtml = ext === '.html' || ext === '.htm' || file.mime === 'text/html';
  return {html: screenDocument(isHtml ? text : `<pre>${escapeHtml(text)}</pre>`)};
};

export const buildPreview = async (file: PickedFile, password = ''): Promise<Preview> => {
  // Resolved rather than guessed from the name: a file arriving from another app
  // may have neither a usable name nor a usable MIME type, and this is the point
  // where being wrong means showing a spreadsheet as a screen of binary noise.
  const format = await resolveFormat(file);

  if (format === 'pdf') {
    return {kind: 'pdf', pageCount: await FileBridge.pdfPageCount(file.uri, password)};
  }

  if (format === 'archive') {
    const entries = await ArchiveBridge.listEntries(file.uri, password);
    // Some writers store Windows separators inside the archive; show one shape.
    return {
      kind: 'archive',
      entries: entries.map(e => ({...e, name: e.name.split('\\').join('/')})),
    };
  }

  if (format === 'docx') return {kind: 'html', ...(await wordPreview(file))};
  if (format === 'xlsx') return sheetPreview(file, false);
  if (format === 'csv') return sheetPreview(file, true);
  if (format === 'pptx') return {kind: 'html', ...(await slidesPreview(file))};
  if (format === 'text') return {kind: 'html', ...(await textPreview(file))};
  if (format === 'image') return {kind: 'image'};

  return {kind: 'unsupported'};
};

/**
 * The Open-with list in AndroidManifest.xml. The in-app picker deliberately does
 * NOT filter on these: Android's document picker matches on the MIME the providing
 * app reports, and providers disagree. On a real device a .zip offered as
 * application/zip and a .csv offered as text/comma-separated-values were both
 * hidden even though both types were requested. A viewer that refuses to show a
 * file the user can plainly see is worse than one that opens anything and says
 * honestly when it cannot read it, which is what previewKindFor does after a pick.
 */
export const VIEWABLE_MIMES = [
  'text/comma-separated-values',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
  'text/html',
  'application/zip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-tar',
  'application/gzip',
  'application/octet-stream',
];

export const titleFor = (file: PickedFile) => stripExtension(file.name);
