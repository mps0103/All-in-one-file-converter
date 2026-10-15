import RNHTMLtoPDF from 'react-native-html-to-pdf';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {Document, HeadingLevel, Packer, Paragraph, TextRun} from 'docx';
import {
  ArchiveBridge,
  FileBridge,
  onArchiveProgress,
  type PickedFile,
  type SavedFile,
} from '@/native/FileBridge';
import {MIME, type Tool, type ToolId} from './catalog';
import {
  b64ToBytes,
  b64ToText,
  escapeHtml,
  printableDocument,
  safeName,
  stripExtension,
  textToB64,
} from './util';

export type Progress = (percent: number, label: string) => void;

export type ConvertOptions = {
  /** For a protected ZIP, and for a PDF that is locked. */
  password?: string;
};

export type ConvertResult = {
  files: SavedFile[];
  /** Surfaced on the result screen when the input limited what was possible. */
  warning?: string;
};

const save = (b64: string, base: string, ext: string) =>
  FileBridge.saveToDownloads(b64, safeName(base, ext), MIME[ext] ?? 'application/octet-stream');

const htmlToPdfBase64 = async (html: string, name: string): Promise<string> => {
  const out = await RNHTMLtoPDF.convert({
    html,
    fileName: `tmp_${Date.now()}`,
    directory: 'Documents',
    base64: true,
    padding: 0,
  });
  if (!out?.base64) {
    throw new Error(`${name} could not be laid out as a PDF.`);
  }
  return out.base64;
};

// ----------------------------------------------------------------- from PDF

const pdfToWord = async (file: PickedFile, p: Progress, o: ConvertOptions): Promise<ConvertResult> => {
  p(15, 'Reading the PDF');
  const {pages, pageCount, pagesWithText} = await FileBridge.extractPdfText(file.uri, o.password ?? '');
  if (pagesWithText === 0) {
    throw new Error('This PDF has no text in it — it is a scan or a set of pictures, so there is nothing to pull out.');
  }
  p(45, 'Rebuilding paragraphs');

  const children: Paragraph[] = [];
  pages.forEach((pageText, index) => {
    children.push(
      new Paragraph({
        text: `Page ${index + 1}`,
        heading: HeadingLevel.HEADING_3,
        spacing: {before: index === 0 ? 0 : 320, after: 120},
      }),
    );
    const blocks = pageText.split(/\n\s*\n/).filter(b => b.trim());
    if (!blocks.length) {
      children.push(new Paragraph({children: [new TextRun({text: '[no text on this page]', italics: true})]}));
      return;
    }
    blocks.forEach(block => {
      // Each line in the text layer stays a line. Flattening a block into a single
      // run reads acceptably for prose but destroys anything laid out in rows — a
      // statement or invoice came through as one unbroken paragraph.
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      children.push(
        new Paragraph({
          children: lines.map(
            (line, i) => new TextRun({text: line, size: 22, break: i === 0 ? 0 : 1}),
          ),
          spacing: {after: 140},
        }),
      );
    });
  });

  p(75, 'Writing the document');
  const doc = new Document({sections: [{properties: {}, children}]});
  const b64 = await Packer.toBase64String(doc);
  p(92, 'Saving to Downloads');
  const saved = await save(b64, file.name, 'docx');
  return {
    files: [saved],
    warning:
      pagesWithText < pageCount
        ? `${pageCount - pagesWithText} of ${pageCount} pages were scans, so they came through empty.`
        : undefined,
  };
};

/** Splits a text line wherever two or more spaces sit between values. */
const rowsFromText = (text: string) =>
  text
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .map(line => line.split(/\s{2,}|\t/).map(cell => cell.trim()));

