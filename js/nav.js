// nav.js — Tombol / gestur "kembali" di HP: menutup pop-up yang terbuka, lalu kembali ke layar sebelumnya,
// dan baru keluar dari aplikasi kalau sudah di Dashboard (dengan konfirmasi geser sekali lagi).
//
// Caranya: browser selalu punya satu entri riwayat "penjaga" di depan entri awal. Saat tombol kembali ditekan,
// penjaga itu yang terbuang, aplikasi bereaksi (tutup pop-up / pindah layar), lalu memasang penjaga baru.
export function initBackNav({ getScreen, goTo, toast }) {
  const stack = [];            // urutan layar menu yang dikunjungi
  const AKAR = "dashboard";
  const TANPA_NAV = ["auth", "onboard"];
  let aktif = false, siapKeluar = false, timer = null;

  const pasangPenjaga = () => { try { history.pushState({ finix: 1 }, ""); } catch { /* abaikan */ } };
  function mulai() {
    if (aktif) return;
    aktif = true;
    try { history.replaceState({ finixAwal: 1 }, ""); } catch { /* abaikan */ }
    pasangPenjaga();
  }

  // Dipanggil setiap kali layar berganti
  function catat(nama) {
    siapKeluar = false;
    if (TANPA_NAV.includes(nama)) { stack.length = 0; return; }
    mulai();
    const i = stack.indexOf(nama);
    if (i >= 0) stack.length = i + 1; else stack.push(nama);
    if (stack.length > 12) stack.shift();
  }

  const popupTeratas = () => [...document.querySelectorAll(".sheet-wrap")].filter((el) => !el.hidden).pop() || null;
  function tutup(el) {
    const tombol = el.querySelector("[id$='-close'], .sheet-head button");
    if (tombol) tombol.click();
    if (!el.hidden) el.hidden = true;
  }
  function keluar() { aktif = false; try { history.back(); } catch { /* abaikan */ } }

  window.addEventListener("popstate", () => {
    if (!aktif) return;
    const popup = popupTeratas();
    if (popup) { tutup(popup); pasangPenjaga(); return; }
    const sekarang = getScreen();
    if (TANPA_NAV.includes(sekarang)) { keluar(); return; }
    if (stack.length > 1) { stack.pop(); goTo(stack[stack.length - 1]); pasangPenjaga(); return; }
    if (sekarang !== AKAR) { goTo(AKAR); pasangPenjaga(); return; }
    if (siapKeluar) { keluar(); return; }
    siapKeluar = true;
    toast("Geser kembali sekali lagi untuk keluar");
    clearTimeout(timer); timer = setTimeout(() => { siapKeluar = false; }, 2500);
    pasangPenjaga();
  });

  return { catat };
}
