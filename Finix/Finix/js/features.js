// features.js — Dashboard analisis, Anggaran, dan Kalender Tagihan.
import {
  doc, collection, writeBatch, setDoc, deleteDoc, onSnapshot, increment, serverTimestamp, Timestamp, deleteField,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  fmtRp, parseRp, dateKey, fmtTgl, computeGuard, prevCycle, analyze, compareWithPrevious, cycleTotals,
  avgSpendByCategory, suggestBudgets, planMoney, simulate, paidKey, occurrencesInMonth, occurrencesInRange,
  billStatus, monthCells, parseKey, fmtRingkas, HARI_SINGKAT, BULAN_PANJANG,
  cashflow, flowByCycle, forecastBalance, CAT_ADMIN, POCKET_TYPES,
} from "./calc.js";

const PALET = ["#FF7A00", "#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#14B8A6", "#EF4444"];
const IKON_TAGIHAN = ["🧾", "💡", "💧", "🌐", "📱", "🏠", "🚗", "💳", "🛡️", "📺", "🎓", "🏥"];
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
  const dash = { period: "now" };

  function dashRange() {
    const tgl = S.profile.tanggalGajian, cur = S.cycle;
    if (dash.period === "prev") { const p = prevCycle(cur, tgl); return { startKey: p.startKey, endKey: p.endKey }; }
    if (dash.period === "3") { const c2 = prevCycle(prevCycle(cur, tgl), tgl); return { startKey: c2.startKey, endKey: cur.endKey }; }
    return { startKey: cur.startKey, endKey: cur.endKey };
  }


  const SL = { hijau: "Aman 🟢", kuning: "Hati-hati 🟡", merah: "Gawat 🔴" };
  const sumPockets = () => S.pockets.reduce((a, p) => a + (p.saldo || 0), 0);

  // Kartu ringkasan paling atas: saldo (bisa disembunyikan), hitung mundur gajian (bisa disembunyikan), batas harian, prakiraan
  function renderHero() {
    const g = guard(), c = S.cycle;
    const saldo = sumPockets();
    const unpaid = unpaidInCycle().reduce((a, o) => a + o.bill.nominal, 0);
    const f = forecastBalance({ saldo, tx: S.tx, cycle: c, unpaidBills: unpaid });
    const hs = S.hide.saldo, hg = S.hide.gajian;
    const gajiBelum = !S.tx.some((t) => t.jenis === "masuk" && t.categoryId === "gaji");
    const dayTxt = c.dayNumber === 1 ? "Hari gajian 🎉" : `H-${c.daysLeft}`;
    const runway = hs ? "" : f.runway === null ? "Belum ada data pengeluaran untuk prakiraan" : `Cukup ±${f.runway} hari dengan pola belanjamu`;
    const nudges = [];
    if (gajiBelum) nudges.push(`<div class="card nudge"><span>💼 Gaji siklus ini belum dicatat ke pocket.</span><button class="mini-btn brand" type="button" data-act="gaji">Catat gaji ${esc(fmtRp(S.profile.gajiBulanan))}</button></div>`);
    if (S.pockets.length && saldo === 0 && !S.pockets.some((p) => p.saldo)) nudges.push(`<div class="card nudge"><span>👛 Saldo pocket masih Rp 0. Isi saldo awal tiap pocket supaya dashboard akurat.</span><button class="mini-btn" type="button" data-go="pockets">Buka Pocket</button></div>`);
    $("dash-hero").innerHTML = `
      <div class="card hc hc-saldo"><div class="hc-top"><span>💰 Total saldo</span>${S.eyeBtn("saldo")}</div>
        <div class="hc-big">${esc(S.mask(fmtRp(saldo)))}</div>
        <div class="hc-sub">${S.pockets.length} pocket${runway ? " · " + esc(runway) : ""}</div></div>
      <div class="card hc"><div class="hc-top"><span>🗓️ Menuju gajian</span>${S.eyeBtn("gajian")}</div>
        <div class="hc-big">${hg ? "H-••" : esc(dayTxt)}</div>
        <div class="hc-sub muted">${hg ? "Disembunyikan" : `Gajian ${esc(fmtTgl(c.next))} · hari ke-${c.dayNumber} dari ${c.totalDays}`}</div>
        <div class="bar" style="margin-top:10px"><i style="width:${g.timePct}%;background:#B9A894"></i></div></div>
      <div class="card hc guard s-${g.status}"><div class="hc-top"><span class="pill">${SL[g.status]}</span></div>
        <div class="hc-sub muted" style="margin-top:8px">Boleh dipakai hari ini</div>
        <div class="hc-big" style="color:var(--s)">${fmtRp(Math.max(0, g.todayLeft))}</div>
        <div class="hc-sub muted">${g.todayLeft < 0 ? `Lewat ${fmtRp(-g.todayLeft)} dari batas` : `Batas harian ${fmtRp(g.dailyLimit)} · terpakai ${fmtRp(g.spentToday)}`}</div></div>
      <div class="card hc"><div class="hc-top"><span>🔮 Saldo saat gajian (prakiraan)</span></div>
        <div class="hc-big" style="${f.proj < 0 && !hs ? "color:var(--merah)" : ""}">${esc(S.mask((f.proj < 0 ? "−" : "") + fmtRp(Math.abs(f.proj))))}</div>
        <div class="hc-sub muted">Rata-rata belanja ${fmtRp(f.avg)}/hari${unpaid ? ` + tagihan ${fmtRp(unpaid)}` : ""}</div></div>
      ${nudges.join("")}`;
  }
  $("dash-hero").addEventListener("click", (e) => {
    if (e.target.closest('[data-act="gaji"]')) S.openTx("masuk", { nominal: S.profile.gajiBulanan, cat: "gaji" });
  });

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
    const todayKey = dateKey(today0());
    const a = analyze({ tx: S.txAll, categories: S.categories.concat([CAT_ADMIN]), envelopes: S.envelopes, startKey, endKey });
    $("dash-range").textContent = `${fmtTgl(parseKey(startKey))} – ${fmtTgl(parseKey(endKey))}`;

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
      $("dash-body").innerHTML = `<div class="card"><div class="empty">Belum ada pengeluaran di periode ini.<br>Catat pengeluaran dulu, nanti grafiknya muncul di sini 📊</div></div>${cycleCompareCard()}`;
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

    $("dash-body").innerHTML = `<div class="grid2">${harian.replace('class="card"', 'class="card span2"')}${kategori}${pos}${minggu}${wawasan}${cycleCompareCard()}</div>`;
  }

  function cycleCompareCard() {
    const rows = cycleTotals(S.txAll, S.profile.tanggalGajian, 6);
    const max = Math.max(1, ...rows.map((r) => r.total));
    return `<div class="card"><h4>Perbandingan antar siklus</h4><div class="muted">6 siklus gajian terakhir</div>
      <div class="col-bars">${rows.map((r) => `<div class="cc${r.isCurrent ? " hi" : ""}"><div class="cv">${r.total ? fmtRingkas(r.total) : ""}</div><div class="ct"><i style="height:${(r.total / max) * 100}%"></i></div><div class="col-lbl">${esc(r.label)}</div></div>`).join("")}</div></div>`;
  }

  $("dash-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    dash.period = b.dataset.p; renderDashboard();
  });
  $("screen-dashboard").addEventListener("click", (e) => {
    const bar = e.target.closest(".vb, .fb"); if (bar) toast(bar.dataset.t);
  });

  /* ================================================================
     ANGGARAN
     ================================================================ */
  let lastPlan = null;
  function renderBudget() {
    if (!ready()) return;
    const cd = S.cycleDoc, c = S.cycle;
    const g = guard();
    const unpaid = unpaidInCycle();
    const unpaidTotal = unpaid.reduce((a, o) => a + o.bill.nominal, 0);
    const plan = planMoney({ guard: g, cycleDoc: cd, envelopes: S.envelopes, unpaidTotal, cycle: c });
    lastPlan = plan; // dipakai simulator

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
      const cats = S.categories.filter((k) => k.envelopeId === e.id);
      const alok = (cd.alokasi || {})[e.id] || 0;
      const sum = cats.reduce((a, k) => a + (k.anggaran || 0), 0);
      const over = sum > alok;
      return `<div class="card bgroup"><div class="bg-head"><span class="b-name"><b>${esc(e.ikon)} ${esc(e.nama)}</b><button class="edit-btn" type="button" data-epos="${esc(e.id)}" aria-label="Ubah pos ${esc(e.nama)}">✏️</button></span>
        <small class="${over ? "bad-t" : ""}">Anggaran ${fmtRp(sum)} dari ${fmtRp(alok)}${over ? " ⚠️" : ""}</small></div>
        ${cats.map((k) => {
          const b = k.anggaran || 0, u = spent[k.id] || 0;
          const r = b > 0 ? u / b : 0;
          const warna = r > 1 ? "var(--merah)" : r >= 0.8 ? "var(--kuning)" : "var(--hijau)";
          const proy = b > 0 && c.dayNumber >= 3 ? (u / c.dayNumber) * c.totalDays : 0;
          const sub = b <= 0 ? `Terpakai ${fmtRp(u)} · belum diatur`
            : u > b ? `Lebih ${fmtRp(u - b)} dari anggaran`
            : `Terpakai ${fmtRp(u)} · sisa ${fmtRp(b - u)}`;
          const warn = proy > b * 1.05 && u <= b ? ` · <span class="bad-t">perkiraan lewat ±${fmtRp(proy - b)}</span>` : "";
          return `<div class="brow"><div class="b-top"><span class="b-name"><span>${esc(k.ikon)} ${esc(k.nama)}</span><button class="edit-btn" type="button" data-ecat="${esc(k.id)}" aria-label="Ubah kategori ${esc(k.nama)}">✏️</button></span>
            <input class="b-in" data-cat="${esc(k.id)}" data-orig="${b}" inputmode="numeric" autocomplete="off" placeholder="Atur Rp" value="${b ? b.toLocaleString("id-ID") : ""}" aria-label="Anggaran ${esc(k.nama)}"></div>
            <div class="bar"><i style="width:${Math.min(100, r * 100)}%;background:${warna}"></i></div>
            <div class="muted b-sub">${sub}${warn}</div></div>`;
        }).join("")}${cats.length ? "" : `<div class="empty" style="padding:8px">Belum ada kategori di pos ini.</div>`}<button class="add-cat" type="button" data-addcat="${esc(e.id)}">+ Tambah kategori di pos ini</button></div>`;
    }).join("");
    renderSim();
  }

  // simpan anggaran saat kolom ditinggalkan
  $("bud-groups").addEventListener("input", (e) => {
    const el = e.target.closest(".b-in"); if (!el) return;
    const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : "";
  });
  $("bud-groups").addEventListener("focusout", (e) => {
    const el = e.target.closest(".b-in"); if (!el) return;
    const n = parseRp(el.value);
    if (String(n) === el.dataset.orig) return;
    const next = e.relatedTarget && e.relatedTarget.dataset ? e.relatedTarget.dataset.cat : null;
    const cat = S.categories.find((k) => k.id === el.dataset.cat); if (!cat) return;
    if (n > 999999999) { toast("Nominalnya terlalu besar"); return; }
    cat.anggaran = n;
    setDoc(doc(db, "users", S.user.uid, "categories", cat.id), { anggaran: n }, { merge: true })
      .catch((err) => { console.error(err); toast("Anggaran gagal tersimpan"); });
    renderBudget();
    if (next) { const nx = document.querySelector(`.b-in[data-cat="${CSS.escape(next)}"]`); if (nx) nx.focus(); }
  });

  $("bud-auto").addEventListener("click", async () => {
    if (S.categories.some((k) => k.anggaran) && !confirm("Anggaran yang sudah kamu isi akan diganti saran otomatis. Lanjut?")) return;
    const history = avgSpendByCategory(S.txAll, S.profile.tanggalGajian, 3);
    const saran = suggestBudgets({ categories: S.categories, envelopes: S.envelopes, alokasi: S.cycleDoc.alokasi || {}, history });
    const batch = writeBatch(db);
    S.categories.forEach((k) => {
      if (saran[k.id] === undefined) return;
      k.anggaran = saran[k.id];
      batch.set(doc(db, "users", S.user.uid, "categories", k.id), { anggaran: saran[k.id] }, { merge: true });
    });
    batch.commit().catch((err) => { console.error(err); toast("Gagal menyimpan saran"); });
    renderBudget();
    toast(Object.keys(history).length ? "Anggaran diisi dari kebiasaanmu bulan lalu ✨" : "Anggaran dibagi rata sesuai pos ✨");
  });

  /* ---------- Ubah / tambah / hapus kategori dan ubah nama pos ---------- */
  const IKON_KATEGORI = ["🍜", "🛵", "🛒", "📱", "🧋", "🎮", "🧾", "🆘", "☕", "👕", "💊", "🎬", "📚", "🐾", "⛽", "🎁", "💇", "🏋️", "🏠", "💡"];
  const IKON_POS = ["🍚", "🧾", "🛟", "🎈", "💼", "🏠", "🚗", "🎓", "🏥", "✈️", "🎯", "💰"];
  const cf = { id: null, ikon: "🧋" };
  const ef = { id: null, ikon: "🍚" };
  const renderPick = (box, cur) => $(box).querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.i === cur));
  $("cf-ikon").innerHTML = IKON_KATEGORI.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("ef-ikon").innerHTML = IKON_POS.map((i) => `<button type="button" class="cat" data-i="${i}" style="min-height:52px"><span style="font-size:22px">${i}</span></button>`).join("");
  $("cf-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { cf.ikon = b.dataset.i; renderPick("cf-ikon", cf.ikon); } });
  $("ef-ikon").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { ef.ikon = b.dataset.i; renderPick("ef-ikon", ef.ikon); } });
  $("cf-anggaran").addEventListener("input", () => fmtInput($("cf-anggaran")));

  function openCatSheet(cat, envId) {
    cf.id = cat ? cat.id : null; cf.ikon = cat ? cat.ikon || "🧋" : "🧋";
    $("cf-title").textContent = cat ? "Ubah kategori" : "Tambah kategori";
    $("cf-nama").value = cat ? cat.nama : "";
    $("cf-pos").innerHTML = S.envelopes.map((e) => `<option value="${esc(e.id)}">${esc(e.ikon)} ${esc(e.nama)}</option>`).join("");
    $("cf-pos").value = cat ? cat.envelopeId : (envId || (S.envelopes[0] || {}).id);
    $("cf-anggaran").value = cat && cat.anggaran ? cat.anggaran.toLocaleString("id-ID") : "";
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
    const nama = $("cf-nama").value.trim().slice(0, 24), envelopeId = $("cf-pos").value, anggaran = parseRp($("cf-anggaran").value);
    const err = $("cf-error");
    if (!nama) { err.textContent = "Nama kategorinya diisi dulu ya."; return; }
    if (!S.envelopes.some((e) => e.id === envelopeId)) { err.textContent = "Pilih pos untuk kategori ini."; return; }
    if (anggaran > 999999999) { err.textContent = "Nominalnya terlalu besar."; return; }
    if (S.categories.some((k) => k.id !== cf.id && k.nama.toLowerCase() === nama.toLowerCase())) { err.textContent = "Nama kategori ini sudah ada."; return; }
    const uid = S.user.uid;
    const old = cf.id ? S.categories.find((k) => k.id === cf.id) : null;
    const id = old ? old.id : doc(collection(db, "users", uid, "categories")).id;
    const urutan = old ? (old.urutan ?? 0) : Math.max(-1, ...S.categories.map((k) => k.urutan ?? 0)) + 1;
    const data = { ...(old || {}), id, nama, ikon: cf.ikon, envelopeId, anggaran, urutan };
    if (old) Object.assign(old, data); else S.categories.push(data);
    S.categories.sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
    setDoc(doc(db, "users", uid, "categories", id), data, { merge: true }).catch((e2) => { console.error(e2); toast("Kategori gagal tersimpan"); });
    closeCatSheet(); renderBudget();
    toast(old ? "Kategori diperbarui" : "Kategori ditambahkan ✨");
  };

  $("cf-delete").onclick = () => {
    const cat = S.categories.find((k) => k.id === cf.id); if (!cat) return;
    if (S.categories.length <= 1) { $("cf-error").textContent = "Minimal harus ada satu kategori."; return; }
    if (!confirm(`Hapus kategori “${cat.nama}”? Catatan lama dengan kategori ini tetap ada dan tampil sebagai “Lainnya”.`)) return;
    S.categories = S.categories.filter((k) => k.id !== cat.id);
    deleteDoc(doc(db, "users", S.user.uid, "categories", cat.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeCatSheet(); renderBudget(); toast("Kategori dihapus");
  };

  function openEnvSheet(env) {
    ef.id = env.id; ef.ikon = env.ikon || "🍚";
    $("ef-nama").value = env.nama; $("ef-error").textContent = "";
    renderPick("ef-ikon", ef.ikon);
    $("env-sheet").hidden = false;
    setTimeout(() => $("ef-nama").focus(), 50);
  }
  const closeEnvSheet = () => { $("env-sheet").hidden = true; };
  $("ef-close").onclick = closeEnvSheet;
  $("env-sheet").addEventListener("click", (e) => { if (e.target === $("env-sheet")) closeEnvSheet(); });
  $("ef-save").onclick = () => {
    const env = S.envelopes.find((e) => e.id === ef.id); if (!env) return;
    const nama = $("ef-nama").value.trim().slice(0, 30);
    if (!nama) { $("ef-error").textContent = "Nama posnya diisi dulu ya."; return; }
    if (S.envelopes.some((e) => e.id !== env.id && e.nama.toLowerCase() === nama.toLowerCase())) { $("ef-error").textContent = "Nama pos ini sudah ada."; return; }
    env.nama = nama; env.ikon = ef.ikon;
    setDoc(doc(db, "users", S.user.uid, "envelopes", env.id), { ...env }, { merge: true }).catch((e2) => { console.error(e2); toast("Pos gagal tersimpan"); });
    closeEnvSheet(); S.renderAll ? S.renderAll() : renderBudget();
    toast("Pos diperbarui");
  };

  $("bud-groups").addEventListener("click", (e) => {
    const c = e.target.closest("[data-ecat]");
    if (c) { const cat = S.categories.find((k) => k.id === c.dataset.ecat); if (cat) openCatSheet(cat); return; }
    const p = e.target.closest("[data-epos]");
    if (p) { const env = S.envelopes.find((x) => x.id === p.dataset.epos); if (env) openEnvSheet(env); return; }
    const a = e.target.closest("[data-addcat]");
    if (a) openCatSheet(null, a.dataset.addcat);
  });

  // Simulator
  const fmtInput = (el) => { const n = parseRp(el.value); el.value = n ? n.toLocaleString("id-ID") : ""; return n; };
  function renderSim() {
    if (!ready() || !lastPlan) return;
    const belanja = parseRp($("sim-beli").value), rencana = parseRp($("sim-harian").value);
    const s = simulate({ aman: lastPlan.aman, daysLeft: S.cycle.daysLeft, belanja, rencana });
    const L = [];
    if (belanja) {
      L.push(s.kelebihan > 0
        ? `<div class="sim-line bad">Melebihi uang aman sebesar <b>${fmtRp(s.kelebihan)}</b>. Sebaiknya ditunda atau dikurangi.</div>`
        : `<div class="sim-line">Sisa uang aman jadi <b>${fmtRp(s.sisa)}</b>. Jatah per hari turun dari <b>${fmtRp(s.perHariSebelum)}</b> menjadi <b>${fmtRp(s.perHariSesudah)}</b>.</div>`);
    }
    if (rencana) {
      if (s.habisTgl) L.push(`<div class="sim-line bad">Dengan ${fmtRp(rencana)} per hari, uangmu habis tanggal <b>${fmtTgl(s.habisTgl)}</b>, ${s.hariLebihAwal} hari sebelum gajian.</div>`);
      else L.push(`<div class="sim-line ok">Dengan ${fmtRp(rencana)} per hari, uangmu cukup sampai gajian dan masih sisa <b>${fmtRp(s.saldoAkhir)}</b> 👍</div>`);
    }
    if (!belanja && !rencana) L.push(`<div class="sim-line muted">Isi salah satu kolom di atas untuk melihat hasilnya. Jatah aman sekarang: <b>${fmtRp(s.perHariSebelum)}</b> per hari.</div>`);
    $("sim-out").innerHTML = L.join("");
  }
  $("sim-beli").addEventListener("input", () => { fmtInput($("sim-beli")); renderSim(); });
  $("sim-harian").addEventListener("input", () => { fmtInput($("sim-harian")); renderSim(); });

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
        <span>${esc(fmtTgl(o.due))} · ${b.tipe === "sekali" ? "sekali" : "tiap bulan"}</span></div>
      <div class="bnom">${fmtRp(b.nominal)}</div>
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
    const total = unpaid.reduce((a, o) => a + o.bill.nominal, 0);
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
    const monthTotal = occ.reduce((a, o) => a + o.bill.nominal, 0);
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

  function payBill(bill, y, m, pocketId) {
    const env = billEnvelope();
    if (!env) { toast("Pos untuk tagihan belum ada"); return; }
    const cat = S.categories.find((k) => k.envelopeId === env.id) || { id: "cicilan" };
    const uid = S.user.uid, now = new Date();
    const txRef = doc(collection(db, "users", uid, "transactions"));
    const batch = writeBatch(db);
    batch.set(txRef, {
      jenis: "keluar", nominal: bill.nominal, pocketId, categoryId: cat.id, envelopeId: env.id, cycleId: S.cycle.id,
      catatan: `Tagihan: ${bill.nama}`.slice(0, 60), tanggal: Timestamp.fromDate(now), hariKe: dateKey(now), tagihanId: bill.id,
    });
    batch.update(doc(db, "users", uid, "cycles", S.cycle.id), { ["terpakai." + env.id]: increment(bill.nominal), totalTerpakai: increment(bill.nominal) });
    if (S.pockets.some((p) => p.id === pocketId)) batch.update(doc(db, "users", uid, "pockets", pocketId), { saldo: increment(-bill.nominal) });
    batch.update(doc(db, "users", uid, "bills", bill.id), { ["paid." + paidKey(y, m)]: { tx: txRef.id, cyc: S.cycle.id, nom: bill.nominal, at: dateKey(now), pk: pocketId } });
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
    else if (el.dataset.act === "pay" && bill) S.pickPocket("Dibayar dari pocket mana?", (pid) => payBill(bill, Number(el.dataset.y), Number(el.dataset.m), pid));
    else if (el.dataset.act === "unpay" && bill) unpayBill(bill, Number(el.dataset.y), Number(el.dataset.m));
  });

  /* ---------- Form tambah / ubah tagihan ---------- */
  const bf = { id: null, tipe: "bulanan", ikon: "🧾" };
  function renderBillForm() {
    $("bf-tipe").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.t === bf.tipe));
    $("bf-wrap-hari").hidden = bf.tipe !== "bulanan";
    $("bf-wrap-tgl").hidden = bf.tipe !== "sekali";
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
  $("bf-nominal").addEventListener("input", () => fmtInput($("bf-nominal")));

  function openBillSheet(bill) {
    bf.id = bill ? bill.id : null;
    bf.tipe = bill ? (bill.tipe === "sekali" ? "sekali" : "bulanan") : "bulanan";
    bf.ikon = bill ? bill.ikon || "🧾" : "🧾";
    $("bf-title").textContent = bill ? "Ubah tagihan" : "Tambah tagihan";
    $("bf-nama").value = bill ? bill.nama : "";
    $("bf-nominal").value = bill ? bill.nominal.toLocaleString("id-ID") : "";
    $("bf-hari").value = bill && bill.hari ? bill.hari : (parseKey(cal.sel).getDate());
    $("bf-tgl").value = bill && bill.tanggalSekali ? bill.tanggalSekali : cal.sel;
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
    if (!nominal || nominal >= 1e9) { err.textContent = "Isi nominal tagihannya dulu ya."; return; }
    const data = { nama, nominal, tipe: bf.tipe, ikon: bf.ikon, aktif: true };
    if (bf.tipe === "bulanan") {
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
    setDoc(ref, data, { merge: true }).catch((e2) => { console.error(e2); toast("Tagihan gagal tersimpan"); });
    closeBillSheet();
    toast(bf.id ? "Tagihan diperbarui" : "Tagihan ditambahkan 🧾");
    if (data.tipe === "sekali") { const d = parseKey(data.tanggalSekali); cal.y = d.getFullYear(); cal.m = d.getMonth(); cal.sel = data.tanggalSekali; }
  };

  $("bf-delete").onclick = () => {
    if (!bf.id || !confirm("Hapus tagihan ini? Catatan pembayaran yang sudah ada tetap tersimpan.")) return;
    deleteDoc(doc(db, "users", S.user.uid, "bills", bf.id)).catch((e2) => { console.error(e2); toast("Gagal menghapus"); });
    closeBillSheet(); toast("Tagihan dihapus");
  };

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
          <div class="nom">${fmtRp(o.bill.nominal)}</div></div>`;
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