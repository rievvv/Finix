// calc.js — logika murni (tanpa Firebase / DOM), gampang dites.

/* ---------- Data bawaan ---------- */

export const DEFAULT_ENVELOPES = [
  { id: 'pokok',   nama: 'Kebutuhan Pokok',   ikon: '🍚', persen: 50, tipe: 'wajib',    untukHarian: true,  warna: '#3B82F6' },
  { id: 'cicilan', nama: 'Cicilan & Tagihan', ikon: '🧾', persen: 20, tipe: 'wajib',    untukHarian: false, warna: '#8B5CF6' },
  { id: 'darurat', nama: 'Tabungan Darurat',  ikon: '🛟', persen: 10, tipe: 'tabungan', untukHarian: false, warna: '#10B981' },
  { id: 'bebas',   nama: 'Dana Bebas',        ikon: '🎈', persen: 20, tipe: 'bebas',    untukHarian: true,  warna: '#F59E0B' },
];

export const DEFAULT_CATEGORIES = [
  { id: 'makan',     nama: 'Makan',          ikon: '🍜', envelopeId: 'pokok' },
  { id: 'transport', nama: 'Transport',      ikon: '🛵', envelopeId: 'pokok' },
  { id: 'belanja',   nama: 'Belanja Harian', ikon: '🛒', envelopeId: 'pokok' },
  { id: 'pulsa',     nama: 'Pulsa & Listrik', ikon: '📱', envelopeId: 'pokok' },
  { id: 'jajan',     nama: 'Jajan',          ikon: '🧋', envelopeId: 'bebas' },
  { id: 'hiburan',   nama: 'Hiburan',        ikon: '🎮', envelopeId: 'bebas' },
  { id: 'cicilan',   nama: 'Bayar Cicilan',  ikon: '🧾', envelopeId: 'cicilan' },
  { id: 'darurat',   nama: 'Dana Darurat',   ikon: '🆘', envelopeId: 'darurat' },
];

/* ---------- Format ---------- */

