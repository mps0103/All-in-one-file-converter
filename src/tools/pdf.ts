import {PDFDocument, StandardFonts, degrees, rgb} from 'pdf-lib';
import {FileBridge, type PickedFile} from '@/native/FileBridge';
import {ImageTools, PdfCompress, PdfCrypto, PdfExtract, PdfOcr, PdfRender, Workbench, type OutFile} from '@/native/Tools';
import {base, errorText, named, publish, saveB64, stage, sum, temp} from './helpers';
import type {RunResult} from './types';

const PDF = 'application/pdf';

async function load(f: PickedFile) {
  const b64 = await FileBridge.readBase64(f.uri);
  try {
    return await PDFDocument.load(b64);
  } catch (e) {
    throw new Error(errorText(e));
  }
}

/** "1-3, 7, 10-" against a page count, as zero-based indices. */
export function parseRanges(input: string, pageCount: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;
    const m = chunk.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const from = m[1] ? parseInt(m[1], 10) : 1;
      const to = m[2] ? parseInt(m[2], 10) : pageCount;
      for (let p = Math.max(1, from); p <= Math.min(to, pageCount); p++) out.add(p - 1);
    } else if (/^\d+$/.test(chunk)) {
      const p = parseInt(chunk, 10);
      if (p >= 1 && p <= pageCount) out.add(p - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

const save = async (doc: PDFDocument, name: string) => saveB64(await doc.saveAsBase64(), name, PDF);

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export async function merge(files: PickedFile[], progress: (p: number, l: string) => void): Promise<RunResult> {
  if (files.length < 2) throw new Error('Choose at least two PDFs to merge.');
  const out = await PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    progress(10 + (i / files.length) * 75, `Adding ${files[i].name}`);
    const src = await load(files[i]);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  progress(90, 'Saving');
  const f = await save(out, named(files[0].name, 'merged', 'pdf'));
  return {files: [f], note: `${plural(files.length, 'file')} joined, ${plural(out.getPageCount(), 'page')}`};
}

export async function split(file: PickedFile, mode: string, ranges: string, progress: (p: number, l: string) => void): Promise<RunResult> {
  const src = await load(file);
  const count = src.getPageCount();
  if (mode === 'ranges') {
    const idx = parseRanges(ranges, count);
    if (!idx.length) throw new Error(`No pages matched. This file has ${count} pages.`);
    const out = await PDFDocument.create();
    (await out.copyPages(src, idx)).forEach(p => out.addPage(p));
    return {files: [await save(out, named(file.name, 'pages', 'pdf'))], note: `${plural(idx.length, 'page')} kept`};
  }
  // Every page (or every N pages) as its own file, gathered in one folder.
  const every = mode === 'each' ? 1 : Math.max(1, parseInt(mode, 10) || 1);
  const dir = await Workbench.tempDir();
  let part = 0;
  for (let start = 0; start < count; start += every) {
    progress(10 + (start / count) * 80, `Page ${start + 1} of ${count}`);
    const out = await PDFDocument.create();
    const idx = Array.from({length: Math.min(every, count - start)}, (_, k) => start + k);
    (await out.copyPages(src, idx)).forEach(p => out.addPage(p));
    part++;
    await Workbench.writeBase64(await out.saveAsBase64(), `${dir}/${base(file.name)}-${String(part).padStart(3, '0')}.pdf`);
  }
  const folder = `${base(file.name)}-split`;
  const files = await Workbench.publishDir(dir, folder);
  return {files, folder: `Downloads/${folder}`, note: `${plural(files.length, 'file')} saved`};
}

export async function deletePages(file: PickedFile, ranges: string): Promise<RunResult> {
  const doc = await load(file);
  const drop = parseRanges(ranges, doc.getPageCount());
  if (!drop.length) throw new Error('No pages matched that range.');
  if (drop.length >= doc.getPageCount()) throw new Error('That would remove every page.');
  [...drop].reverse().forEach(i => doc.removePage(i));
  return {files: [await save(doc, named(file.name, 'trimmed', 'pdf'))], note: `${plural(drop.length, 'page')} removed`};
}

export async function rotate(file: PickedFile, turns: number, ranges: string): Promise<RunResult> {
  const doc = await load(file);
  const only = ranges.trim() ? new Set(parseRanges(ranges, doc.getPageCount())) : null;
  doc.getPages().forEach((p, i) => {
    if (only && !only.has(i)) return;
    p.setRotation(degrees((p.getRotation().angle + turns) % 360));
  });
  return {files: [await save(doc, named(file.name, 'rotated', 'pdf'))]};
}

export async function pageNumbers(file: PickedFile, position: string, startAt: number): Promise<RunResult> {
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const total = doc.getPageCount();
  doc.getPages().forEach((page, i) => {
    const label = `${i + startAt}`;
    const size = 10;
    const w = font.widthOfTextAtSize(label, size);
    const {width, height} = page.getSize();
    const top = position.startsWith('top');
    const x = position.endsWith('left') ? 28 : position.endsWith('right') ? width - 28 - w : width / 2 - w / 2;
    page.drawText(label, {x, y: top ? height - 28 : 20, size, font, color: rgb(0.35, 0.35, 0.35)});
  });
  return {files: [await save(doc, named(file.name, 'numbered', 'pdf'))], note: `${plural(total, 'page')} numbered`};
}

export async function watermark(file: PickedFile, text: string, opacity: number, diagonal: boolean): Promise<RunResult> {
  const label = text.trim() || 'CONFIDENTIAL';
  const doc = await load(file);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach(page => {
    const {width, height} = page.getSize();
    const size = Math.min(width, height) / Math.max(6, label.length * 0.75);
    const w = font.widthOfTextAtSize(label, size);
    const angle = diagonal ? 35 : 0;
    const rad = (angle * Math.PI) / 180;
    page.drawText(label, {
      x: width / 2 - (w / 2) * Math.cos(rad),
      y: height / 2 - (w / 2) * Math.sin(rad) - (diagonal ? 0 : size / 3),
      size,
      font,
      color: rgb(0.55, 0.55, 0.6),
      opacity: opacity / 100,
      rotate: degrees(angle),
    });
  });
  return {files: [await save(doc, named(file.name, 'watermarked', 'pdf'))]};
}

// ------------------------------------------------------------- native based

export async function compress(file: PickedFile, level: string): Promise<RunResult> {
  const levels: Record<string, [number, number]> = {light: [0.85, 2200], balanced: [0.7, 1600], strong: [0.5, 1000]};
  const [q, edge] = levels[level] ?? levels.balanced;
  const src = await stage(file);
  const dest = await temp(named(file.name, 'compressed', 'pdf'));
  const res = await PdfCompress.rewriteImages(src, dest, q, edge, false).catch(e => {
    throw new Error(errorText(e));
  });
  const out = await publish(res.path, named(file.name, 'compressed', 'pdf'));
  const note =
    res.imagesRewritten === 0
      ? 'This PDF is mostly text, so there was little to shrink.'
      : res.bytesAfter >= res.bytesBefore
        ? 'Already well compressed.'
        : undefined;
  return {files: [out], beforeBytes: res.bytesBefore, afterBytes: res.bytesAfter, note};
}

export async function grayscale(file: PickedFile): Promise<RunResult> {
  const src = await stage(file);
  const dest = await temp(named(file.name, 'grayscale', 'pdf'));
  const res = await PdfCompress.rewriteImages(src, dest, 0.8, 0, true);
  const out = await publish(res.path, named(file.name, 'grayscale', 'pdf'));
  return {files: [out], note: res.imagesRewritten ? `${plural(res.imagesRewritten, 'image')} turned grey` : 'No images found. Text colour is not changed.'};
}

export async function addPassword(file: PickedFile, password: string, allowPrinting: boolean, allowCopy: boolean): Promise<RunResult> {
  if (password.length < 4) throw new Error('Use a password of at least 4 characters.');
  const src = await stage(file);
  const dest = await temp(named(file.name, 'locked', 'pdf'));
  await PdfCrypto.addPassword(src, dest, password, password, allowPrinting, allowCopy);
  return {files: [await publish(dest, named(file.name, 'locked', 'pdf'))], note: 'Keep the password safe. It cannot be recovered.'};
}

export async function removePassword(file: PickedFile, password: string): Promise<RunResult> {
  const src = await stage(file);
  const dest = await temp(named(file.name, 'unlocked', 'pdf'));
  try {
    await PdfCrypto.removePassword(src, dest, password);
  } catch (e) {
    const code = (e as {code?: string}).code;
    if (code === 'E_WRONG_PASSWORD') throw new Error('That password is not correct.');
    if (code === 'E_NOT_ENCRYPTED') throw new Error('This PDF has no password.');
    throw e;
  }
  return {files: [await publish(dest, named(file.name, 'unlocked', 'pdf'))]};
}

export async function toImages(file: PickedFile, format: 'jpg' | 'png', dpi: number): Promise<RunResult> {
  const src = await stage(file);
  const dir = await Workbench.tempDir();
  await PdfRender.exportPages(src, dir, dpi, format).catch(e => {
    throw new Error(errorText(e));
  });
  const folder = `${base(file.name)}-images`;
  const files = await Workbench.publishDir(dir, folder);
  return {files, folder: `Downloads/${folder}`, note: `${plural(files.length, 'page')} saved as ${format.toUpperCase()}`};
}

export async function imagesToPdf(files: PickedFile[], pageSize: string): Promise<RunResult> {
  const dest = await temp(named(files[0].name, 'images', 'pdf'));
  await ImageTools.imagesToPdf(files.map(f => f.uri), pageSize, 24, dest);
  const out = await publish(dest, files.length > 1 ? 'images.pdf' : named(files[0].name, '', 'pdf'));
  return {files: [out], note: `${plural(files.length, 'image')} → ${plural(files.length, 'page')}`};
}

export async function toText(file: PickedFile): Promise<RunResult> {
  const src = await stage(file);
  const dest = await temp(named(file.name, '', 'txt'));
  const res = await PdfExtract.extractText(src, dest).catch(e => {
    throw new Error(errorText(e));
  });
  const out = await publish(res.path, named(file.name, '', 'txt'));
  return {files: [out], note: res.characters ? `${res.characters.toLocaleString()} characters` : 'No text layer. This looks like a scan — try Make Searchable.'};
}

export async function extractImages(file: PickedFile): Promise<RunResult> {
  const src = await stage(file);
  const dir = await Workbench.tempDir();
  const written = await PdfExtract.extractImages(src, dir);
  if (!written.length) throw new Error('No pictures are embedded in this PDF.');
  const folder = `${base(file.name)}-pictures`;
  const files = await Workbench.publishDir(dir, folder);
  return {files, folder: `Downloads/${folder}`, note: `${plural(files.length, 'picture')} saved`};
}

export async function makeSearchable(file: PickedFile): Promise<RunResult> {
  const src = await stage(file);
  const dest = await temp(named(file.name, 'searchable', 'pdf'));
  const res = await PdfOcr.makeSearchable(src, dest, 200);
  const out = await publish(res.path, named(file.name, 'searchable', 'pdf'));
  return {files: [out], note: res.words ? `${res.words.toLocaleString()} words read on ${plural(res.pages, 'page')}` : 'No text recognised. Try a sharper scan.'};
}

export const totalIn = (files: PickedFile[]) => sum(files);
export type {OutFile};
