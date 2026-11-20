// app.js — Masuk/Daftar, Onboarding, Beranda, Catat Pengeluaran, Profil, Kata Mutiara, Dashboard Admin
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup,
  updateProfile, updatePassword, verifyBeforeUpdateEmail, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, collection, getDocs, onSnapshot, query, where,
  writeBatch, increment, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  DEFAULT_ENVELOPES, DEFAULT_CATEGORIES, fmtRp, parseRp, dateKey, fmtTgl,
  getCycle, splitSalary, computeGuard, prevCycle, gajiList,
} from "./calc.js";
import { createFeatures } from "./features.js";
import { createPockets } from "./pockets.js";
import { createSavings } from "./savings.js";
import { QUOTES } from "./quotes.js";
import { initBackNav } from "./nav.js";

/* Username admin (tanpa "@") dipetakan ke email ini di Firebase Authentication.
   Password TIDAK disimpan di kode — akun admin dibuat manual di Firebase Console. */
const ADMIN_EMAIL_SUFFIX = "@admin.finix.app";

/* ---------- Firebase ---------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), // jalan juga saat sinyal jelek
});

/* ---------- Helper & state ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { user: null, profile: null, envelopes: [], categories: [], cycle: null, cycleDoc: null, tx: [], txAll: [], bills: [], pockets: [], savings: [], unsub: [], dir: [] };
const STATUS_LABEL = { hijau: "Aman 🟢", kuning: "Hati-hati 🟡", merah: "Gawat 🔴" };
const initial = (nama) => (String(nama || "").trim().charAt(0) || "?").toUpperCase();
let pendingName = ""; // nama dari form daftar, dipakai saat onboarding

const SCREENS = ["auth", "onboard", "dashboard", "pockets", "savings", "tx", "budget", "bills", "profile", "admin"];
const MENU = ["dashboard", "pockets", "savings", "tx", "budget", "bills", "profile"]; // layar yang memakai menu utama
const BISA_CATAT = ["dashboard", "pockets", "savings", "tx", "budget", "bills"];
let currentScreen = "auth";
// Tombol / gestur kembali di HP menutup pop-up atau kembali ke layar sebelumnya, tidak langsung keluar aplikasi
const nav = initBackNav({ getScreen: () => currentScreen, goTo: (n) => navigate(n), toast: (m) => toast(m) });
function show(name) {
  currentScreen = name;
  nav.catat(name);
  SCREENS.forEach((n) => { $("screen-" + n).hidden = n !== name; });
  document.body.classList.toggle("has-nav", MENU.includes(name));
  $("nav").hidden = !MENU.includes(name);
  $("fab").hidden = !BISA_CATAT.includes(name);
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
  window.scrollTo(0, 0);
}
let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
function bindMoney(el) {
  el.addEventListener("input", () => {
    const n = parseRp(el.value);
    el.value = n ? n.toLocaleString("id-ID") : "";
  });
}
function teardown() {
  S.unsub.forEach((f) => f());
  S.unsub = []; S.cycleDoc = null; S.tx = []; S.txAll = []; S.bills = []; S.pockets = []; S.savings = [];
}
function setMsg(id, text, ok = false) {
  const el = $(id);
  el.textContent = text;
  el.dataset.ok = ok ? "1" : "";
}

/* ---------- Ikon mata (lihat / sembunyikan kata sandi) ---------- */
document.querySelectorAll(".eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = btn.parentElement.querySelector("input");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.setAttribute("aria-pressed", String(!showing));
    btn.setAttribute("aria-label", showing ? "Tampilkan kata sandi" : "Sembunyikan kata sandi");
  });
});

/* ---------- Masuk / Daftar ---------- */
let mode = "login";
function setMode(m) {
  mode = m;
  $("tab-login").classList.toggle("active", m === "login");
  $("tab-register").classList.toggle("active", m === "register");
  $("auth-submit").textContent = m === "login" ? "Masuk" : "Daftar";
  $("google-label").textContent = m === "login" ? "Masuk dengan Google" : "Daftar dengan Google";
  $("f-nama").hidden = m === "login";
  $("lbl-email").textContent = m === "login" ? "Email atau username" : "Email";
  $("email").type = m === "login" ? "text" : "email";
  $("password").autocomplete = m === "login" ? "current-password" : "new-password";
  $("auth-error").textContent = "";
}
$("tab-login").onclick = () => setMode("login");
$("tab-register").onclick = () => setMode("register");

