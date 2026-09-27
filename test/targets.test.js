import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openclaw } from '../server/targets/openclaw.js';
import { opencode } from '../server/targets/opencode.js';
import { plan, validateDefault } from '../server/pipeline.js';
import { parseJsonc } from '../server/jsonc.js';
import { prettyName } from '../server/names.js';
import { stateFromConfigs, mergeRouterModels, addManualModel } from '../server/state.js';

const env = { routerUrl: 'http://127.0.0.1:20128/v1', routerKey: 'new-key' };

const OPENCLAW = `{
  // channel telegram, jangan disentuh
  "channels": { "telegram": { "botToken": "secret" } },
  "agents": {
    "defaults": {
      "model": { "primary": "9router/old/model", "fallbacks": ["anthropic/claude"] },
      "models": {
        "9router/old/model": { "alias": "Old" },
        "anthropic/claude": { "alias": "Claude" }
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://old",
        "apiKey": "old-key",
        "api": "custom-api",
        "models": [{ "id": "old/model", "name": "Old" }]
      }
    }
  }
}
`;

const OPENCODE = `{
  "$schema": "https://opencode.ai/config.json",
  // provider lain
  "provider": {
    "other": { "npm": "x", "models": {} },
    "9router": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://old", "apiKey": "old-key" },
      "models": {
        "old/model": { "name": "Old" }, // trailing comment
      },
    },
  },
}
`;

const ROWS = [
  { id: 'geraikita/claude-sonnet-5', name: 'Claude Sonnet 5', alias: 'Sonnet5', image: false },
  { id: 'gemini/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', alias: 'Flash', image: true },
];

test('prettyName dari id', () => {
  assert.equal(prettyName('geraikita/claude-sonnet-5'), 'Claude Sonnet 5');
  assert.equal(prettyName('gemini/gemini-2.5-flash-lite'), 'Gemini 2.5 Flash Lite');
});

test('openclaw: format output §9 dan bagian lain utuh', () => {
  const p = plan(openclaw, OPENCLAW, env, { rows: ROWS, defaultRef: '9router/geraikita/claude-sonnet-5' });
  const v = parseJsonc(p.text);
  const prov = v.models.providers['9router'];
  assert.equal(prov.baseUrl, env.routerUrl);
  assert.equal(prov.apiKey, env.routerKey);
  assert.equal(prov.api, 'custom-api', 'field yang sudah ada tidak ditimpa');
  assert.deepEqual(prov.models, [
    { id: 'geraikita/claude-sonnet-5', name: 'Claude Sonnet 5' },
    { id: 'gemini/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', input: ['text', 'image'] },
  ]);
  assert.deepEqual(v.agents.defaults.models, {
    'anthropic/claude': { alias: 'Claude' },
    '9router/geraikita/claude-sonnet-5': { alias: 'Sonnet5' },
    '9router/gemini/gemini-2.5-flash-lite': { alias: 'Flash' },
  });
  assert.deepEqual(v.agents.defaults.model, {
    primary: '9router/geraikita/claude-sonnet-5',
    fallbacks: ['anthropic/claude'],
  });
  assert.equal(v.channels.telegram.botToken, 'secret');
  assert.match(p.text, /\/\/ channel telegram, jangan disentuh/);
  assert.deepEqual(p.summary.added, ROWS.map((r) => r.id));
  assert.deepEqual(p.summary.removed, ['old/model']);
});

test('opencode: format output §9, komentar & provider lain utuh', () => {
  const p = plan(opencode, OPENCODE, env, { rows: ROWS, defaultRef: '9router/gemini/gemini-2.5-flash-lite' });
  const v = parseJsonc(p.text);
  const prov = v.provider['9router'];
  assert.equal(prov.name, '9 Router', 'name diisi kalau belum ada');
  assert.deepEqual(prov.options, { baseURL: env.routerUrl, apiKey: env.routerKey });
  assert.deepEqual(prov.models, {
    'geraikita/claude-sonnet-5': { name: 'Claude Sonnet 5' },
    'gemini/gemini-2.5-flash-lite': {
      name: 'Gemini 2.5 Flash Lite',
      attachment: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
    },
  });
  assert.equal(v.model, '9router/gemini/gemini-2.5-flash-lite');
  assert.deepEqual(v.provider.other, { npm: 'x', models: {} });
  assert.match(p.text, /\/\/ provider lain/);
});

