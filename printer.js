// Auto bonprint via ESC/POS naar de thermische printer (Epson TM-T20III via USB).
// Slaat zichzelf netjes over als er geen printer beschikbaar is (laptop = geen /dev/usb/lp0).
// Sequentiële printqueue zodat twee bonnen niet door elkaar lopen.

const fs = require("fs");
const { printer: ThermalPrinter, types: PrinterTypes } = require("node-thermal-printer");

const DEVICE = process.env.PRINTER_DEVICE || "/dev/usb/lp0";
const ENABLED = process.env.PRINTER_ENABLED !== "false";
const WIDTH = Number(process.env.PRINTER_WIDTH || 48); // tekens op 80mm Font A

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function formatDatum(iso) {
  if (!iso) return "Datum onbekend";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return cap(`${WEEKDAGEN[d.getDay()]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function deviceAvailable() {
  if (!ENABLED) return false;
  try {
    return fs.existsSync(DEVICE);
  } catch {
    return false;
  }
}

// Eén bon tegelijk; nieuwe prints wachten op de vorige.
let chain = Promise.resolve();
function enqueue(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function printOrder(order) {
  if (!deviceAvailable()) {
    return { skipped: true, reason: "Geen printer beschikbaar (PRINTER_DEVICE niet aanwezig)" };
  }
  return enqueue(() => _doPrint(order));
}

async function _doPrint(order) {
  const p = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: DEVICE,
    characterSet: "PC858_EURO",
    removeSpecialCharacters: false,
    lineCharacter: "-",
    width: WIDTH,
  });

  // --- Header
  p.alignCenter();
  p.bold(true);
  p.println("KLAAS KIP");
  p.bold(false);
  p.println("Westbeemster");
  p.newLine();

  // --- Periode-label
  if (order.label) {
    p.invert(true);
    p.bold(true);
    p.println(` ${order.label} `);
    p.bold(false);
    p.invert(false);
    p.newLine();
  }

  // --- Bestelnummer (heel groot, gecentreerd)
  p.setTextQuadArea();
  p.bold(true);
  p.println(`#${order.id}`);
  p.setTextNormal();
  p.bold(false);

  p.drawLine();

  // --- Afhalen
  p.alignLeft();
  p.println("AFHALEN");
  p.setTextDoubleHeight();
  p.bold(true);
  p.println(formatDatum(order.pickupDate));
  if (order.pickupTime) p.println(order.pickupTime);
  p.setTextNormal();
  p.bold(false);

  p.drawLine();

  // --- Klant
  p.println("KLANT");
  p.setTextDoubleHeight();
  p.bold(true);
  p.println(order.customerName || "Onbekend");
  p.setTextNormal();
  p.bold(false);
  if (order.phone) p.println(order.phone);

  p.drawLine();

  // --- Bestelling
  p.println("BESTELLING");
  p.newLine();
  for (const it of order.items || []) {
    p.setTextDoubleHeight();
    p.bold(true);
    const tag = it.oos ? "  (NIET LEVEREN)" : "";
    p.println(`${it.qty}  ${it.name}${tag}`);
    p.setTextNormal();
    p.bold(false);
  }

  // --- Opmerking
  if (order.note) {
    p.drawLine();
    p.println("OPMERKING");
    p.println(`"${order.note}"`);
  }

  p.drawLine();

  // --- Footer
  p.alignCenter();
  p.println(`Binnengekomen ${formatDateTime(order.receivedAt)}`);
  p.newLine();
  p.newLine();
  p.cut();

  await p.execute();
  return { printed: true };
}

module.exports = { printOrder, deviceAvailable };
