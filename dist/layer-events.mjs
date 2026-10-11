import { getC } from './state.mjs';
import { reorderLayer, moveLayer } from './elements.mjs';
import { commitLayerOrder, clearLayerDrop } from './canvas.mjs';

export function installLayerEvents(app) {
  let dragging = null;
  app.addEventListener('dragstart', event => {
    const handle = event.target.closest?.('[data-layer-drag]');
    if (!handle) return;
    dragging = handle.dataset.layerDrag;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragging);
    handle.closest('[data-layer-row]')?.classList.add('layer-dragging');
  });
  app.addEventListener('dragover', event => {
    const row = event.target.closest?.('[data-layer-row]');
    if (!dragging || !row || row.dataset.layerRow === dragging) return;
    event.preventDefault();
    clearLayerDrop();
    const bounds = row.getBoundingClientRect();
    row.classList.add(event.clientY < bounds.top + bounds.height / 2 ? 'drop-before' : 'drop-after');
    event.dataTransfer.dropEffect = 'move';
  });
  app.addEventListener('drop', event => {
    const row = event.target.closest?.('[data-layer-row]');
    if (!dragging || !row) return;
    event.preventDefault();
    const id = dragging;
    const placement = row.classList.contains('drop-after') ? 'after' : 'before';
    dragging = null;
    clearLayerDrop();
    commitLayerOrder(reorderLayer(getC(), id, row.dataset.layerRow, placement), id);
  });
  app.addEventListener('dragend', () => { dragging = null; clearLayerDrop(); });
  app.addEventListener('keydown', event => {
    const row = event.target.closest?.('[data-layer-row]');
    if (!row || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    commitLayerOrder(moveLayer(getC(), row.dataset.layerRow, direction), row.dataset.layerRow, direction);
  });
}