test('provider belum ada → dibuat dari template §10', () => {
  const oc = parseJsonc(plan(openclaw, '{}', env, { rows: [], defaultRef: null }).text);
  assert.deepEqual(oc.models.providers['9router'], {
    baseUrl: env.routerUrl, apiKey: env.routerKey, api: 'openai-completions', models: [],
  });
  const od = parseJsonc(plan(opencode, '{}', env, { rows: [], defaultRef: null }).text);
  assert.deepEqual(od.provider['9router'], {
    name: '9 Router', npm: '@ai-sdk/openai-compatible',
    options: { baseURL: env.routerUrl, apiKey: env.routerKey }, models: {},
  });
  assert.equal(od.model, undefined);
});

test('generate kedua kali tanpa perubahan → unchanged', () => {
  const first = plan(opencode, OPENCODE, env, { rows: ROWS, defaultRef: '9router/geraikita/claude-sonnet-5' });
  const second = plan(opencode, first.text, env, { rows: ROWS, defaultRef: '9router/geraikita/claude-sonnet-5' });
  assert.equal(second.unchanged, true);
});

test('validasi default model', () => {
  assert.match(validateDefault('X', ROWS, null), /wajib/);
  assert.match(validateDefault('X', ROWS, '9router/old/model'), /tidak dicentang/);
  assert.equal(validateDefault('X', ROWS, '9router/geraikita/claude-sonnet-5'), null);
  assert.equal(validateDefault('X', ROWS, 'anthropic/claude'), null);
  assert.equal(validateDefault('X', [], null), null);
});

test('state run pertama dari config + merge 9Router', () => {
  const state = stateFromConfigs({
    openclaw: openclaw.readModels(parseJsonc(OPENCLAW)),
    opencode: opencode.readModels(parseJsonc(OPENCODE)),
  });
  assert.deepEqual(state.models, [
    { id: 'old/model', name: 'Old', alias: 'Old', image: false, openclaw: true, opencode: true },
  ]);
  assert.equal(state.defaults.openclaw, '9router/old/model');

  state.models[0].alias = 'Custom';
  const added = mergeRouterModels(state, ['old/model', 'geraikita/claude-sonnet-5']);
  assert.deepEqual(added, ['geraikita/claude-sonnet-5']);
  assert.equal(state.models[0].alias, 'Custom', 'baris lama tidak diubah');
  assert.deepEqual(state.models[1], {
    id: 'geraikita/claude-sonnet-5', name: 'Claude Sonnet 5', alias: 'Claude Sonnet 5',
    image: false, openclaw: false, opencode: false,
  });
});

test('tambah model manual', () => {
  const state = { models: [{ id: 'a/b', name: 'B', alias: 'B', image: false, openclaw: true, opencode: false }] };
  const r1 = addManualModel(state, 'gemini/gemini-2.5-flash-lite');
  assert.equal(r1.created, true);
  assert.deepEqual(state.models[0], {
    id: 'gemini/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', alias: 'Gemini 2.5 Flash Lite',
    image: false, openclaw: false, opencode: false, manual: true,
  });
  const r2 = addManualModel(state, 'a/b', 'X');
  assert.equal(r2.created, false);
  assert.equal(state.models[1].manual, true);
  assert.equal(state.models[1].name, 'B', 'baris yang sudah ada tidak diubah');
  assert.equal(mergeRouterModels(state, ['gemini/gemini-2.5-flash-lite']).length, 0);
});
