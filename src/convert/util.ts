import {Buffer} from 'buffer';

export const b64ToBytes = (b64: string): Uint8Array =>
  new Uint8Array(Buffer.from(b64, 'base64'));

export const bytesToB64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

export const b64ToText = (b64: string): string => Buffer.from(b64, 'base64').toString('utf8');

export const textToB64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

export const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, '');

/** Keeps names that MediaStore and every file manager will accept. */
export const safeName = (base: string, ext: string) => {
  const cleaned = stripExtension(base).replace(/[^\w\-. ()]+/g, ' ').replace(/\s+/g, ' ').trim();
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
  return `${cleaned || 'converted'}_${stamp}.${ext}`;
};

export const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * One print stylesheet for every HTML-backed PDF, so a converted sheet and a
 * converted document come out of the app looking like the same product.
 */
export const printableDocument = (body: string, title: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 15mm; }
  body { font-family: -apple-system, Roboto, 'Segoe UI', sans-serif; font-size: 11.5pt;
         line-height: 1.55; color: #16142A; }
  h1 { font-size: 19pt; margin: 0 0 10pt; letter-spacing: -0.4pt; }
  h2 { font-size: 15pt; margin: 16pt 0 6pt; }
  h3 { font-size: 13pt; margin: 14pt 0 5pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt 18pt; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 12pt; font-size: 9.5pt;
          page-break-inside: auto; }
  th, td { border: 0.6pt solid #C9C5DA; padding: 4pt 6pt; text-align: left;
           vertical-align: top; word-break: break-word; }
  th { background: #EFEDF7; font-weight: 600; }
  tr { page-break-inside: avoid; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-family: 'Roboto Mono', monospace;
        font-size: 10pt; }
  .sheet-title { font-size: 12pt; font-weight: 600; margin: 14pt 0 6pt; }
  .slide { page-break-after: always; }
  .slide:last-child { page-break-after: auto; }
</style></head><body>${body}</body></html>`;
