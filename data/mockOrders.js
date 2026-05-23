// Testbestellingen voor het dashboard-prototype.
// Later vervangen door echte bestellingen uit SQLite (gevoed door WhatsApp + Claude).
// Datums zijn relatief aan "vandaag" zodat de demo altijd klopt.

function isoDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // lokale YYYY-MM-DD
}

const initialLabel = null; // bv. "KERSTBESTELLING" als een periode-label actief is

const initialOrders = [
  {
    id: 142,
    customerName: "Jan de Vries",
    phone: "06-12345678",
    items: [
      { qty: "2x", name: "Kipdijen saté" },
      { qty: "500g", name: "Kipfilet" },
      { qty: "1x", name: "Saté 6 stokjes" },
    ],
    pickupDate: isoDate(0),
    pickupTime: "13:00",
    note: "Graag goed doorbakken",
    status: "open",
    label: null,
    receivedAt: isoDate(0) + "T11:32:00",
    confirmedAt: isoDate(0) + "T11:35:00",
  },
  {
    id: 143,
    customerName: "Marieke Bos",
    phone: "06-23456789",
    items: [
      { qty: "1x", name: "Diamanthaas" },
      { qty: "4x", name: "Drumsticks" },
    ],
    pickupDate: isoDate(0),
    pickupTime: "14:30",
    note: "",
    status: "in_bewerking",
    label: null,
    receivedAt: isoDate(0) + "T09:10:00",
    confirmedAt: isoDate(0) + "T09:12:00",
  },
  {
    id: 144,
    customerName: "Familie Jansen",
    phone: "06-34567890",
    items: [
      { qty: "1x", name: "Hele kip" },
      { qty: "500g", name: "Schnitzel" },
    ],
    pickupDate: isoDate(1),
    pickupTime: "10:00",
    note: "",
    status: "open",
    label: null,
    receivedAt: isoDate(0) + "T16:02:00",
    confirmedAt: isoDate(0) + "T16:05:00",
  },
  {
    id: 145,
    customerName: "Peter Smit",
    phone: "06-45678901",
    items: [
      { qty: "6x", name: "Kipburgers" },
      { qty: "1kg", name: "Kippenpoten" },
      { qty: "2x", name: "Spareribs marinade" },
    ],
    pickupDate: isoDate(1),
    pickupTime: "15:45",
    note: "Halen rond half 4, kan iets later worden",
    status: "open",
    label: null,
    receivedAt: isoDate(0) + "T18:20:00",
    confirmedAt: isoDate(0) + "T18:24:00",
  },
  {
    id: 146,
    customerName: "Anneke Visser",
    phone: "06-56789012",
    items: [
      { qty: "2x", name: "Hele kip" },
      { qty: "750g", name: "Kipfilet" },
    ],
    pickupDate: isoDate(2),
    pickupTime: "11:30",
    note: "",
    status: "open",
    label: null,
    receivedAt: isoDate(0) + "T19:40:00",
    confirmedAt: isoDate(0) + "T19:43:00",
  },
  {
    id: 141,
    customerName: "Henk Mol",
    phone: "06-67890123",
    items: [
      { qty: "1x", name: "Kip aan het spit" },
    ],
    pickupDate: isoDate(0),
    pickupTime: "09:30",
    note: "",
    status: "klaar",
    label: null,
    receivedAt: isoDate(-1) + "T15:00:00",
    confirmedAt: isoDate(-1) + "T15:03:00",
  },
];

module.exports = { initialOrders, initialLabel };
