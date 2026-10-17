import {convert} from '@/convert/engine';
import {toolById, type ToolId} from '@/convert/catalog';
import {ArchiveBridge} from '@/native/FileBridge';
import {ImageTools, MediaTools, PdfCrypto, PdfRender, Workbench} from '@/native/Tools';
import {base, clock, humanBytes, named, saveText, stage} from './helpers';
import * as P from './pdf';
import * as M from './media';
import type {Category, CategoryId, ConvertTab, Opt, Opts, RunContext, RunResult, Tool} from './types';

// ------------------------------------------------------------- categories

export const CATEGORIES: Category[] = [
  {id: 'pdf', title: 'PDF Tools', tint: 'red', icon: 'pdf', layout: 'grid'},
  {id: 'convert', title: 'Convert Files', tint: 'blue', icon: 'convert', layout: 'list'},
  {id: 'image', title: 'Image Tools', tint: 'orange', icon: 'image', layout: 'list'},
  {id: 'video', title: 'Video Tools', tint: 'purple', icon: 'video', layout: 'list'},
  {id: 'audio', title: 'Audio Tools', tint: 'green', icon: 'music', layout: 'list'},
  {id: 'more', title: 'More Tools', tint: 'indigo', icon: 'grid', layout: 'list'},
];

export const CONVERT_TABS: ConvertTab[] = ['Documents', 'Images', 'Audio', 'Video'];

// ------------------------------------------------------------ option sets

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const AUDIO_FORMATS = [
  {value: 'mp3', label: 'MP3'},
  {value: 'm4a', label: 'M4A'},
  {value: 'aac', label: 'AAC'},
  {value: 'wav', label: 'WAV'},
];

const audioFormat: Opt = {
  key: 'format',
  label: 'Output format',
  kind: 'segment',
  def: 'mp3',
  choices: AUDIO_FORMATS,
};

/** For tools whose point is a smaller or re-encoded file, where lossless WAV makes no sense. */
const lossyFormat: Opt = {
  key: 'format',
  label: 'Output format',
  kind: 'segment',
  def: 'mp3',
  choices: AUDIO_FORMATS.filter(c => c.value !== 'wav'),
};

const bitrate = (def = 192000, values = [96000, 128000, 192000, 256000, 320000]): Opt => ({
  key: 'bitrate',
  label: 'Bit rate',
  kind: 'segment',
  def,
  choices: values.map(v => ({value: v, label: `${v / 1000}k`})),
  show: o => o.format !== 'wav',
});

const imageFormat = (def = 'jpg', withSame = false): Opt => ({
  key: 'format',
  label: 'Save as',
  kind: 'segment',
  def,
  choices: [
    ...(withSame ? [{value: 'same', label: 'Same'}] : []),
    {value: 'jpg', label: 'JPG'},
    {value: 'png', label: 'PNG'},
    {value: 'webp', label: 'WEBP'},
  ],
});

const quality = (def = 80): Opt => ({
  key: 'quality',
  label: 'Quality',
  kind: 'slider',
  min: 10,
  max: 100,
  step: 5,
  def,
  format: v => `${v}%`,
  show: o => o.format !== 'png',
});

const trim = (defaultLengthMs?: number): Opt => ({key: 'trim', label: 'Keep this part', kind: 'trim', defaultLengthMs});

const resolution: Opt = {
  key: 'height',
  label: 'Resolution',
  kind: 'segment',
  def: 720,
  choices: [
    {value: 360, label: '360p'},
    {value: 480, label: '480p'},
    {value: 720, label: '720p'},
    {value: 1080, label: '1080p'},
    {value: 1440, label: '2K'},
    {value: 2160, label: '4K'},
  ],
};

const ARCHIVES = [
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
  'application/octet-stream',
];

// --------------------------------------------------------------- runners

/** Document conversions reuse the File Converter engine unchanged. */
const doc = (id: ToolId) => async ({files, o, progress}: RunContext): Promise<RunResult> => {
  const res = await convert(toolById(id), files, {password: o.password || undefined}, progress);
  return {files: res.files, note: res.warning};
};

const one = (ctx: RunContext) => ctx.files[0];

