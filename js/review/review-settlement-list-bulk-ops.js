// Settlement bulk operations (review tab): crawl buildings, bulk-connect to map,
// record coats/ruins, continent backfill -- with their per-op running flags and
// status refreshes. Split out of review-settlement-list.js (M5 god-file split).
// Plain classic script: globals called at runtime; shared list state cross-script.

let settlementCrawlBuildingsRunning = false;
// Gechunkter Bauwerks-Crawl: erst die Typ-Liste holen, dann JEDEN Typ einzeln crawlen (kurze
// Requests -> kein STRATO-Timeout wie beim alten Einmal-Crawl, der nichts schrieb). onProgress(done,
// total) optional. Liefert {types, seen, added}. Genutzt vom Button UND vom großen WikiSync-Lauf.
async function crawlSettlementBuildingsChunked(onProgress) {
	const post = (body) =>
		fetch(SETTLEMENT_LIST_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}).then((r) => r.json());
	const typesResp = await post({ action: "crawl_building_types" });
	if (!typesResp || typesResp.ok !== true || !Array.isArray(typesResp.types)) {
		throw new Error(apiErrorMessage(typesResp, "Bauwerks-Typen konnten nicht geladen werden"));
	}
	const types = typesResp.types;
	let seen = 0;
	let added = 0;
	for (let i = 0; i < types.length; i += 1) {
		if (typeof onProgress === "function") {
			onProgress(i + 1, types.length);
		}
		const res = await post({ action: "crawl_building_type", type: types[i] });
		if (res && res.ok === true) {
			seen += Number(res.seen || 0);
			added += Number(res.added || 0);
		}
		await new Promise((resolve) => setTimeout(resolve, 200)); // STRATO schonen
	}
	return { types: types.length, seen, added };
}

// Crawlt alle Bauwerks-Typen aus dem Wiki (Bauwerk nach Art) in die Registry (gebaeude + building_type).
async function runSettlementCrawlBuildings() {
	if (settlementCrawlBuildingsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-crawl-buildings");
	settlementCrawlBuildingsRunning = true;
	if (btn) {
		btn.disabled = true;
		btn.textContent = "🏛 Bauwerke crawlen …";
	}
	try {
		const r = await crawlSettlementBuildingsChunked((done, total) => {
			if (btn) {
				btn.textContent = `🏛 Bauwerke crawlen … (${done}/${total})`;
			}
		});
		showFeedbackToast?.(`${r.seen} Bauwerke erfasst (${r.added} neu/aktualisiert, ${r.types} Typen).`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementCrawlBuildingsRunning = false;
		if (btn) {
			btn.disabled = false;
			btn.textContent = "🏛 Bauwerke crawlen";
		}
	}
}

let settlementBulkConnectRunning = false;
// Verbindet alle eindeutig passenden, unverbundenen Orte/Bauwerke (chunked, mit Progressbar).
async function runSettlementBulkConnect() {
	if (settlementBulkConnectRunning) {
		return;
	}
	const btn = document.getElementById("settlement-bulk-connect");
	const progress = document.getElementById("wiki-sync-progress");
	settlementBulkConnectRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	let total = 0;
	let connectedTotal = 0;
	try {
		try {
			const statusData = await (await fetch(`${SETTLEMENT_LIST_API_URL}?action=connect_status`, { credentials: "same-origin" })).json();
			total = statusData && statusData.ok ? Number(statusData.connectable_unconnected || 0) : 0;
		} catch (statusError) {
			total = 0;
		}
		if (progress && total > 0) {
			progress.max = total;
			progress.value = 0;
			progress.hidden = false;
		}
		let remaining = total > 0 ? total : Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "bulk_connect", limit: 100, dry_run: false, confirm: "apply" }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(apiErrorMessage(data, "Verbinden fehlgeschlagen"));
			}
			const connected = Number(data.connected || 0);
			connectedTotal += connected;
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.min(total, connectedTotal);
			}
			if (btn) {
				btn.textContent = `🔗 Verbinden … (${remaining})`;
			}
			if (connected === 0) {
				break; // kein Fortschritt mehr (Rest mehrdeutig/Fehler)
			}
		}
		showFeedbackToast?.(`${connectedTotal} verbunden — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementBulkConnectRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementConnectStatus();
	}
}

// Zeigt den „Wappen übernehmen"-Button, solange verbundene Orte ein gemeinfreies Wiki-Wappen
// haben, das noch nicht übernommen wurde.
async function refreshSettlementCoatStatus() {
	const btn = document.getElementById("settlement-record-coats");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=coat_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🛡 Wappen übernehmen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementRecordCoatsRunning = false;
// Überträgt gemeinfreie Wiki-Wappen auf die Karten-Orte (properties.coat → Icon-Ersatz).
async function runSettlementRecordCoats() {
	if (settlementRecordCoatsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-record-coats");
	const progress = document.getElementById("wiki-sync-progress");
	settlementRecordCoatsRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	let total = 0;
	let appliedTotal = 0;
	try {
		// Gechunkt schreiben, sonst timeoutet der Request bei vielen Wappen (HTTP2_PROTOCOL_ERROR).
		let remaining = Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "bulk_record_coats", dry_run: false, confirm: "apply", limit: 150 }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(apiErrorMessage(data, "Fehler beim Übernehmen"));
			}
			if (total === 0) {
				total = Number(data.matched || 0);
				if (progress && total > 0) {
					progress.max = total;
					progress.value = 0;
					progress.hidden = false;
				}
			}
			appliedTotal += Number(data.applied || 0);
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.max(0, total - remaining);
			}
			if (btn) {
				btn.textContent = `🛡 Wappen übernehmen … (${remaining})`;
			}
			if (Number(data.applied || 0) === 0) {
				break; // kein Fortschritt mehr -> Abbruch
			}
		}
		showFeedbackToast?.(`${appliedTotal} Wappen übernommen — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementRecordCoatsRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementCoatStatus();
	}
}

