// export.js — Export laporan keuangan ke Excel (.xlsx) dan PDF. Dipakai semua menu lewat laporan.js.
// Library (SheetJS, jsPDF) baru diunduh saat tombol export dipakai, jadi aplikasi tetap ringan.
//
// Bentuk data yang diterima:
//   { menu: "Tagihan", format: "xlsx" | "pdf", periode: "November 2026",
//     sheets: [{ nama, kolom: [{ h: "Judul", w: 14, t: "teks" | "rp" | "angka" | "pct" }],
//                baris: [[sel, sel, ...]],   // sel boleh berupa { v, t } untuk jenis khusus
//                ringkas: [[label, nilai, t?]] }] }
import { fmtRp } from "./calc.js";

const LIB = {
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  autotable: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
};
const dimuat = {};
function muat(kunci) {
  if (!dimuat[kunci]) {
    dimuat[kunci] = new Promise((ok, gagal) => {
      const el = document.createElement("script");
      el.src = LIB[kunci];
      el.onload = ok;
      el.onerror = () => { delete dimuat[kunci]; gagal(new Error("Gagal memuat library export. Periksa koneksi internet.")); };
      document.head.appendChild(el);
    });
  }
  return dimuat[kunci];
}

const pad = (n) => String(n).padStart(2, "0");
// Font bawaan PDF tidak punya emoji, jadi buang karakter di luar Latin
const bersih = (t) => String(t == null ? "" : t).replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "").replace(/\s+/g, " ").trim();
const tglJam = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}.${pad(d.getMinutes())}`;

// Nama file: NAMA MENU-TANGGAL-JAM, contoh Tagihan-19-11-2026-14.35.xlsx
export function namaFile(menu, ext, d = new Date()) {
  return `${bersih(menu).replace(/\s+/g, "")}-${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}-${pad(d.getHours())}.${pad(d.getMinutes())}.${ext}`;
}

const sel = (c) => (c !== null && typeof c === "object" && "v" in c ? c : { v: c, t: null });
const teksSel = (c, tipeKolom) => {
  const { v, t } = sel(c), tipe = t || tipeKolom || "teks";
  if (v === null || v === undefined || v === "") return "";
  if (typeof v !== "number") return bersih(v);
  if (tipe === "rp") return fmtRp(v);
  if (tipe === "pct") return `${Math.round(v)}%`;
  return String(v);
};
const namaSheet = (t, i) => (bersih(t).replace(/[\[\]:*?/\\]/g, "") || `Sheet${i + 1}`).slice(0, 31);

export async function exportLaporan({ menu, format, periode, sheets }) {
  const sekarang = new Date();
  if (format === "xlsx") return excel({ menu, periode, sheets, sekarang });
  return pdf({ menu, periode, sheets, sekarang });
}

async function excel({ menu, periode, sheets, sekarang }) {
  await muat("xlsx");
  const X = window.XLSX, wb = X.utils.book_new();
  sheets.forEach((sh, si) => {
    const kepala = [[`Laporan ${menu} Finix`], [periode ? `Periode: ${periode}` : ""], [`Diunduh: ${tglJam(sekarang)}`], []];
    const aoa = [...kepala, sh.kolom.map((k) => bersih(k.h))];
    const awalData = aoa.length;
    sh.baris.forEach((r) => aoa.push(r.map((c, i) => {
      const { v, t } = sel(c), tipe = t || sh.kolom[i].t || "teks";
      if (typeof v === "number") return tipe === "pct" ? v / 100 : v;
      return bersih(v);
    })));
    if (sh.ringkas && sh.ringkas.length) {
      aoa.push([]);
      sh.ringkas.forEach(([label, nilai, t]) => aoa.push([bersih(label), typeof nilai === "number" ? (t === "pct" ? nilai / 100 : nilai) : bersih(nilai)]));
    }
    const ws = X.utils.aoa_to_sheet(aoa);
    ws["!cols"] = sh.kolom.map((k) => ({ wch: k.w || 14 }));
    sh.baris.forEach((r, ri) => r.forEach((c, ci) => {
      const { v, t } = sel(c), tipe = t || sh.kolom[ci].t || "teks";
      const cell = ws[X.utils.encode_cell({ r: awalData + ri, c: ci })];
      if (cell && typeof v === "number") cell.z = tipe === "rp" ? "#,##0" : tipe === "pct" ? "0%" : "General";
    }));
    const awalRingkas = awalData + sh.baris.length + 1;
    (sh.ringkas || []).forEach(([, nilai, t], i) => {
      const cell = ws[X.utils.encode_cell({ r: awalRingkas + i, c: 1 })];
      if (cell && typeof nilai === "number") cell.z = t === "pct" ? "0%" : t === "angka" ? "General" : "#,##0";
    });
    X.utils.book_append_sheet(wb, ws, namaSheet(sh.nama, si));
  });
  X.writeFile(wb, namaFile(menu, "xlsx", sekarang));
}

async function pdf({ menu, periode, sheets, sekarang }) {
  await muat("jspdf");
  await muat("autotable");
  const { jsPDF } = window.jspdf;
  const lebar = sheets.some((s) => s.kolom.length > 6);
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: lebar ? "landscape" : "portrait" });
  const mx = 40;
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(255, 122, 0);
  doc.text(`Laporan ${bersih(menu)} Finix`, mx, 50);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(90, 70, 55);
  let y = 68;
  if (periode) { doc.text(`Periode: ${bersih(periode)}`, mx, y); y += 15; }
  doc.text(`Diunduh: ${tglJam(sekarang)}`, mx, y);
  let startY = y + 17;

  sheets.forEach((sh) => {
    if (startY > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); startY = 50; }
    if (sheets.length > 1) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(43, 27, 16);
      doc.text(bersih(sh.nama), mx, startY + 4);
      startY += 12;
    }
    const kanan = {};
    sh.kolom.forEach((k, i) => { if (k.t === "rp" || k.t === "pct" || k.t === "angka") kanan[i] = { halign: "right" }; });
    doc.autoTable({
      startY,
      head: [sh.kolom.map((k) => bersih(k.h))],
      body: sh.baris.map((r) => r.map((c, i) => teksSel(c, sh.kolom[i].t))),
      styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [255, 122, 0], textColor: 255 },
      alternateRowStyles: { fillColor: [255, 250, 244] },
      columnStyles: kanan,
      margin: { left: mx, right: mx },
    });
    startY = doc.lastAutoTable.finalY + 10;
    if (sh.ringkas && sh.ringkas.length) {
      doc.autoTable({
        startY,
        body: sh.ringkas.map(([label, nilai, t]) => [bersih(label), teksSel({ v: nilai, t: t || "rp" })]),
        theme: "plain",
        styles: { fontSize: 10, cellPadding: 3, fontStyle: "bold", textColor: [43, 27, 16] },
        columnStyles: { 0: { cellWidth: 150 }, 1: { halign: "right", cellWidth: 130 } },
        tableWidth: 280,
        margin: { left: mx, right: mx },
      });
      startY = doc.lastAutoTable.finalY + 10;
    }
    startY += 14;
  });
  doc.save(namaFile(menu, "pdf", sekarang));
}