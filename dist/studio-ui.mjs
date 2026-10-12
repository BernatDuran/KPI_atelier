import { icon, esc, cardHTML } from './cards.mjs';
import { THEMES } from './model.mjs';
import { elementState, updateElement, clamp } from './elements.mjs';
import { ICON_OPTIONS } from './icons.mjs';
import { COLOR_ROLES, paletteFrom, sanitizePalette, hexToHSV, hsvToHex, contrastRatio } from './colors.mjs';
import { $, btn, getC, getActiveContext, getPaletteDraft, setPaletteDraft, getColorRole, setColorRole, getColorHSV, setColorHSV, customThemes, getCustomThemes, subscribeCustomThemes, saveCustomTheme, deleteCustomTheme, setConfig, toast } from './state.mjs';
import { openModal, closeModal } from './modals.mjs';

let reviewedThemes = [];
let displayedThemes = new Map();
let studioRevision = 0;

export function handleStudioClick(button) {
  const d = button.dataset;
  if (d.pickIcon) {
    if (!ICON_OPTIONS.some(([id]) => id === d.pickIcon)) return true;
    const c = getC();
    const selected = getActiveContext().selectedElement;
    setConfig(selected && selected !== 'icon' ? updateElement(c, selected, { icon: d.pickIcon }) : { icon: d.pickIcon });
    closeModal();
    return true;
  }
  const selectedTheme = d.draftCustom ? displayedThemes.get(d.draftCustom) : null;
  const palette = d.draftTheme ? THEMES[d.draftTheme] : selectedTheme?.colors;
  if (palette) {
    if (selectedTheme) reviewedThemes = [...reviewedThemes.filter(theme => theme.id !== selectedTheme.id), structuredClone(selectedTheme)];
    setPaletteDraft(paletteFrom(palette));
    setColorHSV(hexToHSV(getPaletteDraft()[getColorRole()]));
    updateColorStudio();
    return true;
  }
  if (d.colorRole && COLOR_ROLES.some(([key]) => key === d.colorRole)) {
    setColorRole(d.colorRole);
    setColorHSV(hexToHSV(getPaletteDraft()[d.colorRole]));
    updateColorStudio();
    return true;
  }
  if (d.quickColor && /^#[0-9a-f]{6}$/i.test(d.quickColor)) {
    getPaletteDraft()[getColorRole()] = d.quickColor;
    setColorHSV(hexToHSV(d.quickColor));
    updateColorStudio();
    return true;
  }
  if (d.deleteTheme) {
    if (button.disabled) return true;
    return (async () => {
      button.disabled = true;
      try {
        await deleteCustomTheme(d.deleteTheme, displayedThemes.get(d.deleteTheme));
      } finally { button.disabled = false; }
      return true;
    })();
  }
  if (['apply-theme', 'save-theme'].includes(d.action)) {
    const colors = sanitizePalette(getPaletteDraft());
    if (!colors) { toast('Revisa los colores de la paleta.'); return true; }
    const name = ($('#theme-name')?.value || 'Mi paleta').trim().slice(0, 40) || 'Mi paleta';
    if (d.action === 'save-theme') {
      if (button.disabled) return true;
      return saveStudioPalette(button, name, colors);
    }
    setConfig({ ...colors, theme: 'custom', customThemeName: name });
    closeModal();
    toast('Paleta aplicada.');
    return true;
  }
  return false;
}

async function saveStudioPalette(button, name, colors) {
  const revision = studioRevision;
  const modal = $('#modal');
  const existing = reviewedThemes.find(theme => theme.name === name) || null;
  button.disabled = true;
  let theme;
  try {
    theme = await saveCustomTheme(name, colors, existing);
  } finally { button.disabled = false; }
  if (!theme || revision !== studioRevision || !modal?.open || modal.className !== 'theme-modal') return true;
  setConfig({ ...colors, theme: 'custom', customThemeName: theme.name });
  closeModal();
  toast(getActiveContext().lastCollectionSyncWarning || (getActiveContext().lastThemeSaveConflict ? 'Otra ventana modificó esta paleta. Se guardó y aplicó una copia en conflicto; ambas versiones se conservan.' : 'Paleta guardada y aplicada.'));
  return true;
}