function authMsg(code, ctx) {
  if (ctx === "reauth" && (code === "auth/wrong-password" || code === "auth/invalid-credential")) {
    return "Kata sandi saat ini kurang tepat. Coba lagi ya.";
  }
  const map = {
    "auth/invalid-email": "Format emailnya belum pas nih. Coba cek lagi ya.",
    "auth/missing-password": "Kata sandinya belum diisi.",
    "auth/user-not-found": "Akun ini belum terdaftar. Coba daftar dulu ya.",
    "auth/wrong-password": "Email/username atau kata sandinya kurang tepat.",
    "auth/invalid-credential": "Email/username atau kata sandinya kurang tepat.",
    "auth/email-already-in-use": "Email ini sudah terdaftar. Silakan masuk saja.",
    "auth/weak-password": "Kata sandi minimal 6 karakter ya.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
    "auth/network-request-failed": "Sinyalnya lagi putus. Coba lagi sebentar.",
    "auth/requires-recent-login": "Demi keamanan, silakan keluar lalu masuk lagi, kemudian ulangi.",
    "auth/operation-not-allowed": "Fitur ini belum diaktifkan di pengaturan Firebase.",
    "auth/invalid-api-key": "Konfigurasi Firebase belum benar (apiKey di firebase-config.js belum diisi / salah).",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Konfigurasi Firebase belum benar (apiKey di firebase-config.js belum diisi / salah).",
    "auth/configuration-not-found": "Firebase Authentication belum diaktifkan. Buka Firebase Console → Authentication → Get started.",
    "auth/unauthorized-domain": "Domain website ini belum diizinkan. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.",
    "auth/network-request-failed ": "Sinyalnya lagi putus. Coba lagi sebentar.",
    "auth/popup-closed-by-user": "Jendela Google ditutup sebelum selesai. Coba lagi ya.",
    "auth/cancelled-popup-request": "Jendela Google ditutup sebelum selesai. Coba lagi ya.",
    "auth/popup-blocked": "Browser memblokir jendela Google. Izinkan pop-up untuk situs ini lalu coba lagi.",
    "auth/account-exists-with-different-credential": "Email ini sudah terdaftar dengan cara lain. Masuk memakai email dan kata sandi dulu ya.",
    "auth/internal-error": "Terjadi gangguan di server Firebase. Coba lagi sebentar.",
  };
  return map[code] || "Ada yang kurang pas. Coba lagi ya.";
}
// "rievvv" (tanpa @) dianggap username → dipetakan ke email di Firebase Auth
function toLoginEmail(raw) {
  return raw.includes("@") ? raw : raw.toLowerCase() + ADMIN_EMAIL_SUFFIX;
}

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = $("email").value.trim();
  const pw = $("password").value;
  const nama = $("nama").value.trim();
  const err = $("auth-error");
  err.textContent = "";

  if (mode === "register") {
    if (!nama) { err.textContent = "Namanya diisi dulu ya."; return; }
    if (!/^\S+@\S+\.\S+$/.test(raw)) { err.textContent = "Format emailnya belum pas nih. Coba cek lagi ya."; return; }
    if (raw.toLowerCase().endsWith(ADMIN_EMAIL_SUFFIX)) { err.textContent = "Email ini tidak bisa dipakai. Pakai email lain ya."; return; }
    if (pw.length < 6) { err.textContent = "Kata sandi minimal 6 karakter ya."; return; }
  } else {
    if (!raw || !pw) { err.textContent = "Email/username dan kata sandi diisi dulu ya."; return; }
    if (!raw.includes("@") && !/^[a-z0-9._-]+$/i.test(raw)) { err.textContent = "Username hanya boleh huruf, angka, titik, strip, atau garis bawah."; return; }
  }

  $("auth-submit").disabled = true;
  try {
    if (mode === "register") {
      pendingName = nama;
      const cred = await createUserWithEmailAndPassword(auth, raw, pw);
      await updateProfile(cred.user, { displayName: nama }).catch(() => {});
    } else {
      await signInWithEmailAndPassword(auth, toLoginEmail(raw), pw);
    }
  } catch (error) {
    console.error("Auth error:", error.code, error.message);
    err.textContent = authMsg(error.code);
  }
  $("auth-submit").disabled = false;
});

/* ---------- Pasang ke layar utama (PWA) ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW gagal:", e)));
}
const sudahTerpasang = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let promptPasang = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  promptPasang = e;
  if (!sudahTerpasang) $("install-box").hidden = false;
});
$("install-btn").addEventListener("click", async () => {
  if (!promptPasang) return;
  promptPasang.prompt();
  await promptPasang.userChoice.catch(() => {});
  promptPasang = null;
  $("install-box").hidden = true;
});
window.addEventListener("appinstalled", () => { $("install-box").hidden = true; toast("Finix sudah terpasang 🎉"); });
if (isIOS && !sudahTerpasang) $("ios-tip").hidden = false;

/* ---------- Masuk / Daftar dengan Google ---------- */
$("google-btn").addEventListener("click", async () => {
  const err = $("auth-error");
  const btn = $("google-btn");
  err.textContent = "";
  btn.disabled = true;
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
    // Selanjutnya ditangani onAuthStateChanged (onboarding bila akun baru, beranda bila sudah ada)
  } catch (error) {
    console.error("Google auth error:", error.code, error.message);
    err.textContent = authMsg(error.code);
  }
  btn.disabled = false;
});

