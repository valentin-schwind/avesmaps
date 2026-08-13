let statusDashboardLoaded = false;

function activateStatusSubtab(name) {
	const target = name === "besucher" ? "besucher" : "editoren";
	const nav = document.querySelector(".status-subtabs");
	if (!nav) {
		return;
	}
	nav.querySelectorAll("[data-status-subtab]").forEach((b) => b.classList.toggle("is-active", b.dataset.statusSubtab === target));
	document.querySelectorAll("[data-status-subsection]").forEach((s) => s.classList.toggle("is-active", s.dataset.statusSubsection === target));
	if (target === "besucher" && !statusDashboardLoaded) {
		statusDashboardLoaded = true;
		void loadVisitorDashboard();
	}
}

// The visitor dashboard loads lazily, on the first click of its sub-tab. Since "Besucher"
// is the markup default that click may never come, so the panel asks once when the Status
// tab is opened -- not on page load, which would drag the heavy metrics read into every
// edit-mode start.
function ensureStatusSubtabLoaded() {
	const activeButton = document.querySelector(".status-subtabs [data-status-subtab].is-active");
	activateStatusSubtab(activeButton ? activeButton.dataset.statusSubtab : "besucher");
}

(function wireStatusSubtabs() {
	const nav = document.querySelector(".status-subtabs");
	if (!nav) {
		return;
	}
	nav.addEventListener("click", (event) => {
		const button = event.target.closest("[data-status-subtab]");
		if (!button) {
			return;
		}
		// Display only. Remembering the tab across a refresh is the cascade table's job now
		// (REVIEW_TAB_FAMILIES in js/ui/ui-controls.js), which covers all six tab families at once. It used
		// to be persisted AND restored here too, on the very same storage key -- one key, two writers.
		activateStatusSubtab(button.dataset.statusSubtab === "besucher" ? "besucher" : "editoren");
	});
})();

let visitorDashboardDays = 30;