export function handleStudioInput(input) {
  if (!getPaletteDraft()) return false;
  if (input.id === 'color-hue') {
    const hsv = getColorHSV();
    hsv.h = Number(input.value);
    getPaletteDraft()[getColorRole()] = hsvToHex(hsv.h, hsv.s, hsv.v);
  } else if (input.id === 'color-hex') {
    if (!/^#[0-9a-f]{6}$/i.test(input.value)) {
      input.setAttribute('aria-invalid', 'true');
      $('#hex-error').textContent = 'Introduce # y seis dígitos hexadecimales.';
      return true;
    }
    getPaletteDraft()[getColorRole()] = input.value.toLowerCase();
    setColorHSV(hexToHSV(input.value));
  } else return false;
  updateColorStudio();
  return true;
}

export function installStudioPointerEvents() {
  let pointer = null;
  document.addEventListener('pointerdown', event => {
    const map = event.target.closest?.('#color-map');
    if (!map || event.button !== 0) return;
    pointer = event.pointerId;
    map.setPointerCapture(pointer);
    colorFromPointer(event);
  });
  document.addEventListener('pointermove', event => { if (pointer === event.pointerId) colorFromPointer(event); });
  const finish = () => { pointer = null; };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('keydown', event => {
    if (event.target.id !== 'color-map' || !event.key.startsWith('Arrow')) return;
    event.preventDefault();
    const hsv = getColorHSV();
    const step = event.shiftKey ? .05 : .01;
    hsv.s = clamp(hsv.s + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 0, 1);
    hsv.v = clamp(hsv.v + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0), 0, 1);
    getPaletteDraft()[getColorRole()] = hsvToHex(hsv.h, hsv.s, hsv.v);
    updateColorStudio();
  });
}

export function openIconPicker() {
  openModal(
    'Un símbolo para cada historia.',
    `${ICON_OPTIONS.length} iconos vectoriales para dar contexto a tu KPI.`,
    `<label class="search-box icon-search">${icon('search', 16)}<input id="icon-search" type="search" placeholder="Busca: ventas, tiempo, personas…" aria-label="Buscar iconos"></label><div id="icon-grid" class="icon-grid">${iconGrid('')}</div>`,
    btn('close-modal', 'Cerrar', null, 'button secondary'),
    'icon-modal'
  );
}

export function iconGrid(query) {
  const c = getC();
  const selectedElement = getActiveContext().selectedElement;
  const activeIcon = (selectedElement && elementState(c, selectedElement).icon) || c.icon;
  return ICON_OPTIONS.filter(x => x.join(' ').toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))).map(([id, label, group]) => `<button data-pick-icon="${id}" class="${activeIcon === id ? 'active' : ''}" title="${label} · ${group}">${icon(id, 25)}<span>${label}</span></button>`).join('') || '<p class="field-help">No hay iconos con ese nombre.</p>';
}

// ----------------------------------------------------
// Theme Studio
// ----------------------------------------------------
export function themeTile(id, name, colors, custom = false) {
  return `<button ${custom ? 'data-draft-custom' : 'data-draft-theme'}="${id}" class="studio-theme-tile"><span class="theme-strip">${['background', 'accent', 'text', 'positive'].map(key => `<i style="background:${colors[key]}"></i>`).join('')}</span><span>${esc(name)}</span>${icon('chevron', 12)}</button>`;
}

