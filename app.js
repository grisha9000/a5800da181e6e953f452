import { readDesign, applyDesign, defaultSettings } from './design.js';
import { WordArchive, readWord, prepareTypography, imageLoader } from './document.js';
import { paginate, renderSpreads } from './book.js';
import { addMarginalia } from './marginalia.js';

const book = document.querySelector('#book');
const status = document.querySelector('#status');
const panel = document.querySelector('#panel');
const measurement = document.querySelector('#measurement');
const storageKey = 'book-yre-typography-v1';
let revision = 0;
let observer;
let pending;

function zoom(value) {
  const percent = Math.max(25, Math.min(200, value));
  document.documentElement.style.setProperty('--zoom', percent / 100);
  document.querySelector('#zoom').value = percent;
  document.querySelector('#zoom-value').value = `${percent}%`;
}

document.querySelector('#zoom').addEventListener('input', event => zoom(Number(event.target.value)));
document.querySelector('#grid').addEventListener('change', event => book.classList.toggle('show-grid', event.target.checked));
document.querySelector('#close-panel').addEventListener('click', () => {
  panel.hidden = true;
  document.querySelector('#open-panel').hidden = false;
});
document.querySelector('#open-panel').addEventListener('click', () => {
  panel.hidden = false;
  document.querySelector('#open-panel').hidden = true;
});

// Trackpad pinch changes the book canvas without changing the control panel.
let gestureStart = 100;
book.addEventListener('gesturestart', event => {
  event.preventDefault();
  gestureStart = Number(document.querySelector('#zoom').value);
});
book.addEventListener('gesturechange', event => {
  event.preventDefault();
  zoom(Math.round(gestureStart * event.scale));
});
book.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  zoom(Math.round(Number(document.querySelector('#zoom').value) * Math.exp(-event.deltaY / 300)));
}, { passive: false });

async function start() {
  const [json, archive] = await Promise.all([
    fetch('./Page.json').then(response => { if (!response.ok) throw new Error('Не удалось открыть JSON макета.'); return response.json(); }),
    new WordArchive('./Юре Ладно.docx').open(),
  ]);
  const design = readDesign(json);
  const defaults = defaultSettings(design);
  let settings = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved) {
      for (const name of ['body', 'caption']) {
        for (const property of ['size', 'leading', 'tracking']) {
          if (Number.isFinite(saved[name]?.[property]) && (property === 'tracking' || saved[name][property] > 0)) settings[name][property] = saved[name][property];
        }
      }
    }
  } catch { /* First visit or unavailable local storage: use the Figma values. */ }
  const model = prepareTypography(addMarginalia(await readWord(archive)));
  const loadImage = imageLoader(archive);
  applyDesign(design, settings);
  await Promise.all([
    document.fonts.load(`${settings.body.size}px "${design.body.fontFamily}"`),
    document.fonts.load(`${settings.caption.size}px "${design.caption.fontFamily}"`),
  ]);

  async function update() {
    const current = ++revision;
    applyDesign(design, settings);
    book.setAttribute('aria-busy', 'true');
    status.textContent = 'Перевёрстываю…';
    const result = await paginate(model, design, settings, measurement, () => current !== revision);
    if (!result || current !== revision) return;
    observer?.disconnect();
    renderSpreads(result.pages, book);
    document.querySelector('#page-count').textContent = String(result.pages.length);
    document.querySelector('#line-count').textContent = String(result.lineCount);
    book.setAttribute('aria-busy', 'false');
    status.textContent = '';
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const block = images.get(entry.target);
        loadImage(block).then(url => {
          const image = document.createElement('img');
          image.src = url;
          image.alt = 'Иллюстрация из исходного документа';
          image.decoding = 'async';
          entry.target.replaceChildren(image);
        }).catch(error => {
          entry.target.textContent = error.message;
          status.textContent = error.message;
        });
      }
    }, { rootMargin: '595px 0px' });
    const images = new Map();
    for (const page of result.pages) {
      for (const image of page.images) { images.set(image.element, image.block); observer.observe(image.element); }
    }
  }

  const controls = document.querySelector('#type-controls');
  for (const name of ['body', 'caption']) {
    const group = document.createElement('fieldset');
    group.className = 'type-group';
    const legend = document.createElement('legend');
    legend.textContent = design[name].name;
    group.append(legend);
    const fields = [['size', 'Размер'], ['leading', 'Межстрочное'], ['tracking', 'Межбуквенное']];
    for (const [property, title] of fields) {
      const label = document.createElement('label');
      label.className = 'type-field';
      const text = document.createElement('span');
      text.textContent = title;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      if (property !== 'tracking') input.min = '0.1';
      input.value = settings[name][property];
      input.dataset.style = name;
      input.dataset.property = property;
      input.setAttribute('aria-label', `${design[name].name}: ${title}`);
      const unit = document.createElement('span');
      unit.textContent = 'px';
      label.append(text, input, unit);
      input.addEventListener('input', () => {
        const value = input.valueAsNumber;
        if (!Number.isFinite(value) || (property !== 'tracking' && value <= 0)) return;
        settings[name][property] = value;
        try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Settings still work for this visit. */ }
        clearTimeout(pending);
        ++revision;
        pending = setTimeout(() => update().catch(fail), 180);
      });
      group.append(label);
    }
    controls.append(group);
  }
  document.querySelector('#reset').addEventListener('click', () => {
    settings = structuredClone(defaults);
    try { localStorage.removeItem(storageKey); } catch { /* No saved settings. */ }
    for (const input of controls.querySelectorAll('input')) input.value = settings[input.dataset.style][input.dataset.property];
    clearTimeout(pending);
    update().catch(fail);
  });
  await update();
}

function fail(error) {
  status.textContent = error.message;
  book.setAttribute('aria-busy', 'false');
  console.error(error);
}

start().catch(fail);
