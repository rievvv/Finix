// export.js — Export daftar tagihan ke Excel (.xlsx) dan PDF.
// Library (SheetJS, jsPDF) baru diunduh saat tombol export dipakai, jadi aplikasi tetap ringan.
import { fmtRp, billStatus, paidKey, BULAN_PANJANG } from "./calc.js";

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

const JENIS = { bulanan: "Tiap bulan", sekali: "Sekali", tenor: "Tenor" };
const tglLengkap = (d) => d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
// Font bawaan PDF tidak punya emoji, jadi buang karakter di luar Latin
const bersih = (t) => String(t).replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "").replace(/\s+/g, " ").trim();
const slug = (t) => bersih(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tagihan";

function barisDari(occ) {
  return occ.map((o) => {
    const info = o.bill.paid && o.bill.paid[paidKey(o.y, o.m)];
    return {
      id: o.bill.id,
      tgl: tglLengkap(o.due),
      nama: bersih(o.bill.nama) || "Tagihan",
      jenis: JENIS[o.bill.tipe] || JENIS.bulanan,
      ke: o.dari ? `${o.ke} / ${o.dari}` : "",
      nom: o.nom,
      status: billStatus(o).label,
      lunas: o.paid,
      tglLunas: info && info.at ? tglLengkap(new Date(info.at + "T00:00:00")) : "",
    };
  });
}

function ringkasPerTagihan(baris) {
  const peta = new Map();
  baris.forEach((r) => {
    const x = peta.get(r.id) || { nama: r.nama, jenis: r.jenis, jumlah: 0, total: 0, terbayar: 0 };
    x.jumlah++; x.total += r.nom; if (r.lunas) x.terbayar += r.nom;
    peta.set(r.id, x);
  });
  return [...peta.values()];
}

export function namaBulan(y, m) { return `${BULAN_PANJANG[m]} ${y}`; }

export async function exportExcel({ occ, periode }) {
  await muat("xlsx");
  const X = window.XLSX;
  const baris = barisDari(occ);
  const total = baris.reduce((a, r) => a + r.nom, 0);
  const terbayar = baris.filter((r) => r.lunas).reduce((a, r) => a + r.nom, 0);

  const kepala = ["No", "Jatuh tempo", "Nama tagihan", "Jenis", "Cicilan ke", "Nominal (Rp)", "Status", "Tanggal lunas"];
  const aoa = [["Laporan Tagihan Finix"], [`Periode: ${periode}`], [], kepala,
    ...baris.map((r, i) => [i + 1, r.tgl, r.nama, r.jenis, r.ke, r.nom, r.status, r.tglLunas]),
    [], ["", "", "", "", "Total", total], ["", "", "", "", "Sudah dibayar", terbayar], ["", "", "", "", "Belum dibayar", total - terbayar]];
  const ws = X.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 5 }, { wch: 13 }, { wch: 28 }, { wch: 12 }, { wch: 11 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
  for (let r = 4; r < aoa.length; r++) {
    const c = ws[X.utils.encode_cell({ r, c: 5 })];
    if (c && typeof c.v === "number") c.z = "#,##0";
  }

  const ring = ringkasPerTagihan(baris);
  const aoa2 = [["Tagihan", "Jenis", "Jumlah", "Total (Rp)", "Sudah dibayar (Rp)", "Belum dibayar (Rp)"],
    ...ring.map((x) => [x.nama, x.jenis, x.jumlah, x.total, x.terbayar, x.total - x.terbayar])];
  const ws2 = X.utils.aoa_to_sheet(aoa2);
  ws2["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 9 }, { wch: 16 }, { wch: 20 }, { wch: 20 }];
  for (let r = 1; r < aoa2.length; r++) for (const c of [3, 4, 5]) { const cell = ws2[X.utils.encode_cell({ r, c })]; if (cell) cell.z = "#,##0"; }

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "Jadwal Tagihan");
  X.utils.book_append_sheet(wb, ws2, "Ringkasan");
  X.writeFile(wb, `tagihan-finix-${slug(periode)}.xlsx`);
}

export async function exportPdf({ occ, periode }) {
  await muat("jspdf");
  await muat("autotable");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const baris = barisDari(occ);
  const total = baris.reduce((a, r) => a + r.nom, 0);
  const terbayar = baris.filter((r) => r.lunas).reduce((a, r) => a + r.nom, 0);

  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(255, 122, 0);
  doc.text("Laporan Tagihan Finix", 40, 50);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.setTextColor(90, 70, 55);
  doc.text(`Periode: ${periode}`, 40, 68);
  doc.text(`Dicetak: ${tglLengkap(new Date())}`, 40, 83);

  doc.autoTable({
    startY: 100,
    head: [["No", "Jatuh tempo", "Tagihan", "Jenis", "Cicilan", "Nominal", "Status"]],
    body: baris.map((r, i) => [i + 1, r.tgl, r.nama, r.jenis, r.ke || "-", fmtRp(r.nom), r.status]),
    foot: [[{ content: "Total", colSpan: 5, styles: { halign: "right" } }, { content: fmtRp(total), styles: { halign: "right" } }, ""],
      [{ content: "Sudah dibayar", colSpan: 5, styles: { halign: "right" } }, { content: fmtRp(terbayar), styles: { halign: "right" } }, ""],
      [{ content: "Belum dibayar", colSpan: 5, styles: { halign: "right" } }, { content: fmtRp(total - terbayar), styles: { halign: "right" } }, ""]],
    showFoot: "lastPage",
    styles: { fontSize: 9.5, cellPadding: 5 },
    headStyles: { fillColor: [255, 122, 0], textColor: 255 },
    footStyles: { fillColor: [255, 244, 232], textColor: [43, 27, 16] },
    columnStyles: { 0: { cellWidth: 28 }, 5: { halign: "right" } },
    alternateRowStyles: { fillColor: [255, 250, 244] },
    margin: { left: 40, right: 40 },
  });
  doc.save(`tagihan-finix-${slug(periode)}.pdf`);
}