export const fmtRp = (n) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
export const parseRp = (s) => Number(String(s).replace(/\D/g, '')) || 0;
const pad = (n) => String(n).padStart(2, '0');
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtTgl = (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const DAY = 86400000;

/* ---------- Siklus gajian ---------- */

// Tanggal gajian di bulan tertentu (kalau bulan pendek, dipotong ke hari terakhir).
function paydayIn(year, month, day) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

// Siklus = dari gajian terakhir sampai sehari sebelum gajian berikutnya.
export function getCycle(tanggalGajian, today = new Date()) {
  const t = startOfDay(today);
  let start = paydayIn(t.getFullYear(), t.getMonth(), tanggalGajian);
  if (start > t) start = paydayIn(t.getFullYear(), t.getMonth() - 1, tanggalGajian);
  const next = paydayIn(start.getFullYear(), start.getMonth() + 1, tanggalGajian);
  return {
    id: dateKey(start),
    start, next,
    startKey: dateKey(start),
    endKey: dateKey(addDays(next, -1)),
    totalDays: Math.round((next - start) / DAY),
    dayNumber: Math.round((t - start) / DAY) + 1,   // hari ke-berapa dalam siklus
    daysLeft: Math.round((next - t) / DAY),          // hari menuju gajian (termasuk hari ini)
  };
}

/* ---------- Pembagian otomatis ke pos ---------- */

export function splitSalary(gaji, envelopes = DEFAULT_ENVELOPES) {
  const out = {};
  let used = 0;
  envelopes.forEach((e) => { out[e.id] = Math.floor((gaji * e.persen) / 100); used += out[e.id]; });
  const sisaBulat = gaji - used; // sisa pembulatan masuk ke Dana Bebas
  const target = envelopes.find((e) => e.tipe === 'bebas') || envelopes[0];
  out[target.id] += sisaBulat;
  return out;
}

/* ---------- Smart Budget Guard ---------- */

export function computeGuard({ alokasi, terpakai, tx, envelopes, cycle, today = new Date() }) {
  const harian = new Set(envelopes.filter((e) => e.untukHarian).map((e) => e.id));
  const sum = (obj) => [...harian].reduce((a, id) => a + (obj[id] || 0), 0);

  const budget = sum(alokasi);          // total jatah yang boleh dipakai sehari-hari
  const used = sum(terpakai);
  const remaining = budget - used;      // sisa uang yang boleh dipakai sampai gajian

  const t0 = startOfDay(today);
  const todayKey = dateKey(t0);
  const spending = tx.filter((x) => x.jenis === 'keluar' && harian.has(x.envelopeId));
  const spentToday = spending.filter((x) => x.hariKe === todayKey).reduce((a, x) => a + x.nominal, 0);

  // Rata-rata pengeluaran 3 hari terakhir (atau kurang kalau siklus baru mulai)
  const windowDays = Math.min(3, cycle.dayNumber);
  const keys = new Set(Array.from({ length: windowDays }, (_, i) => dateKey(addDays(t0, -i))));
  const recent = spending.filter((x) => keys.has(x.hariKe)).reduce((a, x) => a + x.nominal, 0);
  const avg = recent / windowDays;

  // Batas aman harian = (sisa uang + yang sudah dipakai hari ini) / sisa hari
  const dailyLimit = Math.max(0, remaining + spentToday) / cycle.daysLeft;
  const todayLeft = dailyLimit - spentToday;

  let status;
  if (remaining <= 0) status = 'merah';
  else if (avg > dailyLimit) status = 'merah';
  else if (avg > dailyLimit * 0.8) status = 'kuning';
  else status = 'hijau';

  // Prediksi kapan uang habis kalau tempo 3 hari terakhir dilanjutkan
  let habisTgl = null, hariLebihAwal = 0;
  if (remaining > 0 && avg > 0) {
    const hariCukup = Math.floor(remaining / avg);
    if (hariCukup < cycle.daysLeft) {
      habisTgl = addDays(t0, hariCukup);
      hariLebihAwal = cycle.daysLeft - hariCukup;
    }
  }

  let message;
  if (status === 'hijau') {
    message = 'Aman! Pengeluaranmu masih di bawah batas harian. Pertahankan ya 💪';
  } else if (status === 'kuning') {
    message = 'Hati-hati dikit ya. Pengeluaran 3 hari terakhir hampir menyentuh batas harian.';
  } else if (remaining <= 0) {
    message = 'Jatah uang harianmu sudah habis. Tahan dulu yang bukan darurat sampai gajian ya, kamu pasti bisa.';
  } else {
    message = `Kalau lanjut segini terus, uangmu habis tanggal ${fmtTgl(habisTgl)}, ${hariLebihAwal} hari sebelum gajian. Yuk irit sedikit mulai hari ini.`;
  }

  return {
    budget, used, remaining, spentToday, avg, dailyLimit, todayLeft,
    status, message, habisTgl, hariLebihAwal,
    timePct: Math.min(100, (cycle.dayNumber / cycle.totalDays) * 100),
    moneyPct: budget > 0 ? Math.min(100, Math.max(0, (used / budget) * 100)) : 0,
  };
}

/* ====================================================================
   Fitur baru: Dashboard (analisis), Anggaran (simulator), Kalender Tagihan
   Semua fungsi di bawah murni (tanpa Firebase / DOM).
   ==================================================================== */

export const HARI_PANJANG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const HARI_SINGKAT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']; // kalender mulai Senin
export const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const parseKey = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d); };
export function fmtRingkas(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + 'jt';
  if (n >= 1e3) return Math.round(n / 1e3) + 'rb';
  return String(n);
}

/* ---------- Rantai siklus ---------- */

export const prevCycle = (cycle, tanggalGajian) => getCycle(tanggalGajian, addDays(cycle.start, -1));

/* ---------- Dashboard: analisis pengeluaran ---------- */

export function sumRange(tx, startKey, endKey) {
  return tx.filter((x) => x.jenis === 'keluar' && x.hariKe >= startKey && x.hariKe <= endKey).reduce((a, x) => a + x.nominal, 0);
}