function doLogout() {
  try { if (S.user) sessionStorage.removeItem("finix-quote-" + S.user.uid); } catch { /* abaikan */ }
  signOut(auth);
}
$("pf-logout").onclick = doLogout;
$("ad-logout").onclick = doLogout;

/* ---------- Alur setelah masuk ---------- */
onAuthStateChanged(auth, async (user) => {
  teardown();
  S.user = user; S.profile = null;
  if (!user) { show("auth"); return; }
  try {
    // Admin? (dokumen admins/{uid} hanya bisa dibuat lewat Firebase Console)
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (adminSnap.exists()) { await startAdmin(); return; }

    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || !snap.data().gajiBulanan) { prepOnboard(); show("onboard"); return; }
    S.profile = snap.data();
    await startHome();
  } catch (err) {
    console.error(err);
    toast("Gagal memuat data. Cek sinyalmu ya.");
  }
});

/* ---------- Onboarding ---------- */
bindMoney($("ob-gaji"));
function prepOnboard() { renderPreview(); }
function renderPreview() {
  const gaji = parseRp($("ob-gaji").value);
  const alokasi = splitSalary(gaji, DEFAULT_ENVELOPES);
  $("ob-preview").innerHTML = DEFAULT_ENVELOPES.map((e) =>
    `<div><span>${e.ikon} ${esc(e.nama)} (${e.persen}%)</span><b>${gaji ? fmtRp(alokasi[e.id]) : "–"}</b></div>`).join("");
}
$("ob-gaji").addEventListener("input", renderPreview);

$("ob-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const gaji = parseRp($("ob-gaji").value);
  const tgl = Number($("ob-tgl").value);
  const err = $("ob-error");
  err.textContent = "";
  if (gaji < 100000) { err.textContent = "Isi gaji per bulanmu dulu ya."; return; }
  if (!Number.isInteger(tgl) || tgl < 1 || tgl > 31) { err.textContent = "Tanggal gajian antara 1 sampai 31 ya."; return; }
  const nama = pendingName || S.user.displayName || (S.user.email || "").split("@")[0] || "Kamu";
  $("ob-submit").disabled = true;
  try {
    const uid = S.user.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), { nama, email: S.user.email || "", gajiBulanan: gaji, tanggalGajian: tgl, gajiList: [{ id: "g1", nama: "Gaji", tanggal: tgl, nominal: gaji }], createdAt: serverTimestamp() });
    // Direktori: data akun saja (tanpa nominal gaji/pengeluaran), dipakai dashboard admin
    batch.set(doc(db, "directory", uid), { nama, email: S.user.email || "", createdAt: serverTimestamp(), lastActive: serverTimestamp(), jumlahCatatan: 0 });
    DEFAULT_ENVELOPES.forEach((en) => batch.set(doc(db, "users", uid, "envelopes", en.id), en));
    DEFAULT_CATEGORIES.forEach((c, i) => batch.set(doc(db, "users", uid, "categories", c.id), { ...c, urutan: i }));
    await batch.commit();
    S.profile = { nama, gajiBulanan: gaji, tanggalGajian: tgl, gajiList: [{ id: "g1", nama: "Gaji", tanggal: tgl, nominal: gaji }] };
    await startHome();
  } catch (error) {
    console.error(error);
    err.textContent = "Gagal menyimpan. Cek sinyal lalu coba lagi ya.";
  }
  $("ob-submit").disabled = false;
});

/* ---------- Beranda ---------- */
/* ---------- Menu utama & fitur Dashboard / Anggaran / Tagihan ---------- */
function go(name) { show(name); render(); }
function navigate(name) {
  if (name === "profile") $("open-profile").onclick();
  else go(name);
}
// Sembunyikan / tampilkan saldo & hitung mundur gajian (ingatan per perangkat)
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
S.hide = { saldo: lsGet("finix-hide-saldo") === "1", gajian: lsGet("finix-hide-gajian") === "1" };
S.mask = (t) => (S.hide.saldo ? "Rp ••••••" : t);
S.eyeBtn = (k) => `<button class="hide-btn" type="button" data-hide="${k}" aria-label="${S.hide[k] ? "Tampilkan" : "Sembunyikan"}"><svg viewBox="0 0 24 24"><use href="#${S.hide[k] ? "ic-eye-off" : "ic-eye"}"/></svg></button>`;
document.addEventListener("click", (e) => {
  const h = e.target.closest("[data-hide]");
  if (h) {
    const k = h.dataset.hide; S.hide[k] = !S.hide[k];
    try { localStorage.setItem("finix-hide-" + k, S.hide[k] ? "1" : "0"); } catch { /* abaikan */ }
    render(); return;
  }
  const b = e.target.closest("[data-go]");
  if (b) navigate(b.dataset.go);
});
const F = createFeatures({ db, S, $, esc, toast, go });
const P = createPockets({ db, S, $, esc, toast });
const SV = createSavings({ db, S, $, esc, toast });
function renderOthers() {
  F.renderHomeBills();
  if (currentScreen === "dashboard") F.renderDashboard();
  else if (currentScreen === "pockets") P.renderPockets();
  else if (currentScreen === "savings") SV.renderSavings();
  else if (currentScreen === "tx") P.renderTx();
  else if (currentScreen === "budget") F.renderBudget();
  else if (currentScreen === "bills") F.renderBills();
}

