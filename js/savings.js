// savings.js — Tabungan: target menabung yang "ditandai" di dalam sebuah pocket, plus keterangan tiap pocket.
// Saldo pocket tidak berubah saat menyetor atau mengambil; dana hanya disisihkan untuk tujuan tertentu.
import {
  doc, collection, setDoc, deleteDoc, onSnapshot, increment, serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  fmtRp, parseRp, fmtTgl, parseKey, dateKey, POCKET_TYPES, SAVING_PRESETS, SAVING_ICONS, savedByPocket, savingProgress, BEBAS_ICONS, JENIS_BEBAS,
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
    const targets = S.savings.filter((x) => x.tipe !== "bebas"), free = S.savings.filter((x) => x.tipe === "bebas");
    const totalTarget = targets.reduce((a, x) => a + (x.terkumpul || 0), 0), totalFree = free.reduce((a, x) => a + (x.terkumpul || 0), 0);
    const total = totalTarget + totalFree;
    const targetTotal = targets.reduce((a, x) => a + (x.target || 0), 0);
    const done = targets.filter((x) => savingProgress(x).tercapai).length;
    $("sv-total").innerHTML = `<div class="card hc hc-saldo"><div class="hc-top"><span>🐷 Total tabungan</span>${S.eyeBtn("saldo")}</div>
      <div class="hc-big">${esc(S.mask(fmtRp(total)))}</div>
      <div class="hc-sub">${targets.length} target${targetTotal ? ` · dari total target ${esc(S.mask(fmtRp(targetTotal)))}` : ""}${done ? ` · ${done} tercapai 🎉` : ""}${free.length ? ` · tabungan bebas ${esc(S.mask(fmtRp(totalFree)))}` : ""}</div></div>`;

    // Tabungan bebas / deposito (di luar pocket)
    $("sv-free").innerHTML = free.length ? `<div class="grid2">${free.map((x) => {
      const hariTempo = x.tempo ? Math.round((parseKey(x.tempo) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000) : null;
      const info = [x.bunga ? `Bunga ${String(x.bunga).replace(".", ",")}%/tahun` : "", x.tempo ? `jatuh tempo ${fmtTgl(parseKey(x.tempo))}${hariTempo !== null ? (hariTempo >= 0 ? ` (${hariTempo} hari lagi)` : " (sudah lewat)") : ""}` : ""].filter(Boolean).join(" · ");
      return `<div class="card sv-card fr-card">
        <div class="sv-head"><span class="sv-ic">${esc(x.ikon || "🏦")}</span><span>${esc(x.nama)}</span><span class="sv-jenis">${esc(x.jenis || "Tabungan")}</span></div>
        <div class="sv-big">${esc(S.mask(fmtRp(x.terkumpul || 0)))}</div>
        ${info ? `<div class="muted" style="margin-top:6px">${esc(info)}</div>` : ""}
        ${x.keterangan ? `<div class="sv-note">${esc(x.keterangan)}</div>` : ""}
        <div class="sv-act">
          <button class="mini-btn ok" type="button" data-act="fsetor" data-id="${esc(x.id)}">+ Pindah dana</button>
          <button class="mini-btn" type="button" data-act="fambil" data-id="${esc(x.id)}">− Tarik</button>
          <button class="mini-btn" type="button" data-act="fedit" data-id="${esc(x.id)}" aria-label="Ubah">✏️</button>
        </div></div>`;
    }).join("")}</div>` : `<div class="card"><div class="empty">Belum ada tabungan bebas.<br>Ketuk “+ Tabungan bebas” untuk mencatat tabungan bank, deposito, reksa dana, atau emas.</div></div>`;

    if (!targets.length) {
      $("sv-list").innerHTML = `<div class="card"><div class="empty">Belum ada target tabungan.<br>Ketuk “+ Target”, misalnya Dana Darurat, Liburan, atau Gadget baru.</div></div>`;
    } else {
      $("sv-list").innerHTML = `<div class="grid2">${targets.map((x) => {
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

  /* ---------- Tabungan bebas / deposito ---------- */
  const fb = { id: null, jenis: "Tabungan", ikon: "🏦" };
  const hariIniKey = () => dateKey(new Date());
  const renderFb = () => {
    $("fb-ikon").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === fb.ikon));
    $("fb-jenis").querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.dataset.j === fb.jenis));
    $("fb-dep").hidden = fb.jenis !== "Deposito";
  };
  $("fb-ikon").innerHTML = BEBAS_ICONS.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("fb-jenis").innerHTML = JENIS_BEBAS.map((j) => `<button type="button" class="chip" data-j="${esc(j)}">${esc(j)}</button>`).join("");
  $("fb-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { fb.ikon = b.dataset.i; renderFb(); } });
  $("fb-jenis").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) { fb.jenis = b.dataset.j; renderFb(); } });
  $("fb-awal").addEventListener("input", () => fmtInput($("fb-awal")));
  $("fb-saldo").addEventListener("input", () => fmtInput($("fb-saldo")));

  function openFree(x) {
    fb.id = x ? x.id : null; fb.jenis = x ? x.jenis || "Tabungan" : "Tabungan"; fb.ikon = x ? x.ikon || "🏦" : "🏦";
    $("fb-title").textContent = x ? "Ubah tabungan bebas" : "Tambah tabungan bebas";
    $("fb-nama").value = x ? x.nama : "";
    $("fb-awal").value = ""; $("fb-wrap-awal").hidden = !!x;
    $("fb-saldo").value = x && x.terkumpul ? x.terkumpul.toLocaleString("id-ID") : ""; $("fb-wrap-saldo").hidden = !x;
    $("fb-bunga").value = x && x.bunga ? x.bunga : ""; $("fb-tempo").value = x && x.tempo ? x.tempo : "";
    $("fb-ket").value = x ? x.keterangan || "" : "";
    $("fb-delete").hidden = !x; $("fb-error").textContent = "";
    const riw = x && Array.isArray(x.riwayat) ? x.riwayat : [];
    const label = { setor: "Pindah dari", ambil: "Ditarik ke", awal: "Saldo awal", koreksi: "Koreksi saldo" };
    $("fb-hist").innerHTML = riw.length ? `<div class="muted" style="font-weight:600;margin-bottom:6px">Riwayat terakhir</div>` + riw.slice(0, 8).map((r) => {
      const p = pk(r.pocketId);
      return `<div class="txd-row"><span>${esc(fmtTgl(parseKey(r.tgl)))} · ${esc(label[r.j] || r.j)}${p && (r.j === "setor" || r.j === "ambil") ? " " + esc(p.nama) : ""}</span><b>${r.j === "ambil" || (r.j === "koreksi" && r.n < 0) ? "−" : "+"}${esc(fmtRp(Math.abs(r.n)))}</b></div>`;
    }).join("") : "";
    renderFb();
    $("free-sheet").hidden = false;
    if (!x) setTimeout(() => $("fb-nama").focus(), 50);
  }
  const closeFree = () => { $("free-sheet").hidden = true; };
  $("sb-add").onclick = () => openFree(null);
  $("fb-close").onclick = closeFree;
  $("free-sheet").addEventListener("click", (e) => { if (e.target === $("free-sheet")) closeFree(); });

  $("fb-save").onclick = () => {
    const err = $("fb-error"), x = fb.id ? sv(fb.id) : null;
    const nama = $("fb-nama").value.trim().slice(0, 40), keterangan = $("fb-ket").value.trim().slice(0, 80);
    const bunga = Number($("fb-bunga").value) || 0, tempo = fb.jenis === "Deposito" ? $("fb-tempo").value : "";
    const saldo = parseRp(x ? $("fb-saldo").value : $("fb-awal").value);
    if (!nama) { err.textContent = "Namanya diisi dulu ya."; return; }
    if (saldo >= 1e12) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (bunga < 0 || bunga > 100) { err.textContent = "Bunga antara 0 sampai 100 persen ya."; return; }
    if (S.savings.some((y) => y.id !== fb.id && y.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama ini sudah ada."; return; }
    const data = { tipe: "bebas", nama, jenis: fb.jenis, ikon: fb.ikon, keterangan, bunga: fb.jenis === "Deposito" ? bunga : 0, tempo: tempo || "" };
    const ref = x ? doc(db, "users", uid(), "savings", x.id) : doc(collection(db, "users", uid(), "savings"));
    let riwayat = x && Array.isArray(x.riwayat) ? x.riwayat : [];
    if (x) {
      const selisih = saldo - (x.terkumpul || 0);
      data.terkumpul = saldo;
      if (selisih) riwayat = [{ tgl: hariIniKey(), j: "koreksi", n: selisih }].concat(riwayat).slice(0, 20);
    } else {
      data.terkumpul = saldo; data.urutan = S.savings.length; data.createdAt = serverTimestamp();
      if (saldo) riwayat = [{ tgl: hariIniKey(), j: "awal", n: saldo }];
    }
    data.riwayat = riwayat;
    setDoc(ref, data, { merge: true }).catch((e2) => { console.error(e2); toast("Gagal tersimpan: " + (e2.code || e2.message)); });
    closeFree();
    toast(x ? "Tabungan diperbarui" : `${fb.ikon} ${nama} ditambahkan`);
  };
  $("fb-delete").onclick = () => {
    const x = sv(fb.id); if (!x) return;
    const msg = x.terkumpul ? `Hapus “${x.nama}”? Saldo tercatat ${fmtRp(x.terkumpul)} akan ikut terhapus dan TIDAK dikembalikan ke pocket. Kalau dana mau dipakai lagi, tarik dulu ke pocket. Tetap hapus?` : `Hapus “${x.nama}”?`;
    if (!confirm(msg)) return;
    deleteDoc(doc(db, "users", uid(), "savings", x.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeFree(); toast("Tabungan dihapus");
  };
  $("sv-free").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const x = sv(b.dataset.id); if (!x) return;
    if (b.dataset.act === "fedit") openFree(x); else openMove(x, b.dataset.act === "fsetor" ? "setor" : "ambil");
  });

  /* ---------- Setor / ambil ---------- */
  const m = { id: null, mode: "setor" };
  function openMove(x, mode) {
    m.id = x.id; m.mode = mode;
    const bebasTipe = x.tipe === "bebas";
    $("sm-wrap-pocket").hidden = !bebasTipe;
    if (bebasTipe) {
      $("sm-pocket-lbl").textContent = mode === "setor" ? "Dipindah dari pocket" : "Dikembalikan ke pocket";
      $("sm-pocket").innerHTML = S.pockets.map((p) => `<option value="${esc(p.id)}">${esc(pkIcon(p) + " " + p.nama)} · ${esc(S.mask(fmtRp(p.saldo || 0)))}</option>`).join("");
      $("sm-title").textContent = (mode === "setor" ? "Pindah dana ke " : "Tarik dari ") + x.nama;
      $("sm-info").textContent = mode === "setor"
        ? "Saldo pocket berkurang sebesar nominal ini, lalu masuk ke tabungan. Ini bukan pengeluaran, jadi tidak mengurangi anggaran."
        : `Saldo ${x.nama} saat ini ${S.mask(fmtRp(x.terkumpul || 0))}. Dana yang ditarik menambah saldo pocket yang dipilih.`;
      $("sm-nominal").value = ""; $("sm-error").textContent = "";
      $("sm-save").textContent = mode === "setor" ? "Pindahkan" : "Tarik";
      $("sv-move-sheet").hidden = false;
      setTimeout(() => $("sm-nominal").focus(), 50);
      return;
    }
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
    if (x.tipe === "bebas") {
      const p = pk($("sm-pocket").value);
      if (!p) { err.textContent = "Pilih pocketnya dulu ya."; return; }
      if (m.mode === "ambil" && n > (x.terkumpul || 0)) { err.textContent = `Saldo tabungan hanya ${fmtRp(x.terkumpul || 0)}.`; return; }
      if (m.mode === "setor" && n > (p.saldo || 0) && !confirm(`Saldo ${p.nama} (${fmtRp(Math.max(0, p.saldo || 0))}) kurang dari ${fmtRp(n)}. Tetap dipindah?`)) return;
      const delta = m.mode === "setor" ? n : -n;
      const riwayat = [{ tgl: hariIniKey(), j: m.mode, n, pocketId: p.id }].concat(Array.isArray(x.riwayat) ? x.riwayat : []).slice(0, 20);
      const batch = writeBatch(db);
      batch.update(doc(db, "users", uid(), "pockets", p.id), { saldo: increment(-delta) });
      batch.set(doc(db, "users", uid(), "savings", x.id), { terkumpul: increment(delta), riwayat }, { merge: true });
      x.terkumpul = (x.terkumpul || 0) + delta; x.riwayat = riwayat; p.saldo = (p.saldo || 0) - delta; // tampil langsung, Firestore menyusul
      batch.commit().catch((e2) => { console.error(e2); toast("Gagal menyimpan. Coba lagi ya."); });
      closeMove(); renderSavings();
      toast(m.mode === "setor" ? `🏦 ${fmtRp(n)} dipindah dari ${p.nama} ke ${x.nama}` : `${fmtRp(n)} ditarik dari ${x.nama} ke ${p.nama}`);
      return;
    }
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
      const baris = S.savings.filter((x) => x.tipe !== "bebas").map((x) => {
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
            ringkas: [["Total terkumpul", S.savings.filter((x) => x.tipe !== "bebas").reduce((a, x) => a + (x.terkumpul || 0), 0)], ["Total target", S.savings.filter((x) => x.tipe !== "bebas").reduce((a, x) => a + (x.target || 0), 0)]] },
          { nama: "Per Pocket",
            kolom: [{ h: "Pocket", w: 22 }, { h: "Saldo", w: 16, t: "rp" }, { h: "Ditabung", w: 16, t: "rp" }, { h: "Saldo bebas", w: 16, t: "rp" }],
            baris: pockets },
          ...(S.savings.some((x) => x.tipe === "bebas") ? [{ nama: "Tabungan Bebas",
            kolom: [{ h: "Nama", w: 24 }, { h: "Jenis", w: 12 }, { h: "Saldo", w: 16, t: "rp" }, { h: "Bunga %/th", w: 12, t: "angka" }, { h: "Jatuh tempo", w: 13 }, { h: "Keterangan", w: 26 }],
            baris: S.savings.filter((x) => x.tipe === "bebas").map((x) => [x.nama, x.jenis || "Tabungan", x.terkumpul || 0, x.bunga || 0, x.tempo ? fmtTgl(parseKey(x.tempo)) : "-", x.keterangan || ""]),
            ringkas: [["Total tabungan bebas", S.savings.filter((x) => x.tipe === "bebas").reduce((a, x) => a + (x.terkumpul || 0), 0)]] }] : []),
        ],
      };
    },
  };

  return { listen, renderSavings };
}