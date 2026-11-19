// savings.js — Tabungan: target menabung yang "ditandai" di dalam sebuah pocket, plus keterangan tiap pocket.
// Saldo pocket tidak berubah saat menyetor atau mengambil; dana hanya disisihkan untuk tujuan tertentu.
import {
  doc, collection, setDoc, deleteDoc, onSnapshot, increment, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  fmtRp, parseRp, fmtTgl, parseKey, dateKey, POCKET_TYPES, SAVING_PRESETS, SAVING_ICONS, savedByPocket, savingProgress,
} from "./calc.js";

export function createSavings({ db, S, $, esc, toast }) {
  const uid = () => S.user.uid;
  const pk = (id) => S.pockets.find((p) => p.id === id);
  const tp = (p) => POCKET_TYPES[p && p.tipe] || POCKET_TYPES.lain;
  const pkIcon = (p) => (p && p.ikon) || tp(p).ikon;
  const fmtInput = (el) => { const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : ""; return n; };
  const sv = (id) => S.savings.find((x) => x.id === id);

  function listen(onChange) {
    return onSnapshot(collection(db, "users", uid(), "savings"), (s) => {
      S.savings = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
      onChange();
    }, (err) => console.error("savings:", err));
  }

  /* ---------- Tampilan ---------- */
  function renderSavings() {
    if (!S.profile) return;
    const total = S.savings.reduce((a, x) => a + (x.terkumpul || 0), 0);
    const targetTotal = S.savings.reduce((a, x) => a + (x.target || 0), 0);
    const done = S.savings.filter((x) => savingProgress(x).tercapai).length;
    $("sv-total").innerHTML = `<div class="card hc hc-saldo"><div class="hc-top"><span>🐷 Total tabungan</span>${S.eyeBtn("saldo")}</div>
      <div class="hc-big">${esc(S.mask(fmtRp(total)))}</div>
      <div class="hc-sub">${S.savings.length} target${targetTotal ? ` · dari total target ${esc(S.mask(fmtRp(targetTotal)))}` : ""}${done ? ` · ${done} tercapai 🎉` : ""}</div></div>`;

    if (!S.savings.length) {
      $("sv-list").innerHTML = `<div class="card"><div class="empty">Belum ada target tabungan.<br>Ketuk “+ Target”, misalnya Dana Darurat, Liburan, atau Gadget baru.</div></div>`;
    } else {
      $("sv-list").innerHTML = `<div class="grid2">${S.savings.map((x) => {
        const g = savingProgress(x), p = pk(x.pocketId);
        const bar = g.tercapai ? "var(--hijau)" : "var(--brand)";
        const info = g.tercapai ? "Target tercapai 🎉"
          : x.target ? `Kurang ${S.mask(fmtRp(g.sisa))}${g.perBulan ? ` · ±${S.mask(fmtRp(g.perBulan))}/bulan sampai ${fmtTgl(parseKey(x.tenggat))}` : ""}`
          : "Target nominal belum diatur";
        return `<div class="card sv-card">
          <div class="sv-head"><span class="sv-ic">${esc(x.ikon || "🎯")}</span><span>${esc(x.nama)}</span>${g.tercapai ? `<span class="sv-done">Tercapai</span>` : ""}</div>
          <div class="sv-big">${esc(S.mask(fmtRp(x.terkumpul || 0)))}</div>
          <div class="muted">${x.target ? `dari ${esc(S.mask(fmtRp(x.target)))} · ${Math.round(g.pct)}%` : "terkumpul"}</div>
          <div class="bar" style="margin-top:8px"><i style="width:${g.pct}%;background:${bar}"></i></div>
          <div class="muted" style="margin-top:6px">${esc(info)}</div>
          <span class="sv-pocket">${p ? esc(pkIcon(p) + " Disimpan di " + p.nama) : "⚠️ Pocket belum dipilih / sudah dihapus"}</span>
          ${x.keterangan ? `<div class="sv-note">${esc(x.keterangan)}</div>` : ""}
          <div class="sv-act">
            <button class="mini-btn ok" type="button" data-act="setor" data-id="${esc(x.id)}">+ Setor</button>
            <button class="mini-btn" type="button" data-act="ambil" data-id="${esc(x.id)}">− Ambil</button>
            <button class="mini-btn" type="button" data-act="edit" data-id="${esc(x.id)}" aria-label="Ubah target">✏️</button>
          </div></div>`;
      }).join("")}</div>`;
    }

    const saved = savedByPocket(S.savings);
    $("sv-pockets").innerHTML = S.pockets.length ? S.pockets.map((p) => {
      const sd = saved[p.id] || 0, saldo = p.saldo || 0, bebas = saldo - sd;
      return `<div class="pk-row"><span class="pc-ic">${esc(pkIcon(p))}</span>
        <div class="tt"><b>${esc(p.nama)}</b><span>${esc(tp(p).label)}${p.keterangan ? " · " + esc(p.keterangan) : " · belum ada keterangan"}</span></div>
        <div class="r"><b>${esc(S.mask(fmtRp(saldo)))}</b>${sd ? `ditabung ${esc(S.mask(fmtRp(sd)))}<br>` : ""}<span style="${bebas < 0 && !S.hide.saldo ? "color:var(--merah);font-weight:700" : ""}">bebas ${esc(S.mask((bebas < 0 ? "−" : "") + fmtRp(Math.abs(bebas))))}</span></div></div>`;
    }).join("") + `<div class="muted" style="padding:10px 0 4px">Keterangan pocket bisa diubah lewat menu Pocket. “Bebas” = saldo dikurangi dana yang ditandai untuk tabungan.</div>`
      : `<div class="empty">Belum ada pocket. Buat pocket dulu di menu Pocket.</div>`;
  }

  /* ---------- Form target ---------- */
  const f = { id: null, ikon: "🎯" };
  const renderIkon = () => $("sf-ikon").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === f.ikon));
  $("sf-ikon").innerHTML = SAVING_ICONS.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("sf-preset").innerHTML = SAVING_PRESETS.map(([n, i]) => `<button type="button" class="chip" data-n="${esc(n)}" data-i="${i}">${i} ${esc(n)}</button>`).join("");
  $("sf-preset").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; $("sf-nama").value = b.dataset.n; f.ikon = b.dataset.i; renderIkon(); });
  $("sf-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { f.ikon = b.dataset.i; renderIkon(); } });
  $("sf-target").addEventListener("input", () => fmtInput($("sf-target")));

  function openSheet(x) {
    if (!S.pockets.length) { toast("Buat pocket dulu di menu Pocket ya"); return; }
    f.id = x ? x.id : null; f.ikon = x ? x.ikon || "🎯" : "🎯";
    $("sf-title").textContent = x ? "Ubah target" : "Tambah target";
    $("sf-nama").value = x ? x.nama : "";
    $("sf-target").value = x && x.target ? x.target.toLocaleString("id-ID") : "";
    $("sf-pocket").innerHTML = S.pockets.map((p) => `<option value="${esc(p.id)}">${esc(pkIcon(p) + " " + p.nama)}</option>`).join("");
    $("sf-pocket").value = x && pk(x.pocketId) ? x.pocketId : S.pockets[0].id;
    $("sf-tenggat").value = x && x.tenggat ? x.tenggat : "";
    $("sf-tenggat").min = dateKey(new Date());
    $("sf-ket").value = x ? x.keterangan || "" : "";
    $("sf-preset").hidden = !!x; $("sf-delete").hidden = !x; $("sf-error").textContent = "";
    renderIkon();
    $("saving-sheet").hidden = false;
    if (!x) setTimeout(() => $("sf-nama").focus(), 50);
  }
  const closeSheet = () => { $("saving-sheet").hidden = true; };
  $("sv-add").onclick = () => openSheet(null);
  $("sf-close").onclick = closeSheet;
  $("saving-sheet").addEventListener("click", (e) => { if (e.target === $("saving-sheet")) closeSheet(); });

  $("sf-save").onclick = () => {
    const nama = $("sf-nama").value.trim().slice(0, 40), target = parseRp($("sf-target").value);
    const pocketId = $("sf-pocket").value, tenggat = $("sf-tenggat").value, keterangan = $("sf-ket").value.trim().slice(0, 80);
    const err = $("sf-error");
    if (!nama) { err.textContent = "Nama targetnya diisi dulu ya."; return; }
    if (!target) { err.textContent = "Isi nominal targetnya dulu ya."; return; }
    if (target >= 1e12) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (!pk(pocketId)) { err.textContent = "Pilih pocket penyimpannya dulu ya."; return; }
    if (S.savings.some((x) => x.id !== f.id && x.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama target ini sudah ada."; return; }
    const data = { nama, target, pocketId, ikon: f.ikon, keterangan, tenggat: tenggat || "" };
    const ref = f.id ? doc(db, "users", uid(), "savings", f.id) : doc(collection(db, "users", uid(), "savings"));
    if (!f.id) { data.terkumpul = 0; data.urutan = S.savings.length; data.createdAt = serverTimestamp(); }
    setDoc(ref, data, { merge: true }).catch((e2) => { console.error(e2); toast("Target gagal tersimpan: " + (e2.code || e2.message)); });
    closeSheet();
    toast(f.id ? "Target diperbarui" : "Target tabungan ditambahkan 🐷");
  };
  $("sf-delete").onclick = () => {
    const x = sv(f.id); if (!x) return;
    const msg = x.terkumpul ? `Hapus target “${x.nama}”? Dana ${fmtRp(x.terkumpul)} yang ditandai akan kembali menjadi saldo bebas di pocket (uangnya tidak hilang).` : `Hapus target “${x.nama}”?`;
    if (!confirm(msg)) return;
    deleteDoc(doc(db, "users", uid(), "savings", x.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeSheet(); toast("Target dihapus");
  };

  /* ---------- Setor / ambil ---------- */
  const m = { id: null, mode: "setor" };
  function openMove(x, mode) {
    m.id = x.id; m.mode = mode;
    const p = pk(x.pocketId);
    const bebas = p ? (p.saldo || 0) - (savedByPocket(S.savings)[p.id] || 0) : 0;
    $("sm-title").textContent = (mode === "setor" ? "Setor ke " : "Ambil dari ") + x.nama;
    $("sm-info").textContent = mode === "setor"
      ? `Dana disisihkan dari pocket ${p ? p.nama : "(belum dipilih)"}. Saldo bebas saat ini ${S.mask(fmtRp(bebas))}. Saldo pocket tidak berubah.`
      : `Terkumpul ${S.mask(fmtRp(x.terkumpul || 0))}. Dana yang diambil kembali menjadi saldo bebas di ${p ? p.nama : "pocket"}.`;
    $("sm-nominal").value = ""; $("sm-error").textContent = "";
    $("sm-save").textContent = mode === "setor" ? "Setor" : "Ambil";
    $("sv-move-sheet").hidden = false;
    setTimeout(() => $("sm-nominal").focus(), 50);
  }
  const closeMove = () => { $("sv-move-sheet").hidden = true; };
  $("sm-close").onclick = closeMove;
  $("sv-move-sheet").addEventListener("click", (e) => { if (e.target === $("sv-move-sheet")) closeMove(); });
  $("sm-nominal").addEventListener("input", () => fmtInput($("sm-nominal")));
  document.querySelectorAll("#sv-move-sheet .chip").forEach((b) => { b.onclick = () => { $("sm-nominal").value = Number(b.dataset.v).toLocaleString("id-ID"); }; });

  $("sm-save").onclick = () => {
    const x = sv(m.id); if (!x) return;
    const n = parseRp($("sm-nominal").value), err = $("sm-error");
    if (!n) { err.textContent = "Isi nominalnya dulu ya."; return; }
    if (n >= 1e12) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (m.mode === "ambil" && n > (x.terkumpul || 0)) { err.textContent = `Dana terkumpul hanya ${fmtRp(x.terkumpul || 0)}.`; return; }
    if (m.mode === "setor") {
      const p = pk(x.pocketId);
      if (!p) { err.textContent = "Pocket penyimpan belum dipilih. Ubah target dan pilih pocketnya."; return; }
      const bebas = (p.saldo || 0) - (savedByPocket(S.savings)[p.id] || 0);
      if (n > bebas && !confirm(`Saldo bebas ${p.nama} (${fmtRp(Math.max(0, bebas))}) kurang dari ${fmtRp(n)}. Tetap disetor?`)) return;
    }
    const delta = m.mode === "setor" ? n : -n;
    x.terkumpul = (x.terkumpul || 0) + delta; // tampil langsung, Firestore menyusul
    setDoc(doc(db, "users", uid(), "savings", x.id), { terkumpul: increment(delta) }, { merge: true })
      .catch((e2) => { console.error(e2); toast("Gagal menyimpan. Coba lagi ya."); });
    closeMove();
    renderSavings();
    toast(m.mode === "setor" ? `🐷 ${fmtRp(n)} disetor ke ${x.nama}` : `${fmtRp(n)} diambil dari ${x.nama}`);
  };

  $("sv-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const x = sv(b.dataset.id); if (!x) return;
    if (b.dataset.act === "edit") openSheet(x); else openMove(x, b.dataset.act);
  });

  (S.exporters = S.exporters || {}).Tabungan = {
    bangun: () => {
      const saved = savedByPocket(S.savings);
      const baris = S.savings.map((x) => {
        const g = savingProgress(x), p = pk(x.pocketId);
        return [x.nama, p ? p.nama : "(belum dipilih)", x.target || 0, x.terkumpul || 0, g.sisa, { v: g.pct, t: "pct" }, x.tenggat ? fmtTgl(parseKey(x.tenggat)) : "-", g.perBulan || 0, g.tercapai ? "Tercapai" : "Berjalan", x.keterangan || ""];
      });
      const pockets = S.pockets.map((p) => { const sd = saved[p.id] || 0, saldo = p.saldo || 0; return [p.nama, saldo, sd, saldo - sd]; });
      return {
        periode: `Posisi per ${fmtTgl(new Date())}`,
        sheets: [
          { nama: "Target Tabungan",
            kolom: [{ h: "Target", w: 22 }, { h: "Disimpan di", w: 16 }, { h: "Target", w: 16, t: "rp" }, { h: "Terkumpul", w: 16, t: "rp" }, { h: "Kurang", w: 16, t: "rp" }, { h: "Progres", w: 10, t: "pct" }, { h: "Tenggat", w: 13 }, { h: "Perlu / bulan", w: 15, t: "rp" }, { h: "Status", w: 11 }, { h: "Keterangan", w: 26 }],
            baris,
            ringkas: [["Total terkumpul", S.savings.reduce((a, x) => a + (x.terkumpul || 0), 0)], ["Total target", S.savings.reduce((a, x) => a + (x.target || 0), 0)]] },
          { nama: "Per Pocket",
            kolom: [{ h: "Pocket", w: 22 }, { h: "Saldo", w: 16, t: "rp" }, { h: "Ditabung", w: 16, t: "rp" }, { h: "Saldo bebas", w: 16, t: "rp" }],
            baris: pockets },
        ],
      };
    },
  };

  return { listen, renderSavings };
}