async function startHome() {
  const uid = S.user.uid;
  const [envSnap, catSnap] = await Promise.all([
    getDocs(collection(db, "users", uid, "envelopes")),
    getDocs(collection(db, "users", uid, "categories")),
  ]);
  S.envelopes = envSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!S.envelopes.length) S.envelopes = DEFAULT_ENVELOPES;
  S.categories = catSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.urutan ?? 0) - (b.urutan ?? 0));
  if (!S.categories.length) S.categories = DEFAULT_CATEGORIES;

  S.cycle = getCycle(S.profile.tanggalGajian);
  await ensureCycle();
  show("dashboard");
  pingDirectory();
  maybeShowQuote();

  S.unsub.push(onSnapshot(doc(db, "users", uid, "cycles", S.cycle.id), (s) => { S.cycleDoc = s.data() || null; render(); }));
  // Transaksi 6 siklus terakhir (untuk Dashboard); S.tx = yang di siklus berjalan saja
  let dari = S.cycle;
  for (let i = 0; i < 11; i++) dari = prevCycle(dari, S.profile.tanggalGajian); // 12 siklus, untuk diagram tahunan
  S.unsub.push(onSnapshot(
    query(collection(db, "users", uid, "transactions"), where("tanggal", ">=", Timestamp.fromDate(dari.start))),
    (s) => {
      S.txAll = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      S.tx = S.txAll.filter((t) => t.cycleId === S.cycle.id);
      render();
    },
  ));
  S.unsub.push(F.listenBills(renderOthers));
  S.unsub.push(P.listen(render));
  S.unsub.push(SV.listen(render));
}

// Catat "terakhir aktif" dan sinkronkan email (kalau user baru saja menggantinya)
function pingDirectory() {
  const uid = S.user.uid;
  const email = S.user.email || "";
  const batch = writeBatch(db);
  batch.set(doc(db, "directory", uid), { email, lastActive: serverTimestamp() }, { merge: true });
  batch.set(doc(db, "users", uid), { email }, { merge: true });
  batch.commit().catch(() => {});
}

// Pembagian otomatis: tiap siklus gajian baru, gaji langsung dipecah ke pos-pos.
async function ensureCycle() {
  const ref = doc(db, "users", S.user.uid, "cycles", S.cycle.id);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    mulai: S.cycle.startKey,
    selesai: S.cycle.endKey,
    gajiMasuk: S.profile.gajiBulanan,
    alokasi: splitSalary(S.profile.gajiBulanan, S.envelopes),
    terpakai: {},
    totalTerpakai: 0,
    createdAt: serverTimestamp(),
  });
}

function render() {
  if (!S.cycleDoc || !S.cycle || !S.profile) return;
  const cd = S.cycleDoc, c = S.cycle;
  $("hi").textContent = `Halo, ${S.profile.nama || "kamu"} 👋`;
  paintAvatar();
  $("cycle-info").textContent = `Siklus ${fmtTgl(c.start)} – ${fmtTgl(c.next)} · hari ke-${c.dayNumber} dari ${c.totalDays}`;

  $("pos-list").innerHTML = S.envelopes.map((e) => {
    const al = (cd.alokasi || {})[e.id] || 0;
    const us = (cd.terpakai || {})[e.id] || 0;
    const pct = al > 0 ? Math.min(100, (us / al) * 100) : 0;
    const note = e.untukHarian ? `sisa ${fmtRp(al - us)}` : (us ? `terpakai ${fmtRp(us)}` : "sudah disisihkan");
    return `<div class="card pos">
      <div class="pos-head"><span>${esc(e.ikon)} ${esc(e.nama)}</span><small>${esc(note)}</small></div>
      <div class="bar"><i style="width:${pct}%;background:${esc(e.warna || "#FF7A00")}"></i></div>
      <div class="muted" style="margin-top:6px">${fmtRp(us)} dari ${fmtRp(al)}</div>
    </div>`;
  }).join("");

  const last = [...S.txAll].sort((a, b) => (b.tanggal?.toMillis?.() ?? 0) - (a.tanggal?.toMillis?.() ?? 0)).slice(0, 6);
  $("tx-list").innerHTML = last.length
    ? last.map((t) => P.rowHtml(t, false)).join("")
    : `<div class="empty">Belum ada catatan. Yuk catat transaksi pertamamu 👇</div>`;
  renderOthers();
}

