import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Env ${name} wajib diisi (lihat .env.example)`);
  return value;
}

function parseListen(raw) {
  const value = (raw || '8787').trim();
  const idx = value.lastIndexOf(':');
  if (idx === -1) return { host: '127.0.0.1', port: Number(value) };
  return { host: value.slice(0, idx) || '127.0.0.1', port: Number(value.slice(idx + 1)) };
}

export function loadEnv() {
  return {
    routerUrl: required('ROUTER_URL').replace(/\/+$/, ''),
    routerKey: required('ROUTER_KEY'),
    opencodePath: required('OPENCODE_CONFIG_LOCATION'),
    openclawPath: required('OPENCLAW_CONFIG_LOCATION'),
    opencodeCommand: process.env.AFTER_OPENCODE_UPDATE_COMMAND || '',
    openclawCommand: process.env.AFTER_OPENCLAW_UPDATE_COMMAND || '',
    backupDir: path.resolve(process.env.BACKUP_DIR || './backup'),
    backupKeep: Number(process.env.BACKUP_KEEP || 20),
    dataFile: path.resolve(process.env.DATA_FILE || './data/config.json'),
    listen: parseListen(process.env.APP_PORT),
  };
}
