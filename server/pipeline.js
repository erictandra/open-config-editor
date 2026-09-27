// §8: backup → tulis .tmp → validasi → timpa file asli → restart → cek exit code
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { JsoncEditor, parseJsonc, sameJson } from './jsonc.js';
import { stripPrefix } from './names.js';

export async function readConfig(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`File config tidak ditemukan: ${file}`);
    throw err;
  }
}

function timestamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

function backupParts(file) {
  const ext = path.extname(file);
  return { stem: path.basename(file, ext), ext };
}

export async function backupFile(env, file) {
  await fs.mkdir(env.backupDir, { recursive: true });
  const { stem, ext } = backupParts(file);
  const dest = path.join(env.backupDir, `${stem}.${timestamp()}${ext}`);
  await fs.copyFile(file, dest);
  await pruneBackups(env, file);
  return dest;
}

async function pruneBackups(env, file) {
  if (!(env.backupKeep > 0)) return;
  const { stem, ext } = backupParts(file);
  const pattern = new RegExp(`^${escapeRe(stem)}\\.\\d{8}-\\d{6}-\\d{3}${escapeRe(ext)}$`);
  const files = (await fs.readdir(env.backupDir)).filter((f) => pattern.test(f)).sort();
  for (const f of files.slice(0, -env.backupKeep)) await fs.rm(path.join(env.backupDir, f));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Tulis via file .tmp di folder yang sama, validasi parse, lalu rename (atomic)
async function atomicWrite(file, text, label) {
  const tmp = `${file}.tmp`;
  const mode = (await fs.stat(file)).mode;
  await fs.writeFile(tmp, text, { mode });
  try {
    parseJsonc(await fs.readFile(tmp, 'utf8'), `${label} (.tmp)`);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  await fs.rename(tmp, file);
}

export function runCommand(command) {
  if (!command) return Promise.resolve({ ok: true, code: 0, output: '(tidak ada command restart)' });
  return new Promise((resolve) => {
    exec(command, { timeout: 120_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim().slice(-2000);
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, output });
    });
  });
}

// Hitung isi file baru + ringkasan perubahan tanpa menulis apa pun
export function plan(target, text, env, { rows, defaultRef }) {
  const before = parseJsonc(text, target.label);
  const editor = new JsoncEditor(text);
  const providerChanges = target.syncProvider(editor, env);
  target.applyModels(editor, rows, defaultRef);
  const after = editor.value;

  const a = target.readModels(before);
  const b = target.readModels(after);
  const oldMap = new Map(a.models.map((m) => [m.id, m]));
  const newMap = new Map(b.models.map((m) => [m.id, m]));
  return {
    text: editor.text,
    unchanged: editor.text === text,
    summary: {
      provider: providerChanges,
      added: b.models.filter((m) => !oldMap.has(m.id)).map((m) => m.id),
      removed: a.models.filter((m) => !newMap.has(m.id)).map((m) => m.id),
      changed: b.models.filter((m) => oldMap.has(m.id) && !sameJson(oldMap.get(m.id), m)).map((m) => m.id),
      defaultBefore: a.default,
      defaultAfter: b.default,
    },
  };
}

// §9: default wajib ada kalau ada model dicentang; default 9router wajib ikut dicentang
export function validateDefault(label, rows, defaultRef) {
  if (rows.length && !defaultRef) return `${label}: default model wajib dipilih`;
  const id = stripPrefix(defaultRef);
  if (id !== null && !rows.some((r) => r.id === id)) {
    return `${label}: default model "${defaultRef}" tidak dicentang, pilih ulang default`;
  }
  return null;
}

export async function generateTarget(target, env, file, command, input) {
  const result = { app: target.key, status: 'error', steps: [] };
  try {
    const text = await readConfig(file);
    const p = plan(target, text, env, input);
    result.summary = p.summary;
    if (p.unchanged) {
      result.status = 'unchanged';
      return result;
    }
    result.backup = await backupFile(env, file);
    result.steps.push('backup');
    await atomicWrite(file, p.text, target.label);
    result.steps.push('tulis');
    const cmd = await runCommand(command);
    result.command = cmd;
    result.steps.push('restart');
    result.status = cmd.ok ? 'ok' : 'restart-failed';
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

// §6 saat load: perbaiki blok provider saja (dengan backup), tanpa restart
export async function syncProviderOnLoad(target, env, file) {
  const text = await readConfig(file);
  const editor = new JsoncEditor(text);
  parseJsonc(text, target.label);
  const changes = target.syncProvider(editor, env);
  let backup = null;
  if (changes.length) {
    backup = await backupFile(env, file);
    await atomicWrite(file, editor.text, target.label);
  }
  const value = editor.value;
  return { value, changes, backup, status: target.providerStatus(value, env) };
}

export async function rollback(target, env, file, command, backupPath) {
  const resolved = path.resolve(backupPath);
  const { stem, ext } = backupParts(file);
  if (path.dirname(resolved) !== env.backupDir || !path.basename(resolved).startsWith(`${stem}.`) || !resolved.endsWith(ext)) {
    throw new Error('Path backup tidak valid');
  }
  const text = await fs.readFile(resolved, 'utf8');
  await atomicWrite(file, text, target.label);
  return { app: target.key, restored: resolved, command: await runCommand(command) };
}