/* ---------- Profil ---------- */
$("open-profile").onclick = () => {
  $("pf-nama").value = S.profile?.nama || "";
  paintAvatar(true);
  $("pf-email-now").textContent = S.user.email || "";
  ["pf-email-new", "pf-email-pw", "pf-pass-cur", "pf-pass-new"].forEach((id) => { $(id).value = ""; });
  ["pf-name-msg", "pf-email-msg", "pf-pass-msg", "pf-gaji-msg"].forEach((id) => setMsg(id, ""));
  loadGaji();
  show("profile");
};
$("pf-back").onclick = () => go("dashboard");

async function reauth(pw) {
  await reauthenticateWithCredential(S.user, EmailAuthProvider.credential(S.user.email, pw));
}

$("pf-name-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nama = $("pf-nama").value.trim();
  if (!nama) { setMsg("pf-name-msg", "Namanya jangan dikosongi ya."); return; }
  setMsg("pf-name-msg", "");
  try {
    const uid = S.user.uid;
    await updateProfile(S.user, { displayName: nama });
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), { nama }, { merge: true });
    batch.set(doc(db, "directory", uid), { nama }, { merge: true });
    await batch.commit();
    S.profile.nama = nama;
    paintAvatar(true);
    setMsg("pf-name-msg", "Nama tersimpan ✅", true);
  } catch (err) {
    console.error(err);
    setMsg("pf-name-msg", authMsg(err.code));
  }
});

$("pf-email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const next = $("pf-email-new").value.trim();
  const pw = $("pf-email-pw").value;
  if (!/^\S+@\S+\.\S+$/.test(next)) { setMsg("pf-email-msg", "Format emailnya belum pas nih."); return; }
  if (next.toLowerCase() === (S.user.email || "").toLowerCase()) { setMsg("pf-email-msg", "Itu email yang sedang kamu pakai."); return; }
  if (next.toLowerCase().endsWith(ADMIN_EMAIL_SUFFIX)) { setMsg("pf-email-msg", "Email ini tidak bisa dipakai."); return; }
  if (!pw) { setMsg("pf-email-msg", "Isi kata sandi saat ini untuk konfirmasi ya."); return; }
  setMsg("pf-email-msg", "");
  try {
    await reauth(pw);
    await verifyBeforeUpdateEmail(S.user, next);
    $("pf-email-new").value = ""; $("pf-email-pw").value = "";
    setMsg("pf-email-msg", `Tautan verifikasi dikirim ke ${next}. Email baru aktif setelah tautannya diklik.`, true);
  } catch (err) {
    console.error(err);
    setMsg("pf-email-msg", authMsg(err.code, "reauth"));
  }
});

$("pf-pass-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const cur = $("pf-pass-cur").value;
  const nw = $("pf-pass-new").value;
  if (!cur) { setMsg("pf-pass-msg", "Isi kata sandi saat ini dulu ya."); return; }
  if (nw.length < 6) { setMsg("pf-pass-msg", "Kata sandi baru minimal 6 karakter ya."); return; }
  setMsg("pf-pass-msg", "");
  try {
    await reauth(cur);
    await updatePassword(S.user, nw);
    $("pf-pass-cur").value = ""; $("pf-pass-new").value = "";
    setMsg("pf-pass-msg", "Kata sandi berhasil diganti ✅", true);
  } catch (err) {
    console.error(err);
    setMsg("pf-pass-msg", authMsg(err.code, "reauth"));
  }
});

