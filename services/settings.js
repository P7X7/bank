import { db } from '../db/index.js';

let cache = null;

function loadAll() {
  if (!cache) {
    cache = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  }
  return cache;
}

export function getSetting(key, fallback = null) {
  const all = loadAll();
  return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : fallback;
}

export function getNumberSetting(key, fallback) {
  const n = Number(getSetting(key, fallback));
  return Number.isFinite(n) ? n : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(String(key), String(value));
  if (cache) cache[key] = String(value);
  else loadAll()[key] = String(value);
}

export function getAllSettings() {
  return { ...loadAll() };
}

export function invalidateSettings() {
  cache = null;
}