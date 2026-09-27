// State internal (config.json): tabel model + pilihan default per aplikasi
import fs from 'node:fs/promises';
import path from 'node:path';
import { prettyName } from './names.js';

export const APPS = ['openclaw', 'opencode'];

function newRow(id, name) {
  const pretty = name || prettyName(id);
  return { id, name: pretty, alias: pretty, image: false, openclaw: false, opencode: false };
}

export async function loadState(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Gagal baca ${file}: ${err.message}`);
  }
}

export async function saveState(file, state) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
  await fs.rename(tmp, file);
}

// §7 run pertama: pakai model yang sudah ada di kedua config sebagai titik awal
// current: { openclaw: {models, default}, opencode: {models, default} } (entry bisa null kalau file gagal dibaca)
export function stateFromConfigs(current) {
  const rows = new Map();
  for (const app of APPS) {
    for (const m of current[app]?.models || []) {
      // Nama dari openclaw diutamakan (diproses duluan)
      const row = rows.get(m.id) || newRow(m.id, m.name);
      row[app] = true;
      row.image = row.image || m.image;
      if (m.alias) row.alias = m.alias;
      rows.set(m.id, row);
    }
  }
  return {
    version: 1,
    models: [...rows.values()],
    defaults: {
      openclaw: current.openclaw?.default ?? null,
      opencode: current.opencode?.default ?? null,
    },
    applied: {},
  };
}

// §7 merge: model baru ditambah, yang sudah ada tidak diubah sama sekali
export function mergeRouterModels(state, routerIds) {
  const known = new Set(state.models.map((m) => m.id));
  const added = [];
  for (const id of routerIds) {
    if (!known.has(id)) {
      state.models.push(newRow(id));
      added.push(id);
    }
  }
  return added;
}

// Tambah model yang tidak muncul di /models 9Router (mis. gemini/gemini-2.5-flash-lite).
// Kalau id sudah ada di tabel, cukup ditandai manual.
export function addManualModel(state, id, name) {
  const existing = state.models.find((m) => m.id === id);
  if (existing) {
    existing.manual = true;
    return { row: existing, created: false };
  }
  const row = { ...newRow(id, name), manual: true };
  state.models.unshift(row);
  return { row, created: true };
}
