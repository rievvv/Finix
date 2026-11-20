// features.js — Dashboard analisis, Anggaran, dan Kalender Tagihan.
import {
  doc, collection, writeBatch, setDoc, deleteDoc, onSnapshot, increment, serverTimestamp, Timestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  fmtRp, parseRp, dateKey, fmtTgl, computeGuard, prevCycle, analyze, compareWithPrevious, cycleTotals,
  avgSpendByCategory, suggestBudgets, planMoney, paidKey, occurrencesInMonth, occurrencesInRange,
  billStatus, tenorSchedule, catBudget, dailyTotal, countWeekdays, HARI_URUT, IKON_UMUM, monthCells, parseKey, fmtRingkas, HARI_SINGKAT, BULAN_PANJANG,
  cashflow, flowByCycle, forecastBalance, CAT_ADMIN, POCKET_TYPES, splitSalary, gajiList, salaryDateInCycle, savingProgress,
} from "./calc.js";
import { createReports } from "./laporan.js";

const PALET = ["#FF7A00", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#14B8A6", "#EF4444"];
const IKON_TAGIHAN = IKON_UMUM;
const PRESET_TAGIHAN = [
  ["Listrik", "💡"], ["Air", "💧"], ["Internet", "🌐"], ["Pulsa / paket data", "📱"],
  ["Kos / KPR", "🏠"], ["Cicilan", "💳"], ["Asuransi", "🛡️"], ["Langganan", "📺"],
];

export function createFeatures({ db, S, $, esc, toast, go }) {
  const today0 = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const guard = () => computeGuard({
    alokasi: S.cycleDoc.alokasi || {}, terpakai: S.cycleDoc.terpakai || {},
    tx: S.tx, envelopes: S.envelopes, cycle: S.cycle, today: new Date(),
  });
  const ready = () => S.user && S.profile && S.cycle && S.cycleDoc;
  const unpaidInCycle = () => occurrencesInRange(S.bills, S.cycle.start, S.cycle.next).filter((o) => !o.paid);

  /* ================================================================
     DASHBOARD
     ================================================================ */
  const dash = { period: "now", from: "", to: "" };

  function dashRange() {
    const tgl = S.profile.tanggalGajian, cur = S.cycle;
    if (dash.period === "prev") { const p = prevCycle(cur, tgl); return { startKey: p.startKey, endKey: p.endKey }; }
    if (dash.period === "custom") {
      let a = dash.from || cur.startKey, b = dash.to || dateKey(today0());
      if (a > b) [a, b] = [b, a];
      const maks = dateKey(new Date(parseKey(a).getFullYear(), parseKey(a).getMonth(), parseKey(a).getDate() + 365));
      return { startKey: a, endKey: b > maks ? maks : b };
    }
    if (dash.period === "year") { let c2 = cur; for (let i = 0; i < 11; i++) c2 = prevCycle(c2, tgl); return { startKey: c2.startKey, endKey: cur.endKey }; } // 12 siklus gajian = setahun
    return { startKey: cur.startKey, endKey: cur.endKey };
  }


  const SL = { hijau: "Aman 🟢", kuning: "Hati-hati 🟡", merah: "Gawat 🔴" };
  const sumPockets = () => S.pockets.reduce((a, p) => a + (p.saldo || 0), 0);

  // Kartu ringkasan paling atas: saldo (bisa disembunyikan), hitung mundur gajian (bisa disembunyikan), batas harian, prakiraan
  function renderHero() {
    const g = guard(), c = S.cycle;
    const saldo = sumPockets();
    const unpaid = unpaidInCycle().reduce((a, o) => a + o.nom, 0);
    const f = forecastBalance({ saldo, tx: S.tx, cycle: c, unpaidBills: unpaid });
    const hs = S.hide.saldo, hg = S.hide.gajian;
    const dayTxt = c.dayNumber === 1 ? "Hari gajian 🎉" : `H-${c.daysLeft}`;
    const runway = hs ? "" : f.runway === null ? "Belum ada data pengeluaran untuk prakiraan" : `Cukup ±${f.runway} hari dengan pola belanjamu`;
    const nudges = [];
    if (S.pockets.length && saldo === 0 && !S.pockets.some((p) => p.saldo)) nudges.push(`<div class="card nudge"><span>👛 Saldo pocket masih Rp 0. Isi saldo awal tiap pocket supaya dashboard akurat.</span><button class="mini-btn" type="button" data-go="pockets">Buka Pocket</button></div>`);
    // Susunan HP: total saldo paling atas, di bawahnya "menuju gajian" dan "boleh dipakai hari ini" berdampingan
    $("dash-hero").innerHTML = `
      <div class="card hc hc-saldo"><div class="hc-top"><span>💰 Total saldo</span>${S.eyeBtn("saldo")}</div>
        <div class="hc-big">${esc(S.mask(fmtRp(saldo)))}</div>
        <div class="hc-sub">${S.pockets.length} pocket${runway ? " · " + esc(runway) : ""}</div></div>
      <div class="card hc hc-half"><div class="hc-top"><span>🗓️ Menuju gajian</span>${S.eyeBtn("gajian")}</div>
        <div class="hc-big">${hg ? "H-••" : esc(dayTxt)}</div>
        <div class="hc-sub muted">${hg ? "Disembunyikan" : `Gajian ${esc(fmtTgl(c.next))} · hari ke-${c.dayNumber}/${c.totalDays}`}</div>
        <div class="bar" style="margin-top:8px"><i style="width:${g.timePct}%;background:#B9A894"></i></div></div>
      <div class="card hc hc-half guard s-${g.status}"><div class="hc-top"><span class="pill">${SL[g.status]}</span></div>
        <div class="hc-sub muted">Boleh dipakai hari ini</div>
        <div class="hc-big" style="color:var(--s)">${fmtRp(Math.max(0, g.todayLeft))}</div>
        <div class="hc-sub muted">${g.todayLeft < 0 ? `Lewat ${fmtRp(-g.todayLeft)}` : `Batas ${fmtRp(g.dailyLimit)}/hari`}</div></div>
      ${nudges.join("")}`;
  }
  // Diagram garis ringkas (SVG): pemasukan dan pengeluaran per siklus
  function lineChart(rows) {
    const W = 320, H = 160, L = 34, R = 10, T = 10, B = 24;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.masuk, r.keluar)));
    const x = (i) => L + (rows.length > 1 ? (i * (W - L - R)) / (rows.length - 1) : (W - L - R) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const pts = (k) => rows.map((r, i) => `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
    const grid = [0, 0.5, 1].map((fr) => { const yy = T + (H - T - B) * (1 - fr); return `<line class="gl" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 4}" y="${yy + 3}" text-anchor="end">${fr ? fmtRingkas(max * fr) : "0"}</text>`; }).join("");
    const step = Math.ceil(rows.length / 6);
    const labels = rows.map((r, i) => ((rows.length - 1 - i) % step === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(r.label)}</text>` : "")).join("");
    const dots = (k, warna) => rows.map((r, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(r[k]).toFixed(1)}" r="${r.isCurrent ? 4 : 2.6}" fill="${warna}"/>`).join("");
    const cols = rows.map((r, i) => { const w = (W - L - R) / Math.max(1, rows.length - 1); return `<rect class="lp" x="${(x(i) - w / 2).toFixed(1)}" y="${T}" width="${w.toFixed(1)}" height="${H - T - B}" fill="transparent" data-t="${esc(r.label + " · masuk " + fmtRp(r.masuk) + " · keluar " + fmtRp(r.keluar))}"/>`; }).join("");
    return `<svg class="lc" viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagram garis pemasukan dan pengeluaran per siklus">${grid}${labels}
      <polyline class="ln" stroke="#10B981" points="${pts("masuk")}"/><polyline class="ln" stroke="#FF9A3D" points="${pts("keluar")}"/>${dots("masuk", "#10B981")}${dots("keluar", "#FF9A3D")}${cols}</svg>`;
  }

  // Saran / nasihat keuangan: aturan sederhana berdasarkan data siklus berjalan
  function adviceCard() {
    const c = S.cycle, tgl = S.profile.tanggalGajian, gaji = S.profile.gajiBulanan || 0;
    const g = guard(), m = (n) => esc(S.mask(fmtRp(n)));
    const f = cashflow({ tx: S.txAll, startKey: c.startKey, endKey: c.endKey });
    const a = analyze({ tx: S.txAll, categories: S.categories.concat([CAT_ADMIN]), envelopes: S.envelopes, startKey: c.startKey, endKey: c.endKey });
    const out = [];
    if (g.status === "merah") out.push(["🚨", g.remaining <= 0 ? "Jatah harianmu sudah habis. <b>Tahan dulu belanja keinginan</b> sampai gajian dan hanya bayar yang benar-benar perlu." : "Tempo belanjamu terlalu cepat. Coba <b>pangkas 1–2 pengeluaran non-esensial</b> (jajan, hiburan) mulai hari ini supaya uang cukup sampai gajian."]);
    else if (g.status === "kuning") out.push(["⚠️", "Pengeluaranmu mendekati batas harian. Tunda dulu pembelian yang <b>bukan kebutuhan</b> selama 2–3 hari ke depan."]);
    else out.push(["💪", "Pengeluaranmu terkendali. Kalau di akhir siklus masih ada sisa, <b>langsung pindahkan ke tabungan</b> supaya tidak habis tanpa terasa."]);

    const idealSave = Math.round(gaji * 0.2 / 1000) * 1000;
    if (f.inc > 0 && f.rate !== null) {
      if (f.rate < 10) out.push(["🐷", `Tingkat tabunganmu baru <b>${Math.round(f.rate)}%</b>. Targetkan minimal 10%, idealnya 20% dari pemasukan${idealSave ? ` (±${m(idealSave)} per bulan)` : ""}.`]);
      else if (f.rate < 20) out.push(["📈", `Tingkat tabunganmu <b>${Math.round(f.rate)}%</b>, sudah baik. Naikkan pelan-pelan ke 20% dengan menyisihkan di awal gajian.`]);
      else out.push(["🌟", `Tingkat tabunganmu <b>${Math.round(f.rate)}%</b>, luar biasa. Pastikan surplusnya benar-benar dipindah ke tabungan, bukan dibiarkan menganggur di dompet harian.`]);
    } else if (idealSave) out.push(["🐷", `Biasakan <b>menabung di awal</b>, bukan dari sisa. Untuk gajimu, 20% itu sekitar <b>${m(idealSave)}</b> per bulan.`]);

    // Dana darurat: 3–6x pengeluaran bulanan
    const bulanan = cycleTotals(S.txAll, tgl, 6).filter((r) => r.total > 0).map((r) => r.total);
    const rataBulan = bulanan.length ? bulanan.reduce((x, y) => x + y, 0) / bulanan.length : gaji * 0.7;
    const simpan = S.savings.reduce((x, y) => x + (y.terkumpul || 0), 0);
    if (rataBulan > 0) {
      if (!S.savings.length) out.push(["🛟", `Kamu belum punya tabungan di Finix. Mulai dari <b>dana darurat</b>: target 3–6 kali pengeluaran bulanan (±${m(rataBulan * 3)} sampai ${m(rataBulan * 6)}). Menabung Rp 50.000 per minggu pun sudah awal yang bagus.`]);
      else if (simpan < rataBulan * 3) out.push(["🛟", `Tabunganmu ${m(simpan)}, belum menyentuh 3× pengeluaran bulanan (±${m(rataBulan * 3)}). <b>Prioritaskan dana darurat</b> sebelum tujuan lain.`]);
      else if (simpan >= rataBulan * 6) out.push(["🛡️", "Dana daruratmu sudah kuat (lebih dari 6× pengeluaran bulanan). Kelebihannya bisa diarahkan ke tujuan jangka panjang, dan pelajari dulu risikonya kalau ingin berinvestasi."]);
    }

    // Tagihan dan cicilan
    const occ = occurrencesInRange(S.bills, c.start, c.next);
    const telat = occ.filter((o) => !o.paid && billStatus(o).kode === "telat");
    const cicilan = occ.filter((o) => o.bill.tipe === "tenor").reduce((x, o) => x + o.nom, 0);
    if (telat.length) out.push(["⏰", `Ada <b>${telat.length} tagihan telat</b>. Bayar secepatnya supaya tidak kena denda atau mengganggu riwayat kreditmu.`]);
    else if (gaji && cicilan / gaji > 0.3) out.push(["💳", `Cicilanmu bulan ini sekitar <b>${Math.round((cicilan / gaji) * 100)}%</b> dari gaji. Batas sehat umumnya maksimal 30%, jadi hindari menambah cicilan baru dulu.`]);

    // Kebiasaan belanja
    const top = a.byCategory[0];
    if (a.small.count >= 5 && a.total > 0 && a.small.total / a.total >= 0.1) out.push(["🧋", `Pengeluaran kecil (di bawah Rp 25.000) sudah <b>${Math.round((a.small.total / a.total) * 100)}%</b> dari total. Coba aturan 24 jam: tunda belanja kecil sehari, banyak yang ternyata tidak jadi dibeli.`]);
    else if (top && top.pct >= 45 && a.count >= 5) out.push(["🎯", `<b>${esc(top.nama)}</b> menyedot ${Math.round(top.pct)}% pengeluaranmu. Coba cek apakah ada yang bisa dihemat di situ.`]);

    // Target tabungan bertenggat
    const tg = S.savings.filter((x) => x.tipe !== "bebas").map((x) => ({ x, p: savingProgress(x) })).find((r) => r.p.perBulan && !r.p.tercapai);
    if (tg) out.push(["🎯", `Agar <b>${esc(tg.x.nama)}</b> tercapai tepat waktu, sisihkan ±<b>${m(tg.p.perBulan)}</b> per bulan.`]);

    const umum = [
      "Bayar dirimu sendiri dulu: pindahkan jatah tabungan begitu gaji masuk, baru belanja dari sisanya.",
      "Cek langganan bulananmu (streaming, aplikasi, paket data). Yang jarang dipakai lebih baik dihentikan.",
      "Pisahkan pocket untuk tabungan dari pocket untuk belanja harian supaya tidak tergoda memakainya.",
      "Aturan 50/30/20 bisa jadi patokan: 50% kebutuhan, 30% keinginan, 20% tabungan dan cicilan.",
      "Sebelum membeli barang mahal, bandingkan harga dan tunggu 24 jam. Kalau masih ingin, baru beli.",
      "Catat setiap pengeluaran, termasuk yang kecil. Yang tercatat bisa dikendalikan.",
      "Dana darurat sebaiknya disimpan di tempat yang aman dan mudah dicairkan, bukan di aset yang naik turun.",
    ];
    out.push(["💡", umum[(c.dayNumber + new Date(c.start).getMonth()) % umum.length]]);
    const tampil = out.slice(0, 5);
    return `<div class="card advice"><h4>Saran keuangan untukmu</h4><div class="muted">Berdasarkan data siklus ini</div>${tampil.map(([i, t]) => `<div class="insight"><span>${i}</span><span>${t}</span></div>`).join("")}
      <div class="advice-note muted">Saran umum berdasarkan catatanmu, bukan nasihat investasi atau hukum.</div></div>`;
  }

  // Arus kas: pemasukan vs pengeluaran, sebaran saldo per pocket, perbandingan antar siklus
  function renderFlow() {
    const { startKey, endKey } = dashRange();
    const f = cashflow({ tx: S.txAll, startKey, endKey });
    const max = Math.max(1, ...f.byDay.map((d) => Math.max(d.masuk, d.keluar)));
    const todayKey = dateKey(today0());
    const bars = f.byDay.map((d) => `<div class="fb${d.future ? " fut" : ""}${d.key === todayKey ? " today" : ""}" data-t="${esc(fmtTgl(d.date) + " · masuk " + fmtRp(d.masuk) + " · keluar " + fmtRp(d.keluar))}"><i class="in" style="height:${(d.masuk / max) * 100}%"></i><i class="out" style="height:${(d.keluar / max) * 100}%"></i></div>`).join("");
    const mid = f.byDay[Math.floor(f.byDay.length / 2)].date, last = f.byDay[f.byDay.length - 1].date;

    const net = f.net;
    const kpis = `<div class="kpis">
      <div class="card kpi"><div class="k">Pemasukan</div><div class="v n-in">${fmtRp(f.inc)}</div></div>
      <div class="card kpi"><div class="k">Pengeluaran</div><div class="v n-out">${fmtRp(f.exp)}</div></div>
      <div class="card kpi"><div class="k">Selisih (arus kas bersih)</div><div class="v ${net >= 0 ? "n-in" : "n-out"}">${net >= 0 ? "+" : "−"}${fmtRp(Math.abs(net))}</div></div>
      <div class="card kpi"><div class="k">Tingkat tabungan</div><div class="v">${f.rate === null ? "–" : Math.round(f.rate) + "%"}</div><div class="d muted">${f.rate === null ? "belum ada pemasukan" : f.rate >= 20 ? "sehat 👍" : f.rate >= 0 ? "bisa ditingkatkan" : "defisit ⚠️"}</div></div></div>`;

    if (dash.period === "year") {
      const rows12 = flowByCycle(S.txAll, S.profile.tanggalGajian, 12);
      $("dash-flow").innerHTML = kpis + `<div class="card"><h4>Pemasukan vs pengeluaran, 12 siklus</h4><div class="muted">Satu titik = satu siklus gajian. Ketuk titik untuk melihat nominalnya.</div>
        <div class="lc-legend"><span><i class="dot" style="background:var(--hijau)"></i>Pemasukan</span><span><i class="dot" style="background:#FF9A3D"></i>Pengeluaran</span></div>${lineChart(rows12)}</div>`;
      return;
    }
    const chart = `<div class="card span2"><h4>Arus kas harian</h4><div class="muted"><span class="dot" style="background:var(--hijau);display:inline-block"></span> pemasukan &nbsp; <span class="dot" style="background:#FF9A3D;display:inline-block"></span> pengeluaran · ketuk batang untuk detail</div>
      <div class="fbars">${bars}</div><div class="axis"><span>${fmtTgl(f.byDay[0].date)}</span><span>${fmtTgl(mid)}</span><span>${fmtTgl(last)}</span></div></div>`;

    const pks = S.pockets.filter((p) => (p.saldo || 0) > 0), tot = pks.reduce((a, p) => a + p.saldo, 0);
    let acc = 0;
    const seg = pks.map((p) => { const pct = (p.saldo / tot) * 100, c = (POCKET_TYPES[p.tipe] || POCKET_TYPES.lain).warna, r = `${c} ${acc}% ${acc + pct}%`; acc += pct; return r; }).join(",");
    const dist = `<div class="card"><h4>Sebaran dana di pocket</h4><div class="muted" style="margin-bottom:14px">Di mana uangmu tersimpan</div>
      ${pks.length ? `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${seg})"><div class="donut-c"><div><small>Total</small><br><b>${esc(S.hide.saldo ? "••••" : fmtRingkas(tot))}</b></div></div></div>
      <div class="legend">${pks.map((p) => `<div><span class="dot" style="background:${esc((POCKET_TYPES[p.tipe] || POCKET_TYPES.lain).warna)}"></span><span style="flex:1">${esc(p.ikon || "👛")} ${esc(p.nama)}</span><b>${Math.round((p.saldo / tot) * 100)}%</b></div>`).join("")}</div></div>`
      : `<div class="empty">Belum ada saldo di pocket manapun.</div>`}</div>`;

    const rows = flowByCycle(S.txAll, S.profile.tanggalGajian, 6);
    const rmax = Math.max(1, ...rows.map((r) => Math.max(r.masuk, r.keluar)));
    const cyc = `<div class="card"><h4>Pemasukan vs pengeluaran per siklus</h4><div class="muted">6 siklus gajian terakhir</div>
      <div class="col-bars">${rows.map((r) => `<div class="cc${r.isCurrent ? " hi" : ""}"><div class="cv">${r.keluar ? fmtRingkas(r.keluar) : ""}</div><div class="ct dual"><i class="in" style="height:${(r.masuk / rmax) * 100}%"></i><i class="out" style="height:${(r.keluar / rmax) * 100}%"></i></div><div class="col-lbl">${esc(r.label)}</div></div>`).join("")}</div></div>`;

    const tips = [];
    if (f.inc === 0) tips.push(["💼", "Belum ada pemasukan tercatat di periode ini. Catat gaji atau pemasukan lain supaya arus kas dan tingkat tabungan bisa dihitung."]);
    else if (net < 0) tips.push(["⚠️", `Pengeluaran melebihi pemasukan sebesar <b>${fmtRp(-net)}</b> di periode ini. Cek kategori terbesar di bawah.`]);
    else tips.push(["✅", `Arus kas positif: kamu menyisihkan <b>${fmtRp(net)}</b> (${Math.round(f.rate)}% dari pemasukan).`]);
    const biggestPk = [...S.pockets].sort((a, b) => (b.saldo || 0) - (a.saldo || 0))[0];
    if (!S.hide.saldo && biggestPk && tot > 0 && (biggestPk.saldo / tot) > 0.7 && pks.length > 1) tips.push(["👛", `${Math.round((biggestPk.saldo / tot) * 100)}% danamu ada di <b>${esc(biggestPk.nama)}</b>. Pastikan pocket untuk kebutuhan harian tetap terisi.`]);
    const cash = S.pockets.filter((p) => p.tipe === "cash").reduce((a, p) => a + (p.saldo || 0), 0);
    if (!S.hide.saldo && S.pockets.some((p) => p.tipe === "cash") && cash <= 0 && S.pockets.length > 1) tips.push(["🏧", "Saldo Cash kosong. Kalau butuh uang tunai, catat <b>Tarik tunai</b> dulu supaya saldo pocket tetap cocok."]);
    const insight = `<div class="card"><h4>Wawasan arus kas</h4>${tips.map(([i, t]) => `<div class="insight"><span>${i}</span><span>${t}</span></div>`).join("")}</div>`;

    $("dash-flow").innerHTML = kpis + `<div class="grid2">${chart}${dist}${cyc}${insight}</div>`;
  }

  function renderDashboard() {
    if (!ready()) return;
    renderHero(); renderFlow(); renderAnalytics();
  }

  function renderAnalytics() {
    if (!ready()) return;
    document.querySelectorAll("#dash-seg button").forEach((b) => b.classList.toggle("active", b.dataset.p === dash.period));
    const { startKey, endKey } = dashRange();
    $("dash-custom").hidden = dash.period !== "custom";
    if (dash.period === "custom") { $("dash-from").value = startKey; $("dash-to").value = endKey; }
    const todayKey = dateKey(today0());
    const a = analyze({ tx: S.txAll, categories: S.categories.concat([CAT_ADMIN]), envelopes: S.envelopes, startKey, endKey });
    $("dash-range").textContent = `${fmtTgl(parseKey(startKey))} – ${fmtTgl(parseKey(endKey))}`;
    // Tampilan tahunan cukup diagram garis (di bagian arus keuangan), jadi analisis detail disembunyikan
    const tahunan = dash.period === "year";
    $("dash-ana-title").hidden = $("dash-kpis").hidden = $("dash-body").hidden = tahunan;
    if (tahunan) return;

    // KPI
    let banding = "";
    if (dash.period === "now") {
      const c = compareWithPrevious(S.txAll, S.cycle, S.profile.tanggalGajian);
      if (c.pct !== null) {
        const naik = c.pct > 0;
        banding = `<div class="d ${naik ? "up" : "down"}">${naik ? "▲" : "▼"} ${Math.abs(Math.round(c.pct))}% vs siklus lalu</div>`;
      }
    }
    $("dash-kpis").innerHTML = `
      <div class="card kpi"><div class="k">Total pengeluaran</div><div class="v">${fmtRp(a.total)}</div>${banding}</div>
      <div class="card kpi"><div class="k">Rata-rata per hari</div><div class="v">${fmtRp(a.avgPerDay)}</div><div class="d muted">dari ${a.elapsed} hari berjalan</div></div>
      <div class="card kpi"><div class="k">Jumlah catatan</div><div class="v">${a.count}</div></div>
      <div class="card kpi"><div class="k">Hari termahal</div><div class="v">${a.peakDay && a.peakDay.total ? fmtRp(a.peakDay.total) : "–"}</div><div class="d muted">${a.peakDay && a.peakDay.total ? fmtTgl(a.peakDay.date) : "belum ada"}</div></div>`;

    if (!a.count) {
      $("dash-body").innerHTML = `<div class="card"><div class="empty">Belum ada pengeluaran di periode ini.<br>Catat pengeluaran dulu, nanti grafiknya muncul di sini 📊</div></div><div class="grid2" style="margin-top:14px">${adviceCard()}${cycleCompareCard()}</div>`;
      return;
    }

    // Grafik harian
    const max = Math.max(1, ...a.byDay.map((d) => d.total), a.avgPerDay);
    const bars = a.byDay.map((d) => `<div class="vb${d.future ? " fut" : ""}${d.key === todayKey ? " today" : ""}" data-t="${esc(fmtTgl(d.date) + " · " + fmtRp(d.total))}"><i style="height:${(d.total / max) * 100}%"></i></div>`).join("");
    const mid = a.byDay[Math.floor(a.byDay.length / 2)].date, last = a.byDay[a.byDay.length - 1].date;
    const harian = `<div class="card">
      <h4>Pengeluaran harian</h4><div class="muted">Ketuk batang untuk melihat nominalnya</div>
      <div class="vbars">${bars}<div class="avgline" style="bottom:${(a.avgPerDay / max) * 100}%"><span>rata-rata ${fmtRingkas(a.avgPerDay)}</span></div></div>
      <div class="axis"><span>${fmtTgl(a.byDay[0].date)}</span><span>${fmtTgl(mid)}</span><span>${fmtTgl(last)}</span></div></div>`;

    // Per kategori
    const topCat = a.byCategory.slice(0, 8);
    const kategori = `<div class="card"><h4>Ke mana uangmu pergi</h4><div class="muted" style="margin-bottom:12px">Per kategori</div>
      ${topCat.map((c, i) => `<div class="hrow"><div class="hh"><span>${esc(c.ikon)} ${esc(c.nama)}</span><b>${fmtRp(c.total)} <small>${Math.round(c.pct)}%</small></b></div>
      <div class="bar"><i style="width:${c.pct}%;background:${PALET[i % PALET.length]}"></i></div></div>`).join("")}</div>`;

    // Per pos (donut)
    let acc = 0;
    const seg = a.byEnvelope.map((e) => { const s = `${e.warna} ${acc}% ${acc + e.pct}%`; acc += e.pct; return s; }).join(",");
    const pos = `<div class="card"><h4>Per pos keuangan</h4><div class="muted" style="margin-bottom:14px">Pembagian pengeluaranmu</div>
      <div class="donut-wrap"><div class="donut" style="background:conic-gradient(${seg})"><div class="donut-c"><div><small>Total</small><br><b>${fmtRingkas(a.total)}</b></div></div></div>
      <div class="legend">${a.byEnvelope.map((e) => `<div><span class="dot" style="background:${esc(e.warna)}"></span><span style="flex:1">${esc(e.ikon)} ${esc(e.nama)}</span><b>${Math.round(e.pct)}%</b></div>`).join("")}</div></div></div>`;

    // Hari dalam seminggu
    const wmax = Math.max(1, ...a.weekday.map((w) => w.avg));
    const minggu = `<div class="card"><h4>Hari apa paling boros?</h4><div class="muted">Rata-rata pengeluaran per hari</div>
      <div class="col-bars">${a.weekday.map((w) => `<div class="cc${a.peakWeekday && w.idx === a.peakWeekday.idx ? " hi" : ""}"><div class="cv">${w.avg ? fmtRingkas(w.avg) : ""}</div><div class="ct"><i style="height:${(w.avg / wmax) * 100}%"></i></div><div class="col-lbl">${w.singkat}</div></div>`).join("")}</div></div>`;

    // Wawasan
    const tips = [];
    const t = a.byCategory[0];
    if (t) tips.push(["🎯", `Pengeluaran terbesarmu ada di <b>${esc(t.ikon)} ${esc(t.nama)}</b>: ${fmtRp(t.total)} (${Math.round(t.pct)}% dari total).`]);
    if (a.peakWeekday && a.peakWeekday.avg > 0) tips.push(["📆", `Rata-rata kamu paling boros di hari <b>${a.peakWeekday.nama}</b>: ${fmtRp(a.peakWeekday.avg)} per hari.`]);
    if (a.small.count >= 5 && a.total > 0 && a.small.total / a.total >= 0.1) tips.push(["🧋", `Ada <b>${a.small.count} catatan kecil</b> (di bawah Rp 25.000) yang totalnya ${fmtRp(a.small.total)}. Pengeluaran kecil yang rutin sering tak terasa, tapi menumpuk.`]);
    if (a.biggest) tips.push(["💥", `Catatan termahal: ${fmtRp(a.biggest.nominal)}${a.biggest.catatan ? ` (${esc(a.biggest.catatan)})` : ""}.`]);
    if (dash.period === "now") {
      const c = compareWithPrevious(S.txAll, S.cycle, S.profile.tanggalGajian);
      if (c.pct !== null) tips.push([c.pct > 0 ? "📈" : "📉", `Di hari ke-${S.cycle.dayNumber}, pengeluaranmu <b>${c.pct > 0 ? "naik" : "turun"} ${Math.abs(Math.round(c.pct))}%</b> dibanding siklus lalu (${fmtRp(c.before)} → ${fmtRp(c.cur)}).`]);
    }
    const wawasan = `<div class="card"><h4>Wawasan untukmu</h4>${tips.map(([i, tx]) => `<div class="insight"><span>${i}</span><span>${tx}</span></div>`).join("")}</div>`;

    $("dash-body").innerHTML = `<div class="grid2">${harian.replace('class="card"', 'class="card span2"')}${kategori}${pos}${minggu}${wawasan}${adviceCard()}${cycleCompareCard()}</div>`;
  }

  function cycleCompareCard() {
    const rows = cycleTotals(S.txAll, S.profile.tanggalGajian, 6);
    const max = Math.max(1, ...rows.map((r) => r.total));
    return `<div class="card"><h4>Perbandingan antar siklus</h4><div class="muted">6 siklus gajian terakhir</div>
      <div class="col-bars">${rows.map((r) => `<div class="cc${r.isCurrent ? " hi" : ""}"><div class="cv">${r.total ? fmtRingkas(r.total) : ""}</div><div class="ct"><i style="height:${(r.total / max) * 100}%"></i></div><div class="col-lbl">${esc(r.label)}</div></div>`).join("")}</div></div>`;
  }

  $("dash-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    dash.period = b.dataset.p;
    if (dash.period === "custom" && !dash.from) { dash.from = S.cycle.startKey; dash.to = dateKey(today0()); }
    renderDashboard();
  });
  const gantiTanggal = () => {
    const a = $("dash-from").value, b = $("dash-to").value;
    if (!a || !b) return;
    dash.from = a; dash.to = b;
    if (a > b) toast("Tanggal awal lebih besar dari tanggal akhir, saya tukar otomatis");
    else if (parseKey(b) - parseKey(a) > 365 * 86400000) toast("Maksimal 1 tahun, dipotong otomatis");
    renderDashboard();
  };
  $("dash-from").addEventListener("change", gantiTanggal);
  $("dash-to").addEventListener("change", gantiTanggal);
  $("screen-dashboard").addEventListener("click", (e) => {
    const bar = e.target.closest(".vb, .fb, .lp"); if (bar) toast(bar.dataset.t);
  });

  /* ================================================================
     ANGGARAN
     ================================================================ */
  function renderBudget() {
    if (!ready()) return;
    const cd = S.cycleDoc, c = S.cycle;
    const g = guard();
    const unpaid = unpaidInCycle();
    const unpaidTotal = unpaid.reduce((a, o) => a + o.nom, 0);
    const plan = planMoney({ guard: g, cycleDoc: cd, envelopes: S.envelopes, unpaidTotal, cycle: c });

    $("bud-aman").textContent = fmtRp(plan.aman);
    $("bud-perhari").textContent = `≈ ${fmtRp(plan.perHari)} per hari selama ${c.daysLeft} hari lagi`;
    const envName = plan.env ? plan.env.nama : "pos tagihan";
    $("bud-detail").innerHTML = `
      <div class="kv"><span>Sisa uang harian</span><b>${fmtRp(g.remaining)}</b></div>
      <div class="kv"><span>Tagihan belum dibayar (${unpaid.length})</span><b>${fmtRp(unpaidTotal)}</b></div>
      <div class="kv"><span>Tersedia di pos ${esc(envName)}</span><b>${fmtRp(plan.posSisa)}</b></div>
      ${plan.kekurangan > 0 ? `<div class="kv bad"><span>Kurang, diambil dari uang harian</span><b>−${fmtRp(plan.kekurangan)}</b></div>` : ""}`;
    $("bud-note").textContent = plan.kekurangan > 0
      ? `Pos ${envName} kurang ${fmtRp(plan.kekurangan)} untuk tagihan sebelum gajian, jadi uang harianmu dikurangi supaya semua tagihan tetap terbayar.`
      : unpaid.length ? "Pos tagihanmu cukup untuk semua tagihan sebelum gajian 👍" : "Belum ada tagihan sebelum gajian. Tambahkan di menu Tagihan supaya perhitungan makin akurat.";
    $("bud-hero").dataset.bad = plan.kekurangan > 0 ? "1" : "";

    // Anggaran per kategori, dikelompokkan per pos
    const spent = {};
    S.tx.filter((x) => x.jenis === "keluar").forEach((x) => { spent[x.categoryId] = (spent[x.categoryId] || 0) + x.nominal; });
    $("bud-groups").innerHTML = S.envelopes.map((e) => {
      const cats = S.categories.filter((k) => k.envelopeId === e.id && !k.bebas);
      const alok = (cd.alokasi || {})[e.id] || 0;
      const sum = cats.reduce((a, k) => a + catBudget(k, c), 0);
      const over = sum > alok;
      return `<div class="card bgroup"><div class="bg-head"><span class="b-name"><b>${esc(e.ikon)} ${esc(e.nama)}</b><button class="edit-btn" type="button" data-epos="${esc(e.id)}" aria-label="Ubah pos ${esc(e.nama)}">✏️</button></span>
        <small class="${over ? "bad-t" : ""}">Anggaran ${fmtRp(sum)} dari ${fmtRp(alok)}${over ? " ⚠️" : ""}</small></div>
        ${cats.map((k) => {
          const harian = k.mode === "harian";
          const b = catBudget(k, c), u = spent[k.id] || 0;
          const r = b > 0 ? u / b : 0;
          const warna = r > 1 ? "var(--merah)" : r >= 0.8 ? "var(--kuning)" : "var(--hijau)";
          const proy = b > 0 && c.dayNumber >= 3 ? (u / c.dayNumber) * c.totalDays : 0;
          const sub = b <= 0 ? `Terpakai ${fmtRp(u)} · belum diatur`
            : u > b ? `Lebih ${fmtRp(u - b)} dari anggaran`
            : `Terpakai ${fmtRp(u)} · sisa ${fmtRp(b - u)}`;
          const warn = !harian && proy > b * 1.05 && u <= b ? ` · <span class="bad-t">perkiraan lewat ±${fmtRp(proy - b)}</span>` : "";
          let info = "";
          if (harian) {
            const per = dailyTotal(k), hariTxt = HARI_URUT.filter(([v]) => (k.hariAktif || []).includes(v)).map(([, n]) => n).join(", ");
            const aktifHariIni = (k.hariAktif || []).includes(today0().getDay());
            const hariIni = S.tx.filter((x) => x.jenis === "keluar" && x.categoryId === k.id && x.hariKe === dateKey(today0())).reduce((a, x) => a + x.nominal, 0);
            info = `<div class="muted b-sub">📅 Harian ${fmtRp(per)} · ${esc(hariTxt)} · ${countWeekdays(c.start, c.next, k.hariAktif)} hari di siklus ini${aktifHariIni ? ` · hari ini ${fmtRp(hariIni)} dari ${fmtRp(per)}` : ""}</div>
              <div class="muted b-sub">${(k.rincian || []).map((r) => `${esc(r.nama)} ${fmtRp(r.nominal)}`).join(" · ")}</div>`;
          }
          return `<div class="brow"><div class="b-top"><span class="b-name"><span>${esc(k.ikon)} ${esc(k.nama)}</span><button class="edit-btn" type="button" data-ecat="${esc(k.id)}" aria-label="Ubah kategori ${esc(k.nama)}">✏️</button></span>
            <input class="b-in" data-cat="${esc(k.id)}" data-orig="${b}" inputmode="numeric" autocomplete="off" placeholder="Atur Rp"${harian ? ' readonly data-ro="1"' : ""} value="${b ? b.toLocaleString("id-ID") : ""}" aria-label="Anggaran ${esc(k.nama)}"></div>
            <div class="bar"><i style="width:${Math.min(100, r * 100)}%;background:${warna}"></i></div>
            <div class="muted b-sub">${sub}${warn}</div>${info}</div>`;
        }).join("")}${cats.length ? "" : `<div class="empty" style="padding:8px">Belum ada kategori di pos ini.</div>`}<button class="add-cat" type="button" data-addcat="${esc(e.id)}">+ Tambah kategori di pos ini</button></div>`;
    }).join("");

    // Kategori bebas: tidak punya anggaran, tapi tetap dihitung ke batas harian
    const bebas = S.categories.filter((k) => k.bebas);
    const totBebas = bebas.reduce((a, k) => a + (spent[k.id] || 0), 0);
    $("bud-bebas").innerHTML = `<div class="card bgroup"><div class="bg-head"><span class="b-name"><b>🧺 Kategori bebas</b></span><small>Di luar anggaran · terpakai ${fmtRp(totBebas)}</small></div>
      ${bebas.map((k) => `<div class="brow"><div class="b-top"><span class="b-name"><span>${esc(k.ikon)} ${esc(k.nama)}</span><button class="edit-btn" type="button" data-ecat="${esc(k.id)}" aria-label="Ubah kategori ${esc(k.nama)}">✏️</button></span><b>${fmtRp(spent[k.id] || 0)}</b></div></div>`).join("")}
      ${bebas.length ? "" : `<div class="empty" style="padding:8px">Belum ada. Contoh: bayar sampah, parkir di luar anggaran, tol, sedekah.</div>`}
      <div class="muted b-sub" style="padding:4px 2px 8px">Pengeluaran kategori ini tidak terikat anggaran kategori, tapi tetap mengurangi uang harian dan dikontrol oleh batas pengeluaran harian.</div>
      <button class="add-cat" type="button" data-addbebas="1">+ Tambah kategori bebas</button></div>`;
  }
  $("bud-bebas").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ecat]");
    if (c) { const cat = S.categories.find((k) => k.id === c.dataset.ecat); if (cat) openCatSheet(cat); return; }
    if (e.target.closest("[data-addbebas]")) openCatSheet(null, null, true);
  });

  // simpan anggaran saat kolom ditinggalkan
  $("bud-groups").addEventListener("input", (e) => {
    const el = e.target.closest(".b-in"); if (!el) return;
    const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : "";
  });
  $("bud-groups").addEventListener("click", (e) => {
    const el = e.target.closest(".b-in[data-ro]"); if (!el) return;
    const cat = S.categories.find((k) => k.id === el.dataset.cat); if (cat) openCatSheet(cat, null);
  });
  $("bud-groups").addEventListener("focusout", (e) => {
    const el = e.target.closest(".b-in"); if (!el || el.readOnly) return;
    const n = parseRp(el.value);
    if (String(n) === el.dataset.orig) return;
    const next = e.relatedTarget && e.relatedTarget.dataset ? e.relatedTarget.dataset.cat : null;
    const cat = S.categories.find((k) => k.id === el.dataset.cat); if (!cat) return;
    if (n > 999999999) { toast("Nominalnya terlalu besar"); return; }
    cat.anggaran = n;
    setDoc(doc(db, "users", S.user.uid, "categories", cat.id), { anggaran: n }, { merge: true })
      .catch((err) => { console.error(err); toast("Anggaran gagal tersimpan: " + (err.code || err.message)); });
    renderBudget();
    if (next) { const nx = document.querySelector(`.b-in[data-cat="${CSS.escape(next)}"]`); if (nx) nx.focus(); }
  });

  $("bud-auto").addEventListener("click", async () => {
    if (S.categories.some((k) => k.anggaran) && !confirm("Anggaran yang sudah kamu isi akan diganti saran otomatis. Lanjut?")) return;
    const history = avgSpendByCategory(S.txAll, S.profile.tanggalGajian, 3);
    const saran = suggestBudgets({ categories: S.categories.filter((k) => !k.bebas), envelopes: S.envelopes, alokasi: S.cycleDoc.alokasi || {}, history });
    const batch = writeBatch(db);
    S.categories.forEach((k) => {
      if (saran[k.id] === undefined || k.mode === "harian") return;
      k.anggaran = saran[k.id];
      batch.set(doc(db, "users", S.user.uid, "categories", k.id), { anggaran: saran[k.id] }, { merge: true });
    });
    batch.commit().catch((err) => { console.error(err); toast("Gagal menyimpan saran"); });
    renderBudget();
    toast(Object.keys(history).length ? "Anggaran diisi dari kebiasaanmu bulan lalu ✨" : "Anggaran dibagi rata sesuai pos ✨");
  });

  /* ---------- Ubah / tambah / hapus kategori dan ubah nama pos ---------- */
  const IKON_KATEGORI = IKON_UMUM;
  const IKON_POS = ["🍚", "🧾", "🛟", "🎈", "💼", "🏠", "🚗", "🎓", "🏥", "✈️", "🎯", "💰", "🤲", "🛣️", "🅿️", "🛒", "📱", "🎁", "🐾", "💳"];
  const cf = { id: null, ikon: "🧋", mode: "bulanan", hari: [], rinc: [] };
  const ef = { id: null, ikon: "🍚" };
  const renderPick = (box, cur) => $(box).querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === cur));
  $("cf-ikon").innerHTML = IKON_KATEGORI.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("ef-ikon").innerHTML = IKON_POS.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("cf-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { cf.ikon = b.dataset.i; renderPick("cf-ikon", cf.ikon); } });
  $("ef-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { ef.ikon = b.dataset.i; renderPick("ef-ikon", ef.ikon); } });
  $("cf-anggaran").addEventListener("input", () => fmtInput($("cf-anggaran")));

  const PRESET_RINCIAN = ["Parkir", "Ongkos busway", "Ongkos kereta", "Ojek online", "Makan siang"];
  function renderModeKat() {
    $("cf-mode").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.m === cf.mode));
    $("cf-wrap-bulanan").hidden = cf.mode !== "bulanan";
    $("cf-wrap-harian").hidden = cf.mode !== "harian";
    if (cf.mode !== "harian") return;
    $("cf-hari").innerHTML = HARI_URUT.map(([v, n]) => `<button type="button" class="chip${cf.hari.includes(v) ? " on" : ""}" data-v="${v}">${n}</button>`).join("");
    $("cf-rinc").innerHTML = cf.rinc.map((r, i) => `<div class="rinc-row"><input type="text" data-k="nama" data-i="${i}" maxlength="30" placeholder="Contoh: Parkir" value="${esc(r.nama)}" autocomplete="off"><input type="text" data-k="nominal" data-i="${i}" inputmode="numeric" placeholder="Rp 0" value="${r.nominal ? Number(r.nominal).toLocaleString("id-ID") : ""}" autocomplete="off"><button type="button" class="edit-btn" data-del="${i}" aria-label="Hapus rincian">🗑️</button></div>`).join("");
    sumKat();
  }
  function sumKat() {
    const per = cf.rinc.reduce((a, r) => a + (Number(r.nominal) || 0), 0);
    const n = S.cycle ? countWeekdays(S.cycle.start, S.cycle.next, cf.hari) : 0;
    $("cf-rinc-sum").innerHTML = `Per hari: <b>${fmtRp(per)}</b><br>Siklus ini: ${n} hari × ${fmtRp(per)} = <b>${fmtRp(per * n)}</b>`;
  }
  $("cf-mode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { cf.mode = b.dataset.m; if (cf.mode === "harian" && !cf.rinc.length) cf.rinc = [{ nama: "", nominal: 0 }]; renderModeKat(); } });
  $("cf-hari").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const v = Number(b.dataset.v);
    cf.hari = cf.hari.includes(v) ? cf.hari.filter((x) => x !== v) : cf.hari.concat(v);
    b.classList.toggle("on", cf.hari.includes(v)); sumKat();
  });
  $("cf-rinc").addEventListener("input", (e) => {
    const el = e.target.closest("input[data-i]"); if (!el) return;
    const r = cf.rinc[Number(el.dataset.i)];
    if (el.dataset.k === "nominal") r.nominal = fmtInput(el); else r.nama = el.value;
    sumKat();
  });
  $("cf-rinc").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    cf.rinc.splice(Number(b.dataset.del), 1); renderModeKat();
  });
  $("cf-rinc-add").onclick = () => { if (cf.rinc.length >= 12) { toast("Maksimal 12 rincian"); return; } cf.rinc.push({ nama: "", nominal: 0 }); renderModeKat(); };
  $("cf-rinc-preset").innerHTML = PRESET_RINCIAN.map((n) => `<button type="button" class="chip" data-n="${esc(n)}">${esc(n)}</button>`).join("");
  $("cf-rinc-preset").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || cf.rinc.length >= 12) return;
    const kosong = cf.rinc.find((r) => !r.nama && !r.nominal);
    if (kosong) kosong.nama = b.dataset.n; else cf.rinc.push({ nama: b.dataset.n, nominal: 0 });
    renderModeKat();
  });

  function openCatSheet(cat, envId, bebas = false) {
    cf.bebas = cat ? !!cat.bebas : bebas;
    cf.id = cat ? cat.id : null; cf.ikon = cat ? cat.ikon || "🧋" : "🧋";
    $("cf-title").textContent = (cat ? "Ubah kategori" : "Tambah kategori") + (cf.bebas ? " bebas" : "");
    $("cf-nama").value = cat ? cat.nama : "";
    $("cf-pos").innerHTML = S.envelopes.map((e) => `<option value="${esc(e.id)}">${esc(e.ikon)} ${esc(e.nama)}</option>`).join("");
    $("cf-pos").value = cat ? cat.envelopeId : (envId || (S.envelopes[0] || {}).id);
    cf.mode = cat && cat.mode === "harian" ? "harian" : "bulanan";
    cf.hari = cat && Array.isArray(cat.hariAktif) ? cat.hariAktif.slice() : [1, 2, 3, 4, 5];
    cf.rinc = cat && Array.isArray(cat.rincian) ? cat.rincian.map((r) => ({ nama: r.nama, nominal: Number(r.nominal) || 0 })) : [];
    $("cf-anggaran").value = cat && cat.mode !== "harian" && cat.anggaran ? cat.anggaran.toLocaleString("id-ID") : "";
    renderModeKat();
    ["cf-wrap-pos", "cf-mode"].forEach((id) => { $(id).hidden = cf.bebas; });
    $("cf-bebas-info").hidden = !cf.bebas;
    if (cf.bebas) { $("cf-wrap-bulanan").hidden = true; $("cf-wrap-harian").hidden = true; }
    $("cf-delete").hidden = !cat; $("cf-error").textContent = "";
    renderPick("cf-ikon", cf.ikon);
    $("cat-sheet").hidden = false;
    if (!cat) setTimeout(() => $("cf-nama").focus(), 50);
  }
  const closeCatSheet = () => { $("cat-sheet").hidden = true; };
  $("cf-close").onclick = closeCatSheet;
  $("cat-sheet").addEventListener("click", (e) => { if (e.target === $("cat-sheet")) closeCatSheet(); });
  $("bud-add").onclick = () => openCatSheet(null, null);

  $("cf-save").onclick = () => {
    const harianEnv = (S.envelopes.find((e) => e.untukHarian) || S.envelopes[0] || {}).id;
    const nama = $("cf-nama").value.trim().slice(0, 24), envelopeId = cf.bebas ? harianEnv : $("cf-pos").value, anggaran = cf.bebas ? 0 : parseRp($("cf-anggaran").value);
    const err = $("cf-error");
    if (!nama) { err.textContent = "Nama kategorinya diisi dulu ya."; return; }
    if (!S.envelopes.some((e) => e.id === envelopeId)) { err.textContent = "Pilih pos untuk kategori ini."; return; }
    if (anggaran > 999999999) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (S.categories.some((k) => k.id !== cf.id && k.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama kategori ini sudah ada."; return; }
    const uid = S.user.uid;
    const old = cf.id ? S.categories.find((k) => k.id === cf.id) : null;
    const id = old ? old.id : doc(collection(db, "users", uid, "categories")).id;
    const urutan = old ? (old.urutan ?? 0) : Math.max(-1, ...S.categories.map((k) => k.urutan ?? 0)) + 1;
    const data = { ...(old || {}), id, nama, ikon: cf.ikon, envelopeId, anggaran, urutan, mode: cf.bebas ? "bulanan" : cf.mode };
    if (cf.bebas) data.bebas = true;
    if (!cf.bebas && cf.mode === "harian") {
      const rincian = cf.rinc.filter((r) => r.nominal > 0).map((r) => ({ nama: String(r.nama || "").trim().slice(0, 30) || "Pengeluaran", nominal: r.nominal }));
      if (!cf.hari.length) { err.textContent = "Pilih minimal satu hari."; return; }
      if (!rincian.length) { err.textContent = "Isi minimal satu rincian pengeluaran harian beserta nominalnya."; return; }
      if (rincian.some((r) => r.nominal >= 1e9)) { err.textContent = "Nominalnya terlalu besar."; return; }
      data.hariAktif = cf.hari.slice().sort((a, b) => a - b); data.rincian = rincian;
      data.anggaran = catBudget(data, S.cycle);
    }
    if (old) Object.assign(old, data); else S.categories.push(data);
    S.categories.sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
    setDoc(doc(db, "users", uid, "categories", id), data, { merge: true }).catch((e2) => { console.error(e2); toast("Kategori gagal tersimpan: " + (e2.code || e2.message)); });
    closeCatSheet(); renderBudget();
    toast(old ? "Kategori diperbarui" : "Kategori ditambahkan ✨");
  };

  $("cf-delete").onclick = () => {
    const cat = S.categories.find((k) => k.id === cf.id); if (!cat) return;
    if (!cat.bebas && S.categories.filter((k) => !k.bebas).length <= 1) { $("cf-error").textContent = "Minimal harus ada satu kategori anggaran."; return; }
    if (!confirm(`Hapus kategori “${cat.nama}”? Catatan lama dengan kategori ini tetap ada dan tampil sebagai “Lainnya”.`)) return;
    S.categories = S.categories.filter((k) => k.id !== cat.id);
    deleteDoc(doc(db, "users", S.user.uid, "categories", cat.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeCatSheet(); renderBudget(); toast("Kategori dihapus");
  };

  // Hitung ulang jatah tiap pos di siklus berjalan setelah persentase / daftar pos berubah.
  // Tambahan manual (pemasukan yang "ditambahkan ke jatah anggaran") tetap dipertahankan.
  S.recalcCycle = (batch, oldEnvelopes) => {
    const cd = S.cycleDoc; if (!cd || !S.cycle) return;
    const total = S.profile.gajiBulanan;
    const oldSplit = splitSalary(cd.gajiMasuk ?? total, oldEnvelopes);
    const newSplit = splitSalary(total, S.envelopes);
    const alokasi = {};
    S.envelopes.forEach((e) => {
      const extra = ((cd.alokasi || {})[e.id] || 0) - (oldSplit[e.id] || 0);
      alokasi[e.id] = Math.max(0, newSplit[e.id] + extra);
    });
    batch.update(doc(db, "users", S.user.uid, "cycles", S.cycle.id), { alokasi, gajiMasuk: total });
  };

  const totalPersen = (exceptId, plus) => S.envelopes.filter((e) => e.id !== exceptId).reduce((a, e) => a + (e.persen || 0), 0) + plus;
  function updateEnvInfo() {
    const n = Number($("ef-persen").value) || 0, tot = totalPersen(ef.id, n);
    const rp = Math.floor(((S.profile.gajiBulanan || 0) * n) / 100);
    const el = $("ef-info");
    el.innerHTML = `${n ? `≈ ${fmtRp(rp)} per siklus. ` : ""}` + (tot > 100 ? `<span class="bad-t">Total semua pos ${tot}%, melebihi 100%. Kurangi dulu.</span>`
      : tot < 100 ? `Total semua pos ${tot}%. Sisa ${100 - tot}% otomatis masuk ke pos Dana Bebas.` : "Total semua pos 100% 👍");
  }
  $("ef-persen").addEventListener("input", updateEnvInfo);

  function openEnvSheet(env) {
    ef.id = env ? env.id : null; ef.ikon = env ? env.ikon || "🍚" : "🎯";
    $("ef-title").textContent = env ? "Ubah pos" : "Tambah pos";
    $("ef-nama").value = env ? env.nama : "";
    $("ef-persen").value = env ? env.persen ?? 0 : Math.max(0, 100 - totalPersen(null, 0));
    $("ef-harian").checked = env ? !!env.untukHarian : false;
    $("ef-delete").hidden = !env; $("ef-error").textContent = "";
    renderPick("ef-ikon", ef.ikon);
    updateEnvInfo();
    $("env-sheet").hidden = false;
    if (!env) setTimeout(() => $("ef-nama").focus(), 50);
  }
  const closeEnvSheet = () => { $("env-sheet").hidden = true; };
  $("ef-close").onclick = closeEnvSheet;
  $("env-sheet").addEventListener("click", (e) => { if (e.target === $("env-sheet")) closeEnvSheet(); });
  $("bud-add-pos").onclick = () => openEnvSheet(null);

  $("ef-save").onclick = () => {
    const err = $("ef-error");
    const old = ef.id ? S.envelopes.find((e) => e.id === ef.id) : null;
    const nama = $("ef-nama").value.trim().slice(0, 30);
    const persen = Number($("ef-persen").value);
    if (!nama) { err.textContent = "Nama posnya diisi dulu ya."; return; }
    if (!Number.isInteger(persen) || persen < 0 || persen > 100) { err.textContent = "Persentase antara 0 sampai 100 (bilangan bulat) ya."; return; }
    if (S.envelopes.some((e) => e.id !== ef.id && e.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama pos ini sudah ada."; return; }
    if (totalPersen(ef.id, persen) > 100) { err.textContent = "Total persentase semua pos tidak boleh lebih dari 100%."; return; }
    const uid = S.user.uid, oldEnvs = S.envelopes.map((e) => ({ ...e }));
    const id = old ? old.id : doc(collection(db, "users", uid, "envelopes")).id;
    const harian = $("ef-harian").checked;
    const data = { ...(old || { tipe: "lain", warna: PALET[S.envelopes.length % PALET.length] }), id, nama, ikon: ef.ikon, persen, untukHarian: harian };
    if (old) Object.assign(old, data); else S.envelopes.push(data);
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid, "envelopes", id), data, { merge: true });
    S.recalcCycle(batch, oldEnvs);
    batch.commit().catch((e2) => { console.error(e2); toast("Pos gagal tersimpan: " + (e2.code || e2.message)); });
    closeEnvSheet(); renderBudget();
    toast(old ? "Pos diperbarui" : "Pos ditambahkan ✨");
  };

  $("ef-delete").onclick = () => {
    const env = S.envelopes.find((e) => e.id === ef.id); if (!env) return;
    const err = $("ef-error");
    if (S.envelopes.length <= 1) { err.textContent = "Minimal harus ada satu pos."; return; }
    if (S.categories.some((k) => k.envelopeId === env.id)) { err.textContent = "Pos ini masih punya kategori. Pindahkan atau hapus kategorinya dulu."; return; }
    if (!confirm(`Hapus pos “${env.nama}”? Jatahnya (${env.persen || 0}%) dihitung ulang ke pos lain. Catatan lama tidak berubah.`)) return;
    const oldEnvs = S.envelopes.map((e) => ({ ...e }));
    S.envelopes = S.envelopes.filter((e) => e.id !== env.id);
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", S.user.uid, "envelopes", env.id));
    S.recalcCycle(batch, oldEnvs);
    batch.commit().catch((e2) => { console.error(e2); toast("Gagal menghapus pos: " + (e2.code || e2.message)); });
    closeEnvSheet(); renderBudget(); toast("Pos dihapus");
  };

  $("bud-groups").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ecat]");
    if (c) { const cat = S.categories.find((k) => k.id === c.dataset.ecat); if (cat) openCatSheet(cat); return; }
    const p = e.target.closest("[data-epos]");
    if (p) { const env = S.envelopes.find((x) => x.id === p.dataset.epos); if (env) openEnvSheet(env); return; }
    const a = e.target.closest("[data-addcat]");
    if (a) openCatSheet(null, a.dataset.addcat);
  });

  const fmtInput = (el) => { const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : ""; return n; };

  /* ================================================================
     KALENDER TAGIHAN
     ================================================================ */
  const t0 = today0();
  const cal = { y: t0.getFullYear(), m: t0.getMonth(), sel: dateKey(t0) };

  function billRow(o) {
    const st = billStatus(o);
    const b = o.bill;
    return `<div class="bill">
      <div class="ic">${esc(b.ikon || "🧾")}</div>
      <div class="tt" data-act="edit" data-id="${esc(b.id)}"><b>${esc(b.nama)}<span class="badge bg-${st.kode}">${esc(st.label)}</span></b>
        <span>${esc(fmtTgl(o.due))} · ${b.tipe === "sekali" ? "sekali" : b.tipe === "tenor" ? `tenor ${o.ke}/${o.dari}` : "tiap bulan"}</span></div>
      <div class="bnom">${fmtRp(o.nom)}</div>
      <button class="mini-btn ${o.paid ? "" : "ok"}" type="button" data-act="${o.paid ? "unpay" : "pay"}" data-id="${esc(b.id)}" data-y="${o.y}" data-m="${o.m}">${o.paid ? "↩ Batal" : "✔ Lunas"}</button>
    </div>`;
  }

  function renderBills() {
    if (!ready()) return;
    const occ = occurrencesInMonth(S.bills, cal.y, cal.m);
    const byDay = {};
    occ.forEach((o) => { (byDay[o.key] = byDay[o.key] || []).push(o); });
    const todayKey = dateKey(today0());

    // Ringkasan sebelum gajian
    const unpaid = unpaidInCycle();
    const total = unpaid.reduce((a, o) => a + o.nom, 0);
    const next = unpaid.sort((a, b) => a.due - b.due)[0];
    $("bill-sum").innerHTML = `
      <div class="card kpi"><div class="k">Belum dibayar sebelum gajian</div><div class="v">${fmtRp(total)}</div><div class="d muted">${unpaid.length} tagihan</div></div>
      <div class="card kpi"><div class="k">Tagihan berikutnya</div><div class="v" style="font-size:17px">${next ? esc(next.bill.nama) : "–"}</div><div class="d muted">${next ? `${esc(fmtTgl(next.due))} · ${esc(billStatus(next).label)}` : "tidak ada"}</div></div>`;

    $("cal-title").textContent = `${BULAN_PANJANG[cal.m]} ${cal.y}`;
    const cells = monthCells(cal.y, cal.m);
    $("cal-grid").innerHTML = HARI_SINGKAT.map((h) => `<div class="cal-dow">${h}</div>`).join("") + cells.map((d) => {
      if (!d) return `<div class="cal-day empty"></div>`;
      const key = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const list = byDay[key] || [];
      const dots = list.slice(0, 3).map((o) => `<i class="d-${billStatus(o).kode}"></i>`).join("");
      return `<button type="button" class="cal-day${key === todayKey ? " today" : ""}${key === cal.sel ? " sel" : ""}" data-key="${key}"><span>${d}</span><span class="dots">${dots}</span></button>`;
    }).join("");

    const selList = byDay[cal.sel] || [];
    $("bill-day-title").textContent = `Tagihan ${fmtTgl(parseKey(cal.sel))}`;
    $("bill-day").innerHTML = selList.length ? selList.map(billRow).join("") : `<div class="empty">Tidak ada tagihan di tanggal ini.</div>`;

    $("bill-month-title").textContent = `Semua tagihan ${BULAN_PANJANG[cal.m]}`;
    const monthTotal = occ.reduce((a, o) => a + o.nom, 0);
    $("bill-month-sub").textContent = occ.length ? `${occ.length} tagihan · total ${fmtRp(monthTotal)}` : "";
    $("bill-month").innerHTML = occ.length ? occ.map(billRow).join("")
      : `<div class="empty">${S.bills.length ? "Tidak ada tagihan bulan ini." : "Belum ada tagihan. Ketuk “Tambah tagihan” supaya tidak lupa bayar 🧾"}</div>`;
  }

  function moveMonth(delta) {
    cal.m += delta;
    if (cal.m > 11) { cal.m = 0; cal.y++; } else if (cal.m < 0) { cal.m = 11; cal.y--; }
    cal.sel = `${cal.y}-${String(cal.m + 1).padStart(2, "0")}-01`;
    const now = today0();
    if (cal.y === now.getFullYear() && cal.m === now.getMonth()) cal.sel = dateKey(now);
    renderBills();
  }
  $("cal-prev").onclick = () => moveMonth(-1);
  $("cal-next").onclick = () => moveMonth(1);
  $("cal-today").onclick = () => { const n = today0(); cal.y = n.getFullYear(); cal.m = n.getMonth(); cal.sel = dateKey(n); renderBills(); };
  $("cal-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".cal-day[data-key]"); if (!b) return;
    cal.sel = b.dataset.key; renderBills();
  });

  const billById = (id) => S.bills.find((b) => b.id === id);

  function billEnvelope() {
    return S.envelopes.find((e) => e.id === "cicilan") || S.envelopes.find((e) => e.tipe === "wajib" && !e.untukHarian) || null;
  }

  function payBill(bill, y, m, pocketId, nom) {
    const env = billEnvelope();
    if (!env) { toast("Pos untuk tagihan belum ada"); return; }
    const cat = S.categories.find((k) => k.envelopeId === env.id) || { id: "cicilan" };
    const uid = S.user.uid, now = new Date();
    const txRef = doc(collection(db, "users", uid, "transactions"));
    const batch = writeBatch(db);
    batch.set(txRef, {
      jenis: "keluar", nominal: nom, pocketId, categoryId: cat.id, envelopeId: env.id, cycleId: S.cycle.id,
      catatan: `Tagihan: ${bill.nama}`.slice(0, 60), tanggal: Timestamp.fromDate(now), hariKe: dateKey(now), tagihanId: bill.id,
    });
    batch.update(doc(db, "users", uid, "cycles", S.cycle.id), { ["terpakai." + env.id]: increment(nom), totalTerpakai: increment(nom) });
    if (S.pockets.some((p) => p.id === pocketId)) batch.update(doc(db, "users", uid, "pockets", pocketId), { saldo: increment(-nom) });
    batch.update(doc(db, "users", uid, "bills", bill.id), { ["paid." + paidKey(y, m)]: { tx: txRef.id, cyc: S.cycle.id, nom, at: dateKey(now), pk: pocketId } });
    batch.set(doc(db, "directory", uid), { jumlahCatatan: increment(1), lastActive: serverTimestamp() }, { merge: true });
    batch.commit().catch((err) => { console.error(err); toast("Gagal menandai lunas. Coba lagi ya."); });
    toast(`${bill.ikon || "🧾"} ${bill.nama} lunas, tercatat di pos ${env.nama}`);
  }

  function unpayBill(bill, y, m) {
    const info = bill.paid && bill.paid[paidKey(y, m)];
    if (!info) return;
    const uid = S.user.uid;
    const batch = writeBatch(db);
    if (info.tx) batch.delete(doc(db, "users", uid, "transactions", info.tx));
    if (info.pk && S.pockets.some((p) => p.id === info.pk)) batch.update(doc(db, "users", uid, "pockets", info.pk), { saldo: increment(info.nom || bill.nominal) });
    const env = billEnvelope();
    if (info.cyc && env) batch.update(doc(db, "users", uid, "cycles", info.cyc), { ["terpakai." + env.id]: increment(-(info.nom || bill.nominal)), totalTerpakai: increment(-(info.nom || bill.nominal)) });
    batch.update(doc(db, "users", uid, "bills", bill.id), { ["paid." + paidKey(y, m)]: deleteField() });
    batch.set(doc(db, "directory", uid), { jumlahCatatan: increment(-1) }, { merge: true });
    batch.commit().catch((err) => { console.error(err); toast("Gagal membatalkan. Coba lagi ya."); });
    toast("Status lunas dibatalkan");
  }

  $("screen-bills").addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]"); if (!el) return;
    const bill = billById(el.dataset.id);
    if (el.dataset.act === "edit" && bill) openBillSheet(bill);
    else if (el.dataset.act === "pay" && bill) {
      const y = Number(el.dataset.y), m = Number(el.dataset.m);
      const occ = occurrencesInMonth([bill], y, m)[0];
      const nom = occ ? occ.nom : bill.nominal;
      S.pickPocket("Dibayar dari pocket mana?", (pid) => payBill(bill, y, m, pid, nom));
    }
    else if (el.dataset.act === "unpay" && bill) unpayBill(bill, Number(el.dataset.y), Number(el.dataset.m));
  });

  /* ---------- Form tambah / ubah tagihan ---------- */
  const bf = { id: null, tipe: "bulanan", ikon: "🧾", cic: [] };
  function renderBillForm() {
    $("bf-tipe").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === bf.tipe));
    $("bf-wrap-hari").hidden = bf.tipe === "sekali";
    $("bf-wrap-tgl").hidden = bf.tipe !== "sekali";
    $("bf-wrap-tenor").hidden = bf.tipe !== "tenor";
    $("bf-nominal-lbl").textContent = bf.tipe === "tenor" ? "Nominal awal (otomatis diisi ke semua bulan)" : "Nominal (Rp)";
    if (bf.tipe === "tenor") renderCicilan();
    $("bf-ikon").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === bf.ikon));
  }
  $("bf-ikon").innerHTML = IKON_TAGIHAN.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("bf-preset").innerHTML = PRESET_TAGIHAN.map(([n, i]) => `<button type="button" class="chip" data-n="${esc(n)}" data-i="${i}">${i} ${esc(n)}</button>`).join("");
  $("bf-preset").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    $("bf-nama").value = b.dataset.n; bf.ikon = b.dataset.i; renderBillForm();
  });
  $("bf-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { bf.ikon = b.dataset.i; renderBillForm(); } });
  $("bf-tipe").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { bf.tipe = b.dataset.t; renderBillForm(); } });
  $("bf-nominal").addEventListener("input", () => {
    const n = fmtInput($("bf-nominal"));
    if (bf.tipe === "tenor") { bf.cic = bf.cic.map(() => n); renderCicilan(); }
  });

  /* Tenor: nominal tiap bulan bisa berbeda */
  const mulaiBf = () => ({ m: Number($("bf-mulai-bln").value), y: Number($("bf-mulai-thn").value) });
  function renderCicilan() {
    const { m, y } = mulaiBf();
    if (!Number.isInteger(y) || y < 2000 || y > 2100) { $("bf-cic-list").innerHTML = ""; return; }
    let mm = m, yy = y;
    $("bf-cic-list").innerHTML = bf.cic.map((n, i) => {
      const lbl = `Bulan ${i + 1} · ${BULAN_PANJANG[mm]} ${yy}`;
      mm++; if (mm > 11) { mm = 0; yy++; }
      return `<label style="margin-bottom:8px"><span>${esc(lbl)}</span><input type="text" inputmode="numeric" data-i="${i}" placeholder="Rp 0" autocomplete="off" value="${n ? n.toLocaleString("id-ID") : ""}"></label>`;
    }).join("");
    $("bf-cic-total").textContent = bf.cic.length ? `Total ${bf.cic.length} bulan: ${fmtRp(bf.cic.reduce((a, n) => a + n, 0))}` : "";
  }
  $("bf-mulai-bln").innerHTML = BULAN_PANJANG.map((n, i) => `<option value="${i}">${n}</option>`).join("");
  $("bf-mulai-bln").addEventListener("change", renderCicilan);
  $("bf-mulai-thn").addEventListener("change", renderCicilan);
  $("bf-jumlah").addEventListener("input", () => {
    const n = Number($("bf-jumlah").value);
    if (!Number.isInteger(n) || n < 1 || n > 60) return;
    const isi = parseRp($("bf-nominal").value);
    bf.cic = Array.from({ length: n }, (_, i) => (i < bf.cic.length ? bf.cic[i] : (bf.cic[bf.cic.length - 1] || isi)));
    renderCicilan();
  });
  $("bf-cic-list").addEventListener("input", (e) => {
    const el = e.target.closest("input[data-i]"); if (!el) return;
    bf.cic[Number(el.dataset.i)] = fmtInput(el);
    $("bf-cic-total").textContent = `Total ${bf.cic.length} bulan: ${fmtRp(bf.cic.reduce((a, n) => a + n, 0))}`;
  });

  function openBillSheet(bill) {
    bf.id = bill ? bill.id : null;
    bf.tipe = bill ? (bill.tipe === "sekali" || bill.tipe === "tenor" ? bill.tipe : "bulanan") : "bulanan";
    bf.ikon = bill ? bill.ikon || "🧾" : "🧾";
    $("bf-title").textContent = bill ? "Ubah tagihan" : "Tambah tagihan";
    $("bf-nama").value = bill ? bill.nama : "";
    $("bf-nominal").value = bill ? bill.nominal.toLocaleString("id-ID") : "";
    $("bf-hari").value = bill && bill.hari ? bill.hari : (parseKey(cal.sel).getDate());
    $("bf-tgl").value = bill && bill.tanggalSekali ? bill.tanggalSekali : cal.sel;
    const mm = bill && bill.tipe === "tenor" && /^(\d{4})-(\d{2})$/.exec(bill.mulai || "");
    bf.cic = mm && Array.isArray(bill.cicilan) ? bill.cicilan.map((n) => Number(n) || 0) : Array(12).fill(0);
    $("bf-mulai-bln").value = String(mm ? Number(mm[2]) - 1 : cal.m);
    $("bf-mulai-thn").value = mm ? mm[1] : cal.y;
    $("bf-jumlah").value = bf.cic.length;
    $("bf-preset").hidden = !!bill;
    $("bf-delete").hidden = !bill;
    $("bf-error").textContent = "";
    renderBillForm();
    $("bill-sheet").hidden = false;
    if (!bill) setTimeout(() => $("bf-nama").focus(), 50);
  }
  const closeBillSheet = () => { $("bill-sheet").hidden = true; };
  $("bill-add").onclick = () => openBillSheet(null);
  $("bf-close").onclick = closeBillSheet;
  $("bill-sheet").addEventListener("click", (e) => { if (e.target === $("bill-sheet")) closeBillSheet(); });

  $("bf-save").onclick = () => {
    const nama = $("bf-nama").value.trim().slice(0, 40);
    const nominal = parseRp($("bf-nominal").value);
    const err = $("bf-error");
    if (!nama) { err.textContent = "Nama tagihannya diisi dulu ya."; return; }
    if (bf.tipe !== "tenor" && (!nominal || nominal >= 1e9)) { err.textContent = "Isi nominal tagihannya dulu ya."; return; }
    const data = { nama, nominal, tipe: bf.tipe, ikon: bf.ikon, aktif: true };
    if (bf.tipe === "tenor") {
      const h = Number($("bf-hari").value), { m, y } = mulaiBf(), n = Number($("bf-jumlah").value);
      if (!Number.isInteger(h) || h < 1 || h > 31) { err.textContent = "Tanggal jatuh tempo antara 1 sampai 31 ya."; return; }
      if (!Number.isInteger(y) || y < 2000 || y > 2100) { err.textContent = "Tahun cicilan pertama belum benar."; return; }
      if (!Number.isInteger(n) || n < 1 || n > 60 || n !== bf.cic.length) { err.textContent = "Lama tenor antara 1 sampai 60 bulan ya."; return; }
      const kosong = bf.cic.findIndex((v) => !v || v >= 1e9);
      if (kosong >= 0) { err.textContent = `Nominal bulan ke-${kosong + 1} belum diisi.`; return; }
      data.hari = h; data.mulai = `${y}-${String(m + 1).padStart(2, "0")}`; data.cicilan = bf.cic.slice(); data.nominal = bf.cic[0];
    } else if (bf.tipe === "bulanan") {
      const h = Number($("bf-hari").value);
      if (!Number.isInteger(h) || h < 1 || h > 31) { err.textContent = "Tanggal jatuh tempo antara 1 sampai 31 ya."; return; }
      data.hari = h;
    } else {
      const k = $("bf-tgl").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { err.textContent = "Pilih tanggal jatuh temponya dulu ya."; return; }
      data.tanggalSekali = k;
    }
    const uid = S.user.uid;
    const ref = bf.id ? doc(db, "users", uid, "bills", bf.id) : doc(collection(db, "users", uid, "bills"));
    if (!bf.id) { data.paid = {}; data.createdAt = serverTimestamp(); }
    setDoc(ref, data, { merge: true }).catch((e2) => { console.error(e2); toast("Tagihan gagal tersimpan: " + (e2.code || e2.message)); });
    closeBillSheet();
    toast(bf.id ? "Tagihan diperbarui" : "Tagihan ditambahkan 🧾");
    if (data.tipe === "tenor") {
      const [ty, tm] = data.mulai.split("-").map(Number), last = new Date(ty, tm, 0).getDate();
      cal.y = ty; cal.m = tm - 1; cal.sel = dateKey(new Date(ty, tm - 1, Math.min(data.hari, last)));
    }
    if (data.tipe === "sekali") { const d = parseKey(data.tanggalSekali); cal.y = d.getFullYear(); cal.m = d.getMonth(); cal.sel = data.tanggalSekali; }
  };

  $("bf-delete").onclick = () => {
    if (!bf.id || !confirm("Hapus tagihan ini? Catatan pembayaran yang sudah ada tetap tersimpan.")) return;
    deleteDoc(doc(db, "users", S.user.uid, "bills", bf.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeBillSheet(); toast("Tagihan dihapus");
  };

  /* ---------- Export (Dashboard, Anggaran, Tagihan) ---------- */
  const namaBulan = (y, m) => `${BULAN_PANJANG[m]} ${y}`;
  const tglLengkap = (d) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
  const akhirSiklus = (c) => new Date(c.next.getFullYear(), c.next.getMonth(), c.next.getDate() - 1);
  const E = (S.exporters = S.exporters || {});

  // Tagihan
  const exOpsiTagihan = () => {
    const c = S.cycle, akhir = akhirSiklus(c);
    return {
      bulan: { label: `Bulan ${namaBulan(cal.y, cal.m)}`, periode: namaBulan(cal.y, cal.m), occ: () => occurrencesInMonth(S.bills, cal.y, cal.m) },
      siklus: { label: `Siklus gaji berjalan (${fmtTgl(c.start)} – ${fmtTgl(akhir)})`, periode: `Siklus ${fmtTgl(c.start)} - ${fmtTgl(akhir)} ${akhir.getFullYear()}`, occ: () => occurrencesInRange(S.bills, c.start, c.next) },
      tahun: { label: `Satu tahun ${cal.y}`, periode: `Tahun ${cal.y}`, occ: () => occurrencesInRange(S.bills, new Date(cal.y, 0, 1), new Date(cal.y + 1, 0, 1)) },
      tenor: { label: "Jadwal lengkap semua tagihan tenor", periode: "Jadwal tenor lengkap",
        occ: () => S.bills.filter((b) => b.tipe === "tenor" && b.aktif !== false)
          .flatMap((b) => tenorSchedule(b).map((r) => occurrencesInMonth([b], r.y, r.m)[0]).filter(Boolean))
          .sort((a, b) => a.due - b.due || String(a.bill.nama).localeCompare(String(b.bill.nama))) },
    };
  };
  const JENIS_TAGIHAN = { bulanan: "Tiap bulan", sekali: "Sekali", tenor: "Tenor" };
  E.Tagihan = {
    scopes: () => Object.entries(exOpsiTagihan()).map(([k, v]) => ({ k, label: v.label })),
    bangun: (k) => {
      const o = exOpsiTagihan()[k] || exOpsiTagihan().bulan;
      const occ = o.occ();
      const baris = occ.map((x) => {
        const info = x.bill.paid && x.bill.paid[paidKey(x.y, x.m)];
        return { id: x.bill.id, nama: x.bill.nama || "Tagihan", jenis: JENIS_TAGIHAN[x.bill.tipe] || "Tiap bulan", nom: x.nom, lunas: x.paid,
          r: [tglLengkap(x.due), x.bill.nama || "Tagihan", JENIS_TAGIHAN[x.bill.tipe] || "Tiap bulan", x.dari ? `${x.ke} / ${x.dari}` : "", x.nom, billStatus(x).label, info && info.at ? tglLengkap(parseKey(info.at)) : ""] };
      });
      const total = baris.reduce((a, r) => a + r.nom, 0), bayar = baris.filter((r) => r.lunas).reduce((a, r) => a + r.nom, 0);
      const peta = new Map();
      baris.forEach((r) => { const x = peta.get(r.id) || { nama: r.nama, jenis: r.jenis, n: 0, total: 0, bayar: 0 }; x.n++; x.total += r.nom; if (r.lunas) x.bayar += r.nom; peta.set(r.id, x); });
      return {
        periode: o.periode,
        sheets: [
          { nama: "Jadwal Tagihan",
            kolom: [{ h: "Jatuh tempo", w: 13 }, { h: "Tagihan", w: 28 }, { h: "Jenis", w: 12 }, { h: "Cicilan ke", w: 11 }, { h: "Nominal", w: 16, t: "rp" }, { h: "Status", w: 14 }, { h: "Tanggal lunas", w: 14 }],
            baris: baris.map((r) => r.r),
            ringkas: [["Total", total], ["Sudah dibayar", bayar], ["Belum dibayar", total - bayar]] },
          { nama: "Ringkasan",
            kolom: [{ h: "Tagihan", w: 28 }, { h: "Jenis", w: 12 }, { h: "Jumlah", w: 9, t: "angka" }, { h: "Total", w: 16, t: "rp" }, { h: "Sudah dibayar", w: 18, t: "rp" }, { h: "Belum dibayar", w: 18, t: "rp" }],
            baris: [...peta.values()].map((x) => [x.nama, x.jenis, x.n, x.total, x.bayar, x.total - x.bayar]) },
        ],
      };
    },
  };

  // Dashboard: mengikuti filter periode yang sedang dipilih
  E.Dashboard = {
    hint: () => { const { startKey, endKey } = dashRange(); return `Periode mengikuti filter di Dashboard: ${fmtTgl(parseKey(startKey))} – ${fmtTgl(parseKey(endKey))}.`; },
    bangun: () => {
      const { startKey, endKey } = dashRange();
      const f = cashflow({ tx: S.txAll, startKey, endKey });
      const a = analyze({ tx: S.txAll, categories: S.categories.concat([CAT_ADMIN]), envelopes: S.envelopes, startKey, endKey });
      const rows = flowByCycle(S.txAll, S.profile.tanggalGajian, 6);
      const todayKey = dateKey(today0());
      return {
        periode: `${tglLengkap(parseKey(startKey))} - ${tglLengkap(parseKey(endKey))}`,
        sheets: [
          { nama: "Ringkasan", kolom: [{ h: "Keterangan", w: 34 }, { h: "Nilai", w: 20, t: "rp" }],
            baris: [["Pemasukan", f.inc], ["Pengeluaran", f.exp], ["Selisih (arus kas bersih)", f.net],
              ["Tingkat tabungan", f.rate === null ? "-" : { v: f.rate, t: "pct" }],
              ["Rata-rata pengeluaran per hari", a.avgPerDay],
              ["Total saldo semua pocket", sumPockets()]] },
          { nama: "Arus Harian", kolom: [{ h: "Tanggal", w: 14 }, { h: "Pemasukan", w: 16, t: "rp" }, { h: "Pengeluaran", w: 16, t: "rp" }, { h: "Selisih", w: 16, t: "rp" }],
            baris: f.byDay.filter((d) => d.key <= todayKey).map((d) => [tglLengkap(d.date), d.masuk, d.keluar, d.masuk - d.keluar]),
            ringkas: [["Total pemasukan", f.inc], ["Total pengeluaran", f.exp], ["Selisih", f.net]] },
          { nama: "Per Kategori", kolom: [{ h: "Kategori", w: 26 }, { h: "Pengeluaran", w: 16, t: "rp" }, { h: "Porsi", w: 10, t: "pct" }],
            baris: a.byCategory.map((c) => [c.nama, c.total, c.pct]) },
          { nama: "Per Siklus", kolom: [{ h: "Siklus (mulai)", w: 18 }, { h: "Pemasukan", w: 16, t: "rp" }, { h: "Pengeluaran", w: 16, t: "rp" }],
            baris: rows.map((r) => [r.label, r.masuk, r.keluar]) },
        ],
      };
    },
  };

  // Anggaran: siklus gaji berjalan
  E.Anggaran = {
    bangun: () => {
      const c = S.cycle, cd = S.cycleDoc || {};
      const spent = {};
      S.tx.filter((x) => x.jenis === "keluar").forEach((x) => { spent[x.categoryId] = (spent[x.categoryId] || 0) + x.nominal; });
      const baris = [];
      S.envelopes.forEach((e) => S.categories.filter((k) => k.envelopeId === e.id && !k.bebas).forEach((k) => {
        const b = catBudget(k, c), u = spent[k.id] || 0;
        baris.push([e.nama, k.nama, k.mode === "harian" ? "Harian" : "Bulanan", b, u, b - u, b > 0 ? { v: (u / b) * 100, t: "pct" } : "-"]);
      }));
      const tb = baris.reduce((a, r) => a + r[3], 0), tu = baris.reduce((a, r) => a + r[4], 0);
      const pos = S.envelopes.map((e) => {
        const ks = S.categories.filter((k) => k.envelopeId === e.id && !k.bebas);
        return [e.nama, (cd.alokasi || {})[e.id] || 0, ks.reduce((a, k) => a + catBudget(k, c), 0), ks.reduce((a, k) => a + (spent[k.id] || 0), 0)];
      });
      const harian = S.categories.filter((k) => k.mode === "harian" && !k.bebas).map((k) => [
        k.nama, HARI_URUT.filter(([v]) => (k.hariAktif || []).includes(v)).map(([, n]) => n).join(", "),
        (k.rincian || []).map((r) => `${r.nama} ${fmtRp(r.nominal)}`).join("; "), dailyTotal(k), countWeekdays(c.start, c.next, k.hariAktif), catBudget(k, c)]);
      const sheets = [
        { nama: "Per Kategori", kolom: [{ h: "Pos", w: 20 }, { h: "Kategori", w: 20 }, { h: "Jenis", w: 10 }, { h: "Anggaran", w: 15, t: "rp" }, { h: "Terpakai", w: 15, t: "rp" }, { h: "Sisa", w: 15, t: "rp" }, { h: "Terpakai %", w: 11, t: "pct" }],
          baris, ringkas: [["Total anggaran", tb], ["Total terpakai", tu], ["Total sisa", tb - tu]] },
        { nama: "Per Pos", kolom: [{ h: "Pos", w: 22 }, { h: "Jatah siklus", w: 16, t: "rp" }, { h: "Anggaran kategori", w: 18, t: "rp" }, { h: "Terpakai", w: 16, t: "rp" }], baris: pos },
      ];
      const bebasK = S.categories.filter((k) => k.bebas);
      if (bebasK.length) sheets.push({ nama: "Kategori Bebas", kolom: [{ h: "Kategori", w: 26 }, { h: "Terpakai", w: 16, t: "rp" }], baris: bebasK.map((k) => [k.nama, spent[k.id] || 0]), ringkas: [["Total terpakai", bebasK.reduce((a, k) => a + (spent[k.id] || 0), 0)]] });
      if (harian.length) sheets.push({ nama: "Rincian Harian", kolom: [{ h: "Kategori", w: 18 }, { h: "Hari", w: 22 }, { h: "Rincian", w: 40 }, { h: "Per hari", w: 14, t: "rp" }, { h: "Jumlah hari", w: 11, t: "angka" }, { h: "Total siklus", w: 15, t: "rp" }], baris: harian });
      return { periode: `Siklus ${tglLengkap(c.start)} - ${tglLengkap(akhirSiklus(c))}`, sheets };
    },
  };

  createReports({ S, $, esc, toast });

  /* ================================================================
     Beranda: kartu tagihan terdekat + lencana di menu
     ================================================================ */
  function renderHomeBills() {
    if (!S.cycle) return;
    const horizon = new Date(today0().getFullYear(), today0().getMonth(), today0().getDate() + 15);
    const list = occurrencesInRange(S.bills, S.cycle.start, horizon).filter((o) => !o.paid)
      .sort((a, b) => a.due - b.due).slice(0, 4);
    const box = $("home-bills");
    if (!S.bills.length) {
      box.innerHTML = `<div class="empty">Belum ada tagihan. Catat tagihan rutinmu supaya tidak lupa bayar.<br><button class="mini-btn ok" type="button" data-go="bills" style="margin-top:10px">+ Tambah tagihan</button></div>`;
    } else if (!list.length) {
      box.innerHTML = `<div class="empty">Tidak ada tagihan dalam 2 minggu ke depan 🎉</div>`;
    } else {
      box.innerHTML = list.map((o) => {
        const st = billStatus(o);
        return `<div class="tx"><div class="ic">${esc(o.bill.ikon || "🧾")}</div>
          <div class="tt"><b>${esc(o.bill.nama)}</b><span>${esc(fmtTgl(o.due))} · <span class="badge bg-${st.kode}" style="margin-left:0">${esc(st.label)}</span></span></div>
          <div class="nom">${fmtRp(o.nom)}</div></div>`;
      }).join("");
    }
    // Lencana merah: ada tagihan telat atau jatuh tempo ≤ 3 hari
    const mendesak = occurrencesInRange(S.bills, S.cycle.start, horizon).filter((o) => !o.paid && billStatus(o).diff <= 3).length;
    document.querySelectorAll(".nav-badge").forEach((el) => { el.hidden = mendesak === 0; });
  }

  // Dengarkan koleksi tagihan; mengembalikan fungsi berhenti-mendengarkan
  function listenBills(onChange) {
    return onSnapshot(collection(db, "users", S.user.uid, "bills"), (s) => {
      S.bills = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange();
    }, (err) => console.error("bills:", err));
  }

  return { renderDashboard, renderBudget, renderBills, renderHomeBills, listenBills };
}