export function analyze({ tx, categories, envelopes, startKey, endKey, today = new Date() }) {
  const todayKey = dateKey(startOfDay(today));
  const start = parseKey(startKey), end = parseKey(endKey);
  const lastKey = endKey < todayKey ? endKey : todayKey;
  const items = tx.filter((x) => x.jenis === 'keluar' && x.hariKe >= startKey && x.hariKe <= endKey);
  const total = items.reduce((a, x) => a + x.nominal, 0);
  const totalDays = Math.round((end - start) / DAY) + 1;
  const elapsed = Math.max(1, Math.min(totalDays, Math.round((parseKey(lastKey) - start) / DAY) + 1));

  const perDay = {};
  items.forEach((x) => { perDay[x.hariKe] = (perDay[x.hariKe] || 0) + x.nominal; });
  const byDay = Array.from({ length: totalDays }, (_, i) => {
    const d = addDays(start, i), k = dateKey(d);
    return { key: k, date: d, total: perDay[k] || 0, future: k > todayKey };
  });

  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const catTot = {}, envTot = {};
  items.forEach((x) => {
    catTot[x.categoryId] = (catTot[x.categoryId] || 0) + x.nominal;
    envTot[x.envelopeId] = (envTot[x.envelopeId] || 0) + x.nominal;
  });
  const byCategory = Object.entries(catTot).map(([id, v]) => {
    const c = catById[id] || { nama: 'Lainnya', ikon: '💸' };
    return { id, nama: c.nama, ikon: c.ikon, total: v, pct: total ? (v / total) * 100 : 0 };
  }).sort((a, b) => b.total - a.total);
  const byEnvelope = envelopes
    .map((e) => ({ id: e.id, nama: e.nama, ikon: e.ikon, warna: e.warna || '#FF7A00', total: envTot[e.id] || 0, pct: total ? ((envTot[e.id] || 0) / total) * 100 : 0 }))
    .filter((e) => e.total > 0).sort((a, b) => b.total - a.total);

  // Rata-rata per hari dalam seminggu (kolom 0 = Minggu, sesuai Date.getDay)
  const wTot = Array(7).fill(0), wCnt = Array(7).fill(0);
  for (let i = 0; i < elapsed; i++) wCnt[addDays(start, i).getDay()]++;
  items.forEach((x) => { wTot[parseKey(x.hariKe).getDay()] += x.nominal; });
  const weekday = [1, 2, 3, 4, 5, 6, 0].map((idx) => ({ idx, nama: HARI_PANJANG[idx], singkat: HARI_SINGKAT[(idx + 6) % 7], total: wTot[idx], avg: wCnt[idx] ? wTot[idx] / wCnt[idx] : 0 }));
  const peakWeekday = items.length ? weekday.reduce((m, w) => (w.avg > m.avg ? w : m), weekday[0]) : null;

  const peakDay = byDay.reduce((m, d) => (d.total > (m?.total || 0) ? d : m), null);
  const kecil = items.filter((x) => x.nominal <= 25000);
  const biggest = items.reduce((m, x) => (!m || x.nominal > m.nominal ? x : m), null);

  return {
    total, count: items.length, elapsed, totalDays, avgPerDay: total / elapsed,
    byDay, byCategory, byEnvelope, weekday, peakWeekday, peakDay, biggest,
    small: { count: kecil.length, total: kecil.reduce((a, x) => a + x.nominal, 0) },
  };
}

// Pengeluaran siklus ini vs siklus lalu pada hari ke-berapa yang sama.
export function compareWithPrevious(tx, cycle, tanggalGajian, today = new Date()) {
  const prev = prevCycle(cycle, tanggalGajian);
  const uptoPrev = dateKey(addDays(prev.start, cycle.dayNumber - 1));
  const cur = sumRange(tx, cycle.startKey, dateKey(startOfDay(today)));
  const before = sumRange(tx, prev.startKey, uptoPrev < prev.endKey ? uptoPrev : prev.endKey);
  return { cur, before, pct: before > 0 ? ((cur - before) / before) * 100 : null };
}

// Total pengeluaran n siklus terakhir (yang paling lama di depan).
export function cycleTotals(tx, tanggalGajian, n = 6, today = new Date()) {
  const out = [];
  let c = getCycle(tanggalGajian, today);
  for (let i = 0; i < n; i++) {
    out.unshift({ id: c.id, label: c.start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }), total: sumRange(tx, c.startKey, c.endKey), isCurrent: i === 0 });
    c = prevCycle(c, tanggalGajian);
  }
  return out;
}

/* ---------- Anggaran ---------- */

// Rata-rata pengeluaran per kategori dari siklus-siklus sebelumnya yang ada catatannya.
export function avgSpendByCategory(tx, tanggalGajian, maxCycles = 3, today = new Date()) {
  let c = prevCycle(getCycle(tanggalGajian, today), tanggalGajian);
  const sum = {}; let used = 0;
  for (let i = 0; i < maxCycles; i++) {
    const rows = tx.filter((x) => x.jenis === 'keluar' && x.hariKe >= c.startKey && x.hariKe <= c.endKey);
    if (rows.length) { used++; rows.forEach((x) => { sum[x.categoryId] = (sum[x.categoryId] || 0) + x.nominal; }); }
    c = prevCycle(c, tanggalGajian);
  }
  return used ? Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / used])) : {};
}

// Saran anggaran tiap kategori: alokasi pos dibagi sesuai kebiasaan lalu (atau rata kalau belum ada riwayat).
export function suggestBudgets({ categories, envelopes, alokasi, history = {} }) {
  const out = {};
  envelopes.forEach((e) => {
    const cats = categories.filter((c) => c.envelopeId === e.id);
    if (!cats.length) return;
    const pool = alokasi[e.id] || 0;
    const wsum = cats.reduce((a, c) => a + (history[c.id] || 0), 0);
    cats.forEach((c) => {
      const w = wsum > 0 ? (history[c.id] || 0) / wsum : 1 / cats.length;
      out[c.id] = Math.floor((pool * w) / 1000) * 1000;
    });
  });
  return out;
}

