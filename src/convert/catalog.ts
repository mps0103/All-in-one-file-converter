import type {InkName} from '@/theme';

export type ToolId =
  | 'pdf-to-word'
  | 'pdf-to-excel'
  | 'pdf-to-text'
  | 'word-to-pdf'
  | 'excel-to-pdf'
  | 'slides-to-pdf'
  | 'text-to-pdf'
  | 'csv-to-excel'
  | 'excel-to-csv'
  | 'word-to-text'
  | 'extract-archive'
  | 'make-archive';

export type Tool = {
  id: ToolId;
  title: string;
  from: string;
  to: string;
  ink: InkName;
  accept: string[];
  multi?: boolean;
  /** Shown on the tool screen. Says plainly what survives the conversion. */
  note: string;
  group: 'From PDF' | 'To PDF' | 'Documents & sheets' | 'Archives';
};

export const TOOLS: Tool[] = [
  {
    id: 'pdf-to-word',
    title: 'PDF to Word',
    from: 'PDF',
    to: 'DOCX',
    ink: 'word',
    accept: ['application/pdf'],
    group: 'From PDF',
    note: 'Keeps the text, paragraphs and page breaks. Columns, tables and images are not rebuilt, and a scanned PDF has no text to take.',
  },
  {
    id: 'pdf-to-excel',
    title: 'PDF to Excel',
    from: 'PDF',
    to: 'XLSX',
    ink: 'excel',
    accept: ['application/pdf'],
    group: 'From PDF',
    note: 'Works on PDFs where table columns are spaced apart, such as statements and invoices. Check the sheet before you use it.',
  },
  {
    id: 'pdf-to-text',
    title: 'PDF to text',
    from: 'PDF',
    to: 'TXT',
    ink: 'text',
    accept: ['application/pdf'],
    group: 'From PDF',
    note: 'Plain text of every page, in reading order.',
  },
  {
    id: 'word-to-pdf',
    title: 'Word to PDF',
    from: 'DOCX',
    to: 'PDF',
    ink: 'pdf',
    accept: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    group: 'To PDF',
    note: 'Keeps headings, lists, bold and italic, tables and inline images. Page-exact spacing can shift a little.',
  },
  {
    id: 'excel-to-pdf',
    title: 'Excel to PDF',
    from: 'XLSX / CSV',
    to: 'PDF',
    ink: 'pdf',
    accept: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ],
    group: 'To PDF',
    note: 'Every sheet becomes a table in the PDF. Charts and cell colours are not carried over.',
  },
  {
    id: 'slides-to-pdf',
    title: 'Slides to PDF',
    from: 'PPTX',
    to: 'PDF',
    ink: 'pdf',
    accept: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    group: 'To PDF',
    note: 'Takes the text of each slide, one slide per page. Layout, pictures and themes are not drawn.',
  },
  {
    id: 'text-to-pdf',
    title: 'Text to PDF',
    from: 'TXT / HTML',
    to: 'PDF',
    ink: 'pdf',
    accept: ['text/plain', 'text/html'],
    group: 'To PDF',
    note: 'Clean typeset pages with automatic page breaks.',
  },
  {
    id: 'csv-to-excel',
    title: 'CSV to Excel',
    from: 'CSV',
    to: 'XLSX',
    ink: 'excel',
    accept: ['text/csv', 'text/comma-separated-values', 'text/plain'],
    group: 'Documents & sheets',
    note: 'Rows and columns land in a real worksheet.',
  },
  {
    id: 'excel-to-csv',
    title: 'Excel to CSV',
    from: 'XLSX',
    to: 'CSV',
    ink: 'text',
    accept: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    group: 'Documents & sheets',
    note: 'Takes the first sheet. Formulas are saved as their last calculated value.',
  },
  {
    id: 'word-to-text',
    title: 'Word to text',
    from: 'DOCX',
    to: 'TXT',
    ink: 'text',
    accept: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    group: 'Documents & sheets',
    note: 'Plain text with the formatting stripped out.',
  },
  {
    id: 'extract-archive',
    title: 'Extract archive',
    from: 'ZIP / 7Z / RAR / TAR',
    to: 'Files',
    ink: 'archive',
    accept: [
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
    ],
    group: 'Archives',
    note: 'Opens ZIP, 7Z, TAR, TAR.GZ, TGZ, GZ, BZ2, XZ and older RAR files into a folder inside Downloads. Password-protected ZIPs work once you enter the password. RAR5 archives cannot be opened.',
  },
  {
    id: 'make-archive',
    title: 'Make an archive',
    from: 'Any files',
    to: 'ZIP',
    ink: 'archive',
    accept: ['*/*'],
    multi: true,
    group: 'Archives',
    note: 'Packs whatever you choose into one archive. Only a zip can carry a password — 7z and tar have no encryption this app can write.',
  },
];

export const GROUPS: Tool['group'][] = ['From PDF', 'To PDF', 'Documents & sheets', 'Archives'];

export const toolById = (id: ToolId) => TOOLS.find(t => t.id === id)!;

export const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};
