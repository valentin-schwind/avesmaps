// Review-Reiter „Regionen" — WikiSync fuer natuerliche Landschaften (Regionen).
// Schlanke, eigene Surface: matcht die Wiki-Regionen (Staging) gegen die Karten-Label-
// Regionen und zeigt v.a. „fehlt auf Karte". Der Crawl laeuft per Button im Hintergrund
// (start_run + crawl_step-Schleife), damit keine Konsole noetig ist. Read-only fuer die Karte.

const REGION_SYNC_API_URL = "/api/edit/wiki/regions.php";
let regionSyncData = null;
let regionSyncView = "missing"; // missing | matched | ambiguous
let regionSyncBusy = false;

function regionSyncElement(id) {
	return document.getElementById(id);
}

function regionSyncPost(body) {
	return fetch(REGION_SYNC_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}).then((response) => response.json());
}

function regionSyncGet(query) {
	return fetch(REGION_SYNC_API_URL + query, { credentials: "same-origin" }).then((response) => response.json());
}

function regionSyncEscapeText(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

function regionSyncEscapeAttr(value) {
	return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
}

async function loadRegionWikiSync() {
	const status = regionSyncElement("region-sync-status");
	const summary = regionSyncElement("region-sync-summary");
	if (status) {
		status.textContent = "Regionen werden abgeglichen ...";
	}
	try {
		const data = await regionSyncGet("?action=match&continent=Aventurien&limit=1500");
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Unerwartete Antwort");
		}
		regionSyncData = data;
		const s = data.summary || {};
		if (summary) {
			summary.textContent = `${s.missing || 0} fehlen · ${s.matched || 0} zugeordnet · ${s.ambiguous || 0} mehrdeutig`;
		}
		if (status) {
			status.textContent = `${s.considered || 0} Aventurien-Wiki-Regionen · ${s.map_labels || 0} Karten-Labels`;
		}
		renderRegionSyncList();
	} catch (error) {
		if (status) {
			status.textContent = "Fehler: " + (error.message || error);
		}
	}
}

function regionSyncCurrentRows() {
	if (!regionSyncData) {
		return [];
	}
	if (regionSyncView === "matched") {
		return regionSyncData.matched || [];
	}
	if (regionSyncView === "ambiguous") {
		return regionSyncData.ambiguous || [];
	}
	return regionSyncData.missing || [];
}

function renderRegionSyncList() {
	const list = regionSyncElement("region-sync-list");
	if (!list) {
		return;
	}
	const summary = regionSyncData && regionSyncData.summary ? regionSyncData.summary : {};
	const filterValue = (regionSyncElement("region-sync-filter")?.value || "").trim().toLowerCase();
	const rows = regionSyncCurrentRows().filter((row) => {
		if (filterValue === "") {
			return true;
		}
		return [row.name, row.art, row.region_parent, row.affiliation_staat]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(filterValue));
	});

	const viewTabs =
		'<div class="region-sync__viewtabs">' +
		`<button type="button" data-region-view="missing" class="region-sync__viewtab${regionSyncView === "missing" ? " is-active" : ""}">Fehlt (${summary.missing || 0})</button>` +
		`<button type="button" data-region-view="matched" class="region-sync__viewtab${regionSyncView === "matched" ? " is-active" : ""}">Zugeordnet (${summary.matched || 0})</button>` +
		`<button type="button" data-region-view="ambiguous" class="region-sync__viewtab${regionSyncView === "ambiguous" ? " is-active" : ""}">Mehrdeutig (${summary.ambiguous || 0})</button>` +
		"</div>";

	const items = rows
		.slice(0, 600)
		.map((row) => {
			const meta = [row.art, row.region_parent].filter(Boolean).map(regionSyncEscapeText).join(" · ");
			let mapInfo = "";
			if (row.label) {
				mapInfo = `<span class="region-sync__map">Karte: ${regionSyncEscapeText(row.label.name)}${row.label.subtype ? " (" + regionSyncEscapeText(row.label.subtype) + ")" : ""}</span>`;
			} else if (row.labels) {
				mapInfo = `<span class="region-sync__map">${row.labels.length} Karten-Kandidaten: ${row.labels.map((l) => regionSyncEscapeText(l.name)).join(", ")}</span>`;
			}
			const wiki = row.wiki_url ? `<a class="region-sync__link" href="${regionSyncEscapeAttr(row.wiki_url)}" target="_blank" rel="noopener">Wiki ↗</a>` : "";
			const image = row.has_image ? '<span class="region-sync__badge" title="Wiki hat ein Bild">🖼</span>' : "";
			return (
				'<div class="review-panel__item region-sync__item">' +
				`<div class="region-sync__name">${regionSyncEscapeText(row.name)} ${image}</div>` +
				`<div class="region-sync__meta">${meta}</div>` +
				(mapInfo ? `<div class="region-sync__meta">${mapInfo}</div>` : "") +
				`<div class="region-sync__links">${wiki}</div>` +
				"</div>"
			);
		})
		.join("");

	const countNote = rows.length > 600 ? `<p class="review-panel__status">${rows.length} Treffer — die ersten 600 werden angezeigt.</p>` : "";
	list.innerHTML = viewTabs + countNote + (items || '<p class="review-panel__status">Keine Einträge.</p>');
}

async function startRegionWikiCrawl() {
	if (regionSyncBusy) {
		return;
	}
	regionSyncBusy = true;
	const status = regionSyncElement("region-sync-status");
	const button = regionSyncElement("region-sync-crawl");
	if (button) {
		button.disabled = true;
	}
	try {
		if (status) {
			status.textContent = "Crawl startet ...";
		}
		const run = await regionSyncPost({ action: "start_run" });
		if (!run || !run.run_id) {
			throw new Error(run && run.error ? run.error : "Kein run_id");
		}
		let step = 0;
		let last;
		do {
			last = await regionSyncPost({ action: "crawl_step", run_id: run.run_id });
			const runStatus = last.status || {};
			step += 1;
			if (status) {
				status.textContent = `Crawl Schritt ${step}: ${runStatus.staging_rows || 0} Regionen erfasst, ${runStatus.pending || 0} offen ...`;
			}
			await new Promise((resolve) => setTimeout(resolve, 350));
		} while (last.status && !last.status.complete && step < 200);
		if (status) {
			status.textContent = "Crawl fertig — gleiche ab ...";
		}
		await loadRegionWikiSync();
	} catch (error) {
		if (status) {
			status.textContent = "Crawl-Fehler: " + (error.message || error);
		}
	} finally {
		regionSyncBusy = false;
		if (button) {
			button.disabled = false;
		}
	}
}

document.addEventListener("click", (event) => {
	const viewButton = event.target.closest ? event.target.closest("[data-region-view]") : null;
	if (viewButton) {
		regionSyncView = viewButton.dataset.regionView || "missing";
		renderRegionSyncList();
		return;
	}
	if (event.target.closest && event.target.closest("#region-sync-crawl")) {
		void startRegionWikiCrawl();
	}
});

document.addEventListener("input", (event) => {
	if (event.target && event.target.id === "region-sync-filter") {
		renderRegionSyncList();
	}
});

window.loadRegionWikiSync = loadRegionWikiSync;
