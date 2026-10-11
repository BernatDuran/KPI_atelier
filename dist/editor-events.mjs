import { render } from './shell-ui.mjs';
import { resizeCard } from './layout.mjs';
import { sanitizeConfig } from './model.mjs';
import { ELEMENTS, SIZE_LIMITS, elementState, elementSize, elementVisible, updateElement, moveElement, clamp, detachElement, resolveElementDef } from './elements.mjs';
import { $, getC, setC, getView, getSelectedElement, getCardSelected, getSelectedElements, getPbipModel, getUndo, getRedo, getContextPreview, getMoveStep, getFormatPainterSource, setFormatPainterSource, getGesture, setGesture, toast, record, toggleRailCollapsed } from './state.mjs';
import { measureElementFrame, renderCanvasBar, refreshCard, flashGuides, renderGuides, selectElement, selectCard, deselect, directChange, elementAction, copySelectedElements, pasteElements, applyFormatPainter, startCardGesture, finishGesture } from './canvas.mjs';
import { updateHistoryButtons, syncElementControls, syncCardControls } from './inspector.mjs';
import { renderBindingDropdown, closeAllBindingDropdowns, applyBindingFieldValue, shortcutsModal } from './modals.mjs';

/** Pointer gestures and desktop keyboard navigation share the same editor operations. */
export function installEditorEvents(app, focusBindingElement) {
// Gestos con el puntero
app.addEventListener('pointerdown', e => {
  if (getContextPreview() || e.button !== 0) return;
  const cardHandle = e.target.closest('[data-card-resize]');
  if (cardHandle) { startCardGesture(e, cardHandle.dataset.cardResize); return; }
  const handle = e.target.closest('[data-resize]');
  const el = e.target.closest('[data-element]');
  if (!handle && !el) return;

  const formatPainterSource = getFormatPainterSource();
  if (formatPainterSource && el) {
    e.preventDefault();
    applyFormatPainter(el.dataset.element);
    return;
  }

  const isCtrl = e.ctrlKey || e.metaKey;
  if (el) {
    if (isCtrl) { selectElement(el.dataset.element, false, true); return; }
    if (!getSelectedElements().has(el.dataset.element)) selectElement(el.dataset.element);
  }

  const sel = getSelectedElement();
  const c = getC();
  if (!sel || !elementVisible(c, sel)) return;
  const scale = ($('#main-card')?.getBoundingClientRect().width || c.width) / c.width;
  const selectedElements = getSelectedElements();

  if (!handle && selectedElements.size > 1) {
    const items = [...selectedElements].map(mId => {
      const node = app.querySelector(`[data-element="${mId}"]`);
      const frame = c.elements?.[mId]?.frame || measureElementFrame(mId);
      const p = elementState(c, mId);
      const bBox = node ? node.getBoundingClientRect() : null;
      const w = bBox ? bBox.width / scale : (p.width || frame?.width || 100);
      const h = bBox ? bBox.height / scale : (frame?.height || 24);
      const left = (frame?.left || 0) + p.x;
      const top = (frame?.top || 0) + p.y;
      return { id: mId, frame, p, w, h, left, top };
    });
    const gesture = {
      kind: 'group-move',
      id: sel,
      items,
      minDx: Math.max(...items.map(it => -it.left)),
      maxDx: Math.min(...items.map(it => c.width - (it.left + it.w))),
      minDy: Math.max(...items.map(it => -it.top)),
      maxDy: Math.min(...items.map(it => c.height - (it.top + it.h))),
      startX: e.clientX,
      startY: e.clientY,
      start: structuredClone(c),
      scale,
      changed: false,
      pointer: e.pointerId,
      undoSnapshot: [...getUndo()],
      redo: [...getRedo()]
    };
    setGesture(gesture);
    if (app.setPointerCapture) app.setPointerCapture(e.pointerId);
    renderGuides();
    e.preventDefault();
    return;
  }

  const node = app.querySelector(`[data-element="${sel}"]`);
  const gesture = {
    id: sel,
    kind: handle?.dataset.resize || 'move',
    startX: e.clientX,
    startY: e.clientY,
    start: structuredClone(c),
    scale,
    width: node ? node.getBoundingClientRect().width / scale : 100,
    frame: measureElementFrame(sel),
    changed: false,
    pointer: e.pointerId,
    undoSnapshot: [...getUndo()],
    redo: [...getRedo()]
  };
  setGesture(gesture);
  if (app.setPointerCapture) app.setPointerCapture(e.pointerId);
  renderGuides();
  e.preventDefault();
});

app.addEventListener('pointermove', e => {
  const g = getGesture();
  if (!g || e.pointerId !== g.pointer) return;
  if (!g.changed && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 3) return;
  if (!g.changed) { record(); g.changed = true; app.classList.add('is-dragging'); }

  const moveStep = getMoveStep();
  const dx = (e.clientX - g.startX) / g.scale;
  const dy = (e.clientY - g.startY) / g.scale;
  const step = e.shiftKey ? (moveStep === 1 ? 5 : 1) : moveStep;
  let next = g.start;

  if (g.card) {
    next = resizeCard(g.start, g.start.width + (g.kind === 's' ? 0 : Math.round(dx / step) * step), g.start.height + (g.kind === 'e' ? 0 : Math.round(dy / step) * step), true);
  } else if (g.kind === 'group-move') {
    const clampedDx = Math.max(g.minDx, Math.min(g.maxDx, Math.round(dx / step) * step));
    const clampedDy = Math.max(g.minDy, Math.min(g.maxDy, Math.round(dy / step) * step));
    next = g.start;
    for (const it of g.items) {
      next = moveElement(next, it.id, clampedDx, clampedDy, step, it.frame);
    }
  } else if (g.kind === 'move') {
    next = moveElement(g.start, g.id, dx, dy, step, g.frame);
  } else {
    let detached = detachElement(g.start, g.id, g.frame);
    const def = resolveElementDef(g.id) || ELEMENTS[g.id];
    const bounds = SIZE_LIMITS[def.kind];
    const p0 = elementState(detached, g.id);
    const S0 = elementSize(detached, g.id);
    const W0 = Math.round(p0.width || g.width);
    const X0 = p0.x;
    const Y0 = p0.y;

    if (g.kind === 'nw') {
      const clampDy = Math.min(0, dy);
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = Math.round(clampDy / step) * step;
      const targetW = Math.max(16, Math.min(800, W0 - snappedDx));
      const targetS = clamp(S0 - snappedDy, ...bounds);
      next = updateElement(detached, g.id, { x: X0 - (targetW - W0), y: Y0 - (targetS - S0), width: targetW });
      if (def?.isDuplicate) next = updateElement(next, g.id, { size: targetS });
      else next = { ...next, [def.sizeKey]: targetS };
    } else {
      const clampDy = Math.max(0, dy);
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = Math.round(clampDy / step) * step;
      const targetW = Math.max(16, Math.min(800, W0 + snappedDx));
      const targetS = clamp(S0 + snappedDy, ...bounds);
      next = updateElement(detached, g.id, { width: targetW });
      if (def?.isDuplicate) next = updateElement(next, g.id, { size: targetS });
      else next = { ...next, [def.sizeKey]: targetS };
    }
  }

  setC(sanitizeConfig(next));
  refreshCard();
  if (g.card) syncCardControls(); else syncElementControls();
  updateHistoryButtons();
});

app.addEventListener('pointerup', () => finishGesture());
app.addEventListener('pointercancel', () => finishGesture(true));
app.addEventListener('click', e => {
  if (getFormatPainterSource()) return;
  const isCtrl = e.ctrlKey || e.metaKey;
  const el = e.target.closest('[data-element]');
  if (el) {
    if (isCtrl) return;
    if (getSelectedElement() !== el.dataset.element || getSelectedElements().size > 1) selectElement(el.dataset.element);
    return;
  }
  if (e.target.closest('[data-card-surface]')) { selectCard(); return; }
  if (e.target.closest('#stage') && !e.target.closest('#selection-overlay') && (getSelectedElement() || getCardSelected())) deselect();
});

// Atajos de teclado generales y de lienzo
document.addEventListener('keydown', e => {
  const target = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && target?.closest?.('#binding-card-inner .is-bindable')) {
    e.preventDefault();
    focusBindingElement(target);
    return;
  }
  const bindKey = target?.dataset?.bindFieldKey || target?.dataset?.bindKey;
  if (bindKey) {
    const menu = document.getElementById(`dropdown-menu-${bindKey}`);
    const isOpen = menu && menu.classList.contains('is-open');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        if (menu && getPbipModel()) {
          closeAllBindingDropdowns();
          menu.innerHTML = renderBindingDropdown(bindKey, target.value);
          menu.classList.add('is-open');
          const toggle = document.querySelector(`[data-action="toggle-bind-dropdown"][data-field="${bindKey}"]`);
          if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.classList.add('is-open'); }
        }
        return;
      }
      const items = Array.from(menu.querySelectorAll('.binding-dropdown-item'));
      if (!items.length) return;
      const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
      const nextIdx = curIdx < items.length - 1 ? curIdx + 1 : 0;
      items.forEach((it, idx) => it.classList.toggle('is-selected', idx === nextIdx));
      items[nextIdx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!isOpen) return;
      e.preventDefault();
      const items = Array.from(menu.querySelectorAll('.binding-dropdown-item'));
      if (!items.length) return;
      const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
      const prevIdx = curIdx > 0 ? curIdx - 1 : items.length - 1;
      items.forEach((it, idx) => it.classList.toggle('is-selected', idx === prevIdx));
      items[prevIdx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && isOpen) {
      const selectedItem = menu.querySelector('.binding-dropdown-item.is-selected') || menu.querySelector('.binding-dropdown-item');
      if (selectedItem) {
        e.preventDefault();
        e.stopPropagation();
        const val = selectedItem.dataset.value;
        applyBindingFieldValue(bindKey, val);
        closeAllBindingDropdowns();
        target.focus();
        return;
      }
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeAllBindingDropdowns();
      return;
    }
  }
  if (e.key === 'Escape') {
    const openMenu = document.querySelector('.binding-dropdown-menu.is-open');
    if (openMenu) {
      e.preventDefault();
      e.stopPropagation();
      closeAllBindingDropdowns();
      return;
    }
  }
  if (e.key === 'Escape' && getGesture()) { e.preventDefault?.(); finishGesture(true); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B') && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('#modal')?.open) {
    e.preventDefault?.();
    toggleRailCollapsed();
    render();
    return;
  }
  if ((e.key === '?' || (e.shiftKey && e.key === '/')) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !$('#modal')?.open) {
    e.preventDefault?.();
    shortcutsModal();
    return;
  }
  if (!$('#modal')?.open && (e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-element]')) {
    e.preventDefault();
    selectElement(e.target.dataset.element);
    return;
  }
  if (e.target.closest?.('.layers-popover')) return;
  if ($('#modal')?.open || !getSelectedElement() || getContextPreview() || getView() !== 'designer' || !e.target.closest?.('#stage,#canvas-edit-bar')) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('#app')?.querySelector('[data-action="save"]')?.click(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('#modal')?.open) {
      e.preventDefault();
      $('#app')?.querySelector(`[data-action="${e.shiftKey ? 'redo' : 'undo'}"]`)?.click();
    }
    if ((e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#modal')?.open) {
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); copySelectedElements(); }
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); pasteElements(); }
    }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === 'Escape') {
    if (getFormatPainterSource()) {
      e.preventDefault();
      setFormatPainterSource(null);
      renderCanvasBar();
      toast('Copiar formato cancelado.');
      return;
    }
    e.preventDefault();
    deselect();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); elementAction('delete-element'); return; }
  const moveStep = getMoveStep();
  const step = e.shiftKey ? (moveStep === 1 ? 5 : 1) : moveStep;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    flashGuides();
    const reqDx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const reqDy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const selectedElements = getSelectedElements();
    const c = getC();
    if (selectedElements.size > 1) {
      const members = [...selectedElements];
      const items = members.map(mId => {
        const frame = c.elements?.[mId]?.frame || measureElementFrame(mId);
        const p = elementState(c, mId);
        const w = p.width || frame?.width || 100;
        const h = frame?.height || 24;
        const left = (frame?.left || 0) + p.x;
        const top = (frame?.top || 0) + p.y;
        return { id: mId, frame, w, h, left, top };
      });
      const minDx = Math.max(...items.map(it => -it.left));
      const maxDx = Math.min(...items.map(it => c.width - (it.left + it.w)));
      const minDy = Math.max(...items.map(it => -it.top));
      const maxDy = Math.min(...items.map(it => c.height - (it.top + it.h)));
      const clampedDx = Math.max(minDx, Math.min(maxDx, reqDx));
      const clampedDy = Math.max(minDy, Math.min(maxDy, reqDy));
      if (clampedDx !== 0 || clampedDy !== 0) {
        let next = c;
        for (const it of items) next = moveElement(next, it.id, clampedDx, clampedDy, step, it.frame);
        directChange(next, true, false);
      }
    } else {
      const sel = getSelectedElement();
      directChange(moveElement(c, sel, reqDx, reqDy, step, measureElementFrame(sel)), true, false);
      app.querySelector(`[data-element="${sel}"]`)?.focus({ preventScroll: true });
    }
  }
  if (e.key === '+' || e.key === '=' || e.key === '-') {
    e.preventDefault();
    flashGuides();
    elementAction(e.key === '-' ? 'smaller-element' : 'bigger-element');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); $('#app')?.querySelector('[data-action="save"]')?.click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('#app')?.querySelector(`[data-action="${e.shiftKey ? 'redo' : 'undo'}"]`)?.click(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelectedElements(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteElements(); }
});


}
