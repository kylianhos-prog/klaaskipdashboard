// Persistente datastore voor het Klaas Kip systeem.
// Bewaart alles in data/db.json zodat bestellingen een herstart overleven.
// Later eventueel te vervangen door SQLite; de functies hieronder blijven gelijk.

const fs = require("fs");
const path = require("path");
const { initialOrders, initialLabel } = require("./data/mockOrders");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "db.json");

function seed() {
  const maxId = initialOrders.reduce((m, o) => Math.max(m, o.id), 100);
  return {
    orders: JSON.parse(JSON.stringify(initialOrders)),
    activeLabel: initialLabel,
    nextNumber: maxId + 1, // doorlopend bestelnummer, loopt oneindig op
    pending: {}, // chatId -> concept-bestelling die wacht op JA/NEE
    review: [], // bestellingen die handmatig nagekeken moeten worden
  };
}

let db;
try {
  db = fs.existsSync(DB_PATH)
    ? JSON.parse(fs.readFileSync(DB_PATH, "utf8"))
    : seed();
} catch (e) {
  console.error("[store] db.json onleesbaar, start met testdata:", e.message);
  db = seed();
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
save(); // schrijf direct weg bij eerste start

// Schone lei: alle bestellingen wissen (voor de start van de testweek).
function reset() {
  db = { orders: [], activeLabel: null, nextNumber: 1, pending: {}, review: [] };
  save();
  return db;
}

/* ---------- dashboard ---------- */
function getState() {
  return { orders: db.orders.filter((o) => !o.archived), activeLabel: db.activeLabel };
}

// Gearchiveerde bestellingen (nieuwste eerst).
function getArchive() {
  return db.orders
    .filter((o) => o.archived)
    .sort((a, b) => String(b.archivedAt || "").localeCompare(String(a.archivedAt || "")));
}

// Klaar -> archiveren (verdwijnt uit het hoofdscherm).
function archiveOrder(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  o.status = "klaar";
  o.archived = true;
  o.archivedAt = new Date().toISOString();
  save();
  return o;
}

// Terugzetten uit het archief naar het hoofdscherm.
function restoreOrder(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  o.archived = false;
  o.archivedAt = null;
  o.status = "in_bewerking";
  save();
  return o;
}

// Product aan-/uitzetten als "niet op voorraad".
function toggleItemOOS(id, index) {
  const o = db.orders.find((x) => x.id === id);
  if (!o || !o.items[index]) return null;
  o.items[index].oos = !o.items[index].oos;
  save();
  return o;
}

function setStatus(id, status) {
  const order = db.orders.find((o) => o.id === id);
  if (!order) return null;
  order.status = status;
  save();
  return order;
}

function setLabel(label) {
  db.activeLabel =
    label && String(label).trim() ? String(label).trim().toUpperCase() : null;
  save();
  return db.activeLabel;
}

/* ---------- bevestigings-flow (WhatsApp) ---------- */
function setPending(chatId, concept) {
  db.pending[chatId] = { ...concept, chatId };
  save();
  return db.pending[chatId];
}

function getPending(chatId) {
  return db.pending[chatId] || null;
}

function clearPending(chatId) {
  delete db.pending[chatId];
  save();
}

// JA: concept wordt een echte bestelling met nummer + huidig periode-label.
function confirmPending(chatId) {
  const concept = db.pending[chatId];
  if (!concept) return null;
  const order = {
    id: db.nextNumber++,
    customerName: concept.customerName || "Onbekend",
    phone: concept.phone || "",
    items: concept.items || [],
    pickupDate: concept.pickupDate || null,
    pickupTime: concept.pickupTime || "",
    note: concept.note || "",
    status: "open",
    label: db.activeLabel || null,
    reviewed: false,
    receivedAt: concept.receivedAt || new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
  };
  db.orders.push(order);
  delete db.pending[chatId];
  save();
  return order;
}

// Stille modus: bestelling direct opnemen zonder JA/NEE-bevestiging.
function addCapturedOrder(concept) {
  const order = {
    id: db.nextNumber++,
    customerName: concept.customerName || "Onbekend",
    phone: concept.phone || "",
    chatId: concept.chatId || null, // WhatsApp-chat om naar terug te sturen
    items: concept.items || [],
    pickupDate: concept.pickupDate || null,
    pickupTime: concept.pickupTime || "",
    note: concept.note || "",
    status: "open",
    label: db.activeLabel || null,
    unconfirmed: true, // niet bevestigd door de klant
    reviewed: false, // nog door de eigenaar te controleren (popup)
    notifiedAt: null, // wanneer "niet op voorraad" is doorgegeven
    receivedAt: concept.receivedAt || new Date().toISOString(),
    confirmedAt: null,
  };
  db.orders.push(order);
  save();
  return order;
}

function getOrder(id) {
  return db.orders.find((o) => o.id === id) || null;
}

function markNotified(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  o.notifiedAt = new Date().toISOString();
  o.awaitingReply = true; // volgende bericht van deze klant = reactie op de melding
  save();
  return o;
}

// Vind de bestelling die wacht op een reactie van deze chat (na een OOS-melding).
// Alleen binnen 48 uur na de melding — daarna laten we de chat met rust.
function findAwaitingReplyOrder(chatId) {
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const matches = db.orders.filter(
    (o) =>
      !o.archived &&
      o.chatId === chatId &&
      o.awaitingReply &&
      o.notifiedAt &&
      new Date(o.notifiedAt).getTime() >= cutoff
  );
  return matches.length ? matches[matches.length - 1] : null;
}

// Chat loslaten zonder iets te wijzigen (bv. als de klant iets stuurt dat niet over de bestelling gaat).
function clearAwaitingReply(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  o.awaitingReply = false;
  save();
  return o;
}

// Bestelling definitief verwijderen.
function deleteOrder(id) {
  const i = db.orders.findIndex((x) => x.id === id);
  if (i === -1) return false;
  db.orders.splice(i, 1);
  save();
  return true;
}

// Verwerk het antwoord van de klant: alternatief toevoegen / uitverkocht eruit.
function applyReply(id, { addItems = [], removeUnavailable = false, replyText = "" }) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  const heeftAlternatief = addItems.length > 0;
  if (heeftAlternatief || removeUnavailable) {
    o.items = o.items.filter((it) => !it.oos); // uitverkocht product vervalt
  }
  for (const it of addItems) {
    o.items.push({ qty: it.qty || "1x", name: it.name, added: true });
  }
  o.customerReply = replyText;
  o.awaitingReply = false;
  o.reviewed = false; // weer ter controle in de popup
  save();
  return o;
}

function markReviewed(id) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) return null;
  o.reviewed = true;
  save();
  return o;
}

// NEE: naar handmatige controle.
function rejectPending(chatId, reason) {
  const concept = db.pending[chatId];
  if (concept) {
    db.review.push({ ...concept, reason: reason || "afgewezen door klant", at: new Date().toISOString() });
    delete db.pending[chatId];
    save();
  }
  return concept;
}

function addReview(item) {
  db.review.push({ ...item, at: new Date().toISOString() });
  save();
}

function getReview() {
  return db.review;
}

module.exports = {
  reset,
  getState,
  getArchive,
  archiveOrder,
  restoreOrder,
  toggleItemOOS,
  getOrder,
  markNotified,
  markReviewed,
  findAwaitingReplyOrder,
  clearAwaitingReply,
  applyReply,
  deleteOrder,
  setStatus,
  setLabel,
  setPending,
  getPending,
  clearPending,
  confirmPending,
  rejectPending,
  addCapturedOrder,
  addReview,
  getReview,
};
