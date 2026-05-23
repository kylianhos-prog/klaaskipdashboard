const express = require("express");
const path = require("path");
const { initialOrders, initialLabel } = require("./data/mockOrders");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// In-memory state voor het prototype. Later: SQLite.
let orders = JSON.parse(JSON.stringify(initialOrders));
let activeLabel = initialLabel;

const VALID_STATUS = ["open", "in_bewerking", "klaar"];

app.get("/api/state", (req, res) => {
  res.json({ orders, activeLabel });
});

// Status van een bestelling wijzigen (open / in_bewerking / klaar).
app.post("/api/orders/:id/status", (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!VALID_STATUS.includes(status)) {
    return res.status(400).json({ error: "Ongeldige status" });
  }
  const order = orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ error: "Bestelling niet gevonden" });
  order.status = status;
  res.json(order);
});

// Periode-label aan- of uitzetten. Body: { label: "KERSTBESTELLING" } of { label: null }.
app.post("/api/label", (req, res) => {
  const { label } = req.body;
  activeLabel = label && String(label).trim() ? String(label).trim().toUpperCase() : null;
  res.json({ activeLabel });
});

app.listen(PORT, () => {
  console.log(`Klaas Kip dashboard draait op http://localhost:${PORT}`);
});