const fileInfo = async ({files}: RunContext): Promise<RunResult> => {
  const f = files[0];
  const info = await Workbench.info(f.uri);
  const rows: {label: string; value: string}[] = [
    {label: 'Name', value: info.name},
    {label: 'Type', value: `${info.extension || '—'}  ·  ${info.mime}`},
    {label: 'Size', value: `${humanBytes(info.size)}  (${Math.round(info.size).toLocaleString()} bytes)`},
  ];
  if (info.width && info.height) rows.push({label: 'Dimensions', value: `${info.width} × ${info.height} px`});
  if (info.durationMs) rows.push({label: 'Length', value: clock(info.durationMs)});
  if (info.bitrate) rows.push({label: 'Bit rate', value: `${Math.round(info.bitrate / 1000)} kbps`});
  if (info.mime === 'application/pdf') {
    try {
      const path = await stage(f);
      const locked = await PdfCrypto.isEncrypted(path);
      rows.push({label: 'Password', value: locked ? 'Protected' : 'None'});
      if (!locked) rows.push({label: 'Pages', value: String(await PdfRender.pageCount(path))});
    } catch {
      // Page count is a nice-to-have.
    }
  }
  if (info.modified) rows.push({label: 'Modified', value: new Date(info.modified).toLocaleString()});
  return {files: [], info: rows};
};

const ocrImage = async ({files, progress}: RunContext): Promise<RunResult> => {
  const parts: string[] = [];
  for (let i = 0; i < files.length; i++) {
    progress(10 + (i / files.length) * 80, files.length > 1 ? `Reading image ${i + 1}` : 'Reading text');
    const r = await ImageTools.recognizeText(files[i].uri);
    if (r.text.trim()) parts.push(r.text.trim());
  }
  if (!parts.length) throw new Error('No text found. Try a sharper, well-lit photo.');
  const text = parts.join('\n\n');
  const out = await saveText(text, named(files[0].name, 'text', 'txt'));
  return {files: [out], text};
};

const makeArchive = async ({files, o, progress}: RunContext): Promise<RunResult> => {
  progress(20, 'Packing files');
  const name = (o.name || '').trim() || (files.length === 1 ? base(files[0].name) : 'archive');
  const saved = await ArchiveBridge.createArchive(
    files.map(f => f.uri),
    o.format,
    o.format === 'zip' ? o.password || '' : '',
    name,
  );
  const size = (await Workbench.info(saved.uri).catch(() => ({size: 0}))).size;
  return {files: [{...saved, size}], beforeBytes: files.reduce((a, f) => a + (f.size || 0), 0), afterBytes: size};
};

/** An image tool: the run and the live preview share one mapping of the options. */
const imageTool = (suffix: string, map: (o: Opts) => Opts, preview?: Tool['preview']) => ({
  imageOpts: map,
  preview,
  run: (c: RunContext) => M.image(c.files, map(c.o), suffix, c.progress),
});

// ------------------------------------------------------------------ tools