function customThemeList() {
  displayedThemes = new Map(customThemes.map(theme => [theme.id, structuredClone(theme)]));
  return customThemes.length ? customThemes.map(theme => `<div class="custom-theme-row">${themeTile(theme.id, theme.name, theme.colors, true)}<button data-delete-theme="${theme.id}" title="Eliminar tema guardado" aria-label="Eliminar tema ${esc(theme.name)}">${icon('trash', 13)}</button></div>`).join('') : '<p class="geometry-note">Guarda tu primera paleta para reutilizarla.</p>';
}
function refreshThemeLibrary() {
  const list = $('#custom-theme-list');
  if (!list || !$('#modal')?.open) return;
  const focused = document.activeElement;
  const focusedTheme = focused?.dataset?.draftCustom || focused?.dataset?.deleteTheme;
  const focusedAction = focused?.dataset?.deleteTheme ? 'data-delete-theme' : 'data-draft-custom';
  list.innerHTML = customThemeList();
  if (focusedTheme) (list.querySelector(`[${focusedAction}="${focusedTheme}"]`) || list.querySelector('[data-draft-custom]') || $('#theme-name'))?.focus();
}
subscribeCustomThemes(refreshThemeLibrary);

export function openThemeStudio() {
  studioRevision++;
  reviewedThemes = structuredClone(getCustomThemes());
  const c = getC();
  const draft = paletteFrom(c);
  setPaletteDraft(draft);
  setColorRole('accent');
  setColorHSV(hexToHSV(draft.accent));

  openModal(
    'El color también cuenta tu historia.',
    'Explora una paleta, afina los matices y hazla tuya.',
    `<div class="theme-studio"><aside class="theme-library"><h3>Paletas curadas <span>${Object.keys(THEMES).length}</span></h3>${Object.entries(THEMES).map(([id, t]) => themeTile(id, t.name, t)).join('')}<div class="custom-theme-heading"><h3>Tus temas</h3></div><div id="custom-theme-list">${customThemeList()}</div></aside><section class="color-workbench"><h3>Ajusta un color</h3><div class="color-roles">${COLOR_ROLES.map(([key, label]) => `<button data-color-role="${key}" class="${key === 'accent' ? 'active' : ''}"><i style="background:${draft[key]}"></i><span>${label}</span></button>`).join('')}</div><div class="color-map-label"><strong id="active-color-label">Acento</strong><span>Saturación · luminosidad</span></div><div id="color-map" class="color-map" tabindex="0" role="slider" aria-label="Mapa de color. Flechas izquierda y derecha: saturación. Arriba y abajo: luminosidad." aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(getColorHSV().s * 100)}"><span id="color-map-cursor"></span></div><label class="hue-label" for="color-hue">Matiz <span id="hue-value"></span></label><input id="color-hue" class="hue-slider" type="range" min="0" max="360" step="1" value="${Math.round(getColorHSV().h)}"><div class="color-hex-row"><span id="active-color-preview"></span><label for="color-hex">HEX</label><input id="color-hex" maxlength="7" value="${draft.accent.toUpperCase()}" spellcheck="false" aria-label="Código hexadecimal"><span id="hex-error" role="status"></span></div><div class="quick-colors">${['#ffffff', '#17272b', '#c3ec83', '#477568', '#8771bb', '#bd8144', '#527bdd', '#bd758b', '#3d9596', '#b8664d', '#c0b2ee', '#000000'].map(color => `<button data-quick-color="${color}" style="background:${color}" title="${color}" aria-label="Usar ${color}"></button>`).join('')}</div><p class="geometry-note">Arrastra sobre el mapa o usa las flechas. Mayús ajusta de 5 en 5.</p></section><section class="palette-preview-column"><h3>Así se verá tu tarjeta</h3><div id="palette-preview" class="palette-preview"></div><div id="palette-contrast" class="palette-contrast"></div><label class="save-label" for="theme-name">Nombre para tu paleta</label><input id="theme-name" class="save-input" maxlength="40" value="${esc(c.customThemeName || 'Mi paleta')}"><p class="geometry-note">Tus paletas se guardan en este navegador. Los colores también viajan con el JSON de cada tarjeta.</p></section></div>`,
    btn('close-modal', 'Cancelar', null, 'button quiet') + btn('save-theme', 'Guardar y aplicar', 'save', 'button secondary') + btn('apply-theme', 'Aplicar paleta', 'check', 'button primary'),
    'theme-modal'
  );
  updateColorStudio();
}