/* ---------- Foto / ikon profil ---------- */
const AV_ICONS = ["⚖️", "💰", "💵", "🪙", "🏦", "🐷", "💎", "📈", "💳", "🧾", "🔥", "⭐", "🦁", "🐯", "🐼", "🦊", "🚀", "🎯", "🌱", "👑", "🧠", "🛡️", "🍀", "🎨"];
let avSig = "";
function avatarInner(p) {
  const a = p && p.avatar;
  if (a && a.tipe === "foto" && a.v) return `<img src="${esc(a.v)}" alt="Foto profil">`;
  if (a && a.tipe === "ikon" && a.v) return `<span class="emo">${esc(a.v)}</span>`;
  return esc(initial(p && p.nama));
}
function paintAvatar(force) {
  if (!S.profile) return;
  const html = avatarInner(S.profile);
  if (!force && html === avSig) return; // render() sering dipanggil, jangan gambar ulang kalau tidak berubah
  avSig = html;
  $("open-profile").innerHTML = html;
  $("pf-avatar").innerHTML = html + `<span class="avatar-edit">Ubah</span>`;
}
const av = { tipe: null, v: null, img: null, zoom: 1, ox: 0, oy: 0, dirty: false };
const AV_C = 480; // sisi kanvas (px), hasil akhir diperkecil ke 256 x 256
function avPreview() {
  $("av-prev").innerHTML = av.tipe === "ikon" ? `<span style="font-size:48px">${esc(av.v)}</span>` : av.tipe === "foto" && av.v ? `<img src="${esc(av.v)}" alt="">` : esc(initial(S.profile && S.profile.nama));
  $("av-grid").querySelectorAll("button").forEach((b) => b.classList.toggle("sel", av.tipe === "ikon" && b.dataset.i === av.v));
}
function avDraw() {
  const cv = $("av-canvas"), x = cv.getContext("2d"), im = av.img; if (!im) return;
  const sc = (AV_C / Math.min(im.naturalWidth, im.naturalHeight)) * av.zoom, w = im.naturalWidth * sc, h = im.naturalHeight * sc;
  av.ox = Math.min(0, Math.max(AV_C - w, av.ox)); av.oy = Math.min(0, Math.max(AV_C - h, av.oy));
  x.fillStyle = "#222"; x.fillRect(0, 0, AV_C, AV_C);
  x.drawImage(im, av.ox, av.oy, w, h);
}
function avScale() { return (AV_C / Math.min(av.img.naturalWidth, av.img.naturalHeight)) * av.zoom; }
function openAvatar() {
  const a = S.profile && S.profile.avatar;
  av.tipe = a ? a.tipe : null; av.v = a ? a.v : null; av.img = null; av.dirty = false;
  $("av-crop").classList.remove("on"); $("av-error").textContent = ""; $("av-file").value = "";
  $("av-grid").innerHTML = AV_ICONS.map((i) => `<button type="button" data-i="${i}" aria-label="Ikon ${i}">${i}</button>`).join("");
  avPreview();
  $("avatar-sheet").hidden = false;
}
const closeAvatar = () => { $("avatar-sheet").hidden = true; };
$("pf-avatar").onclick = openAvatar;
$("pf-avatar-btn").onclick = openAvatar;
$("av-close").onclick = closeAvatar;
$("avatar-sheet").addEventListener("click", (e) => { if (e.target === $("avatar-sheet")) closeAvatar(); });
$("av-grid").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  av.tipe = "ikon"; av.v = b.dataset.i; av.img = null; av.dirty = true;
  $("av-crop").classList.remove("on"); avPreview();
});
$("av-upload").onclick = () => $("av-file").click();
$("av-file").addEventListener("change", () => {
  const file = $("av-file").files && $("av-file").files[0]; if (!file) return;
  const err = $("av-error"); err.textContent = "";
  if (!/^image\//.test(file.type)) { err.textContent = "Pilih file gambar ya (JPG, PNG, dst)."; return; }
  if (file.size > 20 * 1024 * 1024) { err.textContent = "Fotonya terlalu besar (maks 20 MB)."; return; }
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    av.img = im; av.zoom = 1; $("av-zoom").value = "1";
    const sc = avScale(); av.ox = (AV_C - im.naturalWidth * sc) / 2; av.oy = (AV_C - im.naturalHeight * sc) / 2;
    av.tipe = "foto"; av.dirty = true;
    $("av-crop").classList.add("on"); avDraw();
    av.v = $("av-canvas").toDataURL("image/jpeg", 0.8); avPreview();
  };
  im.onerror = () => { URL.revokeObjectURL(url); err.textContent = "Fotonya tidak bisa dibuka. Coba foto lain (JPG atau PNG)."; };
  im.src = url;
});
// Geser foto di dalam bingkai 1:1, dan zoom
(() => {
  const st = $("av-stage"); let drag = null;
  const refresh = () => { avDraw(); av.v = $("av-canvas").toDataURL("image/jpeg", 0.8); avPreview(); };
  st.addEventListener("pointerdown", (e) => { if (!av.img) return; drag = { x: e.clientX, y: e.clientY, ox: av.ox, oy: av.oy }; try { st.setPointerCapture(e.pointerId); } catch { /* abaikan */ } });
  st.addEventListener("pointermove", (e) => {
    if (!drag || !av.img) return;
    const k = AV_C / st.clientWidth;
    av.ox = drag.ox + (e.clientX - drag.x) * k; av.oy = drag.oy + (e.clientY - drag.y) * k; avDraw();
  });
  const end = () => { if (drag) { drag = null; refresh(); } };
  st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
  $("av-zoom").addEventListener("input", () => {
    if (!av.img) return;
    const old = avScale(), cx = (AV_C / 2 - av.ox) / old, cy = (AV_C / 2 - av.oy) / old;
    av.zoom = Number($("av-zoom").value); const nw = avScale();
    av.ox = AV_C / 2 - cx * nw; av.oy = AV_C / 2 - cy * nw; refresh();
  });
})();
async function simpanAvatar(avatar) {
  const err = $("av-error"); err.textContent = "";
  $("av-save").disabled = $("av-reset").disabled = true;
  try {
    await setDoc(doc(db, "users", S.user.uid), { avatar }, { merge: true });
    S.profile.avatar = avatar; paintAvatar(true); closeAvatar(); toast("Profil diperbarui ✨");
  } catch (e) {
    console.error(e); err.textContent = "Gagal menyimpan: " + (e.code || e.message);
  }
  $("av-save").disabled = $("av-reset").disabled = false;
}
$("av-save").onclick = () => {
  if (!av.tipe || !av.v) { $("av-error").textContent = "Pilih ikon atau foto dulu ya."; return; }
  if (!av.dirty) { closeAvatar(); return; }
  if (av.tipe === "foto" && av.img) { // hasil akhir 256 x 256 supaya ringan disimpan
    const out = document.createElement("canvas"); out.width = out.height = 256;
    out.getContext("2d").drawImage($("av-canvas"), 0, 0, 256, 256);
    simpanAvatar({ tipe: "foto", v: out.toDataURL("image/jpeg", 0.85) });
  } else simpanAvatar({ tipe: av.tipe, v: av.v });
};
$("av-reset").onclick = () => simpanAvatar(null);

