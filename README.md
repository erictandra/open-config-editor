# 9Router Config Manager

Web app lokal untuk mengelola daftar model 9Router di OpenClaw (`openclaw.json`) dan opencode (`opencode.jsonc`). Detail kebutuhan ada di [prd.md](prd.md).

## Menjalankan

```bash
npm install
cp .env.example .env   # isi sesuai mesin
npm start              # http://127.0.0.1:8787
npm test
```

Contoh dengan pm2: `pm2 start server/index.js --name 9router-config`

## Cara kerja singkat

- **Saat halaman dibuka:** blok provider 9Router di kedua config dicek dan diperbaiki kalau perlu (dengan backup, tanpa restart). Setelah itu daftar model diambil dari `GET {ROUTER_URL}/models` lalu digabung ke `DATA_FILE`.
- **Saat Generate:** app menampilkan ringkasan perubahan untuk dikonfirmasi. Setelah itu, untuk tiap aplikasi secara terpisah: backup → tulis `.tmp` → validasi parse → rename → restart command → cek exit code.
- **Perubahan hanya di bagian yang dikelola.** File diedit dengan `jsonc-parser` (`modify`), jadi hanya path yang dikelola yang berubah. Komentar dan bagian config lain tidak disentuh.
- **Tanpa perubahan, tanpa restart.** Kalau isi file tidak berubah, file tidak ditulis dan restart command tidak dijalankan.
- **Kalau restart gagal:** muncul tombol "Rollback dari backup", dan state di `config.json` untuk aplikasi itu tidak diupdate.

## Keputusan yang diambil (bisa diubah)

- `name` diturunkan dari segmen terakhir ID: `geraikita/claude-sonnet-5` → `Claude Sonnet 5`. Nilai ini bisa diedit di tabel.
- Hanya ada satu flag gambar (`input` di OpenClaw, `attachment`+`modalities` di opencode).
- Alias di `agents.defaults.models` hanya dikelola untuk key berawalan `9router/`. Alias provider lain tidak disentuh.
- Default model yang menunjuk provider lain bisa dipertahankan ("Tetap: …").
- `small_model` di opencode dan `fallbacks` di OpenClaw tidak dikelola.
- Rollback dilakukan manual lewat tombol, tidak otomatis.
