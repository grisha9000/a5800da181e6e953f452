import { setTextStyle } from './design.js';

function place(element, x, y, width, height) {
  element.classList.add('positioned');
  Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${width}px` });
  if (height !== undefined) element.style.height = `${height}px`;
  return element;
}

function paragraph(block, continued = false, text = block.text, offset = 0) {
  const element = document.createElement('p');
  element.className = `body-text${continued ? ' continuation' : ''}${block.opening && !continued ? ' opening' : ''}${block.verse ? ' verse' : ''}${block.separator ? ' separator' : ''}`;
  if (!block.runs) element.textContent = text;
  else {
    let position = 0;
    for (const run of block.runs) {
      const from = Math.max(0, offset - position);
      const to = Math.min(run.text.length, offset + text.length - position);
      if (from < to) {
        const content = run.text.slice(from, to);
        if (run.italic) {
          const emphasis = document.createElement('em');
          emphasis.textContent = content;
          element.append(emphasis);
        } else element.append(document.createTextNode(content));
      }
      position += run.text.length;
    }
  }
  element.dataset.source = block.id;
  return element;
}

function textPoint(element, offset) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (offset <= node.length) return [node, offset];
    offset -= node.length;
  }
  return [element, element.childNodes.length];
}

function baseline(className, host) {
  const line = document.createElement('p');
  line.className = className;
  line.style.width = '315px';
  line.textContent = 'А';
  const marker = document.createElement('span');
  Object.assign(marker.style, { display: 'inline-block', width: '0', height: '0', verticalAlign: 'baseline' });
  line.append(marker);
  host.replaceChildren(line);
  return marker.getBoundingClientRect().top - line.getBoundingClientRect().top;
}

export async function paginate(model, design, settings, host, cancelled) {
  const pages = [];
  const step = settings.body.leading;
  const bodyBaseline = baseline('body-text continuation', host);
  const captionBaseline = baseline('caption-text', host);
  const snap = top => design.grid.offset + Math.ceil((top + bodyBaseline - design.grid.offset) / step - 0.001) * step - bodyBaseline;
  let page;
  let cursor;
  let section = '';
  let pendingTitle = '';
  let openingParagraph = false;
  let lineCount = 0;
  let processed = 0;
  const notesByAnchor = new Map();
  const positionedNotes = [];
  for (const note of model.marginalia) {
    const notes = notesByAnchor.get(note.anchor) || [];
    notes.push(note);
    notesByAnchor.set(note.anchor, notes);
  }

  const side = number => number % 2 ? 'right' : 'left';
  const start = (type = 'text', title = pendingTitle) => {
    const number = pages.length + 1;
    const template = design.variants.get(`${type}:${side(number)}`);
    const layout = !title && template.body ? {
      ...template,
      body: { ...template.body, y: template.content.y, height: template.content.height },
    } : template;
    pendingTitle = '';
    const element = document.createElement('article');
    element.className = 'page';
    element.dataset.page = String(number);
    element.dataset.template = type;
    element.setAttribute('aria-label', `Страница ${number}${title || section ? ` · ${title || section}` : ''}`);
    if (title && layout.title) {
      const heading = document.createElement('h2');
      heading.className = 'book-title';
      heading.textContent = title;
      setTextStyle(heading, layout.title.text);
      place(heading, layout.title.x, layout.title.y, layout.title.width);
      element.append(heading);
    }
    if (layout.number) {
      const folio = document.createElement('span');
      folio.textContent = String(number);
      setTextStyle(folio, layout.number.text);
      element.append(place(folio, layout.number.x, layout.number.y, layout.number.width, layout.number.height));
    }
    page = { element, layout, number, bodyLines: 0, images: [] };
    pages.push(page);
    cursor = layout.body ? snap(layout.body.y) : layout.content.y;
    return page;
  };

  const bottom = () => page.layout.body.y + page.layout.body.height;
  const measure = (block, text, continued, offset) => {
    const element = paragraph(block, continued, text, offset);
    element.style.width = `${page.layout.body.width}px`;
    host.replaceChildren(element);
    return Math.max(1, Math.round(element.getBoundingClientRect().height / step));
  };
  const appendText = (block, text, continued, lines, offset) => {
    const element = paragraph(block, continued, text, offset);
    place(element, page.layout.body.x, cursor, page.layout.body.width);
    page.element.append(element);
    for (const note of notesByAnchor.get(block.id) || []) {
      const index = text.indexOf(note.phrase);
      if (index < 0) continue;
      const sample = paragraph(block, continued, text, offset);
      sample.style.width = `${page.layout.body.width}px`;
      host.replaceChildren(sample);
      const line = document.createRange();
      line.setStart(...textPoint(sample, index));
      line.setEnd(...textPoint(sample, index + note.phrase.length));
      const firstLine = document.createRange();
      firstLine.setStart(...textPoint(sample, 0));
      firstLine.setEnd(...textPoint(sample, 1));
      const lineIndex = Math.round((line.getClientRects()[0].top - firstLine.getClientRects()[0].top) / step);
      positionedNotes.push({ note, page, top: cursor + lineIndex * step + bodyBaseline - captionBaseline });
    }
    cursor += lines * step;
    page.bodyLines += lines;
    lineCount += lines;
  };

  if (model.title) start('title', model.title);

  for (let index = 0; index < model.blocks.length; index++) {
    if (cancelled()) return null;
    const block = model.blocks[index];
    if (++processed % 24 === 0) await new Promise(resolve => requestAnimationFrame(resolve));

    if (block.kind === 'heading') {
      section = block.text;
      pendingTitle = section;
      openingParagraph = true;
      page = null;
      // A heading immediately followed by a photograph uses the title-image
      // principle. Its photograph keeps the document's aspect ratio.
      if (model.blocks[index + 1]?.kind === 'image') {
        const image = model.blocks[++index];
        start('title-img', section);
        const { content, title } = page.layout;
        const top = title.y + title.height + step;
        const height = Math.min(content.width * image.height / image.width, content.y + content.height - top);
        const element = document.createElement('figure');
        element.className = 'book-image';
        element.dataset.source = image.id;
        place(element, content.x, content.y + content.height - height, content.width, height);
        page.element.append(element);
        page.images.push({ element, block: image });
        page = null;
      }
      continue;
    }
    if (!page || !page.layout.body) start();

    if (block.kind === 'space') {
      if (cursor + step <= bottom() && page.bodyLines) cursor += step;
      continue;
    }

    if (block.kind === 'image') {
      const { content, body } = page.layout;
      const maxHeight = Math.floor(body.height / step) * step;
      const naturalHeight = content.width * block.height / block.width;
      const imageHeight = Math.min(naturalHeight, maxHeight);
      const slotHeight = Math.ceil(imageHeight / step - 0.001) * step;
      let top = cursor + (page.bodyLines || page.images.length ? step : 0);
      if (top + slotHeight > bottom() + 0.01) {
        start();
        top = cursor;
      }
      const figure = document.createElement('figure');
      figure.className = 'book-image';
      figure.dataset.source = block.id;
      place(figure, page.layout.content.x, top, page.layout.content.width, slotHeight);
      page.element.append(figure);
      page.element.dataset.template = 'text-img';
      page.images.push({ element: figure, block });
      cursor = top + slotHeight + step;
      continue;
    }

    const textBlock = openingParagraph ? { ...block, opening: true } : block;
    openingParagraph = false;
    let text = block.text;
    let offset = 0;
    let continued = false;
    while (text.length) {
      const available = Math.floor((bottom() - cursor + 0.01) / step);
      if (available < 1) { start(); continue; }
      const lines = measure(textBlock, text, continued, offset);
      if (lines <= available) {
        appendText(textBlock, text, continued, lines, offset);
        break;
      }
      if (available < 2 && page.bodyLines) { start(); continue; }
      // Split at word boundaries. Explicit author line breaks remain in the
      // strings, including when a poem continues onto the following page.
      // A nonbreaking space is deliberately not a boundary.
      const boundaries = [...text.matchAll(/[ \t\n]+/g)].map(match => match.index + match[0].length);
      let low = 0;
      let high = boundaries.length - 1;
      let best = 0;
      let bestLines = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const position = boundaries[middle];
        const candidate = text.slice(0, position).trimEnd();
        const count = measure(textBlock, candidate, continued, offset);
        if (count <= available) { best = position; bestLines = count; low = middle + 1; }
        else high = middle - 1;
      }
      // Keep at least two lines of the paragraph on each side of a page break.
      let boundary = boundaries.indexOf(best);
      const remainingLines = position => {
        const tail = text.slice(position);
        const trimmed = tail.trimStart();
        return measure(textBlock, trimmed, true, offset + position + tail.length - trimmed.length);
      };
      while (boundary >= 0 && remainingLines(best) < 2) {
        best = boundaries[--boundary] || 0;
        if (best) bestLines = measure(textBlock, text.slice(0, best).trimEnd(), continued, offset);
      }
      if ((!best || bestLines < 2) && page.bodyLines) { start(); continue; }
      if (!best) {
        if (page.bodyLines || page.images.length) { start(); continue; }
        // A single unusually long word still has to make progress.
        best = boundaries[0] || text.length;
        bestLines = measure(textBlock, text.slice(0, best).trimEnd(), continued, offset);
      }
      appendText(textBlock, text.slice(0, best).trimEnd(), continued, bestLines, offset);
      const remainder = text.slice(best);
      text = remainder.trimStart();
      offset += best + remainder.length - text.length;
      continued = true;
      if (text) start();
    }
  }

  for (const { note, page: containing, top } of positionedNotes) {
    if (!containing.layout.caption) continue;
    const caption = document.createElement('aside');
    caption.className = 'caption-text';
    caption.textContent = note.year;
    caption.style.textAlign = containing.layout.caption.text.textAlignHorizontal.toLowerCase();
    caption.title = note.description;
    caption.setAttribute('aria-label', `${note.year}: ${note.description}`);
    if (note.source) caption.dataset.source = note.source;
    containing.element.append(place(caption, containing.layout.caption.x, top, containing.layout.caption.width));
  }
  host.replaceChildren();
  return { pages, lineCount };
}

export function renderSpreads(pages, host) {
  const fragment = document.createDocumentFragment();
  const leaves = [null, ...pages];
  if (leaves.length % 2) leaves.push(null);
  for (let index = 0; index < leaves.length; index += 2) {
    const shell = document.createElement('section');
    shell.className = 'spread-shell';
    shell.setAttribute('aria-label', `Разворот ${index / 2 + 1}`);
    const spread = document.createElement('div');
    spread.className = 'spread';
    for (const leaf of leaves.slice(index, index + 2)) {
      const element = leaf?.element || document.createElement('div');
      if (!leaf) { element.className = 'page blank'; element.setAttribute('aria-hidden', 'true'); }
      spread.append(element);
    }
    shell.append(spread);
    fragment.append(shell);
  }
  host.replaceChildren(fragment);
}
