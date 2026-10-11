import { scanDirectoryHandle, scanFileList } from './pbip.mjs';
import { setPbipModel, toast } from './state.mjs';
import { openDataBindingModal } from './binding-ui.mjs';
import { render } from './shell-ui.mjs';

let pendingScan = null;
export function cancelModelScan() { pendingScan?.abort(); pendingScan = null; }

async function scan(source, fromFiles) {
  cancelModelScan();
  const controller = new AbortController();
  pendingScan = controller;
  toast('Leyendo el modelo local…');
  try {
    const catalog = await (fromFiles ? scanFileList : scanDirectoryHandle)(source, { signal: controller.signal });
    if (controller.signal.aborted) return;
    setPbipModel(catalog, true);
    render();
    openDataBindingModal();
    toast(`Modelo '${catalog.modelName}' conectado · ${catalog.measures.length} medidas.`);
  } catch (error) {
    if (error.name !== 'AbortError') toast(`No se pudo leer el modelo: ${error.message}`);
  } finally {
    if (pendingScan === controller) pendingScan = null;
  }
}

export function importModelFiles(files) { return files?.length ? scan(Array.from(files), true) : Promise.resolve(); }

export async function chooseModelFolder() {
  const fallback = () => document.getElementById('pbip-folder-input')?.click();
  if (typeof window.showDirectoryPicker !== 'function') { fallback(); return; }
  let directory;
  try { directory = await window.showDirectoryPicker({ mode: 'read' }); }
  catch (error) { if (error.name !== 'AbortError') fallback(); return; }
  await scan(directory, false);
}
