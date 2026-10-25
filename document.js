// The archived DOCX supplies images. Text comes from the Google Doc snapshot.
// Range requests avoid unpacking or downloading all photographs at startup.
import Hypher from './hypher.js';
import russianPatterns from './ru-patterns.js';

const russianHyphenator = new Hypher(russianPatterns);
russianHyphenator.rightMin = 3;
const unhyphenatedWords = new Set(['впечатление']);

export class WordArchive {
  constructor(url) {
    this.url = url;
    this.entries = new Map();
    this.wholeFile = null;
  }

  async range(start, length) {
    if (this.wholeFile) return this.wholeFile.slice(start, start + length);
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
    if (!response.ok) throw new Error('Не удалось прочитать документ Word.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) {
      this.wholeFile = bytes;
      return bytes.slice(start, start + length);
    }
    return bytes;
  }

  async open() {
    const response = await fetch(this.url, { headers: { Range: 'bytes=-65557' } });
    if (!response.ok) throw new Error('Не удалось открыть документ Word.');
    const tail = new Uint8Array(await response.arrayBuffer());
    if (response.status === 200) this.wholeFile = tail;
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let end = tail.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('Не удалось прочитать содержимое DOCX.');
    const directory = await this.range(view.getUint32(end + 16, true), view.getUint32(end + 12, true));
    const data = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
    const decoder = new TextDecoder();
    for (let offset = 0; offset + 46 <= directory.length;) {
      if (data.getUint32(offset, true) !== 0x02014b50) break;
      const nameLength = data.getUint16(offset + 28, true);
      const extraLength = data.getUint16(offset + 30, true);
      const commentLength = data.getUint16(offset + 32, true);
      const name = decoder.decode(directory.slice(offset + 46, offset + 46 + nameLength));
      this.entries.set(name, {
        name,
        method: data.getUint16(offset + 10, true),
        length: data.getUint32(offset + 20, true),
        offset: data.getUint32(offset + 42, true),
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return this;
  }

  async read(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`В документе отсутствует ${name}.`);
    const header = await this.range(entry.offset, 30);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const offset = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const data = await this.range(offset, entry.length);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error('Этот способ сжатия DOCX пока не поддерживается.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async xml(name) {
    const text = new TextDecoder().decode(await this.read(name));
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('Не удалось разобрать текст Word.');
    return xml;
  }
}

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DRAWING_WORD = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const first = (node, namespace, name) => node.getElementsByTagNameNS(namespace, name)[0];
const wordValue = node => node?.getAttributeNS(WORD, 'val');

// Keep short Russian dates, ages and measurements together without changing
// the manuscript itself. Apply the same spaces to marginalia anchor phrases.
export function prepareTypography(model) {
  const nonbreaking = text => text.replace(
    /(\d{1,4}) (?=(?:год(?:а|у|ом|ик[а-я]*)?|лет|дн(?:я|ей)|месяц(?:а|ев)?|час(?:а|ов)?|км|см|мм|кг|г\.|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?!\p{L}))/giu,
    '$1\u00a0',
  );
  const hyphenate = text => nonbreaking(text).replace(
    /\p{Script=Cyrillic}{5,}/gu,
    word => unhyphenatedWords.has(word.toLowerCase()) ? word : russianHyphenator.hyphenate(word).join('\u00ad'),
  );
  return {
    ...model,
    blocks: model.blocks.map(block => {
      if (block.kind !== 'paragraph') return block;
      const format = block.verse ? nonbreaking : hyphenate;
      const runs = (block.runs || [{ text: block.text, italic: false }]).map(run => ({ ...run, text: format(run.text) }));
      return { ...block, runs, text: runs.map(run => run.text).join('') };
    }),
    marginalia: model.marginalia.map(note => ({ ...note, phrase: hyphenate(note.phrase) })),
  };
}

export async function readWord(archive) {
  const [document, relationships] = await Promise.all([
    archive.xml('word/document.xml'),
    archive.xml('word/_rels/document.xml.rels'),
  ]);
  const targets = new Map([...relationships.documentElement.children].map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  const paragraphs = [...first(document, WORD, 'body').children].filter(node => node.localName === 'p');
  const blocks = [];
  const cover = [];
  let foundHeading = false;
  let previousVerse = false;

  paragraphs.forEach((paragraph, index) => {
    const properties = [...paragraph.children].find(node => node.localName === 'pPr');
    const fullText = [...paragraph.getElementsByTagNameNS(WORD, 't')].map(node => node.textContent).join('').trim();
    const alignment = wordValue(properties && first(properties, WORD, 'jc'));
    const indentation = properties && first(properties, WORD, 'ind');
    const verse = Number(indentation?.getAttributeNS(WORD, 'left') || 0) > 0 && !indentation?.hasAttributeNS(WORD, 'firstLine');
    const textRuns = [...paragraph.getElementsByTagNameNS(WORD, 'r')].filter(run => first(run, WORD, 't')?.textContent.trim());
    const bold = textRuns.length > 0 && textRuns.every(run => {
      const value = first(run, WORD, 'b');
      return value && !['false', '0'].includes(wordValue(value));
    });
    const heading = bold && fullText.length < 160 && fullText !== '***' && (alignment === 'center' || !verse);

    if (!fullText && !first(paragraph, WORD, 'drawing')) {
      if (previousVerse && blocks.at(-1)?.kind !== 'space') blocks.push({ kind: 'space', id: `p-${index}` });
      return;
    }
    if (heading) foundHeading = true;
    if (!foundHeading && fullText && !first(paragraph, WORD, 'drawing')) {
      cover.push(fullText);
      return;
    }

    let text = '';
    let part = 0;
    const flush = () => {
      if (!text.trim()) { text = ''; return; }
      blocks.push({
        kind: heading ? 'heading' : 'paragraph',
        id: `p-${index}-${part++}`,
        text: text.trim(),
        verse,
        separator: fullText === '***',
      });
      text = '';
    };
    const visit = node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.namespaceURI === WORD) {
        if (node.localName === 't') { text += node.textContent; return; }
        if (node.localName === 'tab') { text += '\t'; return; }
        if (node.localName === 'br') {
          if (wordValue(node) !== 'page' && node.getAttributeNS(WORD, 'type') !== 'page') text += '\n';
          return;
        }
        if (['pPr', 'rPr', 'del'].includes(node.localName)) return;
        if (node.localName === 'drawing') {
          flush();
          const blip = first(node, DRAWING, 'blip');
          const target = targets.get(blip?.getAttributeNS(RELATIONSHIP, 'embed'));
          const extent = first(node, DRAWING_WORD, 'extent');
          if (target && !target.includes('..')) {
            blocks.push({ kind: 'image', id: `p-${index}-${part++}`, path: `word/${target}`, width: Number(extent?.getAttribute('cx')), height: Number(extent?.getAttribute('cy')) });
          }
          return;
        }
      }
      for (const child of node.children) visit(child);
    };
    visit(paragraph);
    flush();
    previousVerse = verse;
  });
  while (blocks.at(-1)?.kind === 'space') blocks.pop();
  return { title: cover.join(' '), blocks, marginalia: [] };
}

// The supplied document contains uncompressed RGB TIFF scans. Decode one
// visible photograph at a time; the original pixels and file remain intact.
function tiffCanvas(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint16(0, false) === 0x4949;
  const offset = view.getUint32(4, little);
  const count = view.getUint16(offset, little);
  const tags = new Map();
  for (let index = 0; index < count; index++) {
    const position = offset + 2 + index * 12;
    const tag = view.getUint16(position, little);
    const type = view.getUint16(position + 2, little);
    const length = view.getUint32(position + 4, little);
    if (![1, 3, 4].includes(type)) continue;
    const size = type === 1 ? 1 : type === 3 ? 2 : 4;
    const start = length * size <= 4 ? position + 8 : view.getUint32(position + 8, little);
    tags.set(tag, Array.from({ length }, (_, i) => size === 1 ? view.getUint8(start + i) : size === 2 ? view.getUint16(start + i * size, little) : view.getUint32(start + i * size, little)));
  }
  const value = (tag, fallback) => tags.get(tag)?.[0] ?? fallback;
  const width = value(256);
  const height = value(257);
  const samples = value(277, 3);
  if (value(259, 1) !== 1 || value(284, 1) !== 1 || tags.get(258)?.some(bits => bits !== 8) || value(262, 2) !== 2) {
    throw new Error('Не удалось прочитать формат TIFF этой фотографии.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  let pixel = 0;
  const strips = tags.get(273);
  const lengths = tags.get(279);
  strips.forEach((start, index) => {
    const end = start + lengths[index];
    for (let source = start; source < end && pixel < image.data.length; source += samples) {
      image.data[pixel++] = bytes[source];
      image.data[pixel++] = bytes[source + 1];
      image.data[pixel++] = bytes[source + 2];
      image.data[pixel++] = samples === 4 ? bytes[source + 3] : 255;
    }
  });
  context.putImageData(image, 0, 0);
  return canvas;
}

export function imageLoader(archive) {
  const urls = new Map();
  return async block => {
    if (!urls.has(block.path)) {
      urls.set(block.path, (async () => {
        const bytes = await archive.read(block.path);
        if (/\.tiff?$/i.test(block.path)) {
          const canvas = tiffCanvas(bytes);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error('Не удалось показать фотографию.');
          return URL.createObjectURL(blob);
        }
        const type = /\.png$/i.test(block.path) ? 'image/png' : 'image/jpeg';
        return URL.createObjectURL(new Blob([bytes], { type }));
      })());
    }
    return urls.get(block.path);
  };
}
