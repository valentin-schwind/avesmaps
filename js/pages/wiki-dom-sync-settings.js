const API_URL = "/api/edit/wiki/dom-sync.php";
const WIKI_SYNC_URL = "/api/edit/wiki/territories.php";

let pollTimer = null;
let pollStartedAt = 0;
let startCount = 0;
let latestRowsPayload = null;

const els = {
	seeds: document.getElementById("seeds"),
	catchwords: document.getElementById("catchwords"),
	maxDepth: document.getElementById("maxDepth"),
	maxIterations: document.getElementById("maxIterations"),
	maxPages: document.getElementById("maxPages"),
	maxRuntime: document.getElementById("maxRuntime"),
	sleepMs: document.getElementById("sleepMs"),
	timeout: document.getElementById("timeout"),
	status: document.getElementById("status"),
	runInfo: document.getElementById("runInfo"),
	rows: document.getElementById("rows"),
	debug: document.getElementById("debug"),
	count: document.getElementById("count"),
	iterations: document.getElementById("iterations"),
	pages: document.getElementById("pages"),
	childLinks: document.getElementById("childLinks"),
	runBtn: document.getElementById("runBtn"),
	reloadBtn: document.getElementById("reloadBtn"),
	defaultsBtn: document.getElementById("defaultsBtn"),
	clearBtn: document.getElementById("clearBtn"),
	clearWikiBtn: document.getElementById("clearWikiBtn"),
	dryRunBtn: document.getElementById("dryRunBtn"),
	promoteBtn: document.getElementById("promoteBtn"),
	selectAllRows: document.getElementById("selectAllRows"),
	deleteSelectedBtn: document.getElementById("deleteSelectedBtn"),
	clearSelectionBtn: document.getElementById("clearSelectionBtn"),
	selectedCount: document.getElementById("selectedCount"),
	visibleCount: document.getElementById("visibleCount"),
	nameSearch: document.getElementById("nameSearch"),
	clearNameSearchBtn: document.getElementById("clearNameSearchBtn"),
};

function setBusy(isBusy) {
	for (const button of Object.values(els).filter((item) => item instanceof HTMLButtonElement)) {
		button.disabled = isBusy;
	}
	if (!isBusy) {
		updateSelectionState();
	}
}

function setStatus(message) {
	els.status.textContent = message;
}

function readPayload() {
	let catchwords = null;
	const rawCatchwords = els.catchwords.value.trim();
	if (rawCatchwords !== "") {
		catchwords = JSON.parse(rawCatchwords);
	}

	return {
		seeds: els.seeds.value.split(/\n+/).map((line) => line.trim()).filter(Boolean),
		max_depth: Number(els.maxDepth.value),
		max_iterations: Number(els.maxIterations.value),
		max_pages: Number(els.maxPages.value),
		max_runtime_seconds: Number(els.maxRuntime.value),
		sleep_ms: Number(els.sleepMs.value),
		request_timeout_seconds: Number(els.timeout.value),
		catchwords,
	};
}

async function fetchJson(url, options = {}) {
	const response = await fetch(url, options);
	const text = await response.text();
	let payload;
	try {
		payload = JSON.parse(text);
	} catch (error) {
		throw new Error(text.slice(0, 700) || response.statusText);
	}
	if (!response.ok || payload.ok === false) {
		throw new Error(payload.error || response.statusText);
	}
	return payload;
}

function startPolling() {
	stopPolling();
	pollStartedAt = Date.now();
	startCount = Number(els.count.textContent) || 0;
	pollTimer = window.setInterval(refreshLiveRows, 1200);
	refreshLiveRows();
}

function stopPolling() {
	if (pollTimer !== null) {
		window.clearInterval(pollTimer);
		pollTimer = null;
	}
}

async function refreshLiveRows() {
	try {
		render(await fetchJson(`${API_URL}?action=list&_=${Date.now()}`), true);
	} catch (error) {
		els.runInfo.textContent = `Live-Aktualisierung fehlgeschlagen: ${error.message}`;
	}
}