async function loadVisitorDashboard() {
	const mount = document.getElementById("visitor-dashboard");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	mount.innerHTML = '<div class="va-off">Wird geladen ...</div>';
	let data;
	try {
		const response = await fetch(`${VISITOR_METRICS_API_URL}?actor=visitor&days=${visitorDashboardDays}&_=${Date.now()}`, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		data = await response.json();
	} catch (error) {
		mount.innerHTML = '<div class="va-off">Konnte die Statistik nicht laden.</div>';
		return;
	}
	if (!data || data.ok !== true) {
		mount.innerHTML = '<div class="va-off">Konnte die Statistik nicht laden.</div>';
		return;
	}
	if (data.enabled === false) {
		mount.innerHTML = '<div class="va-off">Besucher-Statistik ist ausgeschaltet.</div>';
		return;
	}
	renderVisitorDashboard(mount, data);
}

function vaEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function vaBytes(n) {
	const v = Number(n) || 0;
	if (v < 1024) { return v + " B"; }
	if (v < 1048576) { return (v / 1024).toFixed(1) + " KB"; }
	return (v / 1048576).toFixed(1) + " MB";
}

function vaBars(rows, col) {
	const items = (rows || []).map((r) => ({ name: r.dimension, val: Number(r.c) || 0 }));
	if (items.length === 0) { return '<div class="va-storage">noch keine Daten</div>'; }
	const max = Math.max.apply(null, items.map((i) => i.val));
	return items.map((i) =>
		`<div class="va-row"><span class="va-row__name">${vaEscape(i.name)}</span><span class="va-row__track"><span class="va-row__fill" style="width:${Math.round(i.val / max * 100)}%;background:${col}"></span></span><span class="va-row__val">${i.val}</span></div>`
	).join("");
}

function vaLine(daily) {
	const data = daily || [];
	const views = data.map((d) => Number(d.views) || 0);
	const uniq = data.map((d) => Number(d.uniques) || 0);
	const n = Math.max(data.length, 1);
	const max = Math.max(1, Math.max.apply(null, views.concat(uniq).concat([1])));
	const w = 360, h = 116, padL = 30, padR = 8, padT = 10, padB = 26;
	const plotW = w - padL - padR, plotH = h - padT - padB;
	const xAt = (i) => padL + (n <= 1 ? plotW / 2 : i * plotW / (n - 1));
	const yAt = (v) => padT + plotH - (v / max) * plotH;
	const line = (arr) => arr.map((v, i) => (i ? "L" : "M") + xAt(i).toFixed(1) + " " + yAt(v).toFixed(1)).join(" ");
	const dots = (arr, color) => arr.map((v, i) => `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2.6" fill="${color}"/>`).join("");
	const fmtDate = (s) => { const p = String(s).split("-"); return p.length === 3 ? p[2] + "." + p[1] + "." : String(s); };
	const fmtFullDate = (s) => { const p = String(s).split("-"); return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : String(s); };
	const axes = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#e7d8c6" stroke-width="1"/><line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="#e7d8c6" stroke-width="1"/>`;
	const yLabels = `<text x="${padL - 4}" y="${(padT + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7355">${max.toLocaleString("de-DE")}</text><text x="${padL - 4}" y="${(padT + plotH).toFixed(1)}" text-anchor="end" font-size="10" fill="#8a7355">0</text>`;
	let xLabels = "";
	if (data.length) {
		const idxs = data.length <= 5 ? data.map((d, i) => i) : [0, Math.floor((data.length - 1) / 2), data.length - 1];
		xLabels = idxs.map((i) => `<text x="${xAt(i).toFixed(1)}" y="${(h - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#8a7355">${fmtDate(data[i].day)}</text>`).join("");
	}
	// Die Zahlen zum einzelnen Tag stehen im <title> eines unsichtbaren Feldes ueber die volle
	// Diagrammhoehe. Drei Kleinigkeiten daran sind tragend:
	// 💣 Die Punkte selbst taugen nicht als Mausziel (r=2.6) -- das Feld ist eine Spaltenbreite breit.
	// 💣 fill="transparent", NICHT fill="none": nur eine Fuellung faengt Zeigerereignisse, "none"
	//    laesst sie durch und der Tooltip erschiene nie.
	// 💣 Die Felder stehen als Letztes im Markup -- SVG kennt kein z-index, es gewinnt die
	//    Dokumentreihenfolge, sonst liegen sie unter den Kurven.
	const slot = n <= 1 ? plotW : plotW / (n - 1);
	const hovers = data.map((d, i) => {
		const x0 = Math.max(padL, xAt(i) - slot / 2);
		const x1 = Math.min(w - padR, xAt(i) + slot / 2);
		const label = fmtFullDate(d.day)
			+ " — Aufrufe: " + (Number(d.views) || 0).toLocaleString("de-DE")
			+ " · Eindeutige: " + (Number(d.uniques) || 0).toLocaleString("de-DE");
		return `<rect x="${x0.toFixed(1)}" y="${padT}" width="${Math.max(0, x1 - x0).toFixed(1)}" height="${plotH}" fill="transparent"><title>${vaEscape(label)}</title></rect>`;
	}).join("");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Aufrufe und eindeutige Besucher über Zeit">${axes}${yLabels}${xLabels}<path d="${line(views)}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/><path d="${line(uniq)}" fill="none" stroke="#1baf7a" stroke-width="2" stroke-linejoin="round"/>${dots(views, "#2a78d6")}${dots(uniq, "#1baf7a")}${hovers}</svg>`;
}

const VA_HEAT_DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
// Montag oben, Sonntag unten -- die Woche, wie ein Kalender sie zeigt.
const VA_HEAT_ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
// Jede dritte Stunde. Bei 400 px Panelbreite bleiben ~11,8 px je Spalte; 24 Zahlen passen nicht.
const VA_HEAT_HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

// 💣 Die Stunde steht als UTC in der Datenbank -- api/app/track.php schreibt `(int) gmdate('G')`.
// Eine beschriftete Achse waere damit im deutschen Sommer durchgehend ZWEI Stunden falsch, also
// wird auf die Zeitzone des Browsers umgerechnet.
// ⚠️ Der Versatz von heute gilt fuer den ganzen Zeitraum. Ueber die Sommerzeitgrenze hinweg liegt
// die Achse damit um eine Stunde daneben -- harmloser als die zwei Stunden, die sie sonst dauerhaft
// danebenlaege.
function vaLocalHourShift(now) {
	// getTimezoneOffset() zaehlt Minuten HINTER UTC (Berlin im Sommer: -120), daher das Vorzeichen.
	// Gerundet, weil die Eimer ganze Stunden sind -- Zonen mit halber Stunde (IST) rutschen auf die
	// naechste, was bei einer Heatmap dieser Aufloesung nichts austraegt.
	return Math.round(-(now || new Date()).getTimezoneOffset() / 60);
}

// 💣 Der Versatz nimmt den WOCHENTAG mit: UTC Montag 23 Uhr ist Dienstag 1 Uhr. Ohne den Uebertrag
// waere die Stunde richtig und die Zeile falsch.
function vaHeatmapGrid(rows, shift) {
	const grid = {};
	(rows || []).forEach((r) => {
		const utcDay = (((Number(r.dow) - 1) % 7) + 7) % 7; // MySQL DAYOFWEEK: 1 = Sonntag
		const local = (Number(r.hour) || 0) + Number(shift || 0);
		const hour = ((local % 24) + 24) % 24;
		const day = (((utcDay + Math.floor(local / 24)) % 7) + 7) % 7;
		const key = day + "_" + hour;
		grid[key] = (grid[key] || 0) + (Number(r.c) || 0);
	});
	return grid;
}

function vaHeatmap(rows) {
	const grid = vaHeatmapGrid(rows, vaLocalHourShift());
	const max = Math.max.apply(null, Object.values(grid).concat([1]));
	let hours = "";
	for (let hh = 0; hh < 24; hh++) {
		hours += `<span class="va-heat__hour">${VA_HEAT_HOUR_TICKS.indexOf(hh) === -1 ? "" : hh}</span>`;
	}
	const head = `<div class="va-heat__row va-heat__hours"><span class="va-heat__day"></span><div class="va-heat__cells">${hours}</div></div>`;
	const body = VA_HEAT_ROW_ORDER.map((d) => {
		let cells = "";
		for (let hh = 0; hh < 24; hh++) {
			const count = grid[d + "_" + hh] || 0;
			const tone = (0.06 + (count / max) * 0.9).toFixed(2);
			// Auch die Sonntagszeile traegt ihr title -- sie war als einzige ohne gebaut.
			cells += `<span class="va-heat__cell" title="${VA_HEAT_DAYS[d]} ${hh}–${hh + 1} Uhr: ${count}" style="background:rgba(42,120,214,${tone})"></span>`;
		}
		return `<div class="va-heat__row"><span class="va-heat__day">${VA_HEAT_DAYS[d]}</span><div class="va-heat__cells">${cells}</div></div>`;
	}).join("");
	return `<div class="va-heat">${head}${body}</div>`;
}

function vaDonut(rows, cols) {
	const items = (rows || []).map((r) => ({ name: r.dimension, val: Number(r.c) || 0 }));
	const tot = items.reduce((a, i) => a + i.val, 0) || 1;
	const r = 26, c = 2 * Math.PI * r;
	let off = 0, seg = "";
	items.forEach((it, i) => {
		const frac = it.val / tot;
		seg += `<circle cx="34" cy="34" r="${r}" fill="none" stroke="${cols[i % cols.length]}" stroke-width="13" stroke-dasharray="${(frac * c).toFixed(1)} ${c.toFixed(1)}" stroke-dashoffset="${(-off * c).toFixed(1)}" transform="rotate(-90 34 34)"/>`;
		off += frac;
	});
	const leg = items.map((it, i) =>
		`<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:#8a7355;margin:2px 0"><span style="width:8px;height:8px;border-radius:2px;background:${cols[i % cols.length]}"></span>${vaEscape(it.name)} ${Math.round(it.val / tot * 100)}%</div>`
	).join("");
	return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><svg viewBox="0 0 68 68" width="78" height="78" role="img" aria-label="Verteilung"></svg>`.replace("></svg>", ">" + seg + "</svg>") + `<div style="align-self:flex-start">${leg}</div></div>`;
}

function vaRelTime(at) {
	if (!at) { return ""; }
	const t = new Date(String(at).replace(" ", "T"));
	if (isNaN(t.getTime())) { return String(at); }
	const diff = Math.max(0, (Date.now() - t.getTime()) / 1000);
	if (diff < 60) { return "gerade"; }
	if (diff < 3600) { return Math.round(diff / 60) + " Min"; }
	if (diff < 86400) { return Math.round(diff / 3600) + " Std"; }
	if (diff < 2592000) { return Math.round(diff / 86400) + " T"; }
	return t.toLocaleDateString("de-DE");
}

function vaFeed(items) {
	const list = items || [];
	if (list.length === 0) { return '<div class="va-storage">noch keine Daten</div>'; }
	return list.map((it) =>
		`<div class="va-feed"><span class="va-feed__tag">${vaEscape(it.type)}</span><span class="va-feed__label">${vaEscape(it.label || "—")}</span><span class="va-feed__meta">${vaEscape(it.detail)} · ${vaEscape(vaRelTime(it.at))}</span></div>`
	).join("");
}

const VA_TOGGLE_LABELS = {
	metropole: "Metropolen", grossstadt: "Großstädte", stadt: "Städte", kleinstadt: "Kleinstädte", dorf: "Dörfer", gebaeude: "Bauwerke",
	togglePaths: "Wege", toggleRivers: "Flüsse", toggleSeaPaths: "Seewege", toggleCrossings: "Kreuzungen", toggleNodix: "Nodices"
};

// 💣 Die sechs Ansichten stehen NUR in den <option> von #mapLayerModeSelect -- das <select> ist der
// Zustand, die Ansichts-Kachel liest es ebenfalls dort (AGENTS.md §11). Hier stand bis 2026-08-13
// eine zweite Tabelle, und sie ist genau so auseinandergelaufen, wie die Regel es verhindern soll:
// sie kannte vier der sechs, also erschienen „original" und „ecosystem" mit ihrem internen
// Schluessel in der Statistik. Das Dashboard laeuft im selben Dokument wie das <select>.
function vaMapModeLabels() {
	const labels = {};
	document.querySelectorAll("#mapLayerModeSelect option").forEach((option) => {
		const value = String(option.value || "");
		const text = String(option.textContent || "").trim();
		if (value !== "" && text !== "") {
			labels[value] = text;
		}
	});
	return labels;
}

// ⚠️ Ein zurueckgezogener Modus hat keine <option> mehr und faellt auf seinen Schluessel zurueck.
// Das ist gewollt: ein roher Schluessel ist ehrlicher als eine geratene Beschriftung.
function vaPrettyMapMode(slug, labels) {
	const key = String(slug === null || slug === undefined ? "" : slug);
	return (labels || vaMapModeLabels())[key] || key;
}

function vaPrettyToggle(dimension) {
	const parts = String(dimension || "").split(":");
	const label = VA_TOGGLE_LABELS[parts[0]] || parts[0] || "";
	if (parts[1] === "on") { return label + ": an"; }
	if (parts[1] === "off") { return label + ": aus"; }
	return label;
}

function vaMapDimensions(rows, mapper) {
	return (rows || []).map((r) => ({ dimension: mapper(r.dimension), c: r.c }));
}

const VA_COUNTRY_LABELS = { AT: "Österreich", CH: "Schweiz", NL: "Niederlande", FR: "Frankreich", GB: "Großbritannien", US: "USA", IT: "Italien", ES: "Spanien", BE: "Belgien", PL: "Polen", CZ: "Tschechien", DK: "Dänemark", SE: "Schweden", NO: "Norwegen", FI: "Finnland", LU: "Luxemburg", LI: "Liechtenstein", PT: "Portugal", IE: "Irland", GR: "Griechenland", HU: "Ungarn", RO: "Rumänien", RU: "Russland", UA: "Ukraine", TR: "Türkei", CA: "Kanada", AU: "Australien", JP: "Japan", CN: "China", IN: "Indien", BR: "Brasilien", SK: "Slowakei", SI: "Slowenien", HR: "Kroatien", BG: "Bulgarien", RS: "Serbien", EE: "Estland", LV: "Lettland", LT: "Litauen" };

function loadDeGeometry() {
	return new Promise((resolve) => {
		if (window.AVESMAPS_DE_BUNDESLAENDER) {
			resolve(window.AVESMAPS_DE_BUNDESLAENDER);
			return;
		}
		const script = document.createElement("script");
		script.src = "js/map-features/de-bundeslaender-geo.js";
		script.onload = () => resolve(window.AVESMAPS_DE_BUNDESLAENDER || null);
		script.onerror = () => resolve(null);
		document.head.appendChild(script);
	});
}

async function renderGeoMap(mount, regions) {
	const geo = await loadDeGeometry();
	if (!geo || !Array.isArray(geo.states)) {
		mount.innerHTML = '<div class="va-storage">Karte nicht verfügbar.</div>';
		return;
	}
	const byName = {};
	(regions || []).forEach((r) => { byName[r.dimension] = Number(r.c) || 0; });
	const max = Math.max.apply(null, geo.states.map((s) => byName[s.name] || 0).concat([1]));
	const paths = geo.states.map((s) => {
		const v = byName[s.name] || 0;
		const fill = v > 0 ? `rgba(42,120,214,${(0.12 + (v / max) * 0.8).toFixed(2)})` : "#efe6d9";
		return `<path d="${s.d}" fill="${fill}" stroke="#cdb79f" stroke-width="0.6"><title>${vaEscape(s.name)}: ${v}</title></path>`;
	}).join("");
	const labels = geo.states.map((s) => {
		const v = byName[s.name] || 0;
		if (v <= 0) { return ""; }
		const dark = v / max > 0.55;
		return `<text x="${s.cx}" y="${s.cy}" text-anchor="middle" dy="0.32em" font-size="9" font-weight="700" fill="${dark ? "#ffffff" : "#2f251c"}" style="paint-order:stroke;stroke:${dark ? "#1b4f86" : "#fffaf5"};stroke-width:2.5px;pointer-events:none">${v}</text>`;
	}).join("");
	mount.innerHTML = `<svg viewBox="${geo.viewBox}" width="100%" style="max-width:280px;display:block;margin:0 auto" role="img" aria-label="Klicks nach Bundesland">${paths}${labels}</svg>`;
}