export const TOOLS: Tool[] = [
  // ============================== PDF (grid)
  {
    id: 'pdf-merge', title: 'Merge PDF', subtitle: 'Combine several PDFs into one', category: 'pdf', tint: 'red', icon: 'merge',
    accept: ['application/pdf'], multi: true, minFiles: 2,
    note: 'Files are joined in the order you pick them. Use the arrows to change the order.',
    run: c => P.merge(c.files, c.progress),
  },
  {
    id: 'pdf-split', title: 'Split PDF', subtitle: 'Pages or ranges into new files', category: 'pdf', tint: 'purple', icon: 'split',
    accept: ['application/pdf'],
    options: [
      {key: 'mode', label: 'Split', kind: 'segment', def: 'each', choices: [
        {value: 'each', label: 'Every page'}, {value: '2', label: 'Every 2'}, {value: 'ranges', label: 'Pick pages'},
      ]},
      {key: 'ranges', label: 'Pages to keep', kind: 'text', placeholder: 'e.g. 1-3, 6, 9-', show: o => o.mode === 'ranges', required: true},
    ],
    run: c => P.split(one(c), c.o.mode, c.o.ranges ?? '', c.progress),
  },
  {
    id: 'pdf-compress', title: 'Compress PDF', subtitle: 'Shrink for email and upload', category: 'pdf', tint: 'blue', icon: 'compress',
    accept: ['application/pdf'],
    options: [{key: 'level', label: 'Compression', kind: 'segment', def: 'balanced', choices: [
      {value: 'light', label: 'Light'}, {value: 'balanced', label: 'Balanced'}, {value: 'strong', label: 'Strong'},
    ]}],
    note: 'Pictures inside the PDF are re-encoded. Text stays sharp.',
    run: c => P.compress(one(c), c.o.level),
  },
  {
    id: 'pdf-to-image', title: 'PDF to Image', subtitle: 'Every page as JPG or PNG', category: 'pdf', tint: 'orange', icon: 'image', convertTab: 'Images',
    accept: ['application/pdf'],
    options: [
      {key: 'format', label: 'Format', kind: 'segment', def: 'jpg', choices: [{value: 'jpg', label: 'JPG'}, {value: 'png', label: 'PNG'}]},
      {key: 'dpi', label: 'Quality', kind: 'segment', def: 150, choices: [{value: 96, label: 'Screen'}, {value: 150, label: 'Good'}, {value: 220, label: 'Print'}]},
    ],
    run: c => P.toImages(one(c), c.o.format, Number(c.o.dpi)),
  },
  {
    id: 'image-to-pdf', title: 'Image to PDF', subtitle: 'Photos into one PDF', category: 'pdf', tint: 'red', icon: 'images', convertTab: 'Images',
    accept: ['image/*'], multi: true,
    options: [{key: 'page', label: 'Page size', kind: 'segment', def: 'a4', choices: [
      {value: 'a4', label: 'A4'}, {value: 'letter', label: 'Letter'}, {value: 'fit', label: 'Fit image'},
    ]}],
    run: c => P.imagesToPdf(c.files, c.o.page),
  },
  {
    id: 'pdf-rotate', title: 'Rotate PDF', subtitle: 'Turn pages 90° or 180°', category: 'pdf', tint: 'orange', icon: 'rotate',
    accept: ['application/pdf'],
    options: [
      {key: 'turns', label: 'Rotate', kind: 'segment', def: 90, choices: [{value: 90, label: '90° right'}, {value: 180, label: '180°'}, {value: 270, label: '90° left'}]},
      {key: 'ranges', label: 'Only these pages (optional)', kind: 'text', placeholder: 'All pages'},
    ],
    run: c => P.rotate(one(c), Number(c.o.turns), c.o.ranges ?? ''),
  },
  {id: 'pdf-to-word', title: 'PDF to Word', subtitle: 'Convert PDF to DOCX', category: 'pdf', tint: 'blue', icon: 'word', convertTab: 'Documents', accept: ['application/pdf'], note: toolById('pdf-to-word').note, run: doc('pdf-to-word')},
  {id: 'pdf-to-excel', title: 'PDF to Excel', subtitle: 'Tables into XLSX', category: 'pdf', tint: 'green', icon: 'excel', convertTab: 'Documents', accept: ['application/pdf'], note: toolById('pdf-to-excel').note, run: doc('pdf-to-excel')},
  {
    id: 'pdf-protect', title: 'Add Password', subtitle: 'Lock a PDF before sharing', category: 'pdf', tint: 'yellow', icon: 'lock',
    accept: ['application/pdf'],
    options: [
      {key: 'password', label: 'Password', kind: 'password', placeholder: 'At least 4 characters', required: true},
      {key: 'print', label: 'Allow printing', kind: 'switch', def: true},
      {key: 'copy', label: 'Allow copying text', kind: 'switch', def: false},
    ],
    run: c => P.addPassword(one(c), c.o.password, c.o.print, c.o.copy),
  },
  {
    id: 'pdf-unlock', title: 'Remove Password', subtitle: 'Needs the current password', category: 'pdf', tint: 'purple', icon: 'unlock',
    accept: ['application/pdf'],
    options: [{key: 'password', label: 'Current password', kind: 'password', required: true}],
    run: c => P.removePassword(one(c), c.o.password),
  },
  {
    id: 'pdf-delete-pages', title: 'Delete Pages', subtitle: 'Remove pages you do not need', category: 'pdf', tint: 'pink', icon: 'trash',
    accept: ['application/pdf'],
    options: [{key: 'ranges', label: 'Pages to delete', kind: 'text', placeholder: 'e.g. 2, 5-7', required: true}],
    run: c => P.deletePages(one(c), c.o.ranges),
  },
  {
    id: 'pdf-page-numbers', title: 'Page Numbers', subtitle: 'Stamp numbers on every page', category: 'pdf', tint: 'teal', icon: 'hash',
    accept: ['application/pdf'],
    options: [
      {key: 'position', label: 'Position', kind: 'segment', def: 'bottom-center', choices: [
        {value: 'bottom-left', label: 'Left'}, {value: 'bottom-center', label: 'Centre'}, {value: 'bottom-right', label: 'Right'}, {value: 'top-right', label: 'Top'},
      ]},
      {key: 'start', label: 'Start at', kind: 'number', def: '1'},
    ],
    run: c => P.pageNumbers(one(c), c.o.position, parseInt(c.o.start, 10) || 1),
  },
  {
    id: 'pdf-watermark', title: 'Add Watermark', subtitle: 'Text over every page', category: 'pdf', tint: 'indigo', icon: 'drop',
    accept: ['application/pdf'],
    options: [
      {key: 'text', label: 'Watermark text', kind: 'text', placeholder: 'CONFIDENTIAL', def: ''},
      {key: 'opacity', label: 'Opacity', kind: 'slider', min: 10, max: 80, step: 5, def: 25, format: v => `${v}%`},
      {key: 'diagonal', label: 'Diagonal', kind: 'switch', def: true},
    ],
    run: c => P.watermark(one(c), c.o.text ?? '', c.o.opacity, c.o.diagonal),
  },
  {id: 'pdf-to-text', title: 'PDF to Text', subtitle: 'Pull out all the text', category: 'pdf', tint: 'sky', icon: 'text', convertTab: 'Documents', accept: ['application/pdf'], run: c => P.toText(one(c))},
  {id: 'pdf-extract-images', title: 'Extract Images', subtitle: 'Save pictures inside a PDF', category: 'pdf', tint: 'orange', icon: 'images', accept: ['application/pdf'], run: c => P.extractImages(one(c))},
  {id: 'pdf-grayscale', title: 'Grayscale PDF', subtitle: 'Drop colour to save ink', category: 'pdf', tint: 'blue', icon: 'gray', accept: ['application/pdf'], run: c => P.grayscale(one(c))},
  {id: 'pdf-ocr', title: 'Make Searchable', subtitle: 'Read text in scanned PDFs', category: 'pdf', tint: 'green', icon: 'scan', accept: ['application/pdf'], note: 'Text is read on the phone with an offline model. Best for printed text.', run: c => P.makeSearchable(one(c))},
  {id: 'word-to-pdf', title: 'Word to PDF', subtitle: 'Convert DOCX to PDF', category: 'pdf', tint: 'blue', icon: 'word', convertTab: 'Documents', accept: [DOCX], note: toolById('word-to-pdf').note, run: doc('word-to-pdf')},
  {id: 'excel-to-pdf', title: 'Excel to PDF', subtitle: 'Convert XLSX or CSV to PDF', category: 'pdf', tint: 'green', icon: 'excel', convertTab: 'Documents', accept: [XLSX, 'application/vnd.ms-excel', 'text/csv'], note: toolById('excel-to-pdf').note, run: doc('excel-to-pdf')},
  {id: 'ppt-to-pdf', title: 'PowerPoint to PDF', subtitle: 'Convert PPTX to PDF', category: 'pdf', tint: 'orange', icon: 'slides', convertTab: 'Documents', accept: [PPTX], note: toolById('slides-to-pdf').note, run: doc('slides-to-pdf')},
  {id: 'text-to-pdf', title: 'Text to PDF', subtitle: 'Convert TXT to PDF', category: 'pdf', tint: 'sky', icon: 'text', convertTab: 'Documents', accept: ['text/plain', 'text/html'], run: doc('text-to-pdf')},

  // ============================== Documents only reachable from Convert Files
  {id: 'csv-to-excel', title: 'CSV to Excel', subtitle: 'Convert CSV to XLSX', category: 'convert', tint: 'green', icon: 'excel', convertTab: 'Documents', accept: ['text/csv', 'text/comma-separated-values', 'text/plain'], run: doc('csv-to-excel')},
  {id: 'excel-to-csv', title: 'Excel to CSV', subtitle: 'Convert XLSX to CSV', category: 'convert', tint: 'teal', icon: 'excel', convertTab: 'Documents', accept: [XLSX], note: toolById('excel-to-csv').note, run: doc('excel-to-csv')},
  {id: 'word-to-text', title: 'Word to Text', subtitle: 'Convert DOCX to TXT', category: 'convert', tint: 'sky', icon: 'text', convertTab: 'Documents', accept: [DOCX], run: doc('word-to-text')},

  // ============================== Images
  {
    id: 'image-convert', title: 'Image Converter', subtitle: 'JPG, PNG, WEBP, HEIC and more', category: 'image', tint: 'green', icon: 'convert', convertTab: 'Images',
    accept: ['image/*'], multi: true,
    options: [imageFormat('jpg'), quality(90)],
    note: 'Opens JPG, PNG, WEBP, HEIC, BMP and GIF (first frame). Saves JPG, PNG or WEBP.',
    ...imageTool('', o => o, 'compare'),
  },
  {
    id: 'image-resize', title: 'Resize Image', subtitle: 'Change image dimensions', category: 'image', tint: 'blue', icon: 'resize',
    accept: ['image/*'], multi: true,
    options: [
      {key: 'by', label: 'Resize by', kind: 'segment', def: 'percent', choices: [{value: 'percent', label: 'Percent'}, {value: 'pixels', label: 'Pixels'}]},
      {key: 'scale', label: 'Size', kind: 'slider', min: 10, max: 200, step: 5, def: 50, format: v => `${v}%`, show: o => o.by === 'percent'},
      {key: 'width', label: 'Width (px)', kind: 'number', placeholder: 'Auto', show: o => o.by === 'pixels'},
      {key: 'height', label: 'Height (px)', kind: 'number', placeholder: 'Auto', show: o => o.by === 'pixels'},
      {key: 'keepAspect', label: 'Keep proportions', kind: 'switch', def: true, show: o => o.by === 'pixels'},
      imageFormat('same', true),
    ],
    note: 'Over 100% enlarges the picture. Sizes go from 1 to 10000 px.',
    ...imageTool(
      'resized',
      o => ({...o, scale: o.by === 'percent' ? o.scale : undefined, width: o.by === 'pixels' ? o.width : undefined, height: o.by === 'pixels' ? o.height : undefined, quality: 92}),
      'result',
    ),
  },
  {
    id: 'image-compress', title: 'Compress Image', subtitle: 'Reduce image file size', category: 'image', tint: 'purple', icon: 'compress',
    accept: ['image/*'], multi: true,
    options: [
      {...quality(70), show: undefined},
      {key: 'maxEdge', label: 'Longest side', kind: 'segment', def: 0, choices: [{value: 0, label: 'Keep'}, {value: 2560, label: '2560'}, {value: 1920, label: '1920'}, {value: 1280, label: '1280'}]},
      {key: 'format', label: 'Save as', kind: 'segment', def: 'jpg', choices: [{value: 'jpg', label: 'JPG'}, {value: 'webp', label: 'WEBP'}]},
    ],
    ...imageTool('compressed', o => o, 'compare'),
  },
  {
    id: 'image-crop', title: 'Crop Image', subtitle: 'Crop to any shape', category: 'image', tint: 'teal', icon: 'crop',
    accept: ['image/*'], multi: true,
    options: [{key: 'crop', label: 'Crop', kind: 'crop'}, imageFormat('same', true)],
    note: 'Drag the corners or edges of the box, or the box itself. With several pictures, the same part of each is kept.',
    // The crop box shows its own picture and result, so no separate preview.
    ...imageTool('cropped', o => ({format: o.format, rotate: o.rotate, crop: o.crop, quality: 92})),
  },
  {
    id: 'image-rotate', title: 'Rotate Image', subtitle: 'Rotate left or right', category: 'image', tint: 'pink', icon: 'rotate',
    accept: ['image/*'], multi: true,
    options: [{key: 'rotate', label: 'Rotate', kind: 'segment', def: 90, choices: [{value: 90, label: '90° right'}, {value: 180, label: '180°'}, {value: 270, label: '90° left'}]}],
    ...imageTool('rotated', o => ({...o, format: 'same', quality: 95}), 'result'),
  },
  {
    id: 'image-flip', title: 'Flip Image', subtitle: 'Mirror horizontally or vertically', category: 'image', tint: 'indigo', icon: 'flip',
    accept: ['image/*'], multi: true,
    options: [{key: 'flip', label: 'Flip', kind: 'segment', def: 'h', choices: [{value: 'h', label: 'Horizontal'}, {value: 'v', label: 'Vertical'}]}],
    ...imageTool('flipped', o => ({...o, format: 'same', quality: 95}), 'result'),
  },
  {
    id: 'image-resolution', title: 'Change Resolution', subtitle: 'Pixel size or DPI', category: 'image', tint: 'orange', icon: 'monitor',
    accept: ['image/*'], multi: true,
    options: [
      {key: 'mode', label: 'Change', kind: 'segment', def: 'pixels', choices: [{value: 'pixels', label: 'Pixel size'}, {value: 'dpi', label: 'DPI only'}]},
      {key: 'maxEdge', label: 'Longest side', kind: 'segment', def: 1920, show: o => o.mode !== 'dpi', choices: [
        {value: 640, label: '640'}, {value: 1280, label: 'HD'}, {value: 1920, label: 'Full HD'}, {value: 2560, label: '2K'}, {value: 3840, label: '4K'},
      ]},
      {key: 'dpi', label: 'Dots per inch', kind: 'segment', def: 300, show: o => o.mode === 'dpi', choices: [
        {value: 72, label: '72'}, {value: 96, label: '96'}, {value: 150, label: '150'}, {value: 300, label: '300'}, {value: 600, label: '600'},
      ]},
      {...imageFormat('same', true), show: o => o.mode !== 'dpi'},
    ],
    note: 'Pixel size scales the picture down to fit the longest side; a smaller picture is not enlarged. DPI only changes the print size stored in a JPG or PNG: the pixels and quality stay exactly as they are.',
    ...imageTool('resized', o => (o.mode === 'dpi' ? {dpiOnly: true, dpi: o.dpi} : {maxEdge: o.maxEdge, format: o.format, quality: 92}), 'result'),
  },
  {
    id: 'image-grayscale', title: 'Black & White', subtitle: 'Turn photos grayscale', category: 'image', tint: 'sky', icon: 'gray',
    accept: ['image/*'], multi: true,
    ...imageTool('bw', () => ({format: 'same', quality: 92, grayscale: true}), 'compare'),
  },
  {
    id: 'image-ocr', title: 'Image to Text (OCR)', subtitle: 'Extract text from images', category: 'image', tint: 'blue', icon: 'scan',
    accept: ['image/*'], multi: true,
    note: 'Reads printed Latin-script text on the phone. Nothing is uploaded.',
    run: ocrImage,
  },

  // ============================== Video
  {
    id: 'video-convert', title: 'Video Converter', subtitle: 'MKV, WEBM, MOV, 3GP to MP4', category: 'video', tint: 'purple', icon: 'video', convertTab: 'Video',
    accept: ['video/*'], media: true,
    options: [{key: 'height', label: 'Resolution', kind: 'segment', def: 0, choices: [{value: 0, label: 'Same'}, {value: 480, label: '480p'}, {value: 720, label: '720p'}, {value: 1080, label: '1080p'}]}],
    note: 'Saves MP4 (H.264 + AAC), which plays everywhere. Any format the phone can play can be converted.',
    run: c => M.video(c.files, c.o, c.probe, 'converted', c.progress),
  },
  {
    id: 'video-compress', title: 'Compress Video', subtitle: 'Reduce video file size', category: 'video', tint: 'blue', icon: 'compress',
    accept: ['video/*'], media: true,
    options: [{key: 'level', label: 'Compression', kind: 'segment', def: 'balanced', choices: [
      {value: 'light', label: 'Light'}, {value: 'balanced', label: 'Balanced'}, {value: 'strong', label: 'Strong'},
    ]}],
    run: c => M.video(c.files, c.o, c.probe, 'compressed', c.progress),
  },
  {
    id: 'video-to-audio', title: 'Video to Audio', subtitle: 'Extract audio from video', category: 'video', tint: 'green', icon: 'music', convertTab: 'Audio',
    accept: ['video/*'], media: true,
    options: [audioFormat, bitrate(192000)],
    run: c => M.audio(c.files, c.o, c.probe, '', c.progress),
  },
  {
    id: 'video-merge', title: 'Merge Videos', subtitle: 'Combine multiple videos', category: 'video', tint: 'indigo', icon: 'layers',
    accept: ['video/*'], multi: true, minFiles: 2, media: true,
    note: 'Clips are joined in the order you pick them and fitted to the first clip’s frame.',
    run: c => M.video(c.files, c.o, c.probe, 'merged', c.progress),
  },
  {
    id: 'video-trim', title: 'Trim Video', subtitle: 'Cut video to any length', category: 'video', tint: 'pink', icon: 'scissors',
    accept: ['video/*'], media: true,
    options: [trim()],
    run: c => M.video(c.files, c.o, c.probe, 'trimmed', c.progress),
  },
  {
    id: 'video-rotate', title: 'Rotate Video', subtitle: 'Rotate video file', category: 'video', tint: 'orange', icon: 'rotate',
    accept: ['video/*'], media: true,
    options: [{key: 'rotate', label: 'Rotate', kind: 'segment', def: 90, choices: [{value: 90, label: '90° left'}, {value: 180, label: '180°'}, {value: 270, label: '90° right'}]}],
    run: c => M.video(c.files, c.o, c.probe, 'rotated', c.progress),
  },
  {
    id: 'video-resolution', title: 'Change Resolution', subtitle: '720p, 1080p, 4K, etc.', category: 'video', tint: 'green', icon: 'monitor',
    accept: ['video/*'], media: true,
    options: [resolution],
    note: 'Higher than the source does not add detail. Very high sizes need a phone that can encode them.',
    run: c => M.video(c.files, c.o, c.probe, `${c.o.height}p`, c.progress),
  },
  {
    id: 'video-mute', title: 'Mute Video', subtitle: 'Remove the sound', category: 'video', tint: 'teal', icon: 'mute',
    accept: ['video/*'], media: true,
    run: c => M.video(c.files, {...c.o, mute: true}, c.probe, 'muted', c.progress),
  },

  // ============================== Audio
  {
    id: 'audio-convert', title: 'Audio Converter', subtitle: 'MP3, WAV, AAC, M4A, OGG, FLAC…', category: 'audio', tint: 'green', icon: 'music', convertTab: 'Audio',
    accept: ['audio/*'], media: true,
    options: [audioFormat, bitrate(192000)],
    note: 'Opens any format the phone can play. Saves MP3, M4A, AAC or WAV.',
    run: c => M.audio(c.files, c.o, c.probe, '', c.progress),
  },
  {
    id: 'audio-compress', title: 'Compress Audio', subtitle: 'Reduce audio file size', category: 'audio', tint: 'pink', icon: 'compress',
    accept: ['audio/*'], media: true,
    options: [lossyFormat, bitrate(96000, [48000, 64000, 96000, 128000])],
    run: c => M.audio(c.files, c.o, c.probe, 'compressed', c.progress),
  },
  {
    id: 'audio-trim', title: 'Trim Audio', subtitle: 'Cut audio to any length', category: 'audio', tint: 'purple', icon: 'scissors',
    accept: ['audio/*'], media: true,
    options: [trim(), audioFormat, bitrate(192000)],
    run: c => M.audio(c.files, c.o, c.probe, 'trimmed', c.progress),
  },
  {
    id: 'audio-merge', title: 'Merge Audio', subtitle: 'Combine multiple audios', category: 'audio', tint: 'blue', icon: 'layers',
    accept: ['audio/*'], multi: true, minFiles: 2, media: true,
    options: [audioFormat, bitrate(192000)],
    run: c => M.audio(c.files, c.o, c.probe, 'merged', c.progress),
  },
  {
    id: 'ringtone', title: 'Ringtone Maker', subtitle: 'Make a ringtone from any song', category: 'audio', tint: 'orange', icon: 'bell',
    accept: ['audio/*', 'video/*'], media: true,
    options: [
      {key: 'length', label: 'Ringtone part', kind: 'window', lengths: [15000, 20000, 30000, 40000], def: 20000},
      {key: 'fade', label: 'Fade in and out', kind: 'switch', def: true},
    ],
    run: c => M.audio(c.files, {...c.o, format: 'mp3', bitrate: 192000}, c.probe, 'ringtone', c.progress, true),
  },
  {
    id: 'audio-volume', title: 'Adjust Volume', subtitle: 'Increase or decrease volume', category: 'audio', tint: 'teal', icon: 'volume',
    accept: ['audio/*'], media: true,
    options: [{key: 'volume', label: 'Volume', kind: 'slider', min: 10, max: 300, step: 10, def: 150, format: v => `${v}%`}, audioFormat, bitrate(192000)],
    note: 'Above 100% very loud parts can clip.',
    run: c => M.audio(c.files, c.o, c.probe, 'volume', c.progress),
  },
  {
    id: 'audio-fade', title: 'Fade In / Out', subtitle: 'Smooth start and ending', category: 'audio', tint: 'indigo', icon: 'fade',
    accept: ['audio/*'], media: true,
    options: [
      {key: 'fadeIn', label: 'Fade in', kind: 'slider', min: 0, max: 10, step: 1, def: 3, format: v => `${v} s`},
      {key: 'fadeOut', label: 'Fade out', kind: 'slider', min: 0, max: 10, step: 1, def: 3, format: v => `${v} s`},
      audioFormat,
      bitrate(192000),
    ],
    run: c => M.audio(c.files, c.o, c.probe, 'faded', c.progress),
  },
  {
    id: 'audio-bitrate', title: 'Bit Rate Changer', subtitle: 'Re-encode at 128k–320k', category: 'audio', tint: 'yellow', icon: 'gauge',
    accept: ['audio/*'], media: true,
    options: [lossyFormat, bitrate(320000, [128000, 192000, 256000, 320000])],
    note: 'A higher bit rate keeps more of the sound when re-encoding, but cannot add quality the original never had.',
    run: c => M.audio(c.files, c.o, c.probe, `${Number(c.o.bitrate) / 1000}k`, c.progress),
  },

  // ============================== More
  {
    // Opens the viewer, never the tool screen (see ToolScreen): free, no ad, nothing counted.
    id: 'view-file', title: 'View File', subtitle: 'PDF, Office, text, images, archives', category: 'more', tint: 'teal', icon: 'eye',
    accept: ['*/*'], free: true,
    run: async () => ({files: []}),
  },
  {
    id: 'make-archive', title: 'File Compressor', subtitle: 'ZIP, 7Z, TAR, TAR.GZ…', category: 'more', tint: 'purple', icon: 'zip',
    accept: ['*/*'], multi: true,
    options: [
      {key: 'format', label: 'Format', kind: 'segment', def: 'zip', choices: [
        {value: 'zip', label: 'ZIP'}, {value: '7z', label: '7Z'}, {value: 'tar', label: 'TAR'}, {value: 'tar.gz', label: 'TAR.GZ'}, {value: 'tar.bz2', label: 'BZ2'}, {value: 'tar.xz', label: 'XZ'},
      ]},
      {key: 'name', label: 'Archive name', kind: 'text', placeholder: 'archive'},
      {key: 'password', label: 'Password (ZIP only, optional)', kind: 'password', show: o => o.format === 'zip'},
    ],
    note: 'RAR cannot be created — the format is closed. Only ZIP can carry a password.',
    run: makeArchive,
  },
  {
    id: 'extract-archive', title: 'File Extractor', subtitle: 'ZIP, RAR, 7Z, TAR, GZ…', category: 'more', tint: 'yellow', icon: 'unzip',
    accept: ARCHIVES,
    options: [{key: 'password', label: 'Password (if the archive has one)', kind: 'password'}],
    note: toolById('extract-archive').note,
    run: doc('extract-archive'),
  },
  {...placeholderOf('image-ocr', 'more')},
  {...placeholderOf('pdf-watermark', 'more')},
  {...placeholderOf('pdf-unlock', 'more', 'Unlock PDF')},
  {
    id: 'file-info', title: 'File Info', subtitle: 'Size, type, pages, length', category: 'more', tint: 'blue', icon: 'info',
    accept: ['*/*'], free: true,
    run: fileInfo,
  },
];