const pdfToExcel = async (file: PickedFile, p: Progress, o: ConvertOptions): Promise<ConvertResult> => {
  p(15, 'Reading the PDF');
  const {pages, pagesWithText} = await FileBridge.extractPdfText(file.uri, o.password ?? '');
  if (pagesWithText === 0) {
    throw new Error('This PDF has no text in it, so there is nothing to put in a sheet.');
  }
  p(50, 'Finding columns');
  const book = XLSX.utils.book_new();
  let widest = 0;
  pages.forEach((pageText, i) => {
    const rows = rowsFromText(pageText);
    rows.forEach(r => (widest = Math.max(widest, r.length)));
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), `Page ${i + 1}`.slice(0, 31));
  });
  p(85, 'Saving to Downloads');
  const b64 = XLSX.write(book, {bookType: 'xlsx', type: 'base64'});
  const saved = await save(b64, file.name, 'xlsx');
  return {
    files: [saved],
    warning:
      widest < 2
        ? 'The columns in this PDF are not spaced apart, so every line landed in one column.'
        : undefined,
  };
};

const pdfToText = async (file: PickedFile, p: Progress, o: ConvertOptions): Promise<ConvertResult> => {
  p(25, 'Reading the PDF');
  const {pages, pagesWithText} = await FileBridge.extractPdfText(file.uri, o.password ?? '');
  if (pagesWithText === 0) {
    throw new Error('This PDF has no text in it — it is a scan, so there is nothing to pull out.');
  }
  p(70, 'Saving to Downloads');
  const body = pages.map((t, i) => `--- Page ${i + 1} ---\n${t}`).join('\n\n');
  return {files: [await save(textToB64(body), file.name, 'txt')]};
};

// ------------------------------------------------------------------- to PDF

const wordToPdf = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(20, 'Reading the document');
  const bytes = b64ToBytes(await FileBridge.readBase64(file.uri));
  p(45, 'Laying out the pages');
  const {value: html, messages} = await mammoth.convertToHtml({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const pdf = await htmlToPdfBase64(printableDocument(html, stripExtension(file.name)), file.name);
  p(88, 'Saving to Downloads');
  const dropped = messages.filter(m => m.type === 'warning').length;
  return {
    files: [await save(pdf, file.name, 'pdf')],
    warning: dropped > 8 ? 'Some uncommon formatting in this document was simplified.' : undefined,
  };
};

const sheetToPdf = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(20, 'Reading the sheet');
  const raw = await FileBridge.readBase64(file.uri);
  const book = XLSX.read(raw, {type: 'base64'});
  p(50, 'Drawing the tables');
  const body = book.SheetNames.map(name => {
    const table = XLSX.utils.sheet_to_html(book.Sheets[name], {header: '', footer: ''});
    return `<div class="sheet-title">${escapeHtml(name)}</div>${table}`;
  }).join('');
  const pdf = await htmlToPdfBase64(printableDocument(body, stripExtension(file.name)), file.name);
  p(88, 'Saving to Downloads');
  return {files: [await save(pdf, file.name, 'pdf')]};
};

const slidesToPdf = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(20, 'Opening the deck');
  const zip = await JSZip.loadAsync(b64ToBytes(await FileBridge.readBase64(file.uri)));
  const slidePaths = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!slidePaths.length) {
    throw new Error('No slides were found inside this file.');
  }
  p(50, 'Collecting slide text');
  const sections: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const xml = await zip.file(slidePaths[i])!.async('string');
    const lines = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => m[1].trim()).filter(Boolean);
    const [heading, ...rest] = lines;
    sections.push(
      `<div class="slide"><h2>${escapeHtml(heading ?? `Slide ${i + 1}`)}</h2>` +
        rest.map(l => `<p>${escapeHtml(l)}</p>`).join('') +
        '</div>',
    );
  }
  const pdf = await htmlToPdfBase64(printableDocument(sections.join(''), stripExtension(file.name)), file.name);
  p(88, 'Saving to Downloads');
  return {
    files: [await save(pdf, file.name, 'pdf')],
    warning: 'Slide text only — pictures, themes and layouts are not drawn.',
  };
};

const textToPdf = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(25, 'Reading the file');
  const text = b64ToText(await FileBridge.readBase64(file.uri));
  const isHtml = /\.html?$/i.test(file.name) || file.mime === 'text/html';
  const body = isHtml ? text : `<pre>${escapeHtml(text)}</pre>`;
  p(55, 'Typesetting');
  const pdf = await htmlToPdfBase64(printableDocument(body, stripExtension(file.name)), file.name);
  p(88, 'Saving to Downloads');
  return {files: [await save(pdf, file.name, 'pdf')]};
};