function renderGeoCountries(mount, countries) {
	const list = countries || [];
	if (list.length === 0) {
		mount.innerHTML = '<div class="va-storage">noch keine Daten</div>';
		return;
	}
	const max = Math.max.apply(null, list.map((c) => Math.max(Number(c.visitors) || 0, Number(c.bots) || 0)).concat([1]));
	mount.innerHTML = list.map((c) => {
		const name = VA_COUNTRY_LABELS[c.dimension] || c.dimension;
		const vis = Number(c.visitors) || 0;
		const bot = Number(c.bots) || 0;
		const vw = Math.round(vis / max * 100);
		const bw = Math.round(bot / max * 100);
		return `<div class="va-geo-row"><div class="va-geo-name">${vaEscape(name)}</div><div class="va-geo-bars"><div class="va-geo-bar"><span class="va-geo-track"><span class="va-geo-fill" style="width:${vw}%;background:#1baf7a"></span></span><span class="va-geo-val">${vis}</span></div><div class="va-geo-bar"><span class="va-geo-track"><span class="va-geo-fill" style="width:${bw}%;background:#888780"></span></span><span class="va-geo-val">${bot}</span></div></div></div>`;
	}).join("");
}

function renderVisitorDashboard(mount, data) {
	const m = data.metrics || {};
	const sum = (arr, key) => (arr || []).reduce((a, r) => a + (Number(r[key]) || 0), 0);
	const views = sum(m.daily, "views");
	const uniq = sum(m.daily, "uniques");
	const routes = sum(m.daily, "routes");
	const stoRows = (data.storage && data.storage.tables) || [];
	const stoBytes = stoRows.reduce((a, t) => a + (Number(t.bytes) || 0), 0);
	const stoRowsN = stoRows.reduce((a, t) => a + (Number(t.rows) || 0), 0);

	const pillsMount = document.getElementById("visitor-pills");
	if (pillsMount) {
		pillsMount.innerHTML = `<div class="va-pills">${[7, 30, 365, 3660].map((d) => `<span class="va-pill${d === visitorDashboardDays ? " is-active" : ""}" data-va-days="${d}">${d === 7 ? "7 T" : d === 30 ? "30 T" : d === 365 ? "12 M" : "Alles"}</span>`).join("")}</div>`;
		pillsMount.querySelectorAll("[data-va-days]").forEach((pill) => {
			pill.addEventListener("click", () => { visitorDashboardDays = Number(pill.dataset.vaDays); void loadVisitorDashboard(); });
		});
	}

	mount.innerHTML =
		`<div class="va-kpis">`
		+ `<div class="va-kpi"><div class="va-kpi__label">Aufrufe</div><div class="va-kpi__value">${views.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Eindeutige</div><div class="va-kpi__value">${uniq.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Routen</div><div class="va-kpi__value">${routes.toLocaleString("de-DE")}</div></div>`
		+ `</div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivität über Zeit</div>${vaLine(m.daily)}<div class="va-chartlegend"><span><i style="background:#2a78d6"></i>Aufrufe</span><span><i style="background:#1baf7a"></i>Eindeutige</span></div></div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivste Zeiten (Ortszeit)</div>${vaHeatmap(m.heatmap)}</div>`
		+ `<div class="va-card"><div class="va-card__label">Top-Suchbegriffe</div>${vaBars(m.search, "#2a78d6")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Herkunft</div><div id="visitor-geo-map"></div><div class="va-geo-legend"><span>wenige</span><span class="va-geo-scale"><i style="background:rgba(42,120,214,0.12)"></i><i style="background:rgba(42,120,214,0.38)"></i><i style="background:rgba(42,120,214,0.64)"></i><i style="background:rgba(42,120,214,0.9)"></i></span><span>viele Klicks</span></div><div class="va-geo-clabel">Andere Länder<span class="va-geo-key"><i style="background:#1baf7a"></i>echte<i style="background:#888780"></i>Bots</span></div><div id="visitor-geo-countries"></div></div>`
		+ `<div class="va-card"><div class="va-card__label">Referrer</div>${vaBars(m.referrer, "#4a3aa7")}</div>`
		+ `<div class="va-two"><div class="va-card"><div class="va-card__label">Geräte</div>${vaDonut(m.device, ["#2a78d6", "#1baf7a", "#eda100"])}</div>`
		+ `<div class="va-card"><div class="va-card__label">Kartenansicht</div>${vaDonut(vaMapDimensions(m.map_mode, vaPrettyMapMode), ["#2a78d6", "#4a3aa7", "#eda100", "#888780"])}</div></div>`
		+ `<div class="va-card"><div class="va-card__label">Beliebteste Routen</div>${vaBars(m.route, "#1baf7a")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Beliebte Orte</div>${vaBars(m.route_waypoint, "#1baf7a")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Letzte Aktivität</div>${vaFeed(data.activity)}</div>`
		+ `<details class="va-more"><summary>Weitere Kennzahlen</summary>`
		+ `<div class="va-card"><div class="va-card__label">Transportmittel</div>${vaBars(m.transport, "#2a78d6")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Routenoptionen</div>${vaBars(m.route_option, "#4a3aa7")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Sprache</div>${vaBars(m.language, "#1baf7a")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Anzeige-Optionen</div>${vaBars(vaMapDimensions(m.display_toggle, vaPrettyToggle), "#eda100")}</div>`
		+ `</details>`
		+ `<div class="va-card"><div class="va-card__label">Speicher</div><div class="va-storage">Analytics-Tabellen: ${vaBytes(stoBytes)} · ${stoRowsN.toLocaleString("de-DE")} Zeilen<br>Datenbank gesamt: ${vaBytes(data.storage && data.storage.database_bytes)}</div></div>`;

	const geo = data.geo || {};
	const geoMap = document.getElementById("visitor-geo-map");
	if (geoMap) {
		void renderGeoMap(geoMap, geo.regions);
	}
	const geoCountries = document.getElementById("visitor-geo-countries");
	if (geoCountries) {
		renderGeoCountries(geoCountries, geo.countries);
	}
}

