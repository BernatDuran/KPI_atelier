import { render } from './shell-ui.mjs';
import { resizeCard } from './layout.mjs';
import { sanitizeConfig } from './model.mjs';
import { ELEMENTS, SIZE_LIMITS, elementState, elementSize, elementVisible, updateElement, moveElement, clamp, detachElement, resolveElementDef } from './elements.mjs';
import { $, getC, setC, getView, setZoom, getSelectedElement, getCardSelected, getSelectedElements, getPbipModel, getUndo, getRedo, getContextPreview, getMoveStep, getFormatPainterSource, setFormatPainterSource, getGesture, setGesture, toast, record, toggleRailCollapsed } from './state.mjs';
import { measureElementFrame, renderCanvasBar, refreshCard, flashGuides, renderGuides, selectElement, selectCard, deselect, directChange, elementAction, copySelectedElements, pasteElements, applyFormatPainter, startCardGesture, finishGesture } from './canvas.mjs';
import { updateHistoryButtons, syncElementControls, syncCardControls } from './inspector.mjs';
import { closeAllBindingDropdowns, applyBindingFieldValue, shortcutsModal } from './modals.mjs';
import { openBindingDropdown, selectBindingOption } from './binding-ui.mjs';
import { renderStage, panContext,setContextManualZoom } from './canvas.mjs';

/** Pointer gestures and desktop keyboard navigation share the same editor operations. */
export function installEditorEvents(app, focusBindingElement) {
let contextDrag=null;
// Gestos con el puntero
app.addEventListener('pointerdown', e => {
  if(e.button!==0)return;
  if(getContextPreview()){
    const stage=e.target.closest?.('#stage.can-pan');
    if(stage){contextDrag={pointer:e.pointerId,x:e.clientX,y:e.clientY};stage.classList.add('is-panning');stage.querySelector('.context-pan-viewport')?.focus({preventScroll:true});app.setPointerCapture?.(e.pointerId);e.preventDefault();}
    return;
  }
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
  if(contextDrag&&e.pointerId===contextDrag.pointer){panContext(e.clientX-contextDrag.x,e.clientY-contextDrag.y);contextDrag.x=e.clientX;contextDrag.y=e.clientY;e.preventDefault();return;}
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
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = Math.round(dy / step) * step;
      const targetW = Math.max(16, Math.min(800, W0 - snappedDx));
      const targetS = clamp(S0 - snappedDy, ...bounds);
      next = updateElement(detached, g.id, { x: X0 - (targetW - W0), y: Y0 - (targetS - S0), width: targetW });
      if (def?.isDuplicate) next = updateElement(next, g.id, { size: targetS });
      else next = { ...next, [def.sizeKey]: targetS };
    } else {
      const snappedDx = Math.round(dx / step) * step;
      const snappedDy = g.kind === 'e' ? 0 : Math.round(dy / step) * step;
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

const endContextDrag=()=>{const pointer=contextDrag?.pointer;contextDrag=null;$('#stage')?.classList.remove('is-panning');if(pointer!==undefined&&app.hasPointerCapture?.(pointer))app.releasePointerCapture(pointer);};
app.addEventListener('pointerup', () => {endContextDrag();finishGesture();});
app.addEventListener('pointercancel', () => {endContextDrag();finishGesture(true);});
app.addEventListener('lostpointercapture',endContextDrag);
app.addEventListener('click', e => {
  if(getContextPreview())return;
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
  const target = /** @type {HTMLElement} */ (e.target);
  if(getContextPreview()&&target?.closest?.('#stage')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    e.preventDefault();panContext(e.key==='ArrowLeft'?24:e.key==='ArrowRight'?-24:0,e.key==='ArrowUp'?24:e.key==='ArrowDown'?-24:0);return;
  }
  if (target?.matches?.('[role="tab"][data-tab]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    e.preventDefault();
    const tabs = Array.from(target.closest('[role="tablist"]').querySelectorAll('button[role="tab"]'));
    const current = tabs.indexOf(target);
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (current + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const id = tabs[index].id;
    /** @type {HTMLButtonElement} */ (tabs[index]).click();
    document.getElementById(id)?.focus();
    return;
  }
  const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
  const command = e.ctrlKey || e.metaKey;
  if (command && !editingText && !$('#modal')?.open) {
    const key = e.key.toLowerCase();
    if (key === 'y' || key === 'z') {
      e.preventDefault();
      $('#app')?.querySelector(`[data-action="${key === 'y' || e.shiftKey ? 'redo' : 'undo'}"]`)?.click();
      return;
    }
    if (getView() === 'designer' && (key === '0' || key === '1')) {
      e.preventDefault();
      if (key === '0') { if(getContextPreview())setContextManualZoom();setZoom(100); renderStage(); }
      else $('#app')?.querySelector('[data-action="zoom-fit"]')?.click();
      return;
    }
  }
  if ((e.key === 'Enter' || e.key === ' ') && target?.closest?.('#binding-card-inner .is-bindable')) {
    e.preventDefault();
    focusBindingElement(target);
    return;
  }
  const bindKey = target?.dataset?.bindFieldKey || target?.dataset?.bindKey;
  if (bindKey) {
    const menu = document.getElementById(`dropdown-menu-${bindKey}`);
    const isOpen = menu && menu.classList.contains('is-open');
    if (e.key === 'Tab') { closeAllBindingDropdowns(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && (isOpen || e.key.startsWith('Arrow'))) {
      e.preventDefault();
      if (!isOpen) {
        if (menu && getPbipModel()) {
          openBindingDropdown(bindKey, false, target.value);
          const options = menu.querySelectorAll('[role="option"]');
          selectBindingOption(menu, e.key === 'ArrowUp' ? options.length - 1 : 0);
        }
        return;
      }
      const items = Array.from(menu.querySelectorAll('.binding-dropdown-item'));
      if (!items.length) return;
      const curIdx = items.findIndex(it => it.classList.contains('is-selected'));
      const nextIdx = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (curIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      selectBindingOption(menu, nextIdx);
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
