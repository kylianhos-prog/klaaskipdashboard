/* Klaas Kip dashboard — frontend logica (prototype met testdata) */

const STATUS_LABEL = {
  open: "Open",
  in_bewerking: "In bewerking",
  klaar: "Klaar",
};

let state = { orders: [], activeLabel: null };
let archive = [];
let reviewOrderId = null;

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
  if (!dateStr) return { lead: "Datum onbekend", rest: "" };
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
  render(true);
  maybeShowReview();
}

// Automatisch verversen: haalt nieuwe bestellingen op zonder dat je hoeft te herladen.
async function refresh() {
  try {
    const res = await fetch("/api/state");
    const fresh = await res.json();
    if (JSON.stringify(fresh) !== JSON.stringify(state)) {
      state = fresh;
      // Niet opnieuw animeren tijdens een open label-scherm.
      render(false);
      renderHeaderLabel();
    }
    maybeShowReview();
  } catch (e) {
    /* netwerk even weg: gewoon volgende keer opnieuw proberen */
  }
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

// Klaar -> bon gaat naar archief en verdwijnt uit het hoofdscherm.
async function markKlaar(id) {
  await fetch(`/api/orders/${id}/klaar`, { method: "POST" });
  state.orders = state.orders.filter((o) => o.id !== id);
  render();
}

// Terugzetten uit het archief.
async function restoreOrder(id) {
  await fetch(`/api/orders/${id}/restore`, { method: "POST" });
  await loadArchive();
  const res = await fetch("/api/state");
  state = await res.json();
}

// Definitief verwijderen vanuit het archief.
async function deleteOrder(id) {
  if (!confirm("Deze bestelling definitief verwijderen?")) return;
  await fetch(`/api/orders/${id}/delete`, { method: "POST" });
  archive = archive.filter((o) => o.id !== id);
  renderArchive();
}

// Product aan-/uitzetten als "niet op voorraad".
async function toggleOOS(id, index) {
  const res = await fetch(`/api/orders/${id}/item/${index}/oos`, { method: "POST" });
  const updated = await res.json();
  const order = state.orders.find((o) => o.id === id);
  if (order) order.items = updated.items;
  render();
  if (reviewOrderId !== null) renderReview();
}

// Geef aan klant door: stuur een appje met wat er niet op voorraad is (met bevestiging).
async function notifyOOS(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const oos = o.items.filter((i) => i.oos);
  if (!oos.length) {
    alert("Tik eerst de producten aan die niet op voorraad zijn.");
    return;
  }
  const naam = o.customerName && o.customerName !== "Onbekend" ? o.customerName : "de klant";
  const lijst = oos.map((i) => `• ${i.qty} ${i.name}`).join("\n");
  if (!confirm(`Bericht sturen naar ${naam}?\n\nNiet op voorraad:\n${lijst}`)) return;
  const res = await fetch(`/api/orders/${id}/notify-oos`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert("Niet gelukt: " + (err.error || res.status));
    return;
  }
  const updated = await res.json();
  o.notifiedAt = updated.notifiedAt;
  render();
}

async function loadArchive() {
  const res = await fetch("/api/archive");
  const data = await res.json();
  archive = data.orders || [];
  renderArchive();
}

function renderArchive() {
  const el = document.getElementById("archive-cards");
  if (!archive.length) {
    el.innerHTML = `<p class="empty">Nog niets gearchiveerd.</p>`;
    return;
  }
  el.innerHTML = archive.map((o, i) => cardHTML(o, i, false, true)).join("");
}

/* ---------- controle-popup nieuwe bestelling ---------- */
function maybeShowReview() {
  if (reviewOrderId !== null) return; // er staat al een popup open
  const o = state.orders.find((x) => x.reviewed === false);
  if (!o) return;
  reviewOrderId = o.id;
  renderReview();
  document.getElementById("review-overlay").hidden = false;
}

function renderReview() {
  const o = state.orders.find((x) => x.id === reviewOrderId);
  if (!o) {
    closeReview();
    return;
  }
  const heeftOOS = o.items.some((i) => i.oos);
  let afhaal;
  if (o.pickupDate) {
    const t = dayTitle(o.pickupDate);
    afhaal = (t.lead + (t.rest ? " · " + t.rest : "")).trim() + (o.pickupTime ? " om " + o.pickupTime : "");
  } else {
    afhaal = o.pickupTime ? "Tijd " + o.pickupTime : "Datum onbekend";
  }
  const items = o.items
    .map((it, idx) => {
      const cls = it.oos ? " oos" : it.added ? " added" : "";
      const tag = it.oos
        ? '<span class="oos-tag">uitverkocht</span>'
        : it.added
        ? '<span class="oos-tag added-tag">nieuw</span>'
        : "";
      return `<li class="item${cls}" data-oos-order="${o.id}" data-oos-index="${idx}"><span class="qty">${it.qty}</span><span class="iname">${it.name}</span>${tag}</li>`;
    })
    .join("");
  const primary = heeftOOS
    ? `<button class="btn btn-notify" data-review="notify" type="button">Niet op voorraad — doorgeven aan klant</button>`
    : `<button class="btn btn-klaar" data-review="allstock" type="button">Alles op voorraad</button>`;
  const eyebrow = o.customerReply
    ? "Klant heeft gereageerd — controleer de aangepaste bestelling"
    : "Nieuwe bestelling — even controleren";
  document.getElementById("review-modal").innerHTML = `
    <div class="review-eyebrow">${eyebrow}</div>
    <div class="review-top">
      <h2 class="review-name">${o.customerName}</h2>
      <span class="card-num">#${o.id}</span>
    </div>
    <div class="review-meta">${afhaal}${o.phone ? " · " + o.phone : ""}</div>
    <ul class="items review-items">${items}</ul>
    <div class="oos-hint">tik een product aan dat niet op voorraad is</div>
    ${o.note ? `<div class="card-note">${o.note}</div>` : ""}
    ${o.customerReply ? `<div class="card-note card-reply">Klant reageerde: "${o.customerReply}"</div>` : ""}
    <div class="review-actions">${primary}</div>
    <button class="review-discard" data-review="delete" type="button">Dit is geen bestelling — verwijderen</button>
  `;
}

function closeReview() {
  reviewOrderId = null;
  document.getElementById("review-overlay").hidden = true;
}

async function markReviewedApi(id) {
  await fetch(`/api/orders/${id}/reviewed`, { method: "POST" });
  const o = state.orders.find((x) => x.id === id);
  if (o) o.reviewed = true;
}

async function reviewAllInStock() {
  const id = reviewOrderId;
  // Markeert gecontroleerd én stuurt de klant een korte bedankt-app.
  await fetch(`/api/orders/${id}/confirm-instock`, { method: "POST" });
  const o = state.orders.find((x) => x.id === id);
  if (o) o.reviewed = true;
  closeReview();
  render();
  maybeShowReview();
}

async function reviewNotify() {
  const id = reviewOrderId;
  const res = await fetch(`/api/orders/${id}/notify-oos`, { method: "POST" });
  if (res.ok) {
    const u = await res.json();
    const o = state.orders.find((x) => x.id === id);
    if (o) o.notifiedAt = u.notifiedAt;
  } else {
    const err = await res.json().catch(() => ({}));
    alert(
      "Doorgeven niet gelukt: " +
        (err.error || res.status) +
        "\nDe bestelling is wel als gecontroleerd gemarkeerd."
    );
  }
  await markReviewedApi(id);
  closeReview();
  render();
  maybeShowReview();
}

// "Dit is geen bestelling" -> verwijderen vanuit de controle-popup.
async function reviewDelete() {
  const id = reviewOrderId;
  if (!confirm("Weet je zeker dat dit geen bestelling is? Dan wordt 'ie verwijderd.")) return;
  await fetch(`/api/orders/${id}/delete`, { method: "POST" });
  state.orders = state.orders.filter((o) => o.id !== id);
  closeReview();
  render();
  maybeShowReview();
}

/* ---------- render: agenda ---------- */
function render(animate = true) {
  renderHeaderLabel();
  const view = document.getElementById("agenda-view");

  const days = {};
  for (const o of state.orders) {
    const key = o.pickupDate || "";
    (days[key] = days[key] || []).push(o);
  }
  // Gedateerde dagen chronologisch; "Datum onbekend" ("") bovenaan zodat het opvalt.
  const sortedDates = Object.keys(days).sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b);
  });

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
        ${list.map((o) => cardHTML(o, cardIndex++, animate)).join("")}
      </div>
    </section>`;
  }
  view.innerHTML = html;
}

function cardHTML(o, index, animate = true, archived = false) {
  const label = o.label || state.activeLabel;
  const incompleet = o.items.some((it) => it.oos);
  const delay = animate
    ? `style="animation-delay:${Math.min(index * 55, 600)}ms"`
    : `style="animation:none"`;
  const items = o.items
    .map((it, idx) => {
      const cls = it.oos ? " oos" : it.added ? " added" : "";
      const tap = archived ? "" : ` data-oos-order="${o.id}" data-oos-index="${idx}"`;
      const tag = it.oos
        ? `<span class="oos-tag">uitverkocht</span>`
        : it.added
        ? `<span class="oos-tag added-tag">nieuw</span>`
        : "";
      return `<li class="item${cls}"${tap}><span class="qty">${it.qty}</span><span class="iname">${it.name}</span>${tag}</li>`;
    })
    .join("");
  let actions;
  let actionsCls = "card-actions";
  if (archived) {
    actions =
      `<button class="btn btn-restore" data-restore="${o.id}" type="button">Terugzetten</button>` +
      `<button class="btn btn-delete" data-delete="${o.id}" type="button">Verwijderen</button>`;
  } else if (incompleet) {
    actions =
      `<button class="btn btn-klaar" data-klaar="${o.id}" type="button">Klaar</button>` +
      `<button class="btn btn-notify" data-notify="${o.id}" type="button">${o.notifiedAt ? "Opnieuw doorgeven" : "Geef aan klant door"}</button>`;
  } else {
    actions = `<button class="btn btn-klaar" data-klaar="${o.id}" type="button">Klaar</button>`;
    actionsCls += " one";
  }
  return `<article class="card" data-status="${o.status}" data-id="${o.id}"${archived ? ' data-archived="1"' : ""} ${delay}>
    <div class="card-top">
      <span class="card-time">${o.pickupTime || "—"}</span>
      <button class="card-num" data-bon="${o.id}" type="button" title="Bon bekijken">#${o.id}</button>
    </div>
    <span class="status-inline status-${o.status}"><span class="dot"></span>${STATUS_LABEL[o.status]}</span>
    ${label ? `<div class="card-label">${label}</div>` : ""}
    ${o.unconfirmed ? `<div class="card-label card-unconfirmed">ONBEVESTIGD</div>` : ""}
    ${incompleet ? `<div class="card-label card-oos">NIET COMPLEET</div>` : ""}
    ${o.notifiedAt ? `<div class="card-label card-notified">DOORGEGEVEN</div>` : ""}
    <h3 class="card-name">${o.customerName}</h3>
    <div class="card-phone">${o.phone}</div>
    <ul class="items">
      ${items}
    </ul>
    ${archived ? "" : `<div class="oos-hint">tik een product aan dat niet op voorraad is</div>`}
    ${o.note ? `<div class="card-note">${o.note}</div>` : ""}
    ${o.customerReply ? `<div class="card-note card-reply">Klant reageerde: "${o.customerReply}"</div>` : ""}
    <div class="${actionsCls}">
      ${actions}
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
function weekdayDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return cap(
    new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(d)
  );
}

function showBon(id) {
  const o = state.orders.find((x) => x.id === id) || archive.find((x) => x.id === id);
  if (!o) return;
  const label = o.label || state.activeLabel;
  const datum = o.pickupDate ? weekdayDate(o.pickupDate) : "Datum onbekend";
  const bon = document.getElementById("bon");
  bon.innerHTML = `
    <div class="pb-shop">Klaas Kip · Westbeemster</div>
    ${label ? `<div class="pb-label">${label}</div>` : ""}
    <div class="pb-num">#${o.id}</div>
    <hr class="pb-line" />
    <div class="pb-section-label">Afhalen</div>
    <div class="pb-pickup"><span>${datum}</span>${o.pickupTime ? `<span class="pb-time">${o.pickupTime}</span>` : ""}</div>
    <hr class="pb-line" />
    <div class="pb-section-label">Klant</div>
    <div class="pb-name">${o.customerName}</div>
    ${o.phone ? `<div class="pb-phone">${o.phone}</div>` : ""}
    <hr class="pb-line" />
    <div class="pb-section-label">Bestelling</div>
    <div class="pb-items">
      ${o.items
        .map(
          (it) =>
            `<div class="pb-item${it.oos ? " pb-item-oos" : ""}"><span class="pb-qty">${it.qty}</span><span>${it.name}${it.oos ? " — niet leveren" : ""}</span></div>`
        )
        .join("")}
    </div>
    ${
      o.note
        ? `<hr class="pb-line" /><div class="pb-section-label">Opmerking</div><div class="pb-note">${o.note}</div>`
        : ""
    }
    <hr class="pb-line" />
    <div class="pb-foot">Binnengekomen ${fmtDateTime(o.receivedAt)}</div>
  `;
  document.getElementById("bon-overlay").hidden = false;
}

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  // tik op een product: aan/uit "niet op voorraad"
  const itemEl = e.target.closest("[data-oos-order]");
  if (itemEl) {
    e.stopPropagation();
    toggleOOS(Number(itemEl.dataset.oosOrder), Number(itemEl.dataset.oosIndex));
    return;
  }

  // Klaar -> archiveren
  const klaarBtn = e.target.closest("[data-klaar]");
  if (klaarBtn) {
    e.stopPropagation();
    markKlaar(Number(klaarBtn.dataset.klaar));
    return;
  }

  // Terugzetten uit archief
  const restoreBtn = e.target.closest("[data-restore]");
  if (restoreBtn) {
    e.stopPropagation();
    restoreOrder(Number(restoreBtn.dataset.restore));
    return;
  }

  // Verwijderen uit archief
  const deleteBtn = e.target.closest("[data-delete]");
  if (deleteBtn) {
    e.stopPropagation();
    deleteOrder(Number(deleteBtn.dataset.delete));
    return;
  }

  // Geef aan klant door
  const notifyBtn = e.target.closest("[data-notify]");
  if (notifyBtn) {
    e.stopPropagation();
    notifyOOS(Number(notifyBtn.dataset.notify));
    return;
  }

  // Controle-popup: Alles op voorraad / doorgeven
  const reviewBtn = e.target.closest("[data-review]");
  if (reviewBtn) {
    e.stopPropagation();
    if (reviewBtn.dataset.review === "notify") reviewNotify();
    else if (reviewBtn.dataset.review === "delete") reviewDelete();
    else reviewAllInStock();
    return;
  }

  const bonBtn = e.target.closest("[data-bon]");
  if (bonBtn) {
    e.stopPropagation();
    showBon(Number(bonBtn.dataset.bon));
    return;
  }

  // tik op de kaart zelf: open <-> in bewerking (niet in het archief)
  const card = e.target.closest(".card");
  if (card && !card.dataset.archived) {
    const id = Number(card.dataset.id);
    const o = state.orders.find((x) => x.id === id);
    if (o) setStatus(id, o.status === "open" ? "in_bewerking" : "open");
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

document.getElementById("open-archive").addEventListener("click", () => {
  document.getElementById("agenda-view").hidden = true;
  document.getElementById("label-view").hidden = true;
  document.getElementById("archive-view").hidden = false;
  loadArchive();
});
document.getElementById("close-archive").addEventListener("click", () => {
  document.getElementById("archive-view").hidden = true;
  document.getElementById("agenda-view").hidden = false;
  render();
});

const bonOverlay = document.getElementById("bon-overlay");
document.getElementById("close-bon").addEventListener("click", () => {
  bonOverlay.hidden = true;
});
document.getElementById("print-bon").addEventListener("click", () => window.print());
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
setInterval(refresh, 5000); // nieuwe bestellingen verschijnen vanzelf