// Live presence line above the time-range pills: "who is here right now", as opposed
// to the day-aggregated dashboard below it. Fed by the editor-presence poll in
// review-panels.js, which runs every 30s anyway -- this line costs no extra request.
function renderVisitorLiveStrip(visitors, editorsOnline) {
	const mount = document.getElementById("visitor-live");
	if (!mount) {
		return;
	}
	// A missing block means analytics is switched off or nobody has ever pinged.
	// Staying hidden is honest -- claiming "0 Besucher" would not be.
	if (!visitors) {
		mount.hidden = true;
		return;
	}

	const guests = Number(visitors.total) || 0;
	const editors = Number(editorsOnline) || 0;
	const split = [
		[Number(visitors.active) || 0, "aktiv"],
		[Number(visitors.reading) || 0, "liest"],
		[Number(visitors.hidden) || 0, "im Hintergrund"],
	].filter((entry) => entry[0] > 0).map((entry) => entry[0] + " " + entry[1]);
	const windowMinutes = ((Number(visitors.window_seconds) || 150) / 60).toLocaleString("de-DE", { maximumFractionDigits: 1 });

	mount.hidden = false;
	mount.classList.toggle("va-live--quiet", guests + editors === 0);
	mount.innerHTML =
		`<div class="va-live__head" title="Anwesend in den letzten ${windowMinutes} Minuten">`
		+ `<span class="va-live__dot" aria-hidden="true"></span>`
		+ `<span class="va-live__title">Gerade jetzt</span>`
		+ `<span class="va-live__counts"><b>${guests}</b> Besucher · <b>${editors}</b> ${editors === 1 ? "Editor" : "Editoren"}</span>`
		+ `</div>`
		+ (split.length > 0 ? `<div class="va-live__split">${split.join(" · ")}</div>` : "");
}

async function loadEditorActivityFigures() {
	const mount = document.getElementById("editor-activity-figures");
	if (!mount || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE || window.AVESMAPS_VISITOR_ANALYTICS_ENABLED === false) {
		return;
	}
	try {
		const response = await fetch(`${VISITOR_METRICS_API_URL}?actor=editor&days=7&_=${Date.now()}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
		const data = await response.json();
		if (!data || data.ok !== true || data.enabled === false) {
			return;
		}
		const edits = (data.metrics.daily || []).reduce((a, r) => a + (Number(r.views) || 0), 0);
		mount.innerHTML = `<div class="va-card" style="margin-top:10px"><div class="va-card__label">Editoren-Aktivität (7 T)</div><div class="va-storage">Editor-Aufrufe: ${edits.toLocaleString("de-DE")}</div></div>`;
	} catch (error) {
		/* best-effort */
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => loadEditorActivityFigures(), { once: true });
} else {
	loadEditorActivityFigures();
}
