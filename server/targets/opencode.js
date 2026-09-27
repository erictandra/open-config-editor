import { getIn, isPlainObject, sameJson } from '../jsonc.js';

const PROVIDER = ['provider', '9router'];
const DEFAULT_MODEL = ['model'];

export const opencode = {
  key: 'opencode',
  label: 'opencode',

  providerStatus(value, env) {
    const p = getIn(value, PROVIDER);
    if (!isPlainObject(p)) return { exists: false };
    const key = p.options?.apiKey;
    return {
      exists: true,
      baseUrlOk: p.options?.baseURL === env.routerUrl,
      apiKeyOk: key === env.routerKey,
      apiKeyTail: typeof key === 'string' ? key.slice(-4) : null,
    };
  },

  syncProvider(editor, env) {
    const changes = [];
    const p = getIn(editor.value, PROVIDER);
    if (!isPlainObject(p)) {
      editor.set(PROVIDER, {
        name: '9 Router',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: env.routerUrl, apiKey: env.routerKey },
        models: {},
      });
      return ['blok provider 9router dibuat'];
    }
    if (p.name === undefined) {
      editor.set([...PROVIDER, 'name'], '9 Router');
      changes.push('name diisi');
    }
    if (p.npm === undefined) {
      editor.set([...PROVIDER, 'npm'], '@ai-sdk/openai-compatible');
      changes.push('npm diisi');
    }
    if (p.options?.baseURL !== env.routerUrl) {
      editor.set([...PROVIDER, 'options', 'baseURL'], env.routerUrl);
      changes.push('baseURL diperbarui');
    }
    if (p.options?.apiKey !== env.routerKey) {
      editor.set([...PROVIDER, 'options', 'apiKey'], env.routerKey);
      changes.push('apiKey diperbarui');
    }
    if (!isPlainObject(p.models)) {
      editor.set([...PROVIDER, 'models'], {});
      changes.push('models diinisialisasi');
    }
    return changes;
  },

  readModels(value) {
    const obj = getIn(value, [...PROVIDER, 'models']);
    const models = Object.entries(isPlainObject(obj) ? obj : {}).map(([id, m]) => ({
      id,
      name: typeof m?.name === 'string' ? m.name : undefined,
      image: m?.attachment === true || (m?.modalities?.input || []).includes('image'),
    }));
    const current = getIn(value, DEFAULT_MODEL);
    return { models, default: typeof current === 'string' ? current : null };
  },

  applyModels(editor, rows, defaultRef) {
    const models = {};
    for (const r of rows) {
      const entry = { name: r.name };
      if (r.image) {
        entry.attachment = true;
        entry.modalities = { input: ['text', 'image'], output: ['text'] };
      }
      models[r.id] = entry;
    }
    if (!sameJson(getIn(editor.value, [...PROVIDER, 'models']), models)) editor.set([...PROVIDER, 'models'], models);

    if (defaultRef && getIn(editor.value, DEFAULT_MODEL) !== defaultRef) {
      editor.set(DEFAULT_MODEL, defaultRef);
    }
  },
};
