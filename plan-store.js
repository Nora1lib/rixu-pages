import { SCHEMA, normalizeState, copy } from './schedule-domain.js';
export const KEY = 'rixu.web.v1';
export const BACKUP_KEY = 'rixu.migration-backup.v2';
export function readPlan(storage = localStorage) {
  const text = storage.getItem(KEY);
  const raw = text ? JSON.parse(text) : null;
  const state = normalizeState(raw);
  if (text && raw.schemaVersion !== SCHEMA) {
    if (!storage.getItem(BACKUP_KEY)) storage.setItem(BACKUP_KEY, text);
    storage.setItem(KEY, JSON.stringify(state));
  }
  return state;
}
export function writePlan(next, expectedRevision, storage = localStorage) {
  const current = readPlan(storage);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('日程已在另一窗口更新，请重新查看后操作。');
  const state = normalizeState(next); state.revision = current.revision + 1;
  state.updatedAt = new Date().toISOString();
  storage.setItem(KEY, JSON.stringify(state));
  return state;
}
export function transact(action, storage = localStorage) {
  const base = readPlan(storage), next = copy(base); action(next);
  return writePlan(next, base.revision, storage);
}
export function notifyNative(data) {
  window.webkit?.messageHandlers?.rixu?.postMessage({ action: 'dataChanged' });
  window.dispatchEvent(new CustomEvent('rixu:plan-written', { detail: data }));
}

// Explicit recovery retains the original bytes before replacing unreadable data.
export function recoverPlan(next, storage = localStorage) {
  const state = normalizeState(next);
  try { readPlan(storage); throw new Error('当前数据可以读取，请使用正常导入。'); }
  catch(error) { if(error.message === '当前数据可以读取，请使用正常导入。') throw error; }
  const original = storage.getItem(KEY);
  if(original) storage.setItem('rixu.recovery-original.'+Date.now(), original);
  state.revision = Math.max(0, state.revision || 0)+1;
  state.updatedAt = new Date().toISOString();
  storage.setItem(KEY, JSON.stringify(state));
  return state;
}