/* ---------- Gaji (bisa lebih dari satu) ---------- */
let gj = [];
const newGajiId = () => "g" + Math.random().toString(36).slice(2, 8);
function loadGaji() {
  gj = gajiList(S.profile).map((g) => ({ id: g.id || newGajiId(), nama: g.nama || "", tanggal: g.tanggal, nominal: g.nominal ? Number(g.nominal).toLocaleString("id-ID") : "" }));
  renderGaji();
}
function renderGaji() {
  $("pf-gaji-list").innerHTML = gj.map((g, i) => `<div class="gj-row" data-i="${i}">
    <div class="gj-top"><b>${i === 0 ? "Gaji pertama (awal siklus)" : "Gaji ke-" + (i + 1)}</b>${gj.length > 1 ? `<button class="del-btn" type="button" data-gdel="${i}" aria-label="Hapus gaji ini">🗑</button>` : ""}</div>
    <input class="gj-nama" type="text" maxlength="24" placeholder="Nama, mis. Gaji pokok / Freelance" value="${esc(g.nama)}" autocomplete="off">
    <div class="gj-2"><label>Tanggal<input class="gj-tgl" type="number" inputmode="numeric" min="1" max="31" value="${esc(g.tanggal ?? "")}" placeholder="25"></label>
    <label>Nominal (Rp)<input class="gj-nom" type="text" inputmode="numeric" value="${esc(g.nominal)}" placeholder="5.000.000" autocomplete="off"></label></div></div>`).join("");
  updateGajiTotal();
}
function updateGajiTotal() {
  const total = gj.reduce((a, g) => a + parseRp(g.nominal), 0);
  $("pf-gaji-total").innerHTML = `Total gaji per bulan: <b>${fmtRp(total)}</b>`;
}
$("pf-gaji-list").addEventListener("input", (e) => {
  const row = e.target.closest(".gj-row"); if (!row) return;
  const g = gj[Number(row.dataset.i)]; if (!g) return;
  if (e.target.classList.contains("gj-nama")) g.nama = e.target.value;
  else if (e.target.classList.contains("gj-tgl")) g.tanggal = e.target.value;
  else if (e.target.classList.contains("gj-nom")) {
    const n = parseRp(e.target.value);
    e.target.value = n ? n.toLocaleString("id-ID") : "";
    g.nominal = e.target.value; updateGajiTotal();
  }
});
$("pf-gaji-list").addEventListener("click", (e) => {
  const d = e.target.closest("[data-gdel]"); if (!d) return;
  gj.splice(Number(d.dataset.gdel), 1); renderGaji();
});
$("pf-gaji-add").onclick = () => { gj.push({ id: newGajiId(), nama: "", tanggal: "", nominal: "" }); renderGaji(); };

$("pf-gaji-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const list = gj.map((g, i) => ({ id: g.id, nama: (g.nama || "").trim().slice(0, 24) || (i === 0 ? "Gaji" : "Gaji " + (i + 1)), tanggal: Number(g.tanggal), nominal: parseRp(g.nominal) }));
  for (const [i, g] of list.entries()) {
    if (!Number.isInteger(g.tanggal) || g.tanggal < 1 || g.tanggal > 31) { setMsg("pf-gaji-msg", `Tanggal gaji ke-${i + 1} antara 1 sampai 31 ya.`); return; }
    if (g.nominal < 1000 || g.nominal >= 1e9) { setMsg("pf-gaji-msg", `Isi nominal gaji ke-${i + 1} dulu ya.`); return; }
  }
  setMsg("pf-gaji-msg", "");
  const total = list.reduce((a, g) => a + g.nominal, 0);
  const geserSiklus = list[0].tanggal !== S.profile.tanggalGajian;
  const oldEnvs = S.envelopes.map((en) => ({ ...en }));
  try {
    S.profile.gajiList = list; S.profile.gajiBulanan = total; S.profile.tanggalGajian = list[0].tanggal;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", S.user.uid), { gajiList: list, gajiBulanan: total, tanggalGajian: list[0].tanggal }, { merge: true });
    if (!geserSiklus) S.recalcCycle(batch, oldEnvs); // jatah pos siklus ini ikut menyesuaikan total gaji baru
    await batch.commit();
    setMsg("pf-gaji-msg", geserSiklus ? "Gaji tersimpan ✅ Siklus mengikuti tanggal gaji pertama, memuat ulang…" : "Gaji tersimpan ✅ Jatah pos sudah dihitung ulang.", true);
    if (geserSiklus) setTimeout(() => location.reload(), 900);
  } catch (err) {
    console.error(err);
    setMsg("pf-gaji-msg", "Gagal menyimpan: " + (err.code || err.message));
  }
});

