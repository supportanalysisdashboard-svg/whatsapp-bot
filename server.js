import express from "express";
import { execFile } from "child_process";

const SECRET = "dsq-bot-7K29xQ41mP";
const app = express();
app.use(express.json());

const done = new Set();   // تيكيتات اترد عليها (منع التكرار)
const queue = [];
let busy = false;

function runNext() {
  if (busy || queue.length === 0) return;
  busy = true;
  const { ticketId, agentName } = queue.shift();
  console.log("بدأ الرد على", ticketId, agentName);
  execFile(
    "node",
    ["send.js", "", "", "send"],
    { env: { ...process.env, TICKET_ID: ticketId, AGENT_NAME: agentName, HEADLESS: "1" } },
    (err, stdout, stderr) => {
      if (err) {
        console.error("فشل", ticketId, stderr || err.message);
        done.delete(ticketId); // يسمح بمحاولة تانية
      } else {
        console.log("تم", ticketId);
      }
      busy = false;
      runNext();
    }
  );
}

app.post("/fd-webhook", (req, res) => {
  if (req.query.key !== SECRET) return res.sendStatus(403);
  const ticketId = String(req.body.ticket_id || "");
  const agentName = String(req.body.agent_name || "").trim();
  if (!ticketId || !agentName) return res.sendStatus(400);
  if (req.body.group !== "Merchants support") return res.send("ignored");
  if (done.has(ticketId)) return res.send("already");  done.add(ticketId);
  queue.push({ ticketId, agentName });
  res.send("queued");
  runNext();
});

app.listen(3000, () => console.log("السيرفر شغال على بورت 3000"));