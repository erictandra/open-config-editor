import { getIn, isPlainObject, sameJson } from '../jsonc.js';
import { PREFIX, withPrefix } from '../names.js';

const PROVIDER = ['models', 'providers', '9router'];
const ALIASES = ['agents', 'defaults', 'models'];
const DEFAULT_MODEL = ['agents', 'defaults', 'model'];

export const openclaw = {
  key: 'openclaw',
  label: 'OpenClaw',

  providerStatus(value, env) {
    const p = getIn(value, PROVIDER);
    if (!isPlainObject(p)) return { exists: false };
    return {
      exists: true,
      baseUrlOk: p.baseUrl === env.routerUrl,
      apiKeyOk: p.apiKey === env.routerKey,
      apiKeyTail: typeof p.apiKey === 'string' ? p.apiKey.slice(-4) : null,
    };
  },

  // §6 + §10: baseUrl/apiKey selalu dari .env, field lain hanya diisi kalau belum ada
  syncProvider(editor, env) {
    const changes = [];
    const p = getIn(editor.value, PROVIDER);
    if (!isPlainObject(p)) {
      editor.set(PROVIDER, {
        baseUrl: env.routerUrl,
        apiKey: env.routerKey,
        api: 'openai-completions',
        models: [],
      });
      return ['blok provider 9router dibuat'];
    }
    if (p.baseUrl !== env.routerUrl) {
      editor.set([...PROVIDER, 'baseUrl'], env.routerUrl);
      changes.push('baseUrl diperbarui');
    }
    if (p.apiKey !== env.routerKey) {
      editor.set([...PROVIDER, 'apiKey'], env.routerKey);
      changes.push('apiKey diperbarui');
    }
    if (p.api === undefined) {
      editor.set([...PROVIDER, 'api'], 'openai-completions');
      changes.push('api diisi');
    }
    if (!Array.isArray(p.models)) {
      editor.set([...PROVIDER, 'models'], []);
      changes.push('models diinisialisasi');
    }
    return changes;
  },

  readModels(value) {
    const list = getIn(value, [...PROVIDER, 'models']);
    const aliases = getIn(value, ALIASES) || {};
    const models = (Array.isArray(list) ? list : [])
      .filter((m) => m && typeof m.id === 'string')
      .map((m) => ({
        id: m.id,
        name: typeof m.name === 'string' ? m.name : undefined,
        alias: aliases[withPrefix(m.id)]?.alias,
        image: Array.isArray(m.input) && m.input.includes('image'),
      }));
    const dm = getIn(value, DEFAULT_MODEL);
    const current = typeof dm === 'string' ? dm : dm?.primary;
    return { models, default: typeof current === 'string' ? current : null };
  },

  // rows: model yang dicentang untuk openclaw; defaultRef: "9router/..." / ref lain / null (jangan ubah)
  applyModels(editor, rows, defaultRef) {
    const value = editor.value;

    const list = rows.map((r) => {
      const entry = { id: r.id, name: r.name };
      if (r.image) entry.input = ['text', 'image'];
      return entry;
    });
    // Skip kalau isinya sama, supaya format asli file tidak ikut berubah
    if (!sameJson(getIn(value, [...PROVIDER, 'models']), list)) editor.set([...PROVIDER, 'models'], list);

    // Alias: hanya key berawalan "9router/" yang dikelola, alias provider lain tidak disentuh
    const existing = getIn(value, ALIASES);
    const wanted = new Map(rows.map((r) => [withPrefix(r.id), { alias: r.alias || r.name }]));
    if (isPlainObject(existing)) {
      for (const key of Object.keys(existing)) {
        if (key.startsWith(PREFIX) && !wanted.has(key)) editor.remove([...ALIASES, key]);
      }
    }
    for (const [key, entry] of wanted) {
      const cur = isPlainObject(existing) ? existing[key] : undefined;
      // Pertahankan field lain (mis. params) di entry alias yang sudah ada
      const next = isPlainObject(cur) ? { ...cur, alias: entry.alias } : entry;
      if (!sameJson(cur, next)) editor.set([...ALIASES, key], next);
    }

    if (defaultRef) {
      const dm = getIn(value, DEFAULT_MODEL);
      if (typeof dm === 'string') {
        if (dm !== defaultRef) editor.set(DEFAULT_MODEL, defaultRef);
      } else if (dm?.primary !== defaultRef) {
        editor.set([...DEFAULT_MODEL, 'primary'], defaultRef);
      }
    }
  },
};