export function updateColorStudio() {
  const map = $('#color-map');
  const paletteDraft = getPaletteDraft();
  const colorRole = getColorRole();
  const colorHSV = getColorHSV();
  const c = getC();
  if (!map || !paletteDraft || !colorHSV) return;

  $('#hex-error').textContent = '';
  $('#color-hex')?.setAttribute('aria-invalid', 'false');
  const color = paletteDraft[colorRole];
  map.style.backgroundColor = hsvToHex(colorHSV.h, 1, 1);
  map.setAttribute('aria-valuenow', String(Math.round(colorHSV.s * 100)));
  map.setAttribute('aria-valuetext', `${Math.round(colorHSV.s * 100)} % saturación, ${Math.round(colorHSV.v * 100)} % luminosidad`);

  const cursor = $('#color-map-cursor');
  if (cursor) cursor.style.cssText = `left:${colorHSV.s * 100}%;top:${(1 - colorHSV.v) * 100}%;background:${color};`;

  const hueInput = $('#color-hue');
  if (hueInput) hueInput.value = colorHSV.h;
  const hueVal = $('#hue-value');
  if (hueVal) hueVal.textContent = Math.round(colorHSV.h) + '°';

  const hexInput = $('#color-hex');
  if (hexInput && document.activeElement !== hexInput) hexInput.value = color.toUpperCase();

  const previewDot = $('#active-color-preview');
  if (previewDot) previewDot.style.background = color;

  const roleLabel = $('#active-color-label');
  if (roleLabel) roleLabel.textContent = COLOR_ROLES.find(r => r[0] === colorRole)?.[1] || colorRole;

  document.querySelectorAll('[data-color-role]').forEach(button => {
    button.classList.toggle('active', button.dataset.colorRole === colorRole);
    button.setAttribute('aria-pressed', String(button.dataset.colorRole === colorRole));
    const dot = button.querySelector('i');
    if (dot) dot.style.background = paletteDraft[button.dataset.colorRole];
  });

  const palPrev = $('#palette-preview');
  if (palPrev) {
    palPrev.innerHTML = `<div class="mini-viewport" data-base-width="${c.width}"><div class="mini-inner" style="width:${c.width}px">${cardHTML({ ...c, ...paletteDraft })}</div></div>`;
    getActiveContext().fitThumbs?.();
  }

  const main = contrastRatio(paletteDraft.text, paletteDraft.background);
  const secondary = contrastRatio(paletteDraft.muted, paletteDraft.background);
  const contrastEl = $('#palette-contrast');
  if (contrastEl) {
    contrastEl.innerHTML = `<div class="${main < 4.5 ? 'low' : ''}">${icon(main < 4.5 ? 'info' : 'check', 13)}<span>Texto principal</span><b>${main.toFixed(1)}:1</b></div><div class="${secondary < 4.5 ? 'low' : ''}">${icon(secondary < 4.5 ? 'info' : 'check', 13)}<span>Texto secundario</span><b>${secondary.toFixed(1)}:1</b></div><small>${main < 4.5 || secondary < 4.5 ? 'Puedes mejorar la legibilidad separando más el color del texto y el fondo.' : 'Buena separación entre texto y fondo.'}</small>`;
  }
}

export function colorFromPointer(e) {
  const map = $('#color-map');
  if (!map) return;
  const r = map.getBoundingClientRect();
  const colorHSV = getColorHSV();
  const paletteDraft = getPaletteDraft();
  const colorRole = getColorRole();

  colorHSV.s = clamp((e.clientX - r.left) / r.width, 0, 1);
  colorHSV.v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
  paletteDraft[colorRole] = hsvToHex(colorHSV.h, colorHSV.s, colorHSV.v);
  updateColorStudio();
}