// Zeigt den „Ruinen übernehmen"-Button, solange verbundene Orte laut Wiki Ruinen sind,
// aber noch nicht als is_ruined markiert.
async function refreshSettlementRuinStatus() {
	const btn = document.getElementById("settlement-record-ruins");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=ruin_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🏚 Ruinen übernehmen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementRecordRuinsRunning = false;
// Überträgt den Wiki-Ruine-Status auf die Karten-Marker (setzt is_ruined → Marker kursiv).
async function runSettlementRecordRuins() {
	if (settlementRecordRuinsRunning) {
		return;
	}
	const btn = document.getElementById("settlement-record-ruins");
	settlementRecordRuinsRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	try {
		const response = await fetch(SETTLEMENT_LIST_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "bulk_record_ruins", dry_run: false, confirm: "apply" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Fehler beim Übernehmen"));
		}
		showFeedbackToast?.(`${data.applied || 0} Ruinen übernommen — Karte aktualisiert sich.`, "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	} finally {
		settlementRecordRuinsRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		await refreshSettlementRuinStatus();
	}
}

// Zeigt den „Kontinente nachtragen"-Button, solange Registry-Seiten ohne Kontinent existieren.
async function refreshSettlementContinentStatus() {
	const btn = document.getElementById("settlement-backfill-continents");
	if (!btn) {
		return;
	}
	try {
		const response = await fetch(`${SETTLEMENT_LIST_API_URL}?action=enrich_status`, { credentials: "same-origin" });
		const data = await response.json();
		const remaining = data && data.ok ? Number(data.remaining || 0) : 0;
		if (remaining > 0) {
			btn.textContent = `🌍 Wiki-Details nachtragen (${remaining})`;
			btn.hidden = false;
		} else {
			btn.hidden = true;
		}
	} catch (error) {
		btn.hidden = true;
	}
}

let settlementBackfillRunning = false;
// Trägt den Kontinent gebündelt nach (chunked, bis remaining=0), lädt danach die Liste neu.
async function runSettlementContinentBackfill() {
	if (settlementBackfillRunning) {
		return;
	}
	const btn = document.getElementById("settlement-backfill-continents");
	const progress = document.getElementById("wiki-sync-progress");
	settlementBackfillRunning = true;
	if (btn) {
		btn.disabled = true;
	}
	try {
		// Gesamtzahl als Progress-Maximum bestimmen, damit der Balken wirklich läuft.
		let total = 0;
		try {
			const statusResponse = await fetch(`${SETTLEMENT_LIST_API_URL}?action=enrich_status`, { credentials: "same-origin" });
			const statusData = await statusResponse.json();
			total = statusData && statusData.ok ? Number(statusData.remaining || 0) : 0;
		} catch (statusError) {
			total = 0;
		}
		if (progress && total > 0) {
			progress.max = total;
			progress.value = 0;
			progress.hidden = false;
		}
		let remaining = total > 0 ? total : Infinity;
		let guard = 0;
		while (remaining > 0 && guard < 400) {
			const response = await fetch(SETTLEMENT_LIST_API_URL, {
				method: "POST",
				credentials: "same-origin",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "enrich_details", limit: 100 }),
			});
			const data = await response.json();
			if (!data || data.ok !== true) {
				throw new Error(apiErrorMessage(data, "Backfill-Fehler"));
			}
			remaining = Number(data.remaining || 0);
			guard += 1;
			if (progress && total > 0) {
				progress.value = Math.max(0, total - remaining);
			}
			if (btn) {
				btn.textContent = `🌍 Wiki-Details nachtragen … (${remaining})`;
			}
		}
		showFeedbackToast?.("Kontinente nachgetragen.", "success");
		await loadSettlementList();
	} catch (error) {
		showFeedbackToast?.("Fehler beim Nachtragen: " + (error.message || error), "error");
	} finally {
		settlementBackfillRunning = false;
		if (btn) {
			btn.disabled = false;
		}
		if (progress) {
			progress.hidden = true;
			progress.max = 5;
			progress.value = 0;
		}
		await refreshSettlementContinentStatus();
	}
}
