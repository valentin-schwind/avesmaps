(function wireStatusSubtabs() {
	const nav = document.querySelector(".status-subtabs");
	if (!nav) {
		return;
	}
	let dashboardLoaded = false;
	nav.addEventListener("click", (event) => {
		const button = event.target.closest("[data-status-subtab]");
		if (!button) {
			return;
		}
		const target = button.dataset.statusSubtab;
		nav.querySelectorAll("[data-status-subtab]").forEach((b) => b.classList.toggle("is-active", b === button));
		document.querySelectorAll("[data-status-subsection]").forEach((s) => s.classList.toggle("is-active", s.dataset.statusSubsection === target));
		if (target === "besucher" && !dashboardLoaded) {
			dashboardLoaded = true;
			void loadVisitorDashboard();
		}
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
	const views = (daily || []).map((d) => Number(d.views) || 0);
	const uniq = (daily || []).map((d) => Number(d.uniques) || 0);
	const n = Math.max(views.length, 1);
	const max = Math.max(1, Math.max.apply(null, views.concat([1])) * 1.05);
	const w = 360, h = 90, p = 6;
	const path = (arr) => arr.map((v, i) => {
		const x = p + i * ((w - 2 * p) / Math.max(n - 1, 1));
		const y = h - p - (v / max) * (h - 2 * p);
		return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
	}).join(" ");
	return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Aufrufe und eindeutige Besucher über Zeit"><path d="${path(views)}" fill="none" stroke="#2a78d6" stroke-width="2" stroke-linejoin="round"/><path d="${path(uniq)}" fill="none" stroke="#1baf7a" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function vaHeatmap(rows) {
	const grid = {};
	(rows || []).forEach((r) => { grid[(Number(r.dow) - 1) + "_" + Number(r.hour)] = Number(r.c) || 0; });
	const max = Math.max.apply(null, Object.values(grid).concat([1]));
	const days = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
	let html = '<div style="display:flex;flex-direction:column;gap:2px">';
	for (let d = 1; d < 7; d++) {
		html += `<div style="display:flex;gap:2px;align-items:center"><span style="width:18px;font-size:10px;color:#8a7355">${days[d]}</span><div style="display:flex;gap:2px;flex:1">`;
		for (let hh = 0; hh < 24; hh++) {
			const t = (grid[d + "_" + hh] || 0) / max;
			html += `<div title="${days[d]} ${hh} Uhr" style="flex:1;height:13px;border-radius:2px;background:rgba(42,120,214,${(0.06 + t * 0.9).toFixed(2)})"></div>`;
		}
		html += "</div></div>";
	}
	html += `<div style="display:flex;gap:2px;align-items:center"><span style="width:18px;font-size:10px;color:#8a7355">${days[0]}</span><div style="display:flex;gap:2px;flex:1">`;
	for (let hh = 0; hh < 24; hh++) {
		const t = (grid["0_" + hh] || 0) / max;
		html += `<div style="flex:1;height:13px;border-radius:2px;background:rgba(42,120,214,${(0.06 + t * 0.9).toFixed(2)})"></div>`;
	}
	return html + "</div></div>";
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

function renderVisitorDashboard(mount, data) {
	const m = data.metrics || {};
	const sum = (arr, key) => (arr || []).reduce((a, r) => a + (Number(r[key]) || 0), 0);
	const views = sum(m.daily, "views");
	const uniq = sum(m.daily, "uniques");
	const routes = sum(m.daily, "routes");
	const stoRows = (data.storage && data.storage.tables) || [];
	const stoBytes = stoRows.reduce((a, t) => a + (Number(t.bytes) || 0), 0);
	const stoRowsN = stoRows.reduce((a, t) => a + (Number(t.rows) || 0), 0);

	mount.innerHTML =
		`<div class="va-pills">${[7, 30, 365, 3660].map((d) => `<span class="va-pill${d === visitorDashboardDays ? " is-active" : ""}" data-va-days="${d}">${d === 7 ? "7 T" : d === 30 ? "30 T" : d === 365 ? "12 M" : "Alles"}</span>`).join("")}</div>`
		+ `<div class="va-kpis">`
		+ `<div class="va-kpi"><div class="va-kpi__label">Aufrufe</div><div class="va-kpi__value">${views.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Eindeutige</div><div class="va-kpi__value">${uniq.toLocaleString("de-DE")}</div></div>`
		+ `<div class="va-kpi"><div class="va-kpi__label">Routen</div><div class="va-kpi__value">${routes.toLocaleString("de-DE")}</div></div>`
		+ `</div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivität über Zeit</div>${vaLine(m.daily)}</div>`
		+ `<div class="va-card"><div class="va-card__label">Aktivste Zeiten</div>${vaHeatmap(m.heatmap)}</div>`
		+ `<div class="va-card"><div class="va-card__label">Top-Suchbegriffe</div>${vaBars(m.search, "#2a78d6")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Herkunft</div>${vaBars(m.referrer, "#4a3aa7")}</div>`
		+ `<div class="va-two"><div class="va-card"><div class="va-card__label">Geräte</div>${vaDonut(m.device, ["#2a78d6", "#1baf7a", "#eda100"])}</div>`
		+ `<div class="va-card"><div class="va-card__label">Kartenansicht</div>${vaDonut(m.map_mode, ["#2a78d6", "#4a3aa7", "#eda100", "#888780"])}</div></div>`
		+ `<div class="va-card"><div class="va-card__label">Beliebteste Routen</div>${vaBars(m.route, "#1baf7a")}</div>`
		+ `<div class="va-card"><div class="va-card__label">Speicher</div><div class="va-storage">Analytics-Tabellen: ${vaBytes(stoBytes)} · ${stoRowsN.toLocaleString("de-DE")} Zeilen<br>Datenbank gesamt: ${vaBytes(data.storage && data.storage.database_bytes)}</div></div>`;

	mount.querySelectorAll("[data-va-days]").forEach((pill) => {
		pill.addEventListener("click", () => { visitorDashboardDays = Number(pill.dataset.vaDays); void loadVisitorDashboard(); });
	});
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
