// Edit JSONC secara "bedah": hanya path yang diubah yang tersentuh,
// komentar dan format bagian lain dibiarkan apa adanya.
import { parse, printParseErrorCode, modify, applyEdits } from 'jsonc-parser';

const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

export function parseJsonc(text, label = 'file') {
  const errors = [];
  const value = parse(text, errors, PARSE_OPTIONS);
  if (errors.length) {
    const e = errors[0];
    const line = text.slice(0, e.offset).split('\n').length;
    throw new Error(`${label}: gagal parse (${printParseErrorCode(e.error)} di baris ${line})`);
  }
  return value ?? {};
}

function detectFormatting(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indentMatch = text.match(/\n([ \t]+)\S/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const insertSpaces = !indent.startsWith('\t');
  return { eol, insertSpaces, tabSize: insertSpaces ? indent.length : 1 };
}

// Editor kecil: panggil set()/remove() berkali-kali, lalu ambil .text
export class JsoncEditor {
  constructor(text) {
    this.text = text.trim() ? text : '{}\n';
    this.formattingOptions = detectFormatting(this.text);
  }

  get value() {
    return parseJsonc(this.text);
  }

  set(path, value) {
    const edits = modify(this.text, path, value, { formattingOptions: this.formattingOptions });
    this.text = applyEdits(this.text, edits);
  }

  remove(path) {
    this.set(path, undefined);
  }
}

export function getIn(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

export function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
