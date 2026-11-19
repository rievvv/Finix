// laporan.js — Satu jendela "Export" untuk semua menu yang berisi informasi keuangan.
// Tiap menu mendaftarkan penyusun datanya di S.exporters[nama menu]:
//   { scopes?: () => [{ k, label }], bangun: (scopeKey) => { periode, sheets } }
// Tombol export di layar cukup diberi atribut data-export="Nama Menu".
import { exportLaporan } from "./export.js";

export function createReports({ S, $, esc, toast }) {
  let aktif = null;
  const tutup = () => { $("export-sheet").hidden = true; aktif = null; };

  function buka(menu) {
    const cfg = (S.exporters || {})[menu];
    if (!cfg) { toast("Menu ini belum siap diexport"); return; }
    aktif = { menu, cfg };
    $("ex-title").textContent = `Export ${menu}`;
    const scopes = cfg.scopes ? cfg.scopes() : [];
    $("ex-wrap-scope").hidden = !scopes.length;
    $("ex-scope").innerHTML = scopes.map((s) => `<option value="${esc(s.k)}">${esc(s.label)}</option>`).join("");
    $("ex-hint").textContent = cfg.hint ? cfg.hint() : "";
    $("ex-error").textContent = "";
    $("export-sheet").hidden = false;
  }

  async function jalankan(format, btn) {
    if (!aktif) return;
    const { menu, cfg } = aktif, err = $("ex-error");
    err.textContent = "";
    let hasil;
    try { hasil = cfg.bangun($("ex-scope").value); } catch (e) { console.error(e); err.textContent = "Data belum bisa disiapkan. Coba lagi ya."; return; }
    if (!hasil || !hasil.sheets.length || !hasil.sheets[0].baris.length) { err.textContent = "Belum ada data untuk diexport pada cakupan ini."; return; }
    const lama = btn.textContent;
    $("ex-xlsx").disabled = $("ex-pdf").disabled = true; btn.textContent = "Menyiapkan file…";
    try {
      await exportLaporan({ menu, format, periode: hasil.periode, sheets: hasil.sheets });
      tutup(); toast(format === "xlsx" ? "File Excel diunduh 📊" : "File PDF diunduh 📄");
    } catch (e) {
      console.error(e); err.textContent = e.message || "Export gagal. Coba lagi ya.";
    } finally {
      $("ex-xlsx").disabled = $("ex-pdf").disabled = false; btn.textContent = lama;
    }
  }

  document.querySelectorAll("[data-export]").forEach((b) => { b.onclick = () => buka(b.dataset.export); });
  $("ex-close").onclick = tutup;
  $("export-sheet").addEventListener("click", (e) => { if (e.target === $("export-sheet")) tutup(); });
  $("ex-xlsx").onclick = () => jalankan("xlsx", $("ex-xlsx"));
  $("ex-pdf").onclick = () => jalankan("pdf", $("ex-pdf"));
}
