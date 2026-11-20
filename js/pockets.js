// pockets.js — Pocket (Bank, E-Wallet, E-Money, Cash), catat transaksi (keluar / masuk / transfer / tarik tunai) dan riwayat.
import {
  doc, collection, writeBatch, setDoc, deleteDoc, onSnapshot, increment, serverTimestamp, Timestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  fmtRp, parseRp, dateKey, fmtTgl, parseKey, prevCycle, splitSalary, savedByPocket,
  POCKET_TYPES, POCKET_PRESETS, DEFAULT_POCKETS, INCOME_CATEGORIES, CAT_ADMIN, HARI_PANJANG, BULAN_PANJANG, IKON_UMUM, getCycle,
} from "./calc.js";

export function createPockets({ db, S, $, esc, toast }) {
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
  };
  const uid = () => S.user.uid;
  const pk = (id) => S.pockets.find((p) => p.id === id);
  const tp = (p) => POCKET_TYPES[p && p.tipe] || POCKET_TYPES.lain;
  const pkIcon = (p) => (p && p.ikon) || tp(p).ikon;
  const pkLabel = (id) => { const p = pk(id); return p ? `${pkIcon(p)} ${p.nama}` : "Tanpa pocket"; };
  const totalSaldo = () => S.pockets.reduce((a, p) => a + (p.saldo || 0), 0);
  const today0 = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const fmtInput = (el) => { const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : ""; return n; };
  const harianEnv = () => (S.envelopes.find((e) => e.untukHarian) || S.envelopes[0] || {}).id;
  const catOf = (t) => (t.jenis === "masuk"
    ? INCOME_CATEGORIES.find((c) => c.id === t.categoryId) || { ikon: "➕", nama: "Pemasukan" }
    : [...S.categories, CAT_ADMIN].find((c) => c.id === t.categoryId) || { ikon: "💸", nama: "Lainnya" });
  const millis = (t) => (t.tanggal && t.tanggal.toMillis ? t.tanggal.toMillis() : 0);

  /* ---------- Berlangganan data pocket (+ pocket awal untuk akun baru) ---------- */
  function listen(onChange) {
    return onSnapshot(collection(db, "users", uid(), "pockets"), (s) => {
      S.pockets = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
      if (s.empty && !s.metadata.fromCache && S.profile && !S.profile.pocketSeeded) {
        S.profile.pocketSeeded = true; // hanya sekali; kalau kamu hapus semua pocket, tidak dibuat ulang
        const batch = writeBatch(db);
        DEFAULT_POCKETS.forEach((p, i) => batch.set(doc(db, "users", uid(), "pockets", p.id), { ...p, urutan: i }));
        batch.set(doc(db, "users", uid()), { pocketSeeded: true }, { merge: true });
        batch.commit().catch(console.error);
      }
      onChange();
    }, (err) => console.error("pockets:", err));
  }

  /* ---------- Baris transaksi (dipakai Dashboard & Riwayat) ---------- */
  function rowHtml(t, withDel) {
    const when = t.tanggal && t.tanggal.toDate ? fmtTgl(t.tanggal.toDate()) : "";
    let ic, title, sub, nom, cls;
    if (t.jenis === "transfer" || t.jenis === "tarik") {
      ic = t.jenis === "tarik" ? "🏧" : "🔁"; title = t.jenis === "tarik" ? "Tarik tunai" : "Transfer";
      sub = `${pkLabel(t.pocketId)} → ${pkLabel(t.pocketTujuanId)}`; nom = fmtRp(t.nominal); cls = "n-neu";
    } else {
      const c = catOf(t); ic = c.ikon; title = c.nama;
      sub = `${t.jenis === "masuk" ? "ke" : "dari"} ${pkLabel(t.pocketId)}`;
      nom = (t.jenis === "masuk" ? "+" : "−") + fmtRp(t.nominal); cls = t.jenis === "masuk" ? "n-in" : "n-out";
    }
    return `<div class="tx" data-tx="${esc(t.id)}"><div class="ic">${esc(ic)}</div>
      <div class="tt"><b>${esc(title)}</b><span>${esc(sub)}${t.catatan ? " · " + esc(t.catatan) : ""}${!withDel && when ? " · " + esc(when) : ""}</span></div>
      <div class="nom ${cls}">${esc(nom)}</div>
      ${withDel ? `<button class="del-btn" type="button" data-del="${esc(t.id)}" aria-label="Hapus catatan">🗑</button>` : ""}</div>`;
  }

  /* ================================================================
     LAYAR POCKET
     ================================================================ */
  function pocketFlow(id) {
    let masuk = 0, keluar = 0;
    S.tx.forEach((t) => {
      if (t.pocketId === id) { if (t.jenis === "masuk") masuk += t.nominal; else keluar += t.nominal; }
      if (t.pocketTujuanId === id) masuk += t.nominal;
    });
    return { masuk, keluar };
  }

  function renderPockets() {
    if (!S.profile) return;
    const byType = {};
    S.pockets.forEach((p) => { const k = POCKET_TYPES[p.tipe] ? p.tipe : "lain"; byType[k] = (byType[k] || 0) + (p.saldo || 0); });
    $("pk-total").innerHTML = `<div class="card hc hc-saldo"><div class="hc-top"><span>💰 Total semua pocket</span>${S.eyeBtn("saldo")}</div>
      <div class="hc-big">${esc(S.mask(fmtRp(totalSaldo())))}</div>
      <div class="pk-types">${Object.entries(byType).map(([k, v]) => `<span>${POCKET_TYPES[k].ikon} ${POCKET_TYPES[k].label} <b>${esc(S.mask(fmtRp(v)))}</b></span>`).join("")}</div></div>`;
    if (!S.pockets.length) { $("pk-list").innerHTML = `<div class="card"><div class="empty">Belum ada pocket. Ketuk “+ Pocket” untuk menambah rekening, e-wallet, atau dompet tunai.</div></div>`; return; }
    $("pk-list").innerHTML = Object.keys(POCKET_TYPES).map((k) => {
      const list = S.pockets.filter((p) => (POCKET_TYPES[p.tipe] ? p.tipe : "lain") === k);
      if (!list.length) return "";
      return `<h3 class="section-title">${POCKET_TYPES[k].ikon} ${POCKET_TYPES[k].label}</h3><div class="grid2">${list.map((p) => {
        const f = pocketFlow(p.id), sd = savedByPocket(S.savings)[p.id] || 0;
        return `<button class="card pcard" type="button" data-pk="${esc(p.id)}" style="--pc:${esc(tp(p).warna)}">
          <div class="pc-top"><span class="pc-ic">${esc(pkIcon(p))}</span><span class="pc-name">${esc(p.nama)}</span></div>
          <div class="pc-bal">${esc(S.mask(fmtRp(p.saldo || 0)))}</div>
          ${p.keterangan ? `<div class="pc-note">${esc(p.keterangan)}</div>` : ""}
          ${sd ? `<div class="pc-save">🐷 ${esc(S.mask(fmtRp(sd)))} ditandai untuk tabungan</div>` : ""}
          <div class="pc-flow"><span class="n-in">+${esc(fmtRp(f.masuk))}</span><span class="n-out">−${esc(fmtRp(f.keluar))}</span><small>siklus ini</small></div></button>`;
      }).join("")}</div>`;
    }).join("");
  }

  /* ---------- Form tambah / ubah pocket ---------- */
  const pf = { id: null, tipe: "bank" };
  $("pp-tipe").innerHTML = Object.entries(POCKET_TYPES).map(([k, v]) => `<option value="${k}">${v.ikon} ${v.label}</option>`).join("");
  $("pp-preset").innerHTML = POCKET_PRESETS.map(([n, t]) => `<button type="button" class="chip" data-n="${esc(n)}" data-t="${t}">${POCKET_TYPES[t].ikon} ${esc(n)}</button>`).join("");
  $("pp-preset").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; $("pp-nama").value = b.dataset.n; $("pp-tipe").value = b.dataset.t; });
  $("pp-saldo").addEventListener("input", () => fmtInput($("pp-saldo")));

  function openPocketSheet(p) {
    pf.id = p ? p.id : null;
    $("pp-title").textContent = p ? "Ubah pocket" : "Tambah pocket";
    $("pp-nama").value = p ? p.nama : "";
    $("pp-tipe").value = p && POCKET_TYPES[p.tipe] ? p.tipe : "bank";
    $("pp-ket").value = p ? p.keterangan || "" : "";
    $("pp-saldo").value = p && p.saldo ? p.saldo.toLocaleString("id-ID") : "";
    $("pp-saldo-lbl").textContent = p ? "Saldo sekarang (Rp) — ubah untuk koreksi" : "Saldo awal (Rp)";
    $("pp-preset").hidden = !!p; $("pp-delete").hidden = !p; $("pp-error").textContent = "";
    const hist = p ? [...S.txAll].filter((t) => t.pocketId === p.id || t.pocketTujuanId === p.id).sort((a, b) => millis(b) - millis(a)).slice(0, 5) : [];
    $("pp-hist").innerHTML = hist.length ? `<h4 style="margin:6px 0">Aktivitas terakhir</h4><div class="card" style="padding:4px 14px">${hist.map((t) => rowHtml(t, false)).join("")}</div>` : "";
    $("pocket-sheet").hidden = false;
    if (!p) setTimeout(() => $("pp-nama").focus(), 50);
  }
  const closePocketSheet = () => { $("pocket-sheet").hidden = true; };
  $("pp-close").onclick = closePocketSheet;
  $("pocket-sheet").addEventListener("click", (e) => { if (e.target === $("pocket-sheet")) closePocketSheet(); });
  $("pk-add").onclick = () => openPocketSheet(null);

  $("pp-save").onclick = () => {
    const nama = $("pp-nama").value.trim().slice(0, 30), tipe = $("pp-tipe").value, saldo = parseRp($("pp-saldo").value);
    if (!nama) { $("pp-error").textContent = "Nama pocketnya diisi dulu ya."; return; }
    if (saldo >= 1e12) { $("pp-error").textContent = "Nominalnya terlalu besar."; return; }
    if (S.pockets.some((p) => p.id !== pf.id && p.nama.toLowerCase() === nama.toLowerCase())) { $("pp-error").textContent = "Nama pocket ini sudah ada."; return; }
    const ref = pf.id ? doc(db, "users", uid(), "pockets", pf.id) : doc(collection(db, "users", uid(), "pockets"));
    const old = pf.id ? pk(pf.id) : null;
    const data = { nama, tipe, ikon: POCKET_TYPES[tipe].ikon, keterangan: $("pp-ket").value.trim().slice(0, 80) };
    if (!old) { data.saldo = saldo; data.urutan = S.pockets.length; data.createdAt = serverTimestamp(); }
    else if (saldo !== (old.saldo || 0)) data.saldo = saldo;
    setDoc(ref, data, { merge: true }).catch((e) => { console.error(e); toast("Pocket gagal tersimpan: " + (e.code || e.message)); });
    closePocketSheet();
    toast(old ? "Pocket diperbarui" : "Pocket ditambahkan 👛");
  };
  $("pp-delete").onclick = () => {
    const p = pk(pf.id); if (!p) return;
    if (!confirm(`Hapus pocket “${p.nama}”? Riwayat transaksinya tetap ada, tapi tidak lagi terhubung ke pocket ini.`)) return;
    deleteDoc(doc(db, "users", uid(), "pockets", p.id)).catch((e) => { console.error(e); toast("Gagal menghapus"); });
    closePocketSheet(); toast("Pocket dihapus");
  };
  $("screen-pockets").addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]"); if (o) { openTxSheet(o.dataset.open); return; }
    const c = e.target.closest("[data-pk]"); if (c) openPocketSheet(pk(c.dataset.pk));
  });

  /* ================================================================
     RIWAYAT TRANSAKSI
     ================================================================ */
  const tf = { jenis: "all", period: "now", pocket: "all" };
  function txRange() {
    const tgl = S.profile.tanggalGajian;
    if (tf.period === "prev") { const p = prevCycle(S.cycle, tgl); return [p.startKey, p.endKey]; }
    if (tf.period === "all") { let c = S.cycle; for (let i = 0; i < 5; i++) c = prevCycle(c, tgl); return [c.startKey, S.cycle.endKey]; }
    return [S.cycle.startKey, S.cycle.endKey];
  }
  // Transaksi sesuai filter yang sedang tampil di layar (dipakai tampilan dan export)
  function txTersaring() {
    const [a, b] = txRange();
    const q = $("tx-q").value.trim().toLowerCase();
    let rows = S.txAll.filter((t) => t.hariKe >= a && t.hariKe <= b);
    if (tf.jenis !== "all") rows = rows.filter((t) => t.jenis === tf.jenis);
    if (tf.pocket !== "all") rows = rows.filter((t) => t.pocketId === tf.pocket || t.pocketTujuanId === tf.pocket);
    if (q) rows = rows.filter((t) => `${catOf(t).nama} ${t.catatan || ""} ${pkLabel(t.pocketId)} ${pkLabel(t.pocketTujuanId)}`.toLowerCase().includes(q));
    return rows.sort((x, y) => millis(y) - millis(x));
  }
  const JENIS_TX = { keluar: "Pengeluaran", masuk: "Pemasukan", transfer: "Transfer", tarik: "Tarik tunai" };
  (S.exporters = S.exporters || {}).Transaksi = {
    hint: () => "Mengikuti filter yang sedang tampil di halaman Transaksi (periode, jenis, pocket, dan pencarian).",
    bangun: () => {
      const rows = txTersaring(), [a, b] = txRange();
      const inc = rows.filter((t) => t.jenis === "masuk").reduce((x, t) => x + t.nominal, 0);
      const exp = rows.filter((t) => t.jenis === "keluar").reduce((x, t) => x + t.nominal, 0);
      const bersihPk = (id) => { const p = pk(id); return p ? p.nama : ""; };
      return {
        periode: `${fmtTgl(parseKey(a))} - ${fmtTgl(parseKey(b))}`,
        sheets: [{
          nama: "Transaksi",
          kolom: [{ h: "Tanggal", w: 13 }, { h: "Jam", w: 8 }, { h: "Jenis", w: 13 }, { h: "Kategori", w: 18 }, { h: "Dari pocket", w: 16 }, { h: "Ke pocket", w: 16 }, { h: "Nominal", w: 16, t: "rp" }, { h: "Catatan", w: 30 }],
          baris: rows.map((t) => {
            const d = t.tanggal && t.tanggal.toDate ? t.tanggal.toDate() : parseKey(t.hariKe);
            const kat = t.jenis === "transfer" ? "-" : t.jenis === "tarik" ? "Tarik tunai" : catOf(t).nama;
            return [fmtTgl(parseKey(t.hariKe)), d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", "."), JENIS_TX[t.jenis] || t.jenis, kat, bersihPk(t.pocketId), bersihPk(t.pocketTujuanId), t.nominal, t.catatan || ""];
          }),
          ringkas: [["Total pemasukan", inc], ["Total pengeluaran", exp], ["Selisih", inc - exp], ["Jumlah catatan", rows.length, "angka"]],
        }],
      };
    },
  };
  (S.exporters = S.exporters || {}).Pocket = {
    bangun: () => {
      const saved = savedByPocket(S.savings), now = new Date();
      const baris = S.pockets.map((p) => { const sd = saved[p.id] || 0, saldo = p.saldo || 0; return [p.nama, tp(p).label, p.keterangan || "", saldo, sd, saldo - sd]; });
      const tot = (i) => baris.reduce((x, r) => x + r[i], 0);
      return {
        periode: `Posisi per ${fmtTgl(now)}`,
        sheets: [{
          nama: "Pocket",
          kolom: [{ h: "Pocket", w: 22 }, { h: "Jenis", w: 12 }, { h: "Keterangan", w: 28 }, { h: "Saldo", w: 16, t: "rp" }, { h: "Ditabung", w: 16, t: "rp" }, { h: "Saldo bebas", w: 16, t: "rp" }],
          baris,
          ringkas: [["Total saldo", tot(3)], ["Total ditabung", tot(4)], ["Total saldo bebas", tot(5)]],
        }],
      };
    },
  };

  function renderTx() {
    if (!S.profile || !S.cycle) return;
    document.querySelectorAll("#tx-jenis button").forEach((b) => b.classList.toggle("active", b.dataset.j === tf.jenis));
    $("tx-pocket").innerHTML = `<option value="all">Semua pocket</option>` + S.pockets.map((p) => `<option value="${esc(p.id)}">${esc(pkIcon(p) + " " + p.nama)}</option>`).join("");
    $("tx-pocket").value = S.pockets.some((p) => p.id === tf.pocket) ? tf.pocket : "all";
    const rows = txTersaring();
    const inc = rows.filter((t) => t.jenis === "masuk").reduce((s, t) => s + t.nominal, 0);
    const exp = rows.filter((t) => t.jenis === "keluar").reduce((s, t) => s + t.nominal, 0);
    $("tx-sum").innerHTML = `
      <div class="card kpi"><div class="k">Pemasukan</div><div class="v n-in">${fmtRp(inc)}</div></div>
      <div class="card kpi"><div class="k">Pengeluaran</div><div class="v n-out">${fmtRp(exp)}</div></div>
      <div class="card kpi"><div class="k">Selisih</div><div class="v ${inc - exp >= 0 ? "n-in" : "n-out"}">${inc - exp >= 0 ? "+" : "−"}${fmtRp(Math.abs(inc - exp))}</div></div>
      <div class="card kpi"><div class="k">Jumlah catatan</div><div class="v">${rows.length}</div></div>`;
    if (!rows.length) { $("tx-groups").innerHTML = `<div class="card"><div class="empty">Tidak ada transaksi yang cocok.</div></div>`; return; }
    const groups = {};
    rows.forEach((t) => { (groups[t.hariKe] = groups[t.hariKe] || []).push(t); });
    $("tx-groups").innerHTML = Object.keys(groups).sort().reverse().map((k) => {
      const d = parseKey(k);
      return `<h3 class="section-title">${HARI_PANJANG[d.getDay()]}, ${fmtTgl(d)}</h3><div class="card" style="padding:4px 14px">${groups[k].map((t) => rowHtml(t, true)).join("")}</div>`;
    }).join("");
  }
  $("tx-jenis").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { tf.jenis = b.dataset.j; renderTx(); } });
  $("tx-period").addEventListener("change", () => { tf.period = $("tx-period").value; renderTx(); });
  $("tx-pocket").addEventListener("change", () => { tf.pocket = $("tx-pocket").value; renderTx(); });
  $("tx-q").addEventListener("input", renderTx);

  /* ---------- Membatalkan transaksi: saldo pocket & anggaran dikembalikan ---------- */
  function applyDelta(batch, delta) {
    Object.entries(delta).forEach(([id, v]) => { if (v) batch.update(doc(db, "users", uid(), "pockets", id), { saldo: increment(v) }); });
  }
  function reverse(batch, t) {
    const u = uid(), delta = {};
    const add = (id, v) => { if (id && pk(id)) delta[id] = (delta[id] || 0) + v; };
    const cyc = doc(db, "users", u, "cycles", t.cycleId || S.cycle.id);
    if (t.jenis === "keluar") {
      add(t.pocketId, t.nominal);
      if (t.envelopeId) batch.set(cyc, { terpakai: { [t.envelopeId]: increment(-t.nominal) }, totalTerpakai: increment(-t.nominal) }, { merge: true });
    } else if (t.jenis === "masuk") {
      add(t.pocketId, -t.nominal);
      if (t.alok) batch.set(cyc, { alokasi: Object.fromEntries(Object.entries(t.alok).map(([k, v]) => [k, increment(-v)])) }, { merge: true });
    } else { add(t.pocketId, t.nominal); add(t.pocketTujuanId, -t.nominal); }
    applyDelta(batch, delta);
    batch.delete(doc(db, "users", u, "transactions", t.id));
    batch.set(doc(db, "directory", u), { jumlahCatatan: increment(-1) }, { merge: true });
  }
  function hapusTx(t) {
    if (!confirm("Hapus catatan ini? Saldo pocket dan anggaran akan dikembalikan.")) return false;
    const batch = writeBatch(db);
    reverse(batch, t);
    S.txAll.filter((x) => x.terkait === t.id).forEach((f) => reverse(batch, f)); // biaya admin ikut terhapus
    if (t.tagihanId) {
      const bill = S.bills.find((x) => x.id === t.tagihanId);
      const key = bill && bill.paid ? Object.keys(bill.paid).find((k) => bill.paid[k] && bill.paid[k].tx === t.id) : null;
      if (key) batch.update(doc(db, "users", uid(), "bills", bill.id), { ["paid." + key]: deleteField() });
    }
    batch.commit().catch((err) => { console.error(err); toast("Gagal menghapus. Coba lagi ya."); });
    toast("Catatan dihapus");
    return true;
  }
  $("screen-tx").addEventListener("click", (e) => {
    const d = e.target.closest("[data-del]"); if (!d) return;
    const t = S.txAll.find((x) => x.id === d.dataset.del); if (t) hapusTx(t);
  });

  /* ---------- Rincian transaksi (ketuk baris mana pun) ---------- */
  let detailTx = null;
  const closeDetail = () => { $("txd-sheet").hidden = true; detailTx = null; };
  function openDetail(id) {
    const t = S.txAll.find((x) => x.id === id) || S.tx.find((x) => x.id === id); if (!t) return;
    detailTx = t;
    const d = t.tanggal && t.tanggal.toDate ? t.tanggal.toDate() : parseKey(t.hariKe);
    const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }).replace(":", ".");
    const io = t.jenis === "transfer" || t.jenis === "tarik";
    const fee = S.txAll.find((x) => x.terkait === t.id);
    const env = t.envelopeId ? S.envelopes.find((e) => e.id === t.envelopeId) : null;
    const bill = t.tagihanId ? S.bills.find((b) => b.id === t.tagihanId) : null;
    const c = io ? { ikon: t.jenis === "tarik" ? "🏧" : "🔁", nama: t.jenis === "tarik" ? "Tarik tunai" : "Transfer" } : catOf(t);
    const bebas = t.jenis === "keluar" && (S.categories.find((k) => k.id === t.categoryId) || {}).bebas;
    const rows = [
      ["Jenis", JENIS_TX[t.jenis] || t.jenis],
      ["Tanggal", `${HARI_PANJANG[d.getDay()]}, ${fmtTgl(d)} · ${jam}`],
      io ? null : ["Kategori", `${c.ikon} ${c.nama}${bebas ? " (di luar anggaran)" : ""}`],
      env && t.jenis === "keluar" && !bebas ? ["Pos anggaran", `${env.ikon || ""} ${env.nama}`] : null,
      [io ? "Dari pocket" : t.jenis === "masuk" ? "Diterima di" : "Dibayar dari", pkLabel(t.pocketId)],
      io ? ["Ke pocket", pkLabel(t.pocketTujuanId)] : null,
      fee ? ["Biaya admin", fmtRp(fee.nominal)] : null,
      t.alok ? ["Jatah anggaran", "Ikut ditambahkan ke jatah siklus"] : null,
      bill ? ["Tagihan", bill.nama] : null,
      ["Catatan", t.catatan || "-"],
    ].filter(Boolean);
    $("txd-body").innerHTML = `<div class="txd-top"><div class="ic">${esc(c.ikon)}</div><div class="big ${t.jenis === "masuk" ? "n-in" : t.jenis === "keluar" ? "n-out" : ""}">${t.jenis === "masuk" ? "+" : t.jenis === "keluar" ? "−" : ""}${esc(fmtRp(t.nominal))}</div></div>`
      + rows.map(([k, v]) => `<div class="txd-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
    const kunci = t.terkait ? "Ini biaya admin dari sebuah transfer atau tarik tunai. Ubah lewat transaksi induknya." : t.tagihanId ? "Transaksi ini dari pelunasan tagihan. Untuk mengubahnya, batalkan pelunasan di menu Tagihan." : "";
    $("txd-note").textContent = kunci; $("txd-note").hidden = !kunci;
    $("txd-edit").hidden = !!kunci;
    $("txd-sheet").hidden = false;
  }
  $("txd-close").onclick = closeDetail;
  $("txd-sheet").addEventListener("click", (e) => { if (e.target === $("txd-sheet")) closeDetail(); });
  $("txd-del").onclick = () => { if (detailTx && hapusTx(detailTx)) closeDetail(); };
  $("txd-edit").onclick = () => { const t = detailTx; closeDetail(); if (t) openEditTx(t); };
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-del]")) return;
    const r = e.target.closest(".tx[data-tx]"); if (r) openDetail(r.dataset.tx);
  });

  /* ================================================================
     FORM CATAT TRANSAKSI
     ================================================================ */
  const xs = { jenis: "keluar", cat: null, via: "pocket", biayaManual: false, edit: null };
  const kb = { ikon: "🗑️" };
  const PRESET_BEBAS = [["Bayar sampah", "🗑️"], ["Parkir", "🅿️"], ["Tol", "🛣️"], ["Sedekah", "🤲"], ["Iuran RT", "🏘️"], ["Servis", "🔧"]];
  const fillSelect = (el, list, selected) => {
    el.innerHTML = list.map((p) => `<option value="${esc(p.id)}">${esc(pkIcon(p) + " " + p.nama)} · ${esc(S.mask(fmtRp(p.saldo || 0)))}</option>`).join("");
    if (selected && list.some((p) => p.id === selected)) el.value = selected;
  };
  function defaultFrom(j) {
    const last = ls.get("finix-from-" + j);
    if (last && pk(last)) return last;
    if (j === "transfer" || j === "tarik") return (S.pockets.find((p) => p.tipe !== "cash") || S.pockets[0]).id;
    return S.pockets[0].id;
  }
  function defaultTo(j, from) {
    const other = S.pockets.filter((p) => p.id !== from);
    return ((j === "tarik" && other.find((p) => p.tipe === "cash")) || other[0] || {}).id;
  }
  function fillTo() {
    const from = $("x-from").value;
    fillSelect($("x-to"), S.pockets.filter((p) => p.id !== from), $("x-to").value || defaultTo(xs.jenis, from));
    if (!S.pockets.some((p) => p.id !== from)) $("x-to").innerHTML = `<option value="">Tambah pocket lain dulu</option>`;
  }
  const viaTagihan = () => xs.jenis === "keluar" && xs.via === "tagihan";
  function infoTagihan() {
    const total = parseRp($("x-nominal").value), n = Number($("x-t-tenor").value);
    const siap = total > 0 && Number.isInteger(n) && n >= 1;
    $("x-wrap-biaya").hidden = !siap;
    const biaya = parseRp($("x-t-biaya").value), y = Number($("x-t-thn").value), m = Number($("x-t-bln").value), h = Number($("x-t-hari").value);
    if (!siap || !biaya || !y) { $("x-t-info").textContent = ""; return; }
    const akhir = new Date(y, m + n - 1, 1), selisih = n * biaya - total;
    $("x-t-info").innerHTML = `Tercatat di Kalender Tagihan: <b>${n} × ${fmtRp(biaya)}</b>${h ? `, tiap tanggal ${h}` : ""}<br>${BULAN_PANJANG[m]} ${y} sampai ${BULAN_PANJANG[akhir.getMonth()]} ${akhir.getFullYear()} · total bayar <b>${fmtRp(n * biaya)}</b>`
      + (selisih ? `<br>${selisih > 0 ? "Lebih" : "Kurang"} ${fmtRp(Math.abs(selisih))} dari harga total${selisih > 0 ? " (misalnya bunga atau biaya admin)" : ""}.` : "");
  }
  // Harga total dan tenor berubah: biaya per bulan dihitung ulang (harga ÷ tenor, dibulatkan ke atas)
  function autoBiaya() {
    const total = parseRp($("x-nominal").value), n = Number($("x-t-tenor").value);
    if (total && Number.isInteger(n) && n >= 1) $("x-t-biaya").value = Math.ceil(total / n).toLocaleString("id-ID");
    else $("x-t-biaya").value = "";
    xs.biayaManual = false;
  }
  function renderTxForm() {
    const j = xs.jenis, io = j === "transfer" || j === "tarik";
    if (j !== "keluar") xs.via = "pocket";
    const vt = viaTagihan();
    $("x-via").hidden = j !== "keluar" || !!xs.edit;
    $("x-jenis").hidden = !!xs.edit;
    $("x-title").textContent = xs.edit ? "Ubah transaksi" : "Catat transaksi";
    document.querySelectorAll("#x-via button").forEach((b) => b.classList.toggle("active", b.dataset.v === xs.via));
    $("x-wrap-tagihan").hidden = !vt; $("x-wrap-from").hidden = vt; $("x-wrap-date").hidden = vt; $("x-note").hidden = vt;
    $("x-save").textContent = vt ? "Simpan ke Kalender Tagihan" : xs.edit ? "Simpan perubahan" : "Catat";
    if (vt) { $("x-catwrap").hidden = true; infoTagihan(); return; }
    document.querySelectorAll("#x-jenis button").forEach((b) => b.classList.toggle("active", b.dataset.j === j));
    $("x-catwrap").hidden = io;
    $("x-wrap-to").hidden = !io; $("x-wrap-fee").hidden = !io; $("x-wrap-alok").hidden = j !== "masuk";
    $("x-from-lbl").textContent = { keluar: "Dibayar dari pocket", masuk: "Diterima di pocket", transfer: "Dari pocket", tarik: "Tarik dari pocket" }[j];
    $("x-to-lbl").textContent = j === "tarik" ? "Uang tunai masuk ke pocket" : "Ke pocket";
    $("x-bebas-wrap").hidden = j !== "keluar";
    if (!io) {
      const btn = (c) => `<button class="cat${c.id === xs.cat ? " sel" : ""}" type="button" data-id="${esc(c.id)}"><span>${esc(c.ikon)}</span>${esc(c.nama)}</button>`;
      const list = j === "keluar" ? S.categories.filter((c) => !c.bebas) : INCOME_CATEGORIES;
      $("cats").innerHTML = list.map(btn).join("");
      if (j === "keluar") $("cats-bebas").innerHTML = S.categories.filter((c) => c.bebas).map(btn).join("") + `<button class="cat add" type="button" data-add="1"><span>＋</span>Kategori bebas</button>`;
    }
    const from = defaultFrom(j);
    fillSelect($("x-from"), S.pockets, from);
    $("x-to").value = "";
    fillTo();
    $("x-from").dataset.j = j;
  }
  function openTxSheet(jenis = "keluar", preset = {}) {
    if (!S.pockets.length) { toast("Buat pocket dulu di menu Pocket ya"); return; }
    xs.edit = null; $("kb-form").hidden = true;
    xs.jenis = jenis; xs.cat = preset.cat || null; xs.gajiId = preset.gajiId || null; xs.via = "pocket"; xs.biayaManual = false;
    const sk = new Date(), nb = new Date(sk.getFullYear(), sk.getMonth() + 1, 1);
    $("x-t-nama").value = ""; $("x-t-tenor").value = ""; $("x-t-biaya").value = ""; $("x-t-hari").value = sk.getDate();
    $("x-t-bln").innerHTML = BULAN_PANJANG.map((n, i) => `<option value="${i}">${n}</option>`).join("");
    $("x-t-bln").value = String(nb.getMonth()); $("x-t-thn").value = nb.getFullYear();
    $("x-nominal").value = preset.nominal ? preset.nominal.toLocaleString("id-ID") : "";
    $("x-note").value = preset.note || ""; $("x-fee").value = ""; $("x-alok").checked = false; $("x-error").textContent = "";
    const t = dateKey(today0());
    $("x-date").min = S.cycle.startKey; $("x-date").max = t; $("x-date").value = t;
    renderTxForm();
    $("sheet").hidden = false;
    setTimeout(() => $("x-nominal").focus(), 50);
  }
  const closeSheet = () => { $("sheet").hidden = true; $("kb-form").hidden = true; };
  $("fab").onclick = () => openTxSheet("keluar");
  $("sheet-close").onclick = closeSheet;
  $("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
  $("x-nominal").addEventListener("input", () => { fmtInput($("x-nominal")); if (viaTagihan()) { autoBiaya(); infoTagihan(); } });
  $("x-via").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; xs.via = b.dataset.v; renderTxForm(); });
  $("x-t-tenor").addEventListener("input", () => { autoBiaya(); infoTagihan(); });
  $("x-t-biaya").addEventListener("input", () => { xs.biayaManual = true; fmtInput($("x-t-biaya")); infoTagihan(); });
  ["x-t-hari", "x-t-thn"].forEach((id) => $(id).addEventListener("input", infoTagihan));
  $("x-t-bln").addEventListener("change", infoTagihan);
  $("x-fee").addEventListener("input", () => fmtInput($("x-fee")));
  document.querySelectorAll("#sheet .chip").forEach((b) => { b.onclick = () => { $("x-nominal").value = Number(b.dataset.v).toLocaleString("id-ID"); if (viaTagihan()) { autoBiaya(); infoTagihan(); } }; });
  $("x-jenis").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; xs.jenis = b.dataset.j; xs.cat = null; renderTxForm(); });
  $("x-from").addEventListener("change", () => { if (xs.jenis === "transfer" || xs.jenis === "tarik") { $("x-to").value = ""; fillTo(); } });
  $("x-catwrap").addEventListener("click", (e) => {
    const b = e.target.closest(".cat"); if (!b) return;
    if (b.dataset.add) { bukaKb(); return; }
    xs.cat = b.dataset.id;
    document.querySelectorAll("#x-catwrap .cat").forEach((x) => x.classList.toggle("sel", x === b));
  });

  /* ---------- Kategori bebas: pengeluaran di luar anggaran, tetap dihitung ke batas harian ---------- */
  const renderKbIkon = () => $("kb-ikon").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === kb.ikon));
  $("kb-ikon").innerHTML = IKON_UMUM.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("kb-preset").innerHTML = PRESET_BEBAS.map(([n, i]) => `<button type="button" class="chip" data-n="${esc(n)}" data-i="${i}">${i} ${esc(n)}</button>`).join("");
  $("kb-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { kb.ikon = b.dataset.i; renderKbIkon(); } });
  $("kb-preset").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; $("kb-nama").value = b.dataset.n; kb.ikon = b.dataset.i; renderKbIkon(); });
  function bukaKb() { $("kb-nama").value = ""; kb.ikon = "🗑️"; renderKbIkon(); $("kb-form").hidden = false; $("kb-nama").focus(); }
  $("kb-batal").onclick = () => { $("kb-form").hidden = true; };
  $("kb-save").onclick = () => {
    const nama = $("kb-nama").value.trim().slice(0, 24), err = $("x-error");
    const env = harianEnv();
    if (!nama) { err.textContent = "Nama kategori bebasnya diisi dulu ya."; return; }
    if (!env) { err.textContent = "Belum ada pos anggaran. Buat dulu di menu Anggaran."; return; }
    if (S.categories.some((k) => k.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama kategori ini sudah ada."; return; }
    err.textContent = "";
    const id = doc(collection(db, "users", uid(), "categories")).id;
    const data = { id, nama, ikon: kb.ikon, envelopeId: env, anggaran: 0, mode: "bulanan", bebas: true, urutan: Math.max(-1, ...S.categories.map((k) => k.urutan ?? 0)) + 1 };
    S.categories.push(data);
    setDoc(doc(db, "users", uid(), "categories", id), data).catch((e2) => { console.error(e2); toast("Kategori gagal tersimpan: " + (e2.code || e2.message)); });
    xs.cat = id; $("kb-form").hidden = true; renderTxForm();
  };

  /* ---------- Ubah transaksi: memakai form catat yang sama ---------- */
  function openEditTx(t) {
    xs.edit = t; xs.jenis = t.jenis; xs.cat = t.categoryId || null; xs.gajiId = t.gajiId || null; xs.via = "pocket";
    $("kb-form").hidden = true;
    const fee = S.txAll.find((x) => x.terkait === t.id);
    $("x-nominal").value = t.nominal.toLocaleString("id-ID");
    $("x-note").value = t.catatan || ""; $("x-fee").value = fee ? fee.nominal.toLocaleString("id-ID") : "";
    $("x-alok").checked = !!t.alok; $("x-error").textContent = "";
    const cyc = getCycle(S.profile.tanggalGajian, parseKey(t.hariKe)), hariIni = dateKey(today0());
    $("x-date").min = cyc.startKey; $("x-date").max = cyc.endKey < hariIni ? cyc.endKey : hariIni; $("x-date").value = t.hariKe;
    renderTxForm();
    if (pk(t.pocketId)) $("x-from").value = t.pocketId;
    if (t.jenis === "transfer" || t.jenis === "tarik") { $("x-to").value = ""; fillTo(); if (pk(t.pocketTujuanId)) $("x-to").value = t.pocketTujuanId; }
    $("sheet").hidden = false;
  }

  // Belanja dengan paylater / cicilan: tidak memotong saldo sekarang, hanya membuat tagihan tenor di Kalender Tagihan
  function simpanTagihan() {
    const err = $("x-error"); err.textContent = "";
    const nama = $("x-t-nama").value.trim().slice(0, 40), n = Number($("x-t-tenor").value), biaya = parseRp($("x-t-biaya").value), total = parseRp($("x-nominal").value);
    const h = Number($("x-t-hari").value), y = Number($("x-t-thn").value), m = Number($("x-t-bln").value);
    if (!nama) { err.textContent = "Isi keterangan tagihannya dulu ya, misalnya Tiktok Paylater."; return; }
    if (!total || total >= 1e10) { err.textContent = "Isi harga total belanjanya di kolom nominal atas dulu ya."; return; }
    if (!Number.isInteger(n) || n < 1 || n > 60) { err.textContent = "Tenor antara 1 sampai 60 bulan ya."; return; }
    if (!biaya || biaya >= 1e9) { err.textContent = "Isi biaya per bulannya dulu ya."; return; }
    if (!Number.isInteger(h) || h < 1 || h > 31) { err.textContent = "Tanggal jatuh tempo antara 1 sampai 31 ya."; return; }
    if (!Number.isInteger(y) || y < 2000 || y > 2100) { err.textContent = "Tahun cicilan pertama belum benar."; return; }
    if (S.bills && S.bills.some((b) => b.nama && b.nama.toLowerCase() === nama.toLowerCase() && b.tipe === "tenor" && !confirm(`Sudah ada tagihan tenor “${b.nama}”. Tetap tambahkan yang baru?`))) return;
    const ref = doc(collection(db, "users", uid(), "bills"));
    const data = { nama, nominal: biaya, tipe: "tenor", ikon: "💳", aktif: true, hari: h, mulai: `${y}-${String(m + 1).padStart(2, "0")}`, cicilan: Array(n).fill(biaya), paid: {}, createdAt: serverTimestamp() };
    data.hargaTotal = total;
    setDoc(ref, data).catch((e) => { console.error(e); toast("Tagihan gagal tersimpan: " + (e.code || e.message)); });
    closeSheet();
    toast(`💳 ${nama}: ${n} × ${fmtRp(biaya)} masuk Kalender Tagihan`);
  }

  $("x-save").onclick = () => {
    if (viaTagihan()) { simpanTagihan(); return; }
    const err = $("x-error"); err.textContent = "";
    const j = xs.jenis, nominal = parseRp($("x-nominal").value), from = $("x-from").value;
    const io = j === "transfer" || j === "tarik";
    const fee = io ? parseRp($("x-fee").value) : 0;
    const to = io ? $("x-to").value : null;
    const dk = $("x-date").value;
    if (!nominal) { err.textContent = "Isi nominalnya dulu ya."; return; }
    if (nominal >= 1e9 || fee >= 1e9) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (!pk(from)) { err.textContent = "Pilih pocketnya dulu ya."; return; }
    if (io && (!to || !pk(to) || to === from)) { err.textContent = "Pilih pocket tujuan yang berbeda dari pocket asal."; return; }
    if (!io && (!xs.cat || (j === "keluar" && !S.categories.some((c) => c.id === xs.cat)))) { err.textContent = "Pilih kategorinya dulu ya."; return; }
    const dMin = $("x-date").min, dMax = $("x-date").max;
    if (!dk || dk < dMin || dk > dMax) { err.textContent = `Tanggal harus antara ${fmtTgl(parseKey(dMin))} dan ${fmtTgl(parseKey(dMax))}.`; return; }
    const edit = xs.edit, feeLama = edit ? S.txAll.filter((x) => x.terkait === edit.id) : [];
    const keluarDariPocket = j === "masuk" ? 0 : nominal + fee;
    // saat mengubah, nominal lama yang keluar dari pocket yang sama dikembalikan dulu
    const kembali = edit && edit.pocketId === from && edit.jenis !== "masuk" ? edit.nominal + feeLama.reduce((a, f) => a + f.nominal, 0) : 0;
    const bal = (pk(from).saldo || 0) + kembali;
    if (keluarDariPocket && bal < keluarDariPocket && !confirm(`Saldo ${pk(from).nama} (${fmtRp(bal)}) kurang dari ${fmtRp(keluarDariPocket)}. Tetap dicatat?`)) return;

    const u = uid(), now = new Date(), isToday = dk === dateKey(today0());
    const when = isToday ? now : (() => { const d = parseKey(dk); d.setHours(12); return d; })();
    const catatan = $("x-note").value.trim().slice(0, 60);
    const batch = writeBatch(db);
    const cycleId = edit ? (edit.cycleId || S.cycle.id) : S.cycle.id;
    if (edit) { reverse(batch, edit); feeLama.forEach((f) => reverse(batch, f)); } // kembalikan dulu efek lama, lalu tulis ulang
    const ref = edit ? doc(db, "users", u, "transactions", edit.id) : doc(collection(db, "users", u, "transactions"));
    const tanggal = edit && dk === edit.hariKe && edit.tanggal ? edit.tanggal : Timestamp.fromDate(when);
    const base = { jenis: j, nominal, pocketId: from, cycleId, catatan, tanggal, hariKe: dk };
    if (edit && edit.tagihanId) base.tagihanId = edit.tagihanId;
    const cyc = doc(db, "users", u, "cycles", cycleId);
    const delta = {}; let n = 1;

    if (j === "keluar") {
      const cat = S.categories.find((c) => c.id === xs.cat);
      batch.set(ref, { ...base, categoryId: cat.id, envelopeId: cat.envelopeId });
      batch.set(cyc, { terpakai: { [cat.envelopeId]: increment(nominal) }, totalTerpakai: increment(nominal) }, { merge: true });
      delta[from] = -nominal;
    } else if (j === "masuk") {
      const rec = { ...base, categoryId: xs.cat };
      if (xs.gajiId && xs.cat === "gaji") rec.gajiId = xs.gajiId;
      if ($("x-alok").checked) {
        rec.alok = splitSalary(nominal, S.envelopes);
        batch.set(cyc, { alokasi: Object.fromEntries(Object.entries(rec.alok).map(([k, v]) => [k, increment(v)])) }, { merge: true });
      }
      batch.set(ref, rec);
      delta[from] = nominal;
    } else {
      batch.set(ref, { ...base, pocketTujuanId: to });
      delta[from] = -(nominal + fee); delta[to] = nominal;
      if (fee > 0) {
        const env = harianEnv();
        batch.set(doc(collection(db, "users", u, "transactions")), {
          jenis: "keluar", nominal: fee, pocketId: from, categoryId: CAT_ADMIN.id, envelopeId: env, cycleId,
          catatan: (j === "tarik" ? "Biaya tarik tunai" : "Biaya transfer"), tanggal: Timestamp.fromDate(when), hariKe: dk, terkait: ref.id,
        });
        if (env) batch.set(cyc, { terpakai: { [env]: increment(fee) }, totalTerpakai: increment(fee) }, { merge: true });
        n = 2;
      }
    }
    applyDelta(batch, delta);
    batch.set(doc(db, "directory", u), { jumlahCatatan: increment(n), lastActive: serverTimestamp() }, { merge: true });
    batch.commit().catch((e) => { console.error(e); toast("Catatan gagal tersimpan: " + (e.code || e.message)); });
    if (!edit) ls.set("finix-from-" + j, from);
    closeSheet();
    xs.edit = null;
    if (edit) { toast("Perubahan tersimpan ✏️"); return; }
    toast(j === "keluar" ? `${catOf({ jenis: j, categoryId: xs.cat }).ikon} ${fmtRp(nominal)} tercatat dari ${pk(from).nama}`
      : j === "masuk" ? `💰 ${fmtRp(nominal)} masuk ke ${pk(from).nama}`
      : `${j === "tarik" ? "🏧" : "🔁"} ${fmtRp(nominal)}: ${pk(from).nama} → ${pk(to).nama}`);
  };

  /* ---------- Pilih pocket (dipakai saat menandai tagihan lunas) ---------- */
  let pickCb = null;
  S.pickPocket = (title, cb) => {
    if (!S.pockets.length) { toast("Buat pocket dulu di menu Pocket ya"); return; }
    $("pick-title").textContent = title;
    $("pick-list").innerHTML = S.pockets.map((p) => `<button class="pick-item" type="button" data-id="${esc(p.id)}"><span class="ic">${esc(pkIcon(p))}</span><span class="tt"><b>${esc(p.nama)}</b><span>${esc(tp(p).label)}</span></span><b>${esc(S.mask(fmtRp(p.saldo || 0)))}</b></button>`).join("");
    pickCb = cb; $("pick-sheet").hidden = false;
  };
  $("pick-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (!b) return; $("pick-sheet").hidden = true; if (pickCb) pickCb(b.dataset.id); pickCb = null; });
  $("pick-close").onclick = () => { $("pick-sheet").hidden = true; };
  $("pick-sheet").addEventListener("click", (e) => { if (e.target === $("pick-sheet")) $("pick-sheet").hidden = true; });
  S.openTx = openTxSheet;

  return { listen, renderPockets, renderTx, openTxSheet, rowHtml };
}