/* Klaas Kip dashboard — frontend logica (prototype met testdata) */

const STATUS_LABEL = {
  open: "Open",
  in_bewerking: "In bewerking",
  klaar: "Klaar",
};

let state = { orders: [], activeLabel: null };

/* ---------- datum-helpers ---------- */
function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
const TODAY = localDate(new Date());
const TOMORROW = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return localDate(d);
})();

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayTitle(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const full = cap(
    new Intl.DateTimeFormat("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(d)
  );
  if (dateStr === TODAY) return { lead: "Vandaag", rest: full };
  if (dateStr === TOMORROW) return { lead: "Morgen", rest: full };
  return { lead: full, rest: "" };
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

function weekdayShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return new Intl.DateTimeFormat("nl-NL", { weekday: "long" }).format(d);
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  const date = `${String(d.getDate()).padStart(2, "0")}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${d.getFullYear()}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
  return `${date} ${time}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

/* ---------- data ---------- */
async function loadState() {
  const res = await fetch("/api/state");
  state = await res.json();
  render();
}

async function setStatus(id, status) {
  await fetch(`/api/orders/${id}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const order = state.orders.find((o) => o.id === id);
  if (order) order.status = status;
  render();
}

async function setLabel(label) {
  const res = await fetch("/api/label", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  const data = await res.json();
  state.activeLabel = data.activeLabel;
  renderLabelView();
  renderHeaderLabel();
}

/* ---------- render: agenda ---------- */
function render() {
  renderHeaderLabel();
  const view = document.getElementById("agenda-view");

  const days = {};
  for (const o of state.orders) {
    (days[o.pickupDate] = days[o.pickupDate] || []).push(o);
  }
  const sortedDates = Object.keys(days).sort();

  if (sortedDates.length === 0) {
    view.innerHTML = `<p class="empty">Nog geen bestellingen.</p>`;
    return;
  }

  const statusRank = { open: 0, in_bewerking: 0, klaar: 1 };
  let cardIndex = 0;
  let html = "";

  for (const date of sortedDates) {
    const list = days[date].sort((a, b) => {
      if (statusRank[a.status] !== statusRank[b.status])
        return statusRank[a.status] - statusRank[b.status];
      return a.pickupTime.localeCompare(b.pickupTime);
    });
    const t = dayTitle(date);
    const openCount = list.filter((o) => o.status !== "klaar").length;

    html += `<section class="day-section">
      <div class="day-head">
        <h2 class="day-title">${t.lead}${
      t.rest ? ` · <span style="color:var(--ink-soft);font-weight:600">${t.rest}</span>` : ""
    }</h2>
        <span class="day-rule"></span>
        <span class="day-count">${openCount} te doen</span>
      </div>
      <div class="cards">
        ${list.map((o) => cardHTML(o, cardIndex++)).join("")}
      </div>
    </section>`;
  }
  view.innerHTML = html;
}

function cardHTML(o, index) {
  const label = o.label || state.activeLabel;
  const isKlaar = o.status === "klaar";
  return `<article class="card" data-status="${o.status}" data-id="${o.id}"
      style="animation-delay:${Math.min(index * 55, 600)}ms">
    <div class="card-top">
      <span class="card-time">${o.pickupTime}</span>
      <button class="card-num" data-bon="${o.id}" type="button" title="Bon bekijken">#${o.id}</button>
    </div>
    <span class="status-inline status-${o.status}"><span class="dot"></span>${
    STATUS_LABEL[o.status]
  }</span>
    ${label ? `<div class="card-label">${label}</div>` : ""}
    <h3 class="card-name">${o.customerName}</h3>
    <div class="card-phone">${o.phone}</div>
    <ul class="items">
      ${o.items
        .map((it) => `<li><span class="qty">${it.qty}</span><span>${it.name}</span></li>`)
        .join("")}
    </ul>
    ${o.note ? `<div class="card-note">${o.note}</div>` : ""}
    <div class="card-actions">
      <button class="btn btn-klaar" data-klaar="${o.id}" type="button">${
    isKlaar ? "Terugzetten" : "Klaar"
  }</button>
      <a class="btn btn-bel" href="tel:${o.phone.replace(/[^0-9+]/g, "")}">Bel klant</a>
    </div>
  </article>`;
}

/* ---------- render: header-label ---------- */
function renderHeaderLabel() {
  const badge = document.getElementById("header-label");
  if (state.activeLabel) {
    badge.textContent = state.activeLabel;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

/* ---------- render: periode-label scherm ---------- */
function renderLabelView() {
  document.getElementById("current-label").textContent =
    state.activeLabel || "GEEN";
  document.querySelectorAll(".big-btn[data-label]").forEach((b) => {
    b.classList.toggle("active", b.dataset.label === state.activeLabel);
  });
}

/* ---------- bon-voorbeeld ---------- */
function showBon(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const label = o.label || state.activeLabel;
  const bon = document.getElementById("bon");
  bon.innerHTML = `
    <div class="b-head">KLAAS KIP — WESTBEEMSTER</div>
    <div class="b-num">Bestelnummer: #${o.id}</div>
    ${label ? `<div class="b-label">${label}</div>` : ""}
    <hr />
    <div class="b-row"><span>Datum binnen:</span><span>${fmtDateTime(o.receivedAt)}</span></div>
    <div class="b-row b-strong"><span>AFHALEN:</span><span>${weekdayShort(
      o.pickupDate
    )} ${shortDate(o.pickupDate).slice(0, 5)} ${o.pickupTime}</span></div>
    <hr />
    <div>Klant: ${o.customerName}</div>
    <div>Tel: ${o.phone}</div>
    <hr />
    ${o.items
      .map(
        (it) => `<div class="b-item"><span class="q">${it.qty}</span><span>${it.name}</span></div>`
      )
      .join("")}
    <hr />
    ${
      o.note
        ? `<div>Opmerking:</div><div class="b-note">"${o.note}"</div><hr />`
        : ""
    }
    <div class="b-foot">Bevestigd via WhatsApp ${fmtTime(o.confirmedAt)}</div>
  `;
  document.getElementById("bon-overlay").hidden = false;
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const klaarBtn = e.target.closest("[data-klaar]");
  if (klaarBtn) {
    e.stopPropagation();
    const id = Number(klaarBtn.dataset.klaar);
    const o = state.orders.find((x) => x.id === id);
    setStatus(id, o.status === "klaar" ? "in_bewerking" : "klaar");
    return;
  }

  const bonBtn = e.target.closest("[data-bon]");
  if (bonBtn) {
    e.stopPropagation();
    showBon(Number(bonBtn.dataset.bon));
    return;
  }

  if (e.target.closest(".btn-bel")) return; // laat tel: link werken

  // tik op de kaart zelf: open <-> in bewerking
  const card = e.target.closest(".card");
  if (card) {
    const id = Number(card.dataset.id);
    const o = state.orders.find((x) => x.id === id);
    if (o && o.status !== "klaar") {
      setStatus(id, o.status === "open" ? "in_bewerking" : "open");
    }
    return;
  }

  const labelBtn = e.target.closest(".big-btn[data-label]");
  if (labelBtn) {
    const lbl = labelBtn.dataset.label;
    setLabel(lbl === state.activeLabel ? null : lbl);
    return;
  }
});

document.getElementById("open-label").addEventListener("click", () => {
  document.getElementById("agenda-view").hidden = true;
  document.getElementById("label-view").hidden = false;
  renderLabelView();
});
document.getElementById("close-label").addEventListener("click", () => {
  document.getElementById("label-view").hidden = true;
  document.getElementById("agenda-view").hidden = false;
  render();
});
document.getElementById("clear-label").addEventListener("click", () => setLabel(null));
document.getElementById("new-label").addEventListener("click", () => {
  const naam = prompt("Naam van het nieuwe label (bv. MOEDERDAG):");
  if (naam && naam.trim()) setLabel(naam.trim());
});

const bonOverlay = document.getElementById("bon-overlay");
document.getElementById("close-bon").addEventListener("click", () => {
  bonOverlay.hidden = true;
});
bonOverlay.addEventListener("click", (e) => {
  if (e.target === bonOverlay) bonOverlay.hidden = true;
});

/* ---------- start ---------- */
function setToday() {
  document.getElementById("today-label").textContent = cap(
    new Intl.DateTimeFormat("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date())
  );
}
setToday();
loadState();
