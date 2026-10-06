import { chromium } from "playwright";
import readline from "readline";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://dsq.freshdesk.com");

console.log("سجل دخول في المتصفح، وبعدين ارجع هنا واضغط Enter");
await new Promise((r) =>
  readline.createInterface({ input: process.stdin }).once("line", r)
);

await context.storageState({ path: "state.json" });
await browser.close();
console.log("تم حفظ الجلسة في state.json");