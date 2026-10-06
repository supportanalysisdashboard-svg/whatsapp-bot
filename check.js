const auth = "Basic " + Buffer.from(process.env.FD_API_KEY + ":X").toString("base64");
const r = await fetch("https://dsq.freshdesk.com/api/v2/tickets/466451", {
  headers: { Authorization: auth },
});
console.log("status:", r.status);
const t = await r.json();
if (!r.ok) {
  console.log("خطأ:", t);
} else {
  console.log({
    source: t.source,
    group_id: t.group_id,
    responder_id: t.responder_id,
    status: t.status,
    tags: t.tags,
  });
}