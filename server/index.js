import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';
import { fetchRouterModels } from './router9.js';
import { openclaw } from './targets/openclaw.js';
import { opencode } from './targets/opencode.js';
import { APPS, loadState, saveState, stateFromConfigs, mergeRouterModels } from './state.js';
import { plan, readConfig, generateTarget, syncProviderOnLoad, rollback, validateDefault } from './pipeline.js';
import { parseJsonc } from './jsonc.js';

const env = loadEnv();
const TARGETS = {
  openclaw: { target: openclaw, file: env.openclawPath, command: env.openclawCommand },
  opencode: { target: opencode, file: env.opencodePath, command: env.opencodeCommand },
};

let busy = false;
async function exclusive(res, fn) {
  if (busy) return res.status(409).json({ error: 'Proses lain sedang berjalan, coba lagi sebentar' });
  busy = true;
  try {
    res.json(await fn());
  } catch (err) {
    res.status(400).json({ error: err.message });
  } finally {
    busy = false;
  }
}

function sanitizeRows(input) {
  if (!Array.isArray(input)) throw new Error('models harus array');
  const seen = new Set();
  return input.map((r) => {
    if (typeof r?.id !== 'string' || !r.id.trim()) throw new Error('id model tidak valid');
    if (seen.has(r.id)) throw new Error(`id model duplikat: ${r.id}`);
    seen.add(r.id);
    const name = String(r.name ?? '').trim() || r.id;
    return {
      id: r.id,
      name,
      alias: String(r.alias ?? '').trim() || name,
      image: !!r.image,
      openclaw: !!r.openclaw,
      opencode: !!r.opencode,
    };
  });
}

function parseInput(body) {
  const models = sanitizeRows(body?.models);
  const defaults = {};
  for (const app of APPS) {
    const d = body?.defaults?.[app];
    defaults[app] = typeof d === 'string' && d ? d : null;
  }
  return { models, defaults };
}

function inputFor(app, { models, defaults }) {
  return { rows: models.filter((m) => m[app]), defaultRef: defaults[app] };
}

function validate(input) {
  return APPS.map((app) => {
    const { rows, defaultRef } = inputFor(app, input);
    return validateDefault(TARGETS[app].target.label, rows, defaultRef);
  }).filter(Boolean);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')));

// §5.1: sinkron provider → fetch 9Router → merge ke state
app.get('/api/state', (req, res) =>
  exclusive(res, async () => {
    const providers = {};
    const current = {};
    for (const key of APPS) {
      const { target, file } = TARGETS[key];
      try {
        const r = await syncProviderOnLoad(target, env, file);
        providers[key] = { ...r.status, fixed: r.changes, backup: r.backup };
        current[key] = target.readModels(r.value);
      } catch (err) {
        providers[key] = { error: err.message };
        current[key] = null;
      }
    }

    let state = await loadState(env.dataFile);
    let dirty = false;
    if (!state) {
      state = stateFromConfigs(current);
      dirty = true;
    }

    const router = { ok: false };
    let routerIds = null;
    try {
      routerIds = await fetchRouterModels(env);
      const added = mergeRouterModels(state, routerIds);
      Object.assign(router, { ok: true, count: routerIds.length, added });
      dirty ||= added.length > 0;
    } catch (err) {
      router.error = err.message;
    }
    if (dirty) await saveState(env.dataFile, state);

    const inRouter = routerIds && new Set(routerIds);
    return {
      router,
      providers,
      models: state.models.map((m) => ({ ...m, missing: inRouter ? !inRouter.has(m.id) : false })),
      defaults: state.defaults,
      currentDefaults: Object.fromEntries(APPS.map((k) => [k, current[k]?.default ?? null])),
      applied: state.applied || {},
    };
  }),
);

// Ringkasan perubahan untuk dialog konfirmasi (§5.5), tidak menulis apa pun
app.post('/api/preview', (req, res) =>
  exclusive(res, async () => {
    const input = parseInput(req.body);
    const errors = validate(input);
    const result = {};
    for (const key of APPS) {
      const { target, file } = TARGETS[key];
      try {
        const p = plan(target, await readConfig(file), env, inputFor(key, input));
        result[key] = { unchanged: p.unchanged, ...p.summary };
      } catch (err) {
        result[key] = { error: err.message };
      }
    }
    return { errors, plans: result };
  }),
);

app.post('/api/generate', (req, res) =>
  exclusive(res, async () => {
    const input = parseInput(req.body);
    const errors = validate(input);
    if (errors.length) throw new Error(errors.join('; '));

    const results = {};
    for (const key of APPS) {
      const { target, file, command } = TARGETS[key];
      results[key] = await generateTarget(target, env, file, command, inputFor(key, input));
    }

    // §8.7: state hanya diupdate untuk aplikasi yang berhasil
    const prev = (await loadState(env.dataFile)) || { models: [], defaults: {}, applied: {} };
    const prevRows = new Map(prev.models.map((m) => [m.id, m]));
    const okApps = APPS.filter((k) => ['ok', 'unchanged'].includes(results[k].status));
    if (okApps.length) {
      const failed = APPS.filter((k) => !okApps.includes(k));
      const state = {
        version: 1,
        models: input.models.map((m) => {
          const row = { ...m };
          for (const k of failed) row[k] = prevRows.get(m.id)?.[k] ?? false;
          return row;
        }),
        defaults: { ...prev.defaults },
        applied: { ...(prev.applied || {}) },
      };
      for (const k of okApps) {
        state.defaults[k] = input.defaults[k];
        if (results[k].status === 'ok') state.applied[k] = { at: new Date().toISOString(), backup: results[k].backup };
      }
      await saveState(env.dataFile, state);
    }
    return { results };
  }),
);

app.post('/api/rollback', (req, res) =>
  exclusive(res, async () => {
    const t = TARGETS[req.body?.app];
    if (!t) throw new Error('app tidak dikenal');
    return rollback(t.target, env, t.file, t.command, String(req.body.backup || ''));
  }),
);

// Hapus baris model dari tabel (hanya kalau tidak aktif di aplikasi mana pun)
app.post('/api/models/delete', (req, res) =>
  exclusive(res, async () => {
    const state = await loadState(env.dataFile);
    const row = state?.models.find((m) => m.id === req.body?.id);
    if (!row) throw new Error('Model tidak ditemukan');
    if (row.openclaw || row.opencode) throw new Error('Uncheck model di semua aplikasi lalu Generate dulu sebelum dihapus');
    state.models = state.models.filter((m) => m !== row);
    await saveState(env.dataFile, state);
    return { ok: true };
  }),
);

// Validasi awal supaya error parse ketahuan saat start
for (const key of APPS) {
  try {
    parseJsonc(await readConfig(TARGETS[key].file), TARGETS[key].target.label);
  } catch (err) {
    console.warn(`[peringatan] ${err.message}`);
  }
}

app.listen(env.listen.port, env.listen.host, () => {
  console.log(`9Router Config Manager: http://${env.listen.host}:${env.listen.port}`);
});
