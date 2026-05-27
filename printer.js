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

// Hulpjes voor compacte sectie-kopjes (vet + onderstreept).
function sectionLabel(p, text) {
  p.alignLeft();
  p.bold(true);
  p.underline(true);
  p.println(text);
  p.underline(false);
  p.bold(false);
}
function big(p, text, h = 1, w = 0) {
  p.bold(true);
  p.setTextSize(h, w);
  p.println(text);
  p.setTextNormal();
  p.bold(false);
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

  // --- Header (compact, gecentreerd) ---
  p.alignCenter();
  p.bold(true);
  p.println("KLAAS KIP");
  p.bold(false);
  p.println("Westbeemster");
  p.newLine();

  // --- Periode-label als banner ---
  if (order.label) {
    p.invert(true);
    p.bold(true);
    p.setTextSize(1, 0);
    p.println(`  ${order.label}  `);
    p.setTextNormal();
    p.bold(false);
    p.invert(false);
    p.newLine();
  }

  // Eén consistente grootte voor alle data-tekst.
  const DATA = [1, 1]; // dubbelhoog + dubbelbreed, lekker leesbaar

  // --- Bestelnummer (gecentreerd) ---
  p.alignCenter();
  p.println("Bestelling");
  big(p, `#${order.id}`, DATA[0], DATA[1]);
  p.newLine();
  p.drawLine();
  p.newLine();

  // --- Afhalen ---
  sectionLabel(p, "AFHALEN");
  big(p, formatDatum(order.pickupDate), DATA[0], DATA[1]);
  if (order.pickupTime) {
    big(p, order.pickupTime, DATA[0], DATA[1]);
  }
  p.newLine();
  p.drawLine();
  p.newLine();

  // --- Klant ---
  sectionLabel(p, "KLANT");
  big(p, order.customerName || "Onbekend", DATA[0], DATA[1]);
  if (order.phone) {
    big(p, order.phone, DATA[0], DATA[1]);
  }
  p.newLine();
  p.drawLine();
  p.newLine();

  // --- Bestelling ---
  sectionLabel(p, "BESTELLING");
  p.newLine();
  for (const it of order.items || []) {
    const tag = it.oos ? "  (NIET LEVEREN)" : "";
    big(p, `${it.qty}  ${it.name}${tag}`, DATA[0], DATA[1]);
  }
  p.newLine();

  // --- Opmerking ---
  if (order.note) {
    p.drawLine();
    p.newLine();
    sectionLabel(p, "OPMERKING");
    big(p, `"${order.note}"`, DATA[0], DATA[1]);
    p.newLine();
  }

  p.drawLine();
  p.newLine();

  // --- Footer (klein, gecentreerd) ---
  p.alignCenter();
  p.println(`Binnengekomen ${formatDateTime(order.receivedAt)}`);
  p.newLine();
  p.newLine();
  p.newLine();
  p.cut();

  await p.execute();
  return { printed: true };
}

module.exports = { printOrder, deviceAvailable };