/* ---------- Kata mutiara (popup saat masuk) ---------- */
let lastQuote = -1;
function pickQuote() {
  let i;
  do { i = Math.floor(Math.random() * QUOTES.length); } while (i === lastQuote && QUOTES.length > 1);
  lastQuote = i;
  return QUOTES[i];
}
function renderQuote() {
  const q = pickQuote();
  $("q-text").textContent = q.teks;
  $("q-by").textContent = "— " + q.tokoh;
  $("q-src").textContent = q.sumber || "";
  $("q-note").textContent = q.catatan || "";
  $("q-note").hidden = !q.catatan;
}
function openQuote() { renderQuote(); $("quote").hidden = false; }
function maybeShowQuote() {
  const key = "finix-quote-" + S.user.uid;
  try {
    if (sessionStorage.getItem(key)) return; // sekali per sesi masuk, bukan tiap refresh
    sessionStorage.setItem(key, "1");
  } catch { /* sessionStorage tidak tersedia: tetap tampilkan */ }
  openQuote();
}
$("q-ok").onclick = () => { $("quote").hidden = true; };
$("q-next").onclick = renderQuote;
$("quote").addEventListener("click", (e) => { if (e.target === $("quote")) $("quote").hidden = true; });

/* ---------- Dashboard Admin ---------- */
async function startAdmin() {
  $("ad-sub").textContent = "Masuk sebagai " + ((S.user.email || "").split("@")[0] || "admin");
  show("admin");
  await loadAdmin();
}
async function loadAdmin() {
  $("ad-list").innerHTML = `<div class="empty">Memuat…</div>`;
  try {
    const snap = await getDocs(collection(db, "directory"));
    S.dir = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAdmin();
  } catch (err) {
    console.error(err);
    $("ad-list").innerHTML = `<div class="empty">Gagal memuat data. Pastikan akun ini sudah terdaftar di koleksi admins dan aturan Firestore sudah diperbarui.</div>`;
  }
}
const tsMs = (t) => t?.toDate?.()?.getTime?.() ?? 0;
const hariLalu = (ms) => {
  if (!ms) return "belum pernah";
  const n = Math.floor((Date.now() - ms) / 864e5);
  return n <= 0 ? "hari ini" : n === 1 ? "kemarin" : `${n} hari lalu`;
};
function renderAdmin() {
  const list = S.dir;
  const W = 7 * 864e5, now = Date.now();
  $("ad-total").textContent = list.length.toLocaleString("id-ID");
  $("ad-new").textContent = list.filter((u) => tsMs(u.createdAt) && now - tsMs(u.createdAt) <= W).length.toLocaleString("id-ID");
  $("ad-active").textContent = list.filter((u) => tsMs(u.lastActive) && now - tsMs(u.lastActive) <= W).length.toLocaleString("id-ID");
  $("ad-notes").textContent = list.reduce((a, u) => a + (Number(u.jumlahCatatan) || 0), 0).toLocaleString("id-ID");

  const q = $("ad-search").value.trim().toLowerCase();
  const rows = list
    .filter((u) => !q || `${u.nama || ""} ${u.email || ""}`.toLowerCase().includes(q))
    .sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
  $("ad-list").innerHTML = rows.length
    ? rows.map((u) => {
        const daftar = tsMs(u.createdAt) ? new Date(tsMs(u.createdAt)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
        return `<div class="tx"><div class="ic">${esc(initial(u.nama))}</div>
          <div class="tt"><b>${esc(u.nama || "(tanpa nama)")}</b><span>${esc(u.email || "")}</span>
          <span>Daftar ${esc(daftar)} · aktif ${esc(hariLalu(tsMs(u.lastActive)))} · ${(Number(u.jumlahCatatan) || 0).toLocaleString("id-ID")} catatan</span></div></div>`;
      }).join("")
    : `<div class="empty">${list.length ? "Tidak ada yang cocok." : "Belum ada pengguna terdaftar."}</div>`;
}
$("ad-search").addEventListener("input", renderAdmin);
$("ad-refresh").onclick = loadAdmin;

/* ---------- Ganti hari / ganti siklus saat app dibuka lagi ---------- */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !S.profile || !S.cycle) return;
  if (getCycle(S.profile.tanggalGajian).id !== S.cycle.id) location.reload();
  else render();
});