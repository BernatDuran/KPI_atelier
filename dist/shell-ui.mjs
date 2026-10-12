import { TEMPLATES, THEMES, FAMILIES, familyName } from './model.mjs';
import { icon, esc } from './cards.mjs';
import { $, btn, ib, getView, getC, getPbipModel, getSaved, getUiTheme, getFriendlyReportName, getFilter, getQuery, getContextPreview, getCanvasDark, getUndo, getRedo, getZoom, getMode, getTab, getRailCollapsed, filtered, thumb, showDirty } from './state.mjs';
import { renderInspector, rememberInspector } from './inspector.mjs';
import { renderStage, fitThumbs } from './canvas.mjs';

export function render() {
  const remembered = rememberInspector();
  const focused = document.activeElement;
  const focusedId = focused?.id;
  const focusedAction = focused?.dataset?.action;
  const curView = getView();
  const pbipModel = getPbipModel();

  const app = $('#app');
  if (!app) return;
  app.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#" data-action="home" aria-label="KPI Atelier, inicio">
        <span class="brand-icon">${icon('chart', 19)}</span>
        <strong>kpi<span class="brand-divider">/</span>atelier<span class="brand-dot">.</span></strong>
      </a>
      <nav class="top-nav" aria-label="Navegación principal">
        ${btn('view-designer', 'Diseñador', 'sliders', curView === 'designer' ? 'selected' : '', curView === 'designer' ? 'aria-current="page"' : '')}
        ${btn('view-library', `Biblioteca <span class="count">${TEMPLATES.length}</span>`, 'grid', curView === 'library' ? 'selected' : '', curView === 'library' ? 'aria-current="page"' : '')}
        ${btn('view-saved', `Mis diseños <span class="count">${getSaved().length}</span>`, 'folder', curView === 'saved' ? 'selected' : '', curView === 'saved' ? 'aria-current="page"' : '')}
      </nav>
      <div class="header-right">
        ${pbipModel?.isLiveConnection ? `<span class="pbip-live-pill" title="Power BI Desktop conectado: ${esc(getFriendlyReportName(pbipModel))}"><i class="pbip-live-dot"></i> ${esc(getFriendlyReportName(pbipModel))}</span>` : ''}
        ${ib('toggle-ui-theme', getUiTheme() === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', getUiTheme() === 'dark' ? 'sun' : 'moon')}
        ${ib('shortcuts-modal', 'Atajos de teclado (?)', 'keyboard')}
        ${ib('guide', 'Guía de uso', 'book')}
        <span class="avatar">BD</span>
      </div>
    </header>
    <div class="page-heading ${curView === 'designer' ? 'designer-heading' : ''}">
      <div>
        <div class="eyebrow">TU ESTUDIO DE DISEÑO <span> / </span> POWER BI</div>
        <h1>${curView === 'designer' ? 'Grandes datos. <em>Mejor diseño.</em>' : curView === 'library' ? 'Un buen diseño empieza aquí.' : 'Tus ideas, listas para volver.'}</h1>
        ${curView === 'designer' ? '' : `<p>${curView === 'library' ? `${TEMPLATES.length} puntos de partida. Infinitas posibilidades. Todo editable.` : 'Guarda tus tarjetas y construye tu propio lenguaje visual.'}</p>`}
      </div>
      <div class="heading-actions">
        <span id="save-state" class="save-state"></span>
        ${btn('import', 'Importar', 'upload', 'button secondary')}
        ${btn('save', 'Guardar diseño', 'save', 'button secondary')}
        ${btn('open-data-modal', 'Conectar datos', 'sliders', 'button secondary')}
        ${btn('export', 'Generar medida DAX', 'code', 'button primary')}
      </div>
    </div>
    ${curView === 'designer' ? designer() : curView === 'library' ? library() : savedView()}
    <footer class="app-footer">
      <span><i class="tiny-dot"></i> Diseño en directo</span>
      <span>KPI Atelier</span>
    </footer>`;

  if (curView === 'designer') {
    renderInspector(remembered);
    renderStage();
  }
  fitThumbs();
  showDirty();
  if (!remembered?.focus) {
    const replacement = focusedId ? document.getElementById(focusedId) : focusedAction ? app.querySelector(`[data-action="${focusedAction}"]`) : null;
    replacement?.focus({ preventScroll: true });
  }
}

export function designer() {
  const c = getC();
  const filter = getFilter();
  const query = getQuery();
  const context = getContextPreview();
  const canvasDark = getCanvasDark();
  const undo = getUndo();
  const redo = getRedo();
  const zoom = getZoom();
  const mode = getMode();
  const tab = getTab();
  const railCollapsed = getRailCollapsed();

  return `<div class="workspace${railCollapsed ? ' rail-collapsed' : ''}">
    <aside class="template-rail${railCollapsed ? ' is-collapsed' : ''}">
      ${railCollapsed ? `
        <div class="rail-collapsed-bar">
          <button class="icon-btn rail-toggle-btn" data-action="toggle-rail" title="Expandir barra de plantillas (Ctrl+B)" aria-label="Expandir barra de plantillas">
            ${icon('chevronRight', 14)}
          </button>
          <span class="rail-collapsed-label">Plantillas</span>
        </div>
      ` : `
        <div class="rail-heading">
          <h2>Elige tu tarjeta</h2>
          <div class="rail-heading-actions">
            <span>01—${TEMPLATES.length}</span>
            <button class="icon-btn rail-toggle-btn" data-action="toggle-rail" title="Colapsar barra de plantillas (Ctrl+B)" aria-label="Colapsar barra de plantillas">
              ${icon('chevronLeft', 14)}
            </button>
          </div>
        </div>
        <label class="search-box">${icon('search', 15)}<input id="template-search" placeholder="Buscar una tarjeta…" aria-label="Buscar plantillas" value="${esc(query)}"></label>
        <select id="family-filter" aria-label="Familia de tarjetas">${FAMILIES.map(f => `<option value="${f.id}" ${filter === f.id ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
        <div id="rail-cards" class="rail-cards">${railCards()}</div>
        <button class="rail-more" data-action="view-library">Explorar la biblioteca ${icon('arrow', 15)}</button>
      `}
    </aside>
    <main class="design-main">
      <div class="canvas-toolbar">
        <div class="live-label"><i></i>VISTA PREVIA</div>
        <div class="segmented small">
          <button data-action="single" aria-pressed="${!context}" class="${!context ? 'active' : ''}" title="Vista individual de la tarjeta">${icon('card', 14)}Tarjeta</button>
          <button data-action="context" aria-pressed="${context}" class="${context ? 'active' : ''}" title="Vista de la tarjeta en contexto del informe">${icon('grid', 14)}En contexto</button>
        </div>
        <div class="toolbar-icons">
          ${ib('undo', 'Deshacer', 'undo', undo.length ? '' : 'disabled')}
          ${ib('redo', 'Rehacer', 'redo', redo.length ? '' : 'disabled')}
        </div>
      </div>
      <div id="canvas-edit-bar" class="canvas-edit-bar"></div>
      <div id="stage" class="stage ${canvasDark ? 'dark-stage' : ''}"></div>
      <div class="canvas-bottom">
        <span id="dimensions"></span>
        <div class="zoom-controls">
          ${ib('canvas-color', 'Cambiar fondo del lienzo', 'palette')}
          <span class="divider"></span>
          <button data-action="zoom-out" aria-label="Alejar">−</button>
          <span id="zoom-text">${zoom}%</span>
          <button data-action="zoom-in" aria-label="Acercar">+</button>
          ${ib('zoom-fit', 'Ajustar vista', 'expand')}
        </div>
      </div>
      <details id="design-diagnostics" class="design-diagnostics" hidden aria-label="Avisos de legibilidad de la tarjeta"></details>
      <div class="palette-section">
        <div class="theme-swatches">
          ${Object.entries(THEMES).map(([key, t]) => `<button data-theme="${key}" aria-pressed="${c.theme === key}" class="theme-swatch ${c.theme === key ? 'active' : ''}" title="${t.name}" aria-label="Aplicar tema ${t.name}" style="--swatch:${t.background};--dot:${t.accent}"><span></span><small>${t.name}</small></button>`).join('')}
          <button class="theme-swatch theme-add" data-action="themes" title="Crear o editar una paleta"><span>${icon('plus', 15)}</span><small>Crear tema</small></button>
        </div>
      </div>
    </main>
    <aside class="inspector">
      <div class="inspector-title"><h2>Nivel de detalle</h2>${ib('reset', 'Restaurar esta plantilla', 'reset')}</div>
      <div class="mode-switch">${[['essential', 'Esencial'], ['advanced', 'Avanzado']].map(([id, label]) => `<button data-mode="${id}" class="${mode === id ? 'active' : ''}" aria-pressed="${mode === id}">${label}</button>`).join('')}</div>
      <div class="inspector-tabs" role="tablist" aria-label="Propiedades del diseño">${[['content', 'Contenido'], ['style', 'Estilo'], ['data', 'Datos & DAX']].map(([id, label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div>
      <div id="inspector-fields" class="inspector-fields"></div>
    </aside>
  </div>`;
}

export function railCards() {
  const c = getC();
  return filtered().map(t => `<button class="template-item ${c.id === t.id ? 'chosen' : ''}" data-template="${t.id}" aria-pressed="${c.id === t.id}" aria-label="Usar ${t.name}">${thumb(t.config)}<div><strong>${t.name}</strong>${c.id === t.id ? '<span class="chosen-mark">' + icon('check', 12) + '</span>' : '<span>' + icon('arrow', 12) + '</span>'}</div><small>${familyName(t.category)}</small></button>`).join('') || '<p class="empty-hint">No hay plantillas con ese nombre.</p>';
}

export function library() {
  const filter = getFilter();
  const query = getQuery();
  return `<main class="library-view">
    <div class="library-top">
      <div class="filter-pills">${FAMILIES.map(f => `<button data-filter="${f.id}" class="${filter === f.id ? 'active' : ''}">${f.id === 'all' ? 'Todas' : f.name}</button>`).join('')}</div>
      <label class="search-box">${icon('search', 16)}<input id="gallery-search" placeholder="Buscar plantilla…" aria-label="Buscar plantilla" value="${esc(query)}"></label>
    </div>
    <div id="gallery-grid" class="gallery-grid">${galleryCards()}</div>
    <div class="library-foot">
      <span>${icon('sliders', 16)} Todas las plantillas incluyen modos de edición esencial y avanzado.</span>
      <span>Hechas para tus datos. Diseñadas para destacar.</span>
    </div>
  </main>`;
}

export function galleryCards() {
  return filtered().map((t, i) => `<button class="gallery-card" data-template="${t.id}"><div class="gallery-preview">${thumb(t.config)}<span class="gallery-use">Personalizar ${icon('arrow', 15)}</span></div><div class="gallery-description"><div><span class="overline">${familyName(t.category)}</span><h3>${t.name}</h3><p>${t.description}</p></div><span class="gallery-number">${String(TEMPLATES.indexOf(t) + 1).padStart(2, '0')}</span></div></button>`).join('') || '<div class="empty-state">No encontramos esa tarjeta. Prueba con otra búsqueda.</div>';
}

export function savedView() {
  const saved = getSaved();
  return `<main class="library-view">
    <div class="saved-info">${icon('info', 16)} Tus diseños se guardan en este navegador. Exporta un JSON para llevarlos a otro equipo.</div>
    ${saved.length ? `<div class="gallery-grid">${saved.map(s => `<article class="gallery-card saved-card"><button data-load="${s.id}" class="saved-preview" aria-label="Abrir ${esc(s.name)}">${thumb(s.config)}</button><div class="gallery-description"><div><span class="overline">${familyName(s.config.type)}</span><h3>${esc(s.name)}</h3><p>${new Date(s.date).toLocaleDateString('es-ES')}</p></div><div class="saved-actions">${ib('saved-json', 'Exportar configuración', 'download', `data-id="${s.id}"`)}${ib('delete', 'Eliminar diseño', 'trash', `data-id="${s.id}"`)}</div></div></article>`).join('')}</div>` : `<div class="empty-state">${icon('folder', 44)}<h2>Aquí empieza tu colección.</h2><p>Guarda una tarjeta y vuelve a ella siempre que quieras.</p>${btn('view-library', 'Encontrar mi primera plantilla', 'arrow', 'button primary')}</div>`}
  </main>`;
}