// Uang yang benar-benar aman dipakai setelah memperhitungkan tagihan yang belum dibayar.
export function planMoney({ guard, cycleDoc, envelopes, unpaidTotal, cycle }) {
  const env = envelopes.find((e) => e.id === 'cicilan') || envelopes.find((e) => e.tipe === 'wajib' && !e.untukHarian) || null;
  const posSisa = env ? Math.max(0, ((cycleDoc.alokasi || {})[env.id] || 0) - ((cycleDoc.terpakai || {})[env.id] || 0)) : 0;
  const kekurangan = Math.max(0, unpaidTotal - posSisa);
  const aman = Math.max(0, guard.remaining - kekurangan);
  return { env, posSisa, unpaidTotal, kekurangan, aman, perHari: aman / Math.max(1, cycle.daysLeft) };
}

// Simulator "kalau aku beli ini" dan "kalau aku jajan segini per hari".
export function simulate({ aman, daysLeft, belanja = 0, rencana = 0, today = new Date() }) {
  const hari = Math.max(1, daysLeft);
  const sisa = aman - belanja;
  const out = { sisa, perHariSebelum: aman / hari, perHariSesudah: Math.max(0, sisa) / hari, kelebihan: Math.max(0, -sisa), saldoAkhir: null, habisTgl: null, hariLebihAwal: 0 };
  if (rencana > 0 && sisa > 0) {
    out.saldoAkhir = sisa - rencana * hari;
    if (out.saldoAkhir < 0) {
      const cukup = Math.floor(sisa / rencana);
      out.habisTgl = addDays(startOfDay(today), cukup);
      out.hariLebihAwal = hari - cukup;
    }
  } else if (rencana > 0) { out.saldoAkhir = sisa - rencana * hari; out.habisTgl = startOfDay(today); out.hariLebihAwal = hari; }
  return out;
}

/* ---------- Kalender tagihan ---------- */

// Kunci field di dokumen tagihan, mis. m202611 (aman dipakai sebagai nama field Firestore).
export const paidKey = (y, m) => `m${y}${pad(m + 1)}`;

export function occurrencesInMonth(bills, year, month) {
  const out = [];
  bills.forEach((b) => {
    if (b.aktif === false) return;
    let due = null;
    if (b.tipe === 'sekali') {
      if (b.tanggalSekali) { const d = parseKey(b.tanggalSekali); if (d.getFullYear() === year && d.getMonth() === month) due = d; }
    } else if (b.hari >= 1 && b.hari <= 31) {
      due = paydayIn(year, month, b.hari);
    }
    if (due) out.push({ bill: b, due, key: dateKey(due), y: year, m: month, paid: !!(b.paid && b.paid[paidKey(year, month)]) });
  });
  return out.sort((a, b) => a.due - b.due || String(a.bill.nama).localeCompare(String(b.bill.nama)));
}

