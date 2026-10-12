// IndexedDB owns shared collections. localStorage remains a UI/legacy mirror;
// a renderer's asynchronously updated localStorage cache is not transactional.
const DB_NAME = 'kpi-atelier-storage';
const STORE = 'collections';
export const COLLECTION_LOCKS = new Map([
  ['kpi-atelier-saved-collection', 'kpi-atelier-saved'],
  ['kpi-atelier-themes-collection', 'kpi-atelier-themes']
]);
const connections = new WeakMap();
const snapshots = new WeakMap();

const storageOf = ctx => ctx?.localStorage || ctx?.window?.localStorage;
/** @returns {IDBFactory | null} */
function factoryOf(ctx) {
  const factory = ctx?.indexedDB || ctx?.window?.indexedDB;
  if (factory?.open) return factory;
  if (typeof process !== 'undefined' && process.versions?.node) return null;
  throw new Error('El almacenamiento compartido no está disponible. Tus cambios siguen abiertos; exporta el JSON antes de cerrar.');
}
export function collectionValue(storage, key) {
  const cache = snapshots.get(storage);
  return cache?.has(key) ? cache.get(key) : storage?.getItem(key) ?? null;
}
function publish(ctx, key, value, storage) {
  let cache = snapshots.get(storage);
  if (!cache) { cache = new Map(); snapshots.set(storage, cache); }
  cache.set(key, value);
  try {
    if (storage.getItem(key) !== value) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
  } catch {
    ctx.collectionSyncWarning = 'La colección se conservó en el almacenamiento compartido. No se pudo actualizar la caché local; al volver a abrir se recuperará desde la copia guardada.';
  }
}
/** @param {IDBFactory} factory @returns {Promise<IDBDatabase>} */
function openDatabase(factory) {
  if (connections.has(factory)) return connections.get(factory);
  /** @type {Promise<IDBDatabase>} */
  const opening = new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    let rejected = false;
    const fail = () => { rejected = true; reject(new Error('No se pudo abrir el almacenamiento compartido. Tus cambios siguen abiertos; exporta el JSON.')); };
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onerror = fail;
    request.onblocked = fail;
    request.onsuccess = () => {
      const db = request.result;
      if (rejected) { db.close(); return; }
      db.onversionchange = () => { db.close(); connections.delete(factory); };
      db.onclose = () => { connections.delete(factory); };
      resolve(db);
    };
  });
  connections.set(factory, opening);
  opening.catch(() => { connections.delete(factory); });
  return opening;
}

/** Execute a synchronous collection operation inside one durable transaction. */
export async function collectionTransaction(ctx, key, operation, preserveMirror = false) {
  const storage = storageOf(ctx), factory = factoryOf(ctx);
  if (!storage) throw new Error('La caché local no está disponible. La colección original se ha conservado.');
  // Node harnesses provide an in-memory Storage and a real lock queue. Browsers
  // never fall back to localStorage after an unavailable/failed IndexedDB open.
  if (!factory) return operation(storage);
  const db = await openDatabase(factory);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const read = store.get(key);
    let value, result, failure;
    const deferred = new Map();
    const inspected = new Map();
    transaction.onabort = () => reject(failure || new Error('No se pudo guardar la colección compartida. Tus cambios siguen abiertos.'));
    transaction.onerror = () => { /* onabort reports the final transaction result. */ };
    transaction.oncomplete = () => {
      publish(ctx, key, value, storage);
      let deferredConflict = false;
      for (const [otherKey, otherValue] of deferred) {
        try {
          if (otherValue === null && storage.getItem(otherKey) !== inspected.get(otherKey)) {
            deferredConflict = true;
            if (result !== undefined) ctx.collectionSyncWarning = 'La colección se guardó. El borrador cambió durante el guardado y se ha conservado su versión nueva.';
            continue;
          }
          if (otherValue === null) storage.removeItem(otherKey); else storage.setItem(otherKey, otherValue);
        }
        catch { ctx.collectionSyncWarning = 'La colección se guardó. No se pudo retirar su borrador de recuperación; ambas copias se han conservado.'; }
      }
      if (deferredConflict && result === undefined) { reject(new Error('changed')); return; }
      resolve(result);
    };
    read.onsuccess = () => {
      try {
        // An absent row migrates its original raw legacy value exactly once.
        const mirror = storage.getItem(key);
        value = read.result === undefined ? mirror : read.result;
        if (value !== null && typeof value !== 'string') throw new Error('La colección compartida está dañada. Su contenido original se ha conservado.');
        // First-load resynchronization may encounter a previous application
        // version's divergent mirror. Preserve it before publishing authority.
        if (preserveMirror && read.result !== undefined && mirror !== null && mirror !== value) {
          store.put({ collection: key, date: new Date().toISOString(), value: mirror }, 'backup:' + key + ':' + crypto.randomUUID());
        }
        const facade = {
          getItem(name) {
            if (name === key) return value;
            if (deferred.has(name)) return deferred.get(name);
            const raw = storage.getItem(name);
            if (!inspected.has(name)) inspected.set(name, raw);
            return raw;
          },
          setItem(name, next) { if (name === key) value = String(next); else deferred.set(name, String(next)); },
          removeItem(name) {
            if (name === key) value = null;
            else { if (!inspected.has(name)) inspected.set(name, storage.getItem(name)); deferred.set(name, null); }
          }
        };
        result = operation(facade);
        if (result?.then) throw new Error('La operación de colección debe ser síncrona dentro de la transacción.');
        store.put(value, key);
      } catch (error) { failure = error; transaction.abort(); }
    };
  });
}

/** Hydration uses the mutation lock so an old snapshot cannot republish later. */
export async function hydrateCollections(ctx, keys = [...COLLECTION_LOCKS.values()], preserveMirror = false) {
  if (!factoryOf(ctx)) return;
  const locks = ctx?.navigator?.locks || ctx?.window?.navigator?.locks;
  if (!locks?.request) throw new Error('Este navegador no permite coordinar el almacenamiento entre ventanas.');
  await Promise.all([...COLLECTION_LOCKS].filter(([, key]) => keys.includes(key)).map(([lock, key]) =>
    locks.request(lock, { mode: 'exclusive' }, () => collectionTransaction(ctx, key, () => {}, preserveMirror))));
}
