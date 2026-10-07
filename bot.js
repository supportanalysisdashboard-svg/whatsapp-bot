import { chromium } from "playwright";
import fs from "fs";

// لو شغال على استضافة: بيعمل ملف الجلسة من متغير بيئة (على جهازك مبيعملش حاجة)
if (process.env.STATE_B64) {
  fs.writeFileSync("state.json", Buffer.from(process.env.STATE_B64, "base64"));
}

// ===== الإعدادات =====
const DOMAIN = "dsq.freshdesk.com";
const GROUP_ID = 70000123820;   // Merchants support
const WHATSAPP_SOURCE = 13;
const POLL_SECONDS = 5;         // يفحص كل 5 ثواني
const MAX_AGE_MIN = 30;         // يرد بس على تيكيتات اتفتحت في آخر 30 دقيقة
const TAG = "auto_greeted";
const COMPANY = "ديسكويرز";

const START_HOUR = 10;          // بيبدأ الرد الساعة 10 الصبح (توقيت القاهرة)
const END_HOUR = 24;            // وبيقف 12 منتصف الليل

// أول اسم للـ agent في Freshdesk (حروف صغيرة) ← الاسم بالعربي
const NAMES = {
  hussein: "حسين", hossein: "حسين", hussien: "حسين", hosein: "حسين",
  karim: "كريم", kareem: "كريم",
  ahmed: "أحمد", ahmad: "أحمد", "ahmed.sayed": "أحمد",
  amira: "أميرة", ameera: "أميرة",
  menna: "منه", mennah: "منه",
  hana: "هنا", hanna: "هنا",

};
// =====================

const KEY = process.env.FD_API_KEY;
if (!KEY) {
  console.error("لازم تكتب الأول: set FD_API_KEY=مفتاحك");
  process.exit(1);
}
const ONLY = (process.env.ONLY_REQUESTER || "").trim().toLowerCase(); // للتجربة بس
const DRY = process.env.DRY === "1";   // يطبع بس ومبيبعتش
const SHOW = process.env.SHOW === "1"; // يظهر المتصفح
const auth = "Basic " + Buffer.from(KEY + ":X").toString("base64");

