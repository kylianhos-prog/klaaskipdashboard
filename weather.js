// Dagelijks weerbericht voor Westbeemster, geprint op de bonprinter.
// Bron: Open-Meteo (gratis, geen API-key nodig).

const printer = require("./printer");

const LAT = process.env.WEATHER_LAT || "52.58";
const LON = process.env.WEATHER_LON || "4.93";
const LOC_NAME = process.env.WEATHER_LOCATION || "De Beemster";
const DAYS = Number(process.env.WEATHER_DAYS || 3);

const WEATHER_NL = {
  0: "Zonnig",
  1: "Vooral zonnig",
  2: "Half bewolkt",
  3: "Bewolkt",
  45: "Mist",
  48: "Mist met rijp",
  51: "Lichte motregen",
  53: "Motregen",
  55: "Stevige motregen",
  56: "IJsregen (licht)",
  57: "IJsregen",
  61: "Lichte regen",
  63: "Regen",
  65: "Stevige regen",
  66: "IJsregen (licht)",
  67: "IJsregen",
  71: "Lichte sneeuw",
  73: "Sneeuw",
  75: "Veel sneeuw",
  77: "Sneeuwkorrels",
  80: "Lichte buien",
  81: "Regenbuien",
  82: "Stevige buien",
  85: "Sneeuwbuien",
  86: "Hevige sneeuwbuien",
  95: "Onweer",
  96: "Onweer met hagel",
  99: "Hevig onweer met hagel",
};

const WEEKDAGEN = [
  "zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag",
];
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function dayLabel(dateStr, idx) {
  if (idx === 0) return "Vandaag";
  if (idx === 1) return "Morgen";
  const d = new Date(dateStr + "T00:00:00");
  return cap(`${WEEKDAGEN[d.getDay()]} ${d.getDate()} ${MAANDEN[d.getMonth()]}`);
}

function summary(code) {
  return WEATHER_NL[code] || `Weercode ${code}`;
}

async function fetchForecast() {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${LAT}&longitude=${LON}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
    `precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset` +
    `&forecast_days=${DAYS}&timezone=Europe/Amsterdam`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo gaf ${res.status}`);
  const data = await res.json();
  if (!data.daily || !data.daily.time) throw new Error("Onverwacht antwoord van Open-Meteo");
  return data.daily;
}

function buildDays(daily) {
  const out = [];
  for (let i = 0; i < daily.time.length; i++) {
    out.push({
      datum: daily.time[i],
      label: dayLabel(daily.time[i], i),
      tMin: Math.round(daily.temperature_2m_min[i]),
      tMax: Math.round(daily.temperature_2m_max[i]),
      regenKans: Math.round(daily.precipitation_probability_max?.[i] ?? 0),
      regenMM: Math.round((daily.precipitation_sum?.[i] ?? 0) * 10) / 10,
      windKmh: Math.round(daily.wind_speed_10m_max?.[i] ?? 0),
      omschr: summary(daily.weather_code[i]),
      code: daily.weather_code[i],
    });
  }
  return out;
}

function fmtNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function printWeather() {
  const daily = await fetchForecast();
  const days = buildDays(daily);

  return printer.print((p) => {
    const DATA = [1, 1]; // zelfde grote leesbare maat als de bonnen

    // Header
    p.alignCenter();
    p.bold(true);
    p.println("KLAAS KIP");
    p.bold(false);
    p.println(LOC_NAME);
    p.newLine();
    p.bold(true);
    p.setTextSize(2, 2);
    p.println("WEER");
    p.setTextNormal();
    p.bold(false);
    p.newLine();
    p.drawLine();
    p.newLine();

    // Per dag
    for (let i = 0; i < days.length; i++) {
      const d = days[i];

      printer.sectionLabel(p, d.label.toUpperCase());
      // Omschrijving (zonnig/regen/...)
      printer.big(p, d.omschr, DATA[0], DATA[1]);
      // Temperatuur
      printer.big(p, `${d.tMin}°C / ${d.tMax}°C`, DATA[0], DATA[1]);
      // Regen
      const regen = d.regenMM > 0 ? `Regen: ${d.regenKans}%  (${d.regenMM} mm)` : `Regen: ${d.regenKans}%`;
      printer.big(p, regen, DATA[0], DATA[1]);
      // Wind
      printer.big(p, `Wind: ${d.windKmh} km/u`, DATA[0], DATA[1]);

      if (i < days.length - 1) {
        p.newLine();
        p.drawLine();
        p.newLine();
      }
    }

    p.newLine();
    p.drawLine();
    p.newLine();

    // Footer
    p.alignCenter();
    p.println(`Geprint ${fmtNow()}`);
    p.newLine();
    p.newLine();
    p.newLine();
    p.cut();
  });
}

module.exports = { printWeather, fetchForecast, buildDays };