// ------------------------------------------------- sheets, text, archives

const csvToExcel = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(30, 'Reading the rows');
  const csv = b64ToText(await FileBridge.readBase64(file.uri));
  // Without cellDates a date column is written as a bare serial number shifted by
  // the device timezone: 2026-01-05 reached Excel as 46027.22917. This keeps dates
  // as real dates and leaves amounts numeric.
  const sheet = XLSX.read(csv, {type: 'string', cellDates: true, dateNF: 'yyyy-mm-dd'});
  p(75, 'Saving to Downloads');
  const b64 = XLSX.write(sheet, {bookType: 'xlsx', type: 'base64'});
  return {files: [await save(b64, file.name, 'xlsx')]};
};

const excelToCsv = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(30, 'Reading the sheet');
  const book = XLSX.read(await FileBridge.readBase64(file.uri), {type: 'base64'});
  const csv = XLSX.utils.sheet_to_csv(book.Sheets[book.SheetNames[0]]);
  p(75, 'Saving to Downloads');
  return {
    files: [await save(textToB64(csv), file.name, 'csv')],
    warning: book.SheetNames.length > 1 ? `Only the first sheet, "${book.SheetNames[0]}", was taken.` : undefined,
  };
};

const wordToText = async (file: PickedFile, p: Progress): Promise<ConvertResult> => {
  p(30, 'Reading the document');
  const bytes = b64ToBytes(await FileBridge.readBase64(file.uri));
  const {value} = await mammoth.extractRawText({
    arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  p(80, 'Saving to Downloads');
  return {files: [await save(textToB64(value), file.name, 'txt')]};
};

const extractArchive = async (
  file: PickedFile,
  p: Progress,
  o: ConvertOptions,
): Promise<ConvertResult> => {
  p(12, 'Opening the archive');
  // The native side reports each entry as it lands, so the ring moves on big archives.
  const off = onArchiveProgress(({stage, done, total}) => {
    const share = total > 0 ? done / total : Math.min(done / 60, 1);
    p(12 + Math.round(share * 80), stage);
  });
  try {
    const result = await ArchiveBridge.extract(file.uri, o.password ?? '');
    return {
      files: result.files,
      warning:
        result.files.length > 12
          ? `${result.files.length} files were unpacked into ${result.folder}.`
          : undefined,
    };
  } finally {
    off();
  }
};

// ------------------------------------------------------------------ dispatch

export async function convert(
  tool: Tool,
  files: PickedFile[],
  options: ConvertOptions,
  onProgress: Progress,
): Promise<ConvertResult> {
  if (!files.length) {
    throw new Error('Choose a file first.');
  }
  const one = files[0];
  onProgress(5, 'Getting ready');

  // make-archive is deliberately absent: it takes many files, a format and a
  // password, so it has its own screen and calls the native writer directly rather
  // than passing through this one-file-in, one-file-out engine.
  const run: Record<Exclude<ToolId, 'make-archive'>, () => Promise<ConvertResult>> = {
    'pdf-to-word': () => pdfToWord(one, onProgress, options),
    'pdf-to-excel': () => pdfToExcel(one, onProgress, options),
    'pdf-to-text': () => pdfToText(one, onProgress, options),
    'word-to-pdf': () => wordToPdf(one, onProgress),
    'excel-to-pdf': () => sheetToPdf(one, onProgress),
    'slides-to-pdf': () => slidesToPdf(one, onProgress),
    'text-to-pdf': () => textToPdf(one, onProgress),
    'csv-to-excel': () => csvToExcel(one, onProgress),
    'excel-to-csv': () => excelToCsv(one, onProgress),
    'word-to-text': () => wordToText(one, onProgress),
    'extract-archive': () => extractArchive(one, onProgress, options),
  };

  const step = run[tool.id as keyof typeof run];
  if (!step) throw new Error('That tool is not handled here.');

  const result = await step();
  onProgress(100, 'Done');
  return result;
}
