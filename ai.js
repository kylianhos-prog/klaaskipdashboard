// Leest een WhatsApp-bericht uit en haalt er een gestructureerde bestelling uit.
// Gebruikt Claude met geforceerde tool-use, zodat de output altijd geldig JSON is.

const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-7";

// Lazy: pas een client maken zodra we 'm nodig hebben, zodat de WhatsApp-koppeling
// ook kan opstarten (QR tonen) voordat de ANTHROPIC_API_KEY is ingesteld.
let _client;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

const SYSTEM = `Je bent het orderverwerkingssysteem van poelier Klaas Kip in Westbeemster.
Klanten sturen via WhatsApp een bestelling. Jouw taak: haal de bestelgegevens uit het bericht.

Context over het assortiment (poelier): hele kip, kipfilet, kipdijen, drumsticks, kippenpoten,
kipburgers, schnitzel, saté/saté-stokjes, diamanthaas, spareribs, gemarineerd vlees, kip aan het spit, enz.

Regels:
- Producten: noteer per regel een hoeveelheid (qty) en een naam (name).
  - Aantallen als "2x", "1x", "6x". Gewichten als "500g", "1kg", "750g". Hou de naam kort en netjes.
- Afhaaldatum (pickupDate): geef als YYYY-MM-DD. Reken relatieve datums om naar de echte datum
  op basis van de meegegeven datum van vandaag ("morgen", "zaterdag", "volgende week dinsdag", "24 mei").
  Als er geen datum genoemd is: laat pickupDate leeg ("").
- Afhaaltijd (pickupTime): geef als HH:MM in 24-uurs notatie. "half 3" = 14:30, "kwart voor 5" = 16:45.
  Geen tijd genoemd: laat leeg ("").
- Klantnaam (customerName): de volledige naam van de klant — voornaam én achternaam indien bekend.
  Gebruik de naam die in het bericht genoemd wordt (bv. ondertekening "Groet, Jan de Vries").
  Staat er geen naam in het bericht, gebruik dan de meegegeven WhatsApp-profielnaam van de afzender.
  Laat alleen leeg als er echt geen naam te vinden is.
- note: bijzonderheden/opmerkingen van de klant (bv. "graag goed doorbakken"); anders leeg.
- clarificationNeeded: korte omschrijving van wat ontbreekt of onduidelijk is (bv. ontbrekende datum/tijd).
  Laat leeg als de bestelling compleet en duidelijk is.
- isOrder: true als het bericht een bestelling is; false bij bijv. een vraag, begroeting of onzin.

Vul altijd alle velden in via de tool record_order.`;

const ORDER_TOOL = {
  name: "record_order",
  description: "Leg de uit het WhatsApp-bericht gehaalde bestelling vast.",
  input_schema: {
    type: "object",
    properties: {
      isOrder: { type: "boolean", description: "true als dit bericht een bestelling is" },
      customerName: { type: "string", description: "naam van de klant of leeg" },
      items: {
        type: "array",
        description: "bestelde producten",
        items: {
          type: "object",
          properties: {
            qty: { type: "string", description: 'hoeveelheid, bv. "2x" of "500g"' },
            name: { type: "string", description: "productnaam" },
          },
          required: ["qty", "name"],
        },
      },
      pickupDate: { type: "string", description: "afhaaldatum als YYYY-MM-DD, of leeg" },
      pickupTime: { type: "string", description: "afhaaltijd als HH:MM, of leeg" },
      note: { type: "string", description: "opmerking van de klant, of leeg" },
      clarificationNeeded: { type: "string", description: "wat ontbreekt/onduidelijk is, of leeg" },
    },
    required: [
      "isOrder",
      "customerName",
      "items",
      "pickupDate",
      "pickupTime",
      "note",
      "clarificationNeeded",
    ],
  },
};

async function extractOrder(messageText, todayContext, waName) {
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [ORDER_TOOL],
    tool_choice: { type: "tool", name: "record_order" },
    messages: [
      {
        role: "user",
        content: `${todayContext}\nWhatsApp-profielnaam van de afzender: ${waName || "(onbekend)"}\n\nWhatsApp-bericht van de klant:\n"""\n${messageText}\n"""`,
      },
    ],
  });

  const block = resp.content.find((b) => b.type === "tool_use");
  return block ? block.input : null;
}

// Interpreteer het antwoord van een klant op een "niet op voorraad"-melding.
const REPLY_TOOL = {
  name: "record_reply",
  description: "Leg vast wat de klant wil n.a.v. de niet-op-voorraad-melding.",
  input_schema: {
    type: "object",
    properties: {
      addItems: {
        type: "array",
        description: "alternatieve producten die de klant wil toevoegen aan de bestelling",
        items: {
          type: "object",
          properties: {
            qty: { type: "string", description: 'hoeveelheid, bv. "2x" of "500g"; leeg indien niet genoemd' },
            name: { type: "string", description: "productnaam" },
          },
          required: ["qty", "name"],
        },
      },
      removeUnavailable: {
        type: "boolean",
        description: "true als de klant het uitverkochte product uit de bestelling wil laten halen",
      },
      clarification: { type: "string", description: "korte samenvatting of wat onduidelijk is" },
    },
    required: ["addItems", "removeUnavailable", "clarification"],
  },
};

async function extractAlternative(replyText, oosNames, todayContext) {
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "Je bent het orderverwerkingssysteem van poelier Klaas Kip. Een klant kreeg te horen dat een product " +
      "uit zijn bestelling niet op voorraad is, en heeft daarop geantwoord. Bepaal of de klant een alternatief " +
      "product wil (en welk), of dat het uitverkochte product uit de bestelling gehaald mag worden. " +
      "Hanteer dezelfde notatie als bestellingen: aantallen als \"2x\", gewichten als \"500g\".",
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: "record_reply" },
    messages: [
      {
        role: "user",
        content: `${todayContext}\n\nNiet op voorraad: ${oosNames.join(", ") || "(onbekend)"}\n\nAntwoord van de klant:\n"""\n${replyText}\n"""`,
      },
    ],
  });
  const block = resp.content.find((b) => b.type === "tool_use");
  return block ? block.input : null;
}

module.exports = { extractOrder, extractAlternative, MODEL };