async function loadDefaults() {
	setBusy(true);
	try {
		setStatus("Lade Vorgaben ...");
		const payload = await fetchJson(`${API_URL}?action=defaults`);
		const defaults = payload.defaults || {};
		els.catchwords.value = JSON.stringify(payload.catchwords, null, "\t");
		if (Array.isArray(payload.seeds)) els.seeds.value = payload.seeds.join("\n");
		if (defaults.max_iterations !== undefined) els.maxIterations.value = defaults.max_iterations;
		if (defaults.max_pages !== undefined) els.maxPages.value = defaults.max_pages;
		if (defaults.max_runtime_seconds !== undefined) els.maxRuntime.value = defaults.max_runtime_seconds;
		if (defaults.sleep_ms !== undefined) els.sleepMs.value = defaults.sleep_ms;
		if (defaults.request_timeout_seconds !== undefined) els.timeout.value = defaults.request_timeout_seconds;
		setStatus("Vorgaben geladen.");
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

async function runImport() {
	setBusy(true);
	try {
		setStatus("Synchronisierung läuft. Die vorbereiteten Daten aktualisieren sich live.");
		startPolling();
		const payload = await fetchJson(`${API_URL}?action=run`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(readPayload()),
		});
		stopPolling();
		render(payload, false);
		setStatus("Synchronisierung abgeschlossen.");
	} catch (error) {
		stopPolling();
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

async function reloadRows() {
	setBusy(true);
	try {
		render(await fetchJson(`${API_URL}?action=list`), false);
		setStatus("Vorbereitete Daten geladen.");
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

async function clearRows() {
	if (!confirm("Vorbereitete Herrschaftsgebiets-Daten wirklich leeren?")) return;
	setBusy(true);
	try {
		await fetchJson(`${API_URL}?action=clear`, { method: "POST" });
		render({ ok: true, items: [], count: 0 }, false);
		setStatus("Vorbereitete Daten geleert.");
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

async function runWikiSync(dryRun) {
	if (!dryRun && !confirm("Vorbereitete Daten jetzt in den produktiven Wiki-Cache übernehmen? Kartengeometrien bleiben unberührt.")) return;
	setBusy(true);
	try {
		setStatus(dryRun ? "Übernahme wird geprüft ..." : "Daten werden übernommen ...");
		const payload = await fetchJson(WIKI_SYNC_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "sync_territories", dry_run: dryRun, reset_target: false }),
		});
		renderSyncResult(payload);
		setStatus(dryRun ? "Übernahme geprüft." : "Daten übernommen.");
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

async function clearWikiTable() {
	if (!confirm("Achtung: Das leert die produktive Wiki-Herrschaftsgebiettabelle. Kartengeometrien bleiben erhalten, aber die Wiki-Zuordnungsliste ist danach leer, bis du Daten wieder übernimmst. Fortfahren?")) return;
	if (!confirm("Sicher? Diese Aktion ist nur sinnvoll vor einem kompletten Neuaufbau der Wiki-Herrschaftsgebietdaten.")) return;
	setBusy(true);
	try {
		const payload = await fetchJson(WIKI_SYNC_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "clear_territory_wiki_table" }),
		});
		renderSyncResult(payload);
		setStatus(payload.message || "Wiki-Herrschaftsgebiettabelle geleert.");
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

function normalizeSearchText(value) {
	return String(value ?? "").trim().toLocaleLowerCase("de-DE");
}

function filterRowsByName(items) {
	const query = normalizeSearchText(els.nameSearch?.value || "");
	if (query === "") return items;
	return items.filter((item) => normalizeSearchText(item.name).includes(query));
}

function render(payload, live) {
	latestRowsPayload = payload;
	const allItems = Array.isArray(payload.items) ? payload.items : [];
	const items = filterRowsByName(allItems);
	const count = Number(payload.count ?? allItems.length);
	els.count.textContent = String(count);
	els.visibleCount.textContent = `${items.length} sichtbar`;
	els.clearNameSearchBtn.disabled = normalizeSearchText(els.nameSearch?.value || "") === "";

	if (live && !payload.run) {
		const elapsed = Math.max(0, Math.round((Date.now() - pollStartedAt) / 1000));
		els.iterations.textContent = "läuft";
		els.pages.textContent = String(count);
		els.childLinks.textContent = "–";
		els.runInfo.textContent = `Live-Stand nach ${elapsed}s: ${count} Datensätze${count > startCount ? `, +${count - startCount} seit Start` : ""}.`;
	} else {
		els.iterations.textContent = payload.run?.iterations ?? "–";
		els.pages.textContent = payload.run?.fetched_pages ?? "–";
		els.childLinks.textContent = payload.run?.queued_child_links ?? "–";
		els.runInfo.textContent = payload.run ? `Fertig: ${count} Datensätze, ${payload.run.fetched_pages ?? 0} Seiten, ${payload.run.queued_child_links ?? 0} Kinderlinks, ${payload.run.errors?.length ?? 0} Fehler.` : `Vorbereitete Daten geladen: ${count} Datensätze.`;
	}

	els.rows.innerHTML = "";
	for (const item of items) {
		const raw = item.raw || {};
		const tr = document.createElement("tr");
		const path = Array.isArray(item.affiliation_path) ? item.affiliation_path.join(" > ") : "";
		tr.innerHTML = `<td class="select-cell"><input class="row-check" type="checkbox" value="${escapeAttr(item.id || "")}" aria-label="${escapeAttr(item.name || "Eintrag")} auswählen"></td><td><strong>${escapeHtml(item.name || "")}</strong><br><span class="badge ${raw.synthetic ? "warn" : "ok"}">${raw.synthetic ? "synthetisch" : "geholt"}</span></td><td class="coat-cell">${formatCoatCell(item)}</td><td>${escapeHtml(item.type || "")}</td><td>${escapeHtml(item.continent || "")}</td><td>${escapeHtml(path || item.affiliation_root || "")}</td><td class="date-cell">${formatDateCell(item, "founded")}</td><td class="numeric-cell">${escapeHtml(rawNumericValue(item.founded_start_bf))}</td><td class="date-cell">${formatDateCell(item, "dissolved")}</td><td class="numeric-cell">${escapeHtml(rawNumericValue(item.dissolved_end_bf))}</td><td>${item.wiki_url ? `<a href="${escapeAttr(item.wiki_url)}" target="_blank" rel="noreferrer">Wiki</a>` : ""}</td>`;
		els.rows.appendChild(tr);
	}
	updateSelectionState();
	els.debug.textContent = JSON.stringify(payload, null, "\t");
}

function renderSyncResult(payload) {
	const sync = payload.sync || {};
	els.iterations.textContent = "–";
	els.pages.textContent = String(payload.territory_count ?? "–");
	els.childLinks.textContent = String(payload.root_count ?? "–");
	els.count.textContent = String(payload.territory_count ?? 0);
	els.runInfo.textContent = `${payload.dry_run ? "Prüfung" : "Übernahme"}: ${sync.valid_count ?? 0} gültig, ${sync.created_count ?? 0} neu, ${sync.updated_count ?? 0} aktualisiert, ${sync.skipped_count ?? 0} übersprungen. Baum: ${payload.root_count ?? 0} Wurzeln, ${payload.territory_count ?? 0} Einträge.`;
	els.debug.textContent = JSON.stringify(payload, null, "\t");
}

function formatCoatCell(item) {
	const url = item.coat_of_arms_url || "";
	if (!url) return "";
	return `<a class="coat-preview" href="${escapeAttr(url)}" target="_blank" rel="noreferrer" title="Wappen öffnen"><img src="${escapeAttr(url)}" alt="Wappen" loading="lazy" onerror="this.parentElement.classList.add('broken')"><span>Wappen</span></a>`;
}

function formatDateCell(item, prefix) {
	return escapeHtml(formatBfRange(item[`${prefix}_start_bf`], item[`${prefix}_end_bf`]));
}

function rawNumericValue(value) {
	return value === null || value === undefined || value === "" ? "–" : String(value);
}

function formatBfRange(start, end) {
	const hasStart = start !== null && start !== undefined && start !== "";
	const hasEnd = end !== null && end !== undefined && end !== "";
	if (!hasStart && !hasEnd) return "";
	const startLabel = hasStart ? formatBfYear(Number(start)) : "";
	const endLabel = hasEnd ? formatBfYear(Number(end)) : "";
	if (startLabel && endLabel && startLabel !== endLabel) return `${startLabel}–${endLabel}`;
	return startLabel || endLabel;
}

function formatBfYear(value) {
	if (!Number.isFinite(value)) return "";
	if (value < 0) return `${Math.abs(value)} v. BF`;
	return `${value} BF`;
}

function selectedRowIds() {
	return Array.from(els.rows.querySelectorAll(".row-check:checked")).map((input) => Number(input.value)).filter(Number.isInteger);
}

function updateSelectionState() {
	const checks = Array.from(els.rows.querySelectorAll(".row-check"));
	const selected = selectedRowIds();
	for (const check of checks) {
		check.closest("tr")?.classList.toggle("selected", check.checked);
	}
	els.selectedCount.textContent = `${selected.length} ausgewählt`;
	els.deleteSelectedBtn.disabled = selected.length === 0;
	els.clearSelectionBtn.disabled = selected.length === 0;
	els.selectAllRows.checked = checks.length > 0 && selected.length === checks.length;
	els.selectAllRows.indeterminate = selected.length > 0 && selected.length < checks.length;
}

function clearSelection() {
	for (const check of els.rows.querySelectorAll(".row-check")) {
		check.checked = false;
	}
	updateSelectionState();
}

async function deleteSelectedRows() {
	const ids = selectedRowIds();
	if (ids.length === 0) return;
	if (!confirm(`${ids.length} vorbereitete Einträge aus political_territory_wiki_test löschen? Produktive Daten bleiben unberührt.`)) return;
	setBusy(true);
	try {
		const payload = await fetchJson(`${API_URL}?action=delete_rows`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ids }),
		});
		render(payload, false);
		setStatus(payload.message || `${ids.length} vorbereitete Einträge gelöscht.`);
	} catch (error) {
		setStatus(`Fehler: ${error.message}`);
	} finally {
		setBusy(false);
	}
}

function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function escapeAttr(value) {
	return escapeHtml(value).replace(/'/g, "&#039;");
}

els.runBtn.addEventListener("click", runImport);
els.reloadBtn.addEventListener("click", reloadRows);
els.defaultsBtn.addEventListener("click", loadDefaults);
els.clearBtn.addEventListener("click", clearRows);
els.clearWikiBtn.addEventListener("click", clearWikiTable);
els.dryRunBtn.addEventListener("click", () => runWikiSync(true));
els.promoteBtn.addEventListener("click", () => runWikiSync(false));
els.selectAllRows.addEventListener("change", () => {
	for (const check of els.rows.querySelectorAll(".row-check")) {
		check.checked = els.selectAllRows.checked;
	}
	updateSelectionState();
});
els.rows.addEventListener("change", (event) => {
	if (event.target instanceof HTMLInputElement && event.target.classList.contains("row-check")) {
		updateSelectionState();
	}
});
els.deleteSelectedBtn.addEventListener("click", deleteSelectedRows);
els.clearSelectionBtn.addEventListener("click", clearSelection);
els.nameSearch.addEventListener("input", () => {
	if (latestRowsPayload) render(latestRowsPayload, false);
});
els.clearNameSearchBtn.addEventListener("click", () => {
	els.nameSearch.value = "";
	if (latestRowsPayload) render(latestRowsPayload, false);
});

loadDefaults().then(reloadRows);
