function descendants(node, x = 0, y = 0) {
  return (node.children || []).flatMap(child => {
    const positioned = { ...child, x: x + child.x, y: y + child.y };
    return [positioned, ...descendants(child, positioned.x, positioned.y)];
  });
}

function template(node) {
  const children = descendants(node);
  const text = children.find(child => child.type === 'TEXT' && child.name === 'Text');
  return {
    node,
    width: node.width,
    height: node.height,
    content: children.find(child => child.type === 'FRAME' && child.name === 'Content'),
    body: text,
    caption: children.find(child => child.type === 'TEXT' && child.name === 'Marginalia'),
    title: children.find(child => child.type === 'TEXT' && child.name === 'Title'),
    number: children.find(child => child.type === 'TEXT' && child.name === 'Page'),
  };
}

export function readDesign(json) {
  const variants = new Map(json.node.children.map(node => [`${node.variantProperties.Content}:${node.variantProperties.Hiral}`, template(node)]));
  const regular = variants.get('text:right');
  const styles = Object.values(json.styles).filter(style => style.type === 'TEXT');
  const body = styles.find(style => style.id === regular.body.text.textStyle.id);
  const caption = styles.find(style => style.id === regular.caption.text.textStyle.id);
  const grid = regular.node.layoutGrids.find(grid => grid.pattern === 'ROWS');
  return { variants, body, caption, grid, width: regular.width, height: regular.height, paper: regular.node.fills[0].color, ink: regular.body.fills[0].color };
}

export function setTextStyle(element, style) {
  element.style.fontFamily = `"${style.fontFamily}"`;
  element.style.fontSize = `${style.fontSize}px`;
  element.style.lineHeight = style.lineHeight.unit === 'PIXELS' ? `${style.lineHeight.value}px` : `${style.lineHeight.value}%`;
  element.style.letterSpacing = style.letterSpacing.unit === 'PERCENT' ? `${style.letterSpacing.value / 100}em` : `${style.letterSpacing.value}px`;
  element.style.textAlign = style.textAlignHorizontal?.toLowerCase() || 'left';
  if (style.textCase === 'LOWER') element.style.textTransform = 'lowercase';
}

export function applyDesign(design, settings) {
  const root = document.documentElement.style;
  const values = {
    '--page-width': `${design.width}px`,
    '--page-height': `${design.height}px`,
    '--paper-color': design.paper,
    '--book-color': design.ink,
    '--grid-step': `${settings.body.leading}px`,
    '--grid-offset': `${design.grid.offset}px`,
    '--grid-color': design.grid.color,
    '--paragraph-indent': `${design.body.paragraphIndent}px`,
  };
  for (const name of ['body', 'caption']) {
    values[`--${name}-family`] = `"${design[name].fontFamily}"`;
    values[`--${name}-size`] = `${settings[name].size}px`;
    values[`--${name}-leading`] = `${settings[name].leading}px`;
    values[`--${name}-tracking`] = `${settings[name].tracking}px`;
  }
  for (const [name, value] of Object.entries(values)) root.setProperty(name, value);
}

export function defaultSettings(design) {
  return Object.fromEntries(['body', 'caption'].map(name => [name, {
    size: design[name].fontSize,
    leading: design[name].lineHeight.value,
    tracking: design[name].letterSpacing.unit === 'PERCENT' ? design[name].letterSpacing.value * design[name].fontSize / 100 : design[name].letterSpacing.value,
  }]));
}
