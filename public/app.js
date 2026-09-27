const APPS = ['openclaw', 'opencode'];
const LABEL = { openclaw: 'OpenClaw', opencode: 'opencode' };
const PREFIX = '9router/';

let rows = [];
let defaults = { openclaw: null, opencode: null };
let currentDefaults = {};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function load() {
  $('#status').innerHTML = '<span class="chip muted">Memuat…</span>';
  try {
    const data = await api('/api/state');
    rows = data.models;
    defaults = { ...data.defaults };
    currentDefaults = data.currentDefaults;
    renderStatus(data);
    renderDefaults();
    renderRows();
  } catch (err) {
    $('#status').innerHTML = `<span class="chip err">${esc(err.message)}</span>`;
  }
}

function renderStatus({ router, providers, applied }) {
  const chips = [];
  if (router.ok) {
    const added = router.added.length ? ` · <span class="warn">+${router.added.length} baru</span>` : '';
    chips.push(`<span class="chip"><b>9Router</b><span class="ok">OK</span> · ${router.count} model${added}</span>`);
  } else {
    chips.push(`<span class="chip"><b>9Router</b><span class="err">${esc(router.error)}</span></span>`);
  }
  for (const app of APPS) {
    const p = providers[app];
    let body;
    if (p.error) body = `<span class="err">${esc(p.error)}</span>`;
    else {
      const mark = (ok) => (ok ? '<span class="ok">OK</span>' : '<span class="err">beda</span>');
      body = `baseUrl: ${mark(p.baseUrlOk)} · apiKey: ${mark(p.apiKeyOk)} (…${esc(p.apiKeyTail ?? '')})`;
      if (p.fixed?.length) body += ` · <span class="warn" title="Backup: ${esc(p.backup)}">diperbaiki: ${esc(p.fixed.join(', '))}</span>`;
    }
    const last = applied?.[app]?.at ? ` · <span class="muted">generate terakhir ${new Date(applied[app].at).toLocaleString()}</span>` : '';
    chips.push(`<span class="chip"><b>${LABEL[app]}</b>${body}${last}</span>`);
  }
  $('#status').innerHTML = chips.join('');
}

function defaultProblem(app) {
  const checked = rows.filter((r) => r[app]);
  const d = defaults[app];
  if (checked.length && !d) return 'wajib dipilih';
  if (d?.startsWith(PREFIX) && !checked.some((r) => PREFIX + r.id === d)) return 'model tidak dicentang';
  return null;
}

function renderDefaults() {
  for (const app of APPS) {
    const sel = $(`#default-${app}`);
    const d = defaults[app];
    const opts = ['<option value="">— pilih —</option>'];
    // Default ke provider lain (bukan 9router) tetap bisa dipertahankan
    const foreign = [d, currentDefaults[app]].find((v) => v && !v.startsWith(PREFIX));
    if (foreign) opts.push(`<option value="${esc(foreign)}">Tetap: ${esc(foreign)} (bukan 9Router)</option>`);
    const checked = rows.filter((r) => r[app]);
    if (d?.startsWith(PREFIX) && !checked.some((r) => PREFIX + r.id === d)) {
      opts.push(`<option value="${esc(d)}">⚠ ${esc(d)} (tidak dicentang)</option>`);
    }
    for (const r of checked) {
      opts.push(`<option value="${esc(PREFIX + r.id)}">${esc(r.alias || r.name)} — ${esc(r.id)}</option>`);
    }
    sel.innerHTML = opts.join('');
    sel.value = d || '';
    sel.classList.toggle('invalid', !!defaultProblem(app));
    sel.title = defaultProblem(app) || '';
  }
  const counts = APPS.map((a) => `${LABEL[a]}: ${rows.filter((r) => r[a]).length}`).join(' · ');
  $('#counts').textContent = `${rows.length} model · aktif ${counts}`;
}

function renderRows() {
  const q = $('#filter').value.trim().toLowerCase();
  const onlyActive = $('#only-active').checked;
  const html = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !onlyActive || r.openclaw || r.opencode)
    .filter(({ r }) => !q || [r.id, r.name, r.alias].some((v) => v?.toLowerCase().includes(q)))
    .map(({ r, i }) => {
      const missing = r.missing ? '<span class="badge warn">tidak ditemukan di 9Router</span>' : '';
      const del = r.missing && !r.openclaw && !r.opencode
        ? `<button class="small ghost" data-del="${i}" title="Hapus dari tabel">Hapus</button>` : '';
      return `<tr class="${r.missing ? 'missing' : ''}">
        <td class="c"><input type="checkbox" data-i="${i}" data-f="opencode" ${r.opencode ? 'checked' : ''}></td>
        <td class="c"><input type="checkbox" data-i="${i}" data-f="openclaw" ${r.openclaw ? 'checked' : ''}></td>
        <td class="id">${esc(r.id)}${missing}</td>
        <td><input type="text" data-i="${i}" data-f="name" value="${esc(r.name)}"></td>
        <td><input type="text" data-i="${i}" data-f="alias" value="${esc(r.alias)}"></td>
        <td class="c"><input type="checkbox" data-i="${i}" data-f="image" ${r.image ? 'checked' : ''}></td>
        <td class="c">${del}</td>
      </tr>`;
    });
  $('#rows').innerHTML = html.join('') || '<tr><td colspan="7" class="muted">Tidak ada model.</td></tr>';
}

$('#rows').addEventListener('input', (e) => {
  const { i, f } = e.target.dataset;
  if (i === undefined) return;
  rows[i][f] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (['openclaw', 'opencode', 'alias'].includes(f)) renderDefaults();
});

$('#rows').addEventListener('click', async (e) => {
  const i = e.target.dataset.del;
  if (i === undefined) return;
  if (!confirm(`Hapus ${rows[i].id} dari tabel?`)) return;
  try {
    await api('/api/models/delete', { id: rows[i].id });
    rows.splice(i, 1);
    renderRows();
    renderDefaults();
  } catch (err) {
    alert(err.message);
  }
});

for (const app of APPS) {
  $(`#default-${app}`).addEventListener('change', (e) => {
    defaults[app] = e.target.value || null;
    renderDefaults();
  });
}
$('#filter').addEventListener('input', renderRows);
$('#only-active').addEventListener('change', renderRows);
$('#reload').addEventListener('click', load);

function payload() {
  return {
    models: rows.map(({ id, name, alias, image, openclaw, opencode }) => ({ id, name, alias, image, openclaw, opencode })),
    defaults,
  };
}

function list(title, items) {
  if (!items?.length) return '';
  return `<h3>${esc(title)} (${items.length})</h3><ul>${items.map((x) => `<li><code>${esc(x)}</code></li>`).join('')}</ul>`;
}

$('#generate').addEventListener('click', async () => {
  const btn = $('#generate');
  btn.disabled = true;
  try {
    const { errors, plans } = await api('/api/preview', payload());
    if (errors.length) return alert(errors.join('\n'));
    $('#confirm-body').innerHTML = APPS.map((app) => {
      const p = plans[app];
      if (p.error) return `<h3>${LABEL[app]}</h3><p class="err">${esc(p.error)}</p>`;
      if (p.unchanged) return `<h3>${LABEL[app]}</h3><p class="muted">Tidak ada perubahan (tidak ditulis, tidak di-restart).</p>`;
      const def = p.defaultBefore === p.defaultAfter
        ? `<p>Default: <code>${esc(p.defaultAfter ?? '-')}</code> (tetap)</p>`
        : `<p>Default: <code>${esc(p.defaultBefore ?? '-')}</code> → <b><code>${esc(p.defaultAfter)}</code></b></p>`;
      const prov = p.provider.length ? `<p class="warn">Provider: ${esc(p.provider.join(', '))}</p>` : '';
      return `<h3>${LABEL[app]}</h3>${prov}${def}
        ${list('Ditambah', p.added)}${list('Dihapus', p.removed)}${list('Diubah', p.changed)}`;
    }).join('');
    const dlg = $('#confirm');
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', async () => {
      if (dlg.returnValue === 'ok') await runGenerate();
    }, { once: true });
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

async function runGenerate() {
  const out = $('#results');
  out.innerHTML = '<div class="result muted">Menulis config & menjalankan restart…</div>';
  try {
    const { results } = await api('/api/generate', payload());
    out.innerHTML = APPS.map((app) => renderResult(results[app])).join('');
    await load();
  } catch (err) {
    out.innerHTML = `<div class="result err">${esc(err.message)}</div>`;
  }
}

function renderResult(r) {
  const status = {
    ok: '<span class="ok">Berhasil</span>',
    unchanged: '<span class="muted">Tidak ada perubahan</span>',
    'restart-failed': '<span class="err">Config ditulis, tapi restart gagal</span>',
    error: '<span class="err">Gagal (file asli tidak diubah)</span>',
  }[r.status];
  const backup = r.backup ? `<div>Backup: <code>${esc(r.backup)}</code></div>` : '';
  const error = r.error ? `<div class="err">${esc(r.error)}</div>` : '';
  const cmd = r.command ? `<pre>exit ${r.command.code}\n${esc(r.command.output)}</pre>` : '';
  const rb = r.status === 'restart-failed' && r.backup
    ? `<button class="small" data-rollback="${esc(r.app)}" data-backup="${esc(r.backup)}">Rollback dari backup</button>` : '';
  return `<div class="result"><b>${LABEL[r.app]}</b>: ${status}${backup}${error}${cmd}${rb}</div>`;
}

$('#results').addEventListener('click', async (e) => {
  const { rollback: app, backup } = e.target.dataset;
  if (!app) return;
  if (!confirm(`Kembalikan ${LABEL[app]} dari ${backup} lalu jalankan restart?`)) return;
  e.target.disabled = true;
  try {
    const r = await api('/api/rollback', { app, backup });
    e.target.insertAdjacentHTML('afterend',
      `<div>${r.command.ok ? '<span class="ok">Rollback berhasil</span>' : '<span class="err">Rollback ditulis, restart masih gagal</span>'}<pre>${esc(r.command.output)}</pre></div>`);
    await load();
  } catch (err) {
    alert(err.message);
    e.target.disabled = false;
  }
});

load();
