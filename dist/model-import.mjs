import { scanDirectoryHandle, scanFileList } from './pbip.mjs';
import { toast } from './state.mjs';
import { beginModelRequest, cancelModelRequest } from './model-session.mjs';
import { openDataBindingModal } from './binding-ui.mjs';
import { render } from './shell-ui.mjs';

export function cancelModelScan() { cancelModelRequest(); }

async function scan(source, fromFiles, request = beginModelRequest()) {
  toast('Leyendo el modelo local…');
  try {
    const catalog = await (fromFiles ? scanFileList : scanDirectoryHandle)(source, { signal: request.signal });
    if (!request.commit(catalog, true)) return;
    render();
    openDataBindingModal();
    toast(`Modelo '${catalog.modelName}' conectado · ${catalog.measures.length} medidas.`);
  } catch (error) {
    if (request.isCurrent() && error.name !== 'AbortError') toast(`No se pudo leer el modelo: ${error.message}`);
  } finally {
    request.finish();
  }
}

export function importModelFiles(files) { return files?.length ? scan(Array.from(files), true) : Promise.resolve(); }

export async function chooseModelFolder() {
  const fallback = () => document.getElementById('pbip-folder-input')?.click();
  if (typeof window.showDirectoryPicker !== 'function') { fallback(); return; }
  const request = beginModelRequest();
  let directory;
  try { directory = await window.showDirectoryPicker({ mode: 'read' }); }
  catch (error) { if (request.isCurrent() && error.name !== 'AbortError') fallback(); request.finish(); return; }
  if (!request.isCurrent()) { request.finish(); return; }
  await scan(directory, false, request);
}