// Semua tagihan jatuh tempo pada [start, endExclusive)
export function occurrencesInRange(bills, start, endExclusive) {
  const out = [];
  const last = addDays(endExclusive, -1);
  let y = start.getFullYear(), m = start.getMonth();
  while (y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth())) {
    occurrencesInMonth(bills, y, m).forEach((o) => { if (o.due >= start && o.due < endExclusive) out.push(o); });
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

export function billStatus(occ, today = new Date()) {
  if (occ.paid) return { kode: 'lunas', label: 'Lunas', diff: 0 };
  const diff = Math.round((occ.due - startOfDay(today)) / DAY);
  if (diff < 0) return { kode: 'telat', label: `Telat ${-diff} hari`, diff };
  if (diff === 0) return { kode: 'hari-ini', label: 'Hari ini', diff };
  if (diff === 1) return { kode: 'segera', label: 'Besok', diff };
  return { kode: diff <= 3 ? 'segera' : 'nanti', label: `${diff} hari lagi`, diff };
}

// Sel kalender satu bulan, minggu mulai Senin. Isi: null (kosong) atau nomor tanggal.
export function monthCells(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
}

/* ====================================================================
   Pocket, arus kas (pemasukan vs pengeluaran), dan prakiraan saldo
   ==================================================================== */

export const POCKET_TYPES = {
  bank:   { label: 'Bank',      ikon: '🏦', warna: '#3B82F6' },
  ewallet:{ label: 'E-Wallet',  ikon: '📱', warna: '#8B5CF6' },
  emoney: { label: 'E-Money',   ikon: '💳', warna: '#14B8A6' },
  cash:   { label: 'Cash',      ikon: '💵', warna: '#10B981' },
  invest: { label: 'Investasi', ikon: '📈', warna: '#F59E0B' },
  lain:   { label: 'Lainnya',   ikon: '👛', warna: '#EC4899' },
};

export const POCKET_PRESETS = [
  ['BCA', 'bank'], ['Mandiri', 'bank'], ['BRI', 'bank'], ['BNI', 'bank'], ['Jago', 'bank'], ['SeaBank', 'bank'],
  ['GoPay', 'ewallet'], ['OVO', 'ewallet'], ['DANA', 'ewallet'], ['ShopeePay', 'ewallet'],
  ['Flazz', 'emoney'], ['e-Money', 'emoney'], ['Brizzi', 'emoney'], ['TapCash', 'emoney'],
  ['Dompet Tunai', 'cash'], ['Reksa Dana', 'invest'],
];

export const DEFAULT_POCKETS = [
  { id: 'cash', nama: 'Cash', tipe: 'cash', ikon: '💵', saldo: 0 },
  { id: 'bank', nama: 'Bank Utama', tipe: 'bank', ikon: '🏦', saldo: 0 },
];

export const INCOME_CATEGORIES = [
  { id: 'gaji',   nama: 'Gaji',         ikon: '💼' },
  { id: 'bonus',  nama: 'Bonus / THR',  ikon: '🎁' },
  { id: 'usaha',  nama: 'Usaha / Freelance', ikon: '🧑‍💻' },
  { id: 'hadiah', nama: 'Hadiah',       ikon: '🎀' },
  { id: 'refund', nama: 'Refund',       ikon: '↩️' },
  { id: 'lain',   nama: 'Lainnya',      ikon: '➕' },
];

// Kategori "virtual" untuk biaya admin transfer/tarik tunai (tidak disimpan sebagai kategori anggaran)
export const CAT_ADMIN = { id: 'admin', nama: 'Biaya Admin', ikon: '🏦' };

// Pemasukan vs pengeluaran dalam satu rentang. Transfer & tarik tunai TIDAK dihitung (hanya pindah pocket).
export function cashflow({ tx, startKey, endKey, today = new Date() }) {
  const todayKey = dateKey(startOfDay(today));
  const start = parseKey(startKey), end = parseKey(endKey);
  const totalDays = Math.round((end - start) / DAY) + 1;
  const m = {}, k = {};
  let inc = 0, exp = 0;
  tx.forEach((x) => {
    if (x.hariKe < startKey || x.hariKe > endKey) return;
    if (x.jenis === 'masuk') { inc += x.nominal; m[x.hariKe] = (m[x.hariKe] || 0) + x.nominal; }
    else if (x.jenis === 'keluar') { exp += x.nominal; k[x.hariKe] = (k[x.hariKe] || 0) + x.nominal; }
  });
  const byDay = Array.from({ length: totalDays }, (_, i) => {
    const d = addDays(start, i), key = dateKey(d);
    return { key, date: d, masuk: m[key] || 0, keluar: k[key] || 0, future: key > todayKey };
  });
  return { inc, exp, net: inc - exp, rate: inc > 0 ? ((inc - exp) / inc) * 100 : null, byDay };
}

export function flowByCycle(tx, tanggalGajian, n = 6, today = new Date()) {
  const out = [];
  let c = getCycle(tanggalGajian, today);
  for (let i = 0; i < n; i++) {
    const f = cashflow({ tx, startKey: c.startKey, endKey: c.endKey, today });
    out.unshift({ label: c.start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }), masuk: f.inc, keluar: f.exp, isCurrent: i === 0 });
    c = prevCycle(c, tanggalGajian);
  }
  return out;
}

// Prakiraan saldo di hari gajian: saldo - (rata-rata belanja harian x sisa hari) - tagihan yang belum dibayar.
export function forecastBalance({ saldo, tx, cycle, unpaidBills = 0 }) {
  const items = tx.filter((x) => x.jenis === 'keluar' && !x.tagihanId && x.hariKe >= cycle.startKey);
  const avg = items.reduce((a, x) => a + x.nominal, 0) / Math.max(1, cycle.dayNumber);
  const proj = saldo - avg * cycle.daysLeft - unpaidBills;
  const runway = avg > 0 ? Math.floor(Math.max(0, saldo - unpaidBills) / avg) : null;
  return { avg, proj, runway };
}