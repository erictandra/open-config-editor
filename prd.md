# PRD — 9Router Model Config Manager

## 1. Latar Belakang

Eric memakai 9Router sebagai proxy model lokal, dikonsumsi oleh dua aplikasi:

- **OpenClaw** (agent "inorin" di Telegram) → config di `openclaw.json`
- **opencode** (CLI coding) → config di `opencode.jsonc`

Setiap ada model baru di 9Router, Eric harus edit manual dua file JSON/JSONC yang formatnya mirip tapi tidak identik, plus menjaga field kemampuan gambar (`input` vs `attachment`+`modalities`) tetap sinkron. Proses ini rawan salah dan memakan waktu, apalagi kalau nanti setup ulang di PC lain.

## 2. Tujuan

Sebuah web app lokal (Python atau Node.js) untuk:

1. Fetch daftar model dari 9Router sekali klik
2. Menyeleksi model mana yang aktif di OpenClaw / opencode via checklist, dengan alias custom dan flag dukungan gambar
3. Menentukan **model default** untuk masing-masing aplikasi lewat select box
4. Generate ulang bagian model di kedua config secara otomatis, dengan backup dan rollback, tanpa menyentuh bagian config lain

## 3. Non-Tujuan

- Tidak mengelola isi config di luar blok provider 9Router dan model (channel Telegram, gateway, hooks, dll tidak disentuh)
- Tidak mengelola MCP image generation (dibahas sebagai fase terpisah/opsional, lihat §12)
- Tidak menyediakan sistem login sendiri (autentikasi diserahkan ke Cloudflare Access di layer luar)
- Tidak mendukung provider selain 9Router di iterasi pertama

## 4. Environment (`.env`)

```env
ROUTER_URL=http://127.0.0.1:20128/v1
ROUTER_KEY=isi-key-9router
OPENCODE_CONFIG_LOCATION=/home/asus/.config/opencode/opencode.jsonc
OPENCLAW_CONFIG_LOCATION=/home/asus/.openclaw/openclaw.json
AFTER_OPENCODE_UPDATE_COMMAND=pm2 restart opencode
AFTER_OPENCLAW_UPDATE_COMMAND=pm2 restart openclaw
BACKUP_DIR=./backup
APP_PORT=127.0.0.1:8787
```

`ROUTER_URL` dan `ROUTER_KEY` adalah **sumber kebenaran tunggal** untuk kredensial 9Router — lihat §6.

## 5. Alur Pengguna

1. Buka web app → app otomatis:
   - Cek/perbaiki blok provider 9Router di kedua config (§6)
   - Fetch daftar model terbaru dari 9Router
   - Merge ke `config.json` internal tanpa menimpa pilihan yang sudah ada (§7)
2. Tabel model tampil dengan kolom: checkbox Opencode, checkbox OpenClaw, nama model asli, textbox alias, checkbox dukungan gambar teks, checkbox dukungan gambar
3. Dua select box terpisah di atas tabel: **Default model — OpenClaw** dan **Default model — Opencode**, isinya hanya model yang sedang dicentang aktif untuk aplikasi itu
4. Eric centang/edit sesuai kebutuhan, pilih default model, klik **Generate Config**
5. Muncul dialog konfirmasi ringkasan perubahan (jumlah model ditambah/dihapus/diubah, default model baru)
6. Setelah konfirmasi, app menjalankan alur tulis (§8)
7. Hasil akhir ditampilkan: sukses/gagal per aplikasi, path backup yang dipakai

## 6. Sinkronisasi Provider 9Router (jalan otomatis tiap load & tiap generate)

Untuk **masing-masing** config (openclaw, opencode), sebelum menyentuh apa pun terkait model:

| Field | Aturan |
|---|---|
| `baseUrl` / `options.baseURL` | selalu ditimpa dengan `ROUTER_URL` dari `.env`, tanpa konfirmasi |
| `apiKey` / `options.apiKey` | selalu ditimpa dengan `ROUTER_KEY` dari `.env`, tanpa konfirmasi |
| Field lain (`api`, `npm`, `name`) | isi hanya kalau **belum ada**; kalau sudah ada, dibiarkan apa adanya |
| Blok provider tidak ada sama sekali | buat baru lengkap dari template (lihat §9) dengan `models: []` / `models: {}` kosong |

Field lain di luar tabel ini (channels, gateway, hooks, dst di openclaw; provider lain di opencode) **tidak pernah disentuh**.

## 7. Merge Model dari 9Router

- App fetch daftar model dari `ROUTER_URL` (endpoint model list 9Router)
- Untuk tiap model hasil fetch, cek apakah `id`-nya **sudah ada** di `config.json` internal:
  - **Sudah ada** → tidak diubah sama sekali (alias, checklist, flag gambar milik Eric tetap)
  - **Belum ada** → ditambahkan sebagai baris baru, default: kedua checkbox aplikasi off, alias = nama asli dari 9Router, flag gambar off
- Model yang **hilang** dari hasil fetch (misal dihapus di 9Router) tidak otomatis dihapus dari tabel — cukup ditandai dengan label "tidak ditemukan di 9Router" di UI, biar Eric yang putuskan hapus manual atau biarkan
- **Run pertama kali** (config.json belum ada): app baca dulu model + alias yang sudah ada di `openclaw.json`/`opencode.jsonc` saat ini sebagai starting point tabel (bukan mulai kosong), baru di-merge dengan hasil fetch 9Router

## 8. Alur Generate Config (setelah konfirmasi)

Dijalankan berurutan, berhenti di langkah manapun kalau gagal (tidak lanjut ke langkah berikutnya):

1. **Backup** — copy file asli ke `{BACKUP_DIR}/{nama_asli}.{timestamp}.{ext}` untuk kedua config
2. **Baca & parse** file asli pakai parser yang tahan comment/trailing comma (JSON5/JSONC), supaya bagian non-model tidak rusak
3. **Tulis ke file sementara** (`.tmp`) dulu, bukan langsung ke file asli:
   - Sinkronkan blok provider (§6)
   - Timpa isi blok model (`models.providers.9router.models` di openclaw / `provider["9router"].models` di opencode) sesuai centang di tabel
   - Set default model (`agents.defaults.model.primary` di openclaw; field default model opencode — lihat §11 asumsi yang perlu dikonfirmasi)
4. **Validasi** file `.tmp` bisa di-parse ulang tanpa error
5. **Timpa file asli** dengan file `.tmp` (baru dianggap "berhasil ditulis" di titik ini)
6. **Jalankan restart command** masing-masing (`AFTER_OPENCODE_UPDATE_COMMAND` / `AFTER_OPENCLAW_UPDATE_COMMAND`)
7. **Cek exit code** command:
   - Berhasil → lanjut simpan `config.json` (state tabel + info backup yang dipakai)
   - Gagal → tawarkan rollback otomatis dari backup di langkah 1, `config.json` **tidak** diupdate untuk aplikasi yang gagal

Openclaw dan opencode diproses sebagai dua alur independen — kalau opencode gagal, openclaw yang sudah sukses tidak ikut di-rollback.

## 9. Format Output — WAJIB Sama Persis

**OpenClaw** — dua lokasi per model:

```json
// agents.defaults.models  (key pakai prefix "9router/", hanya alias)
"9router/geraikita/claude-sonnet-5": { "alias": "Sonnet5" }

// models.providers.9router.models  (array, id TANPA prefix)
{ "id": "geraikita/claude-sonnet-5", "name": "Claude Sonnet 5 (GeraiKita)" }
{ "id": "gemini/gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite", "input": ["text", "image"] }
// "input" hanya muncul kalau flag gambar dicentang

// default model
"agents.defaults.model": { "primary": "9router/geraikita/claude-sonnet-5" }
```

**opencode** — satu lokasi per model:

```jsonc
// provider["9router"].models  (object, key TANPA prefix)
"geraikita/claude-sonnet-5": { "name": "Claude Sonnet 5 (GK)" }
"gemini/gemini-2.5-flash-lite": {
  "name": "Gemini 2.5 Flash Lite",
  "attachment": true,
  "modalities": { "input": ["text", "image"], "output": ["text"] }
}
// "attachment" + "modalities" hanya muncul kalau flag gambar dicentang
```

Aturan tambahan:
- ID model harus identik di ketiga tempat (dua di openclaw, satu di opencode), beda hanya di prefix `9router/`
- Nama tampilan (`name`) boleh beda gaya per file — bukan sumber kebenaran, cukup label
- Model yang dicentang tapi tidak dipilih jadi default → field default tidak diubah kalau model defaultnya masih ada di daftar; kalau model default lama ternyata di-uncheck, select box wajib diisi ulang sebelum generate bisa dijalankan

## 10. Sinkronisasi Provider 9Router — Template Skeleton

Kalau blok provider belum ada sama sekali:

OpenClaw:
```json
"models": {
  "providers": {
    "9router": {
      "baseUrl": "<ROUTER_URL>",
      "apiKey": "<ROUTER_KEY>",
      "api": "openai-completions",
      "models": []
    }
  }
}
```

Opencode:
```jsonc
"provider": {
  "9router": {
    "name": "9 Router",
    "npm": "@ai-sdk/openai-compatible",
    "options": {
      "baseURL": "<ROUTER_URL>",
      "apiKey": "<ROUTER_KEY>"
    },
    "models": {}
  }
}
```

## 11. Keamanan

- Server bind ke `127.0.0.1` saja
- Akses dari internet lewat Cloudflare Tunnel + Cloudflare Access (login email+password), bukan lewat sistem login aplikasi sendiri
- App **tidak pernah** menampilkan isi mentah `openclaw.json`/`opencode.jsonc` ke UI (ada field sensitif seperti `gateway.auth.password`, bot token Telegram) — UI hanya menampilkan tabel model dan status provider (misal "baseUrl: OK", tanpa expose apiKey penuh, cukup beberapa karakter terakhir)
- `.env` tidak pernah dikirim ke frontend

## 12. Hal yang Perlu Dikonfirmasi Sebelum Coding

1. **Default model opencode** — perlu dipastikan field config-nya apa (kemungkinan `"model": "9router/geraikita/..."` di root opencode.jsonc), karena contoh config opencode yang dikirim Eric belum ada bagian ini
2. **Endpoint fetch model 9Router** — perlu path pastinya (kemungkinan `GET {ROUTER_URL}/models`), dan bentuk response-nya (field apa saja yang dipakai sebagai `id`/`name`)
3. **Bahasa/stack** — Python (Flask/FastAPI) atau Node.js (Express)? Mempengaruhi pilihan library parser JSON5/JSONC
4. **Constraint tambahan** untuk select box default model: apakah boleh kosong (tidak ada default), atau wajib selalu terisi?

## 13. Fase Selanjutnya (di luar scope PRD ini)

- Section terpisah untuk kelola MCP image generation (provider Gemini/OpenAI/Seedream, API key masing-masing, aktif/tidak untuk opencode)
- Kemungkinan dukungan provider selain 9Router