/** A tool listed in a second category under its own id, so history and search stay single. */
function placeholderOf(id: string, category: CategoryId, title?: string): Tool {
  return {id: `${id}@${category}`, title: title ?? '', subtitle: '', category, tint: 'blue', icon: 'info', accept: [], run: async () => ({files: []})};
}

// Fill the aliases from their originals once everything is declared.
for (const t of TOOLS) {
  const at = t.id.indexOf('@');
  if (at < 0) continue;
  const src = TOOLS.find(x => x.id === t.id.slice(0, at));
  if (src) Object.assign(t, {...src, id: t.id, category: t.category, title: t.title || src.title});
}

export const realId = (id: string) => id.split('@')[0];

export const toolFor = (id: string): Tool => {
  const t = TOOLS.find(x => x.id === id) ?? TOOLS.find(x => x.id === realId(id));
  if (!t) throw new Error(`Unknown tool ${id}`);
  return t;
};

export const toolsIn = (cat: CategoryId) => TOOLS.filter(t => t.category === cat);

export const toolsForTab = (tab: ConvertTab) => TOOLS.filter(t => t.convertTab === tab && !t.id.includes('@'));

export const searchTools = (q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return TOOLS.filter(t => !t.id.includes('@') && `${t.title} ${t.subtitle}`.toLowerCase().includes(s));
};

/** Tools that can take a file of this type, for files opened from other apps. */
export const toolsForMime = (mime: string, name: string): Tool[] => {
  const m = (mime || '').toLowerCase();
  const e = (name.split('.').pop() || '').toLowerCase();
  const kind = m.startsWith('image/')
    ? 'image/*'
    : m.startsWith('video/')
      ? 'video/*'
      : m.startsWith('audio/')
        ? 'audio/*'
        : m === 'application/pdf' || e === 'pdf'
          ? 'application/pdf'
          : m;
  return TOOLS.filter(t => !t.id.includes('@') && t.id !== 'file-info' && t.accept.some(a => a === kind || a === m || (a === 'text/csv' && e === 'csv')));
};

export {MediaTools};
