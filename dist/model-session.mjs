import { getPbipModel, setPbipModel } from './state.mjs';

let revision = 0;
/** @type {AbortController | null} */
let pending = null;

/** Every model selection shares this boundary, including local folder reads. */
export function cancelModelRequest() {
  revision++;
  pending?.abort();
  pending = null;
}

/** @returns {import('./types.d.ts').ModelRequestSession} */
export function beginModelRequest() {
  cancelModelRequest();
  const version = revision;
  const controller = new AbortController();
  pending = controller;
  let observed = getPbipModel();
  const isCurrent = () => version === revision && !controller.signal.aborted && getPbipModel() === observed;
  return {
    signal: controller.signal,
    isCurrent,
    /** @param {import('./types.d.ts').ModelCatalog} catalog @param {boolean} [autoAssign] */
    commit(catalog, autoAssign = false) {
      if (!isCurrent()) return false;
      if (setPbipModel(catalog, autoAssign) === false) return false;
      observed = getPbipModel();
      return true;
    },
    finish() { if (pending === controller) pending = null; }
  };
}

/**
 * Result actions remain tied to the model that received the original write.
 * @param {import('./types.d.ts').ModelCatalog | null} model
 * @param {import('./types.d.ts').MeasureWriteTarget} target
 */
export function matchesModelTarget(model, target) {
  return Boolean(model?.isLiveConnection && model.server === target.server &&
    (model.databaseId || model.database) === target.database);
}
