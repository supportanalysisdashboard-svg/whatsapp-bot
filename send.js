import { chromium } from "playwright";

const [argTicket, argAgent, mode] = process.argv.slice(2);
const ticketId = process.env.TICKET_ID || argTicket;
const agentName = process.env.AGENT_NAME || argAgent;
const reallySend = mode === "send";
const hour = Number(new Intl.DateTimeFormat("en-GB", {
  hour: "numeric", hour12: false, timeZone: "Africa/Cairo"
}).format(new Date()));
const msg = `${hour < 12 ? "صباح الخير" : "مساء الخير"}، معك ${agentName}، إزاي أقدر أساعدك؟`;

const browser = await chromium.launch({ headless: process.env.HEADLESS === "1", slowMo: 100 });
const context = await browser.newContext({
  storageState: "state.json",
  viewport: { width: 1366, height: 900 },
});
const page = await context.newPage();

await page.goto(`https://dsq.freshdesk.com/a/tickets/${ticketId}`, {
  waitUntil: "domcontentloaded",
});

const editor = page.locator('[data-test-id="active-editor"]');
await editor.waitFor({ timeout: 40000 });
await editor.click();
await page.keyboard.insertText(msg);
await page.screenshot({ path: "before-send.png" });
console.log("النص اللي اتكتب:", msg);

if (reallySend) {
  await page.locator('[data-test-id="submit"]').click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "after-send.png" });
  console.log("اتبعت");
} else {
  console.log("Dry run: مبعتش حاجة");
  await page.waitForTimeout(8000);
}

await browser.close();