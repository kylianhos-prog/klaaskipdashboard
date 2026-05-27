// WhatsApp-koppeling via whatsapp-web.js.
// Inkomend bericht -> Claude leest de bestelling uit -> bevestiging (JA/NEE) -> dashboard.
// Draait in hetzelfde proces als de webserver (handig voor PM2 op de Raspberry Pi).

const fs = require("fs");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const store = require("./store");

// Op de Pi (ARM) gebruiken we de systeem-Chromium; op andere systemen
// laten we puppeteer zijn eigen bundel kiezen.
function resolveChromium() {
  for (const p of ["/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
const { extractOrder, extractAlternative } = require("./ai");
const printer = require("./printer");

// Veiligheidsklep: tijdens testen alleen deze nummers verwerken.
// Zet WHATSAPP_ALLOWLIST="31657222791,3161..." in .env. Leeg = iedereen (volledig live).
const ALLOWLIST = (process.env.WHATSAPP_ALLOWLIST || "")
  .split(",")
  .map((s) => s.replace(/\D/g, ""))
  .filter(Boolean);

// Stille modus: bestellingen wél opnemen, maar NIET terugappen naar klanten.
// Zet WHATSAPP_AUTOREPLY=false in .env om dit aan te zetten.
const AUTOREPLY = process.env.WHATSAPP_AUTOREPLY !== "false";

// Actieve client (voor handmatig versturen, bv. "Geef aan klant door").
let client = null;

// Stuur een bericht naar een chat (chatId zoals "...@c.us" of "...@lid").
async function sendToChat(chatId, text) {
  if (!client) throw new Error("WhatsApp is niet verbonden");
  if (!chatId) throw new Error("Geen chat-adres bekend voor deze bestelling");
  return client.sendMessage(chatId, text);
}

const WEEKDAGEN = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function todayContext() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `Vandaag is ${WEEKDAGEN[d.getDay()]} ${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()} (${iso}).`;
}

// "31612345678" / "0612345678" / "612345678" -> "+31 612345678" (zoals WhatsApp)
function formatPhone(intl) {
  const raw = String(intl || "").replace(/\D/g, "");
  let nat = raw;
  if (nat.startsWith("31")) nat = nat.slice(2);
  else if (nat.startsWith("0")) nat = nat.slice(1);
  if (nat.length === 9 && nat.startsWith("6")) return `+31 ${nat}`;
  return raw ? "+" + raw : "";
}

// Echt telefoonnummer (digits) ophalen, ook bij @lid privacy-adressen.
async function resolveNumber(cli, chatId) {
  if (!chatId) return "";
  if (chatId.endsWith("@c.us")) return chatId.replace(/\D/g, "");
  if (cli) {
    try {
      const res = await cli.getContactLidAndPhone([chatId]);
      const pn = res && res[0] && res[0].pn;
      if (pn) return pn.replace(/\D/g, "");
    } catch (e) {
      console.error("[whatsapp] lid->nummer ophalen mislukt:", e.message);
    }
  }
  return chatId.replace(/\D/g, ""); // laatste redmiddel
}

function humanDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return `${WEEKDAGEN[d.getDay()]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`;
}

function buildSummary(concept) {
  const lines = ["Bestelling ontvangen:"];
  for (const it of concept.items) lines.push(`• ${it.qty} ${it.name}`);
  const datum = humanDate(concept.pickupDate);
  if (datum || concept.pickupTime) {
    lines.push(`Afhalen: ${datum || "(datum?)"}${concept.pickupTime ? " om " + concept.pickupTime : ""}`);
  }
  if (concept.note) lines.push(`Opmerking: ${concept.note}`);
  lines.push("");
  lines.push("Klopt dit? Antwoord JA of NEE.");
  return lines.join("\n");
}

async function handleMessage(client, msg) {
  // Groepen en statusupdates overslaan; 1-op-1 chats (@c.us én @lid) verwerken.
  if (msg.from.endsWith("@g.us") || msg.from === "status@broadcast") return;

  // Echt telefoonnummer ophalen (ook bij @lid privacy-adressen).
  const fromId = msg.from.replace(/\D/g, "");
  const number = await resolveNumber(client, msg.from);
  const waName = (msg._data && msg._data.notifyName) || "";
  console.log(`[whatsapp] afzender from=${msg.from} -> nummer=${number}${waName ? " (" + waName + ")" : ""}`);

  // Allowlist matcht op het echte nummer of op het @lid-id.
  if (ALLOWLIST.length && !ALLOWLIST.includes(number) && !ALLOWLIST.includes(fromId)) {
    console.log(`[whatsapp] genegeerd (niet op allowlist): ${number}`);
    return;
  }

  const body = (msg.body || "").trim();

  // STILLE MODUS: alleen opnemen, niets terugsturen.
  if (!AUTOREPLY) {
    // Reactie op een eerder verstuurde "niet op voorraad"-melding?
    const awaiting = store.findAwaitingReplyOrder(msg.from);
    if (awaiting) {
      try {
        const oosNames = awaiting.items.filter((i) => i.oos).map((i) => i.name);
        const r = await extractAlternative(body, oosNames, todayContext());
        const heeftInhoud = r && ((r.addItems && r.addItems.length) || r.removeUnavailable);
        if (heeftInhoud) {
          store.applyReply(awaiting.id, {
            addItems: r.addItems || [],
            removeUnavailable: !!r.removeUnavailable,
            replyText: body,
          });
          console.log(`[whatsapp] (stil) reactie verwerkt voor #${awaiting.id} — staat weer ter controle`);
        } else {
          // Bericht gaat niet over de bestelling -> chat loslaten, niets wijzigen, niets sturen.
          store.clearAwaitingReply(awaiting.id);
          console.log(`[whatsapp] (stil) bericht ging niet over de bestelling — chat losgelaten, genegeerd`);
        }
      } catch (e) {
        console.error("[whatsapp] reactie verwerken mislukt:", e.message);
        store.clearAwaitingReply(awaiting.id);
      }
      return;
    }

    let parsed;
    try {
      parsed = await extractOrder(body, todayContext(), waName);
    } catch (e) {
      console.error("[whatsapp] (stil) AI-extractie mislukt:", e.message);
      store.addReview({ phone: formatPhone(number), raw: body, reason: "AI-extractie mislukt: " + e.message });
      return;
    }
    if (parsed && parsed.isOrder && parsed.items && parsed.items.length > 0) {
      const order = store.addCapturedOrder({
        customerName: parsed.customerName || "",
        phone: formatPhone(number),
        chatId: msg.from,
        items: parsed.items,
        pickupDate: parsed.pickupDate || null,
        pickupTime: parsed.pickupTime || "",
        note: parsed.note || "",
        receivedAt: new Date().toISOString(),
      });
      console.log(`[whatsapp] (stil) bestelling opgenomen #${order.id} van ${order.phone} — geen antwoord verstuurd`);
      // Bon meteen printen — fire-and-forget, blokkeert de verwerking niet.
      printer
        .printOrder(order)
        .then((r) => r && r.printed && console.log(`[printer] bon #${order.id} geprint`))
        .catch((e) => console.error(`[printer] bon #${order.id} mislukt:`, e.message));
    } else {
      console.log("[whatsapp] (stil) bericht is geen bestelling, overgeslagen");
    }
    return;
  }

  const pending = store.getPending(msg.from);

  // Bestaat er een openstaande bevestiging? Dan is dit het JA/NEE-antwoord.
  if (pending) {
    const answer = body.toUpperCase();
    if (answer.startsWith("JA")) {
      const order = store.confirmPending(msg.from);
      console.log(`[whatsapp] bevestigd -> bestelling #${order.id}`);
      // TODO (op de Pi): hier de bon printen via ESC/POS.
      const datum = humanDate(order.pickupDate);
      await msg.reply(
        `Top! Je bestelling staat genoteerd onder #${order.id}.` +
          (datum ? `\nTot ${datum}${order.pickupTime ? " om " + order.pickupTime : ""}!` : "")
      );
    } else if (answer.startsWith("NEE")) {
      store.rejectPending(msg.from, "klant antwoordde NEE");
      console.log(`[whatsapp] afgewezen door klant -> handmatige controle`);
      await msg.reply(
        "Oké, geen probleem. We kijken er even handmatig naar en nemen zo nodig contact op. " +
          "Je kunt je bestelling ook opnieuw sturen."
      );
    } else {
      await msg.reply("Antwoord met JA als de bestelling klopt, of NEE om aan te passen.");
    }
    return;
  }

  // Nieuw bericht -> proberen als bestelling te lezen.
  let parsed;
  try {
    parsed = await extractOrder(body, todayContext(), waName);
  } catch (e) {
    console.error("[whatsapp] AI-extractie mislukt:", e.message);
    store.addReview({ phone: formatPhone(number), raw: body, reason: "AI-extractie mislukt: " + e.message });
    await msg.reply("Bedankt voor je bericht! We verwerken het zo even handmatig.");
    return;
  }

  if (!parsed || !parsed.isOrder || !parsed.items || parsed.items.length === 0) {
    await msg.reply(
      "Hallo! Stuur gerust je bestelling door — vermeld de producten met aantallen, " +
        "en de gewenste afhaaldag en tijd. Dan bevestig ik 'm meteen."
    );
    return;
  }

  const concept = {
    customerName: parsed.customerName || "",
    phone: formatPhone(number),
    items: parsed.items,
    pickupDate: parsed.pickupDate || null,
    pickupTime: parsed.pickupTime || "",
    note: parsed.note || "",
    receivedAt: new Date().toISOString(),
    raw: body,
  };
  store.setPending(msg.from, concept);
  console.log(`[whatsapp] concept-bestelling van ${concept.phone}, wacht op JA/NEE`);

  let reply = buildSummary(concept);
  if (parsed.clarificationNeeded) {
    reply += `\n\n(${parsed.clarificationNeeded})`;
  }
  await msg.reply(reply);
}

function start() {
  const chromium = resolveChromium();
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...(chromium ? { executablePath: chromium } : {}),
    },
  });

  client.on("qr", (qr) => {
    console.log("\n[whatsapp] Scan deze QR-code met WhatsApp (Gekoppelde apparaten > Apparaat koppelen):\n");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    console.log("[whatsapp] verbonden en klaar.");
    const eigen = client.info && client.info.wid ? client.info.wid.user : "onbekend";
    console.log(`[whatsapp] gekoppeld account (winkeltelefoon): ${eigen}`);
    if (!AUTOREPLY) {
      console.log("[whatsapp] STILLE MODUS: bestellingen worden opgenomen, er wordt NIET teruggeappt.");
    }
    if (ALLOWLIST.length) {
      console.log(`[whatsapp] alleen berichten van: ${ALLOWLIST.join(", ")} worden verwerkt.`);
    } else {
      console.log("[whatsapp] alle inkomende berichten worden verwerkt.");
    }
  });

  // Diagnostiek: laat ELK bericht zien dat de client binnenkrijgt (ook eigen verzonden).
  client.on("message_create", (m) => {
    console.log(
      `[whatsapp] (debug) bericht gezien: van ${m.from} -> ${m.to}, fromMe=${m.fromMe}, tekst="${(m.body || "").slice(0, 40)}"`
    );
  });

  client.on("auth_failure", (m) => console.error("[whatsapp] auth mislukt:", m));
  client.on("disconnected", (r) => console.warn("[whatsapp] verbinding verbroken:", r));

  client.on("message", (msg) => {
    handleMessage(client, msg).catch((e) => console.error("[whatsapp] fout in handler:", e));
  });

  client.initialize();
  return client;
}

module.exports = { start, formatPhone, todayContext, sendToChat, resolveNumber };
