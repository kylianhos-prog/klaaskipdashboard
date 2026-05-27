require("dotenv").config({ override: true });
const express = require("express");
const path = require("path");
const store = require("./store");
const whatsapp = require("./whatsapp");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const VALID_STATUS = ["open", "in_bewerking", "klaar"];

app.get("/api/state", (req, res) => {
  res.json(store.getState());
});

app.post("/api/orders/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Ongeldige status" });
  }
  const order = store.setStatus(id, status);
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  res.json(order);
});

app.post("/api/label", (req, res) => {
  const activeLabel = store.setLabel(req.body.label);
  res.json({ activeLabel });
});

// Klaar -> archiveren.
app.post("/api/orders/:id/klaar", (req, res) => {
  const order = store.archiveOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  res.json(order);
});

// Terugzetten uit archief.
app.post("/api/orders/:id/restore", (req, res) => {
  const order = store.restoreOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  res.json(order);
});

// Product aan-/uitzetten als "niet op voorraad".
app.post("/api/orders/:id/item/:index/oos", (req, res) => {
  const order = store.toggleItemOOS(Number(req.params.id), Number(req.params.index));
  if (!order) return res.status(404).json({ error: "Bestelling of product niet gevonden" });
  res.json(order);
});

// "Geef aan klant door": stuur de klant een appje met wat er niet op voorraad is.
// Alleen de voornaam voor berichten naar de klant.
function firstName(name) {
  if (!name || name === "Onbekend") return "";
  return name.trim().split(/\s+/)[0];
}

function buildOOSMessage(order) {
  const lijst = order.items
    .filter((i) => i.oos)
    .map((i) => `* ${i.qty} ${i.name}`)
    .join("\n");
  const naam = firstName(order.customerName) ? ` ${firstName(order.customerName)}` : "";
  return (
    `Hi${naam},\n\n` +
    `Helaas hebben we het volgende product uit je bestelling momenteel niet op voorraad:\n\n` +
    `${lijst}\n\n` +
    `We denken graag met je mee 😊\n` +
    `Wil je misschien een alternatief ontvangen, of zullen we het product uit de bestelling halen? ` +
    `Laat het gerust even weten.`
  );
}

app.post("/api/orders/:id/notify-oos", async (req, res) => {
  const order = store.getOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  const oos = order.items.filter((i) => i.oos);
  if (oos.length === 0) {
    return res.status(400).json({ error: "Geen producten als uitverkocht gemarkeerd" });
  }
  if (!order.chatId) {
    return res.status(400).json({
      error: "Geen chat-koppeling (oudere bestelling) — automatisch sturen kan alleen bij nieuwe bestellingen.",
    });
  }
  try {
    await whatsapp.sendToChat(order.chatId, buildOOSMessage(order));
  } catch (e) {
    return res.status(502).json({ error: "Versturen mislukt: " + e.message });
  }
  res.json(store.markNotified(order.id));
});

// Bestelling als gecontroleerd markeren (na de controle-popup).
app.post("/api/orders/:id/reviewed", (req, res) => {
  const order = store.markReviewed(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  res.json(order);
});

// "Alles op voorraad": markeer gecontroleerd én stuur de klant een korte bedankt-app.
function buildThankYouMessage(order) {
  const naam = firstName(order.customerName) ? ` ${firstName(order.customerName)}` : "";
  let ophalen = "";
  if (order.pickupDate) {
    const [, m, d] = order.pickupDate.split("-");
    ophalen = ` Ophalen: ${d}-${m}${order.pickupTime ? " om " + order.pickupTime : ""}.`;
  }
  return `Bedankt voor je bestelling${naam}! We maken alles voor je klaar.${ophalen} Groet, Klaas Kip`;
}

app.post("/api/orders/:id/confirm-instock", async (req, res) => {
  const order = store.getOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  store.markReviewed(order.id);
  let sent = false;
  let sendError = null;
  if (order.chatId) {
    try {
      await whatsapp.sendToChat(order.chatId, buildThankYouMessage(order));
      sent = true;
    } catch (e) {
      sendError = e.message;
    }
  }
  res.json({ order: store.getOrder(order.id), sent, sendError });
});

// Bestelling definitief verwijderen.
app.post("/api/orders/:id/delete", (req, res) => {
  const ok = store.deleteOrder(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Bestelling niet gevonden" });
  res.json({ ok: true });
});

// Gearchiveerde bestellingen.
app.get("/api/archive", (req, res) => {
  res.json({ orders: store.getArchive() });
});

// Bestellingen die handmatig nagekeken moeten worden (NEE / niet gelukt te lezen).
app.get("/api/review", (req, res) => {
  res.json({ review: store.getReview() });
});

app.listen(PORT, () => {
  console.log(`Klaas Kip dashboard draait op http://localhost:${PORT}`);
});

// WhatsApp-koppeling starten als die is ingeschakeld (zelfde proces = makkelijk voor PM2/Pi).
if (process.env.WHATSAPP_ENABLED !== "false") {
  try {
    whatsapp.start();
  } catch (e) {
    console.error("[whatsapp] kon niet starten:", e.message);
  }
}
