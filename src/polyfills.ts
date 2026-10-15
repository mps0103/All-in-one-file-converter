import {Buffer} from 'buffer';

// mammoth, docx and jszip all expect a Node-style Buffer to exist.
if (typeof global.Buffer === 'undefined') {
  (global as unknown as {Buffer: typeof Buffer}).Buffer = Buffer;
}
if (typeof global.process === 'undefined') {
  (global as unknown as {process: Record<string, unknown>}).process = {env: {}};
}

/**
 * Hermes ships no TextDecoder/TextEncoder, and two of the conversion libraries
 * reach for them: mammoth decodes every zip entry name through TextDecoder, and
 * SheetJS uses both when it reads a sheet. Without these, Word to PDF and Word to
 * text fail outright with "TextDecoder does not exist".
 *
 * Buffer does the actual work, so this stays small. Only the encodings those two
 * libraries ask for are supported; utf-16be has no Buffer equivalent and is
 * byte-swapped into utf-16le by hand.
 */
const BUFFER_ENCODINGS: Record<string, BufferEncoding> = {
  'utf-8': 'utf8',
  utf8: 'utf8',
  'unicode-1-1-utf-8': 'utf8',
  'utf-16le': 'utf16le',
  'utf-16': 'utf16le',
  ucs2: 'utf16le',
  'ucs-2': 'utf16le',
  latin1: 'latin1',
  binary: 'latin1',
  'iso-8859-1': 'latin1',
  'windows-1252': 'latin1',
  ascii: 'ascii',
};

const toBuffer = (input?: ArrayBuffer | ArrayBufferView): Buffer => {
  if (!input) return Buffer.alloc(0);
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input);
};

if (typeof (global as {TextDecoder?: unknown}).TextDecoder === 'undefined') {
  class PolyfilledTextDecoder {
    readonly encoding: string;
    readonly fatal = false;
    readonly ignoreBOM = false;

    constructor(label: string = 'utf-8') {
      this.encoding = String(label).toLowerCase();
    }

    decode(input?: ArrayBuffer | ArrayBufferView): string {
      let buffer = toBuffer(input);

      if (this.encoding === 'utf-16be') {
        // Buffer has no big-endian utf-16, so swap each pair and read as little.
        const swapped = Buffer.from(buffer);
        for (let i = 0; i + 1 < swapped.length; i += 2) {
          const b = swapped[i];
          swapped[i] = swapped[i + 1];
          swapped[i + 1] = b;
        }
        buffer = swapped;
      }

      const encoding = BUFFER_ENCODINGS[this.encoding] ?? 'utf8';
      return buffer.toString(this.encoding === 'utf-16be' ? 'utf16le' : encoding);
    }
  }

  (global as unknown as {TextDecoder: unknown}).TextDecoder = PolyfilledTextDecoder;
}

if (typeof (global as {TextEncoder?: unknown}).TextEncoder === 'undefined') {
  class PolyfilledTextEncoder {
    // The spec allows utf-8 only, which is also all the libraries ask for.
    readonly encoding = 'utf-8';

    encode(input: string = ''): Uint8Array {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  }

  (global as unknown as {TextEncoder: unknown}).TextEncoder = PolyfilledTextEncoder;
}