const DONE_FILE = "done.json";
let baseline = !fs.existsSync(DONE_FILE); // أول تشغيل: يتجاهل التيكيتات الموجودة
const done = new Set(baseline ? [] : JSON.parse(fs.readFileSync(DONE_FILE, "utf8")));
const saveDone = () => fs.writeFileSync(DONE_FILE, JSON.stringify([...done]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tries = new Map();
const inFlight = new Set();
const dryLogged = new Set();
const nameCache = new Map();

async function api(path, opts = {}) {
  const r = await fetch(`https://${DOMAIN}/api/v2${path}`, {
    ...opts,
    headers: { Authorization: auth, "Content-Type": "application/json" },
  });
  if (r.status === 429) throw new Error("Freshdesk طلبت تهدي شوية (rate limit)");
  if (!r.ok) throw new Error(`${r.status} ${path} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

function arabicName(full) {
  const first = (full || "").trim().split(/\s+/)[0] || "";
  if (/[\u0600-\u06FF]/.test(first)) return first; // لو الاسم عربي أصلاً
  return NAMES[first.toLowerCase()] || null;
}

async function agentArabic(id) {
  if (nameCache.has(id)) return nameCache.get(id);
  const a = await api(`/agents/${id}`);
  const full = a.contact?.name || "";
  const ar = arabicName(full);
  if (!ar) console.warn(`تحذير: مفيش اسم عربي للـ agent "${full}"، ضيفه في NAMES. هستخدم "فريق الدعم" مؤقتاً`);
  nameCache.set(id, ar);
  return ar;
}

function cairoHour() {
  return Number(new Intl.DateTimeFormat("en-GB", {
    hour: "numeric", hourCycle: "h23", timeZone: "Africa/Cairo",
  }).format(new Date()));
}

function inHours() {
  const h = cairoHour();
  return h >= START_HOUR && h < END_HOUR;
}

function buildMsg(name) {
  const greet = cairoHour() < 12 ? "صباح الخير" : "مساء الخير";
  return `${greet}، معك ${name || "فريق الدعم"} من ${COMPANY}، إزاي أقدر أساعدك؟`;
}

function eligible(t) {
  if (t.source !== WHATSAPP_SOURCE || t.group_id !== GROUP_ID) return false;
  if (t.status !== 2 || !t.responder_id) return false;       // Open ومتعيّن لحد
  if ((t.tags || []).includes(TAG)) return false;
  if (t.stats?.first_responded_at) return false;              // حد رد عليه قبل كده
  if (Date.now() - new Date(t.created_at) > MAX_AGE_MIN * 60000) return false;
  const who = [t.requester?.name, t.requester?.mobile, t.requester?.phone, t.requester?.email]
    .join(" ").toLowerCase();
  if (ONLY && !who.includes(ONLY)) return false;
  return true;
}

// ===== المتصفح (مفتوح طول الوقت) =====
const browser = await chromium.launch({ headless: !SHOW });
browser.on("disconnected", () => { console.error("المتصفح اتقفل، شغّل الـ Robot تاني"); process.exit(1); });
const context = await browser.newContext({
  storageState: "state.json",
  viewport: { width: 1366, height: 900 },
});

{
  const p = await context.newPage();
  await p.goto(`https://${DOMAIN}/a/tickets`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(4000);
  if (/login|sso/i.test(p.url())) {
    console.error("الجلسة منتهية. شغّل: node login.js وسجل دخول تاني");
    await browser.close();
    process.exit(1);
  }
  await p.close();
}

async function sendGreeting(ticketId, msg) {
  const page = await context.newPage();
  let clicked = false;
  try {
    await page.goto(`https://${DOMAIN}/a/tickets/${ticketId}`, { waitUntil: "domcontentloaded" });
    const editor = page.locator('[data-test-id="active-editor"]');
    await editor.waitFor({ timeout: 30000 });
    await editor.click();
    await page.keyboard.insertText(msg);
    await page.locator('[data-test-id="submit"]').click();
    clicked = true;
    await page.waitForTimeout(3000);
    return true;
  } catch (e) {
    console.error("فشل الإرسال للتيكيت", ticketId, "|", e.message.split("\n")[0], "|", page.url());
    return clicked;
  } finally {
    await page.close().catch(() => {});
  }
}

async function handle(t, msg) {
  console.log("بدأ الرد على التيكيت", t.id);
  const ok = await sendGreeting(t.id, msg);
  if (ok) {
    done.add(t.id);
    saveDone();
    console.log("تم", t.id);
    try {
      await api(`/tickets/${t.id}`, {
        method: "PUT",
        body: JSON.stringify({ tags: [...(t.tags || []), TAG] }),
      });
    } catch (e) { console.error("مقدرتش أضيف التاج:", e.message); }
  } else {
    const n = (tries.get(t.id) || 0) + 1;
    tries.set(t.id, n);
    if (n >= 3) {
      done.add(t.id);
      saveDone();
      console.error("فشل 3 مرات، هتخطى التيكيت", t.id);
    }
  }
}

async function poll() {
  const since = new Date(Date.now() - 2 * 3600e3).toISOString();
  const list = await api(
    `/tickets?include=requester,stats&updated_since=${since}&order_by=created_at&order_type=desc&per_page=50`
  );
  for (const t of list) {
    if (!eligible(t) || done.has(t.id) || inFlight.has(t.id)) continue;

    if (baseline) { done.add(t.id); continue; }

    const ar = await agentArabic(t.responder_id);
    const msg = buildMsg(ar);

    if (DRY) {
      if (!dryLogged.has(t.id)) {
        console.log(`[تجربة] هرد على التيكيت ${t.id}: ${msg}`);
        dryLogged.add(t.id);
      }
      continue;
    }

    inFlight.add(t.id);
    handle(t, msg).finally(() => inFlight.delete(t.id));
  }
  if (baseline) {
    baseline = false;
    saveDone();
    console.log(`تسجلت ${done.size} تيكيت موجودين من قبل (مش هيتردلهم). مستني تيكيتات جديدة...`);
  }
}

async function checkNames() {
  try {
    const g = await api(`/groups/${GROUP_ID}`);
    console.log("--- فحص أسماء الـ agents في Merchants support ---");
    for (const id of g.agent_ids || []) {
      const a = await api(`/agents/${id}`);
      const full = a.contact?.name || "";
      console.log(full, "->", arabicName(full) ? "OK" : "MISSING (ضيفه في NAMES)");
    }
    console.log("------------------------------------------------");
  } catch (e) {
    console.log("مقدرتش أفحص أسماء الـ agents:", e.message.slice(0, 120));
  }
}

await checkNames();
console.log(`الـ Robot شغال. بيرد من ${START_HOUR}:00 لحد ${END_HOUR}:00 بتوقيت القاهرة، وبيفحص كل ${POLL_SECONDS} ثواني`, DRY ? "(وضع التجربة)" : "");
while (true) {
  if (!inHours()) { await sleep(60000); continue; }  // برا المواعيد: ينام ويفحص كل دقيقة
  try { await poll(); }
  catch (e) { console.error(new Date().toLocaleTimeString(), "خطأ:", e.message); await sleep(30000); }
  await sleep(POLL_SECONDS * 1000);
}