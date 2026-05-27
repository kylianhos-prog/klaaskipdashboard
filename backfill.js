// Eenmalige import: leest de WhatsApp-berichten van de afgelopen X dagen,
// haalt er bestellingen uit met Claude en zet ze in het dashboard.
// Zet het dashboard eerst op een schone lei (demo/testdata eruit).
//
// Gebruik (terwijl `npm start` GESTOPT is, anders botst de WhatsApp-sessie):
//   BACKFILL_DAYS=4 node backfill.js
//
// Standaard 4 dagen. Daarna weer gewoon `npm start` draaien.

require("dotenv").config({ override: true });
const { Client, LocalAuth } = require("whatsapp-web.js");
const store = require("./store");
const { extractOrder } = require("./ai");
const { formatPhone, todayContext, resolveNumber } = require("./whatsapp");

const DAYS = Number(process.env.BACKFILL_DAYS || 4);
const SINCE = Math.floor(Date.now() / 1000) - DAYS * 86400;
const MAX_SCAN = 400; // veiligheidslimiet tegen onverwacht veel berichten

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
});

client.on("qr", () => {
  console.log("[backfill] Geen geldige WhatsApp-sessie. Start eerst `npm start` en scan de QR, daarna opnieuw.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log(`[backfill] verbonden. Berichten van de afgelopen ${DAYS} dagen ophalen...`);
  let scanned = 0;
  let imported = 0;
  try {
    store.reset(); // schone lei
    const chats = await client.getChats();
    for (const chat of chats) {
      if (chat.isGroup) continue;
      const id = (chat.id && chat.id._serialized) || "";
      if (id.endsWith("@g.us") || id === "status@broadcast") continue;

      let msgs = [];
      try {
        msgs = await chat.fetchMessages({ limit: 80 });
      } catch {
        continue;
      }

      for (const m of msgs) {
        if (m.fromMe) continue;
        if (!m.timestamp || m.timestamp < SINCE) continue;
        const body = (m.body || "").trim();
        if (!body) continue;
        if (scanned >= MAX_SCAN) break;
        scanned++;

        const waName = (m._data && m._data.notifyName) || "";
        let parsed;
        try {
          parsed = await extractOrder(body, todayContext(), waName);
        } catch (e) {
          console.error("  extractie-fout:", e.message);
          continue;
        }
        if (!parsed || !parsed.isOrder || !parsed.items || parsed.items.length === 0) continue;

        const number = await resolveNumber(client, m.from);

        const order = store.addCapturedOrder({
          customerName: parsed.customerName || "",
          phone: formatPhone(number),
          chatId: m.from || (m.id && m.id.remote) || null,
          items: parsed.items,
          pickupDate: parsed.pickupDate || null,
          pickupTime: parsed.pickupTime || "",
          note: parsed.note || "",
          receivedAt: new Date(m.timestamp * 1000).toISOString(),
        });
        store.markReviewed(order.id); // historische import: geen controle-popup
        imported++;
        const regels = parsed.items.map((i) => `${i.qty} ${i.name}`).join(", ");
        console.log(`  + #${order.id} ${order.customerName || "Onbekend"} (${order.phone}) — ${regels} | afhalen ${order.pickupDate || "?"} ${order.pickupTime || ""}`);
      }
    }
    console.log(`\n[backfill] klaar: ${scanned} berichten bekeken, ${imported} bestelling(en) opgenomen.`);
  } catch (e) {
    console.error("[backfill] fout:", e.message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.initialize();
