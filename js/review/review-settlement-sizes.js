// „Größen"-Reiter unter WikiSync: gleicht die Karten-Ortsgröße gegen die Wiki-Siedlungsklasse
// (Registry wiki_sync_pages) ab und erlaubt gruppenweises Übernehmen (Karte := Wiki). Gated:
// Schreiben nur über bulk_fix_sizes (dry_run:false, confirm:"apply"). Quelle/Schreiben serverseitig.

const SETTLEMENT_SIZE_API_URL = "/api/edit/wiki/settlements.php";
let settlementSizeConflicts = [];
let settlementSizeSelected = new Set();

const SETTLEMENT_SIZE_RANK = { dorf: 1, kleinstadt: 2, stadt: 3, grossstadt: 4, metropole: 5 };

function settlementSizeEl(id) {
	return document.getElementById(id);
}
function settlementSizeEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

async function loadSettlementSizeAudit() {
	const summary = settlementSizeEl("settlement-size-summary");
	const list = settlementSizeEl("settlement-size-list");
	if (summary) {
		summary.textContent = "Wird geprüft ...";
	}
	if (list) {
		list.innerHTML = '<p class="region-sync__empty">Lädt ...</p>';
	}
	try {
		const response = await fetch(`${SETTLEMENT_SIZE_API_URL}?action=audit_sizes`, { credentials: "same-origin" });
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Abgleich fehlgeschlagen");
		}
		settlementSizeConflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
		settlementSizeSelected = new Set();
		const s = data.summary || {};
		if (summary) {
			summary.textContent = `${settlementSizeConflicts.length} Konflikte · ${s.ok || 0} ✓ · ${s.unmatched || 0} ohne Wiki`;
		}
		renderSettlementSizeList();
		syncSettlementSizeApplyButton();
	} catch (error) {
		if (summary) {
			summary.textContent = "Fehler: " + (error.message || error);
		}
		if (list) {
			list.innerHTML = "";
		}
	}
}

function settlementSizeTransitionLabel(conflict) {
	const wiki = conflict.target_label || (conflict.wiki_classes || []).map((c) => settlementSizeClassLabel(c)).join("/");
	return `${conflict.map_label || conflict.map_class} → ${wiki}`;
}
function settlementSizeClassLabel(cls) {
	return ({ dorf: "Dorf", kleinstadt: "Kleinstadt", stadt: "Stadt", grossstadt: "Großstadt", metropole: "Metropole" })[cls] || cls;
}

function renderSettlementSizeList() {
	const list = settlementSizeEl("settlement-size-list");
	if (!list) {
		return;
	}
	if (settlementSizeConflicts.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Keine Größen-Konflikte. (Ggf. zuerst die Siedlungs-Sync laufen lassen, damit die Registry gefüllt ist.)</p>';
		return;
	}
	// Nach Übergang gruppieren, Hochstufungen (dir>0) zuerst.
	const groups = new Map();
	settlementSizeConflicts.forEach((c) => {
		const key = settlementSizeTransitionLabel(c);
		if (!groups.has(key)) {
			groups.set(key, { dir: c.dir, ambiguous: c.ambiguous, items: [] });
		}
		groups.get(key).items.push(c);
	});
	const sortedKeys = Array.from(groups.keys()).sort((a, b) => (groups.get(b).dir - groups.get(a).dir) || a.localeCompare(b));

	let html = "";
	sortedKeys.forEach((key) => {
		const group = groups.get(key);
		const selectable = !group.ambiguous;
		const dirBadge = group.dir > 0 ? "▲ Hochstufung" : (group.dir < 0 ? "▼ Herabstufung" : "mehrdeutig");
		html += `<div class="settlement-size-group">`;
		html += `<div class="settlement-size-group__head">`;
		html += selectable
			? `<label class="settlement-size-group__toggle"><input type="checkbox" class="settlement-size-group__check" data-group="${settlementSizeEscape(key)}" /> </label>`
			: `<span class="settlement-size-group__toggle"></span>`;
		html += `<span class="settlement-size-group__title">${settlementSizeEscape(key)}</span>`;
		html += `<span class="settlement-size-group__badge settlement-size-group__badge--${group.dir > 0 ? "up" : group.dir < 0 ? "down" : "amb"}">${dirBadge} · ${group.items.length}</span>`;
		html += `</div>`;
		group.items.sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => {
			const checked = settlementSizeSelected.has(c.public_id) ? " checked" : "";
			html += `<div class="settlement-size-item">`;
			html += selectable
				? `<input type="checkbox" class="settlement-size-item__check" data-public-id="${settlementSizeEscape(c.public_id)}"${checked} />`
				: `<span class="settlement-size-item__check settlement-size-item__check--none">–</span>`;
			html += `<button type="button" class="settlement-size-item__name" data-public-id="${settlementSizeEscape(c.public_id)}" title="Auf der Karte zeigen">${settlementSizeEscape(c.name)}</button>`;
			if (c.ambiguous) {
				html += `<span class="settlement-size-item__amb" title="${settlementSizeEscape((c.titles || []).join(", "))}">mehrdeutig: ${settlementSizeEscape((c.wiki_classes || []).map(settlementSizeClassLabel).join("/"))}</span>`;
			}
			html += `</div>`;
		});
		html += `</div>`;
	});
	list.innerHTML = html;
}

function syncSettlementSizeApplyButton() {
	const apply = settlementSizeEl("settlement-size-apply");
	if (apply) {
		apply.disabled = settlementSizeSelected.size === 0;
		apply.textContent = `Markierte übernehmen (${settlementSizeSelected.size})`;
	}
}

function settlementSizeFocusOnMap(publicId) {
	if (!publicId || typeof findLocationMarkerByPublicId !== "function") {
		return;
	}
	const entry = findLocationMarkerByPublicId(publicId);
	if (entry && entry.marker && typeof map !== "undefined" && map) {
		map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), 4), { duration: 0.6 });
		entry.marker.openPopup();
	}
}

async function applySettlementSizeSelection() {
	const ids = Array.from(settlementSizeSelected);
	if (ids.length === 0) {
		return;
	}
	if (!window.confirm(`${ids.length} Ortsgröße(n) an die Wiki-Angaben angleichen?`)) {
		return;
	}
	const apply = settlementSizeEl("settlement-size-apply");
	if (apply) {
		apply.disabled = true;
		apply.textContent = "Wird übernommen ...";
	}
	try {
		const response = await fetch(SETTLEMENT_SIZE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "bulk_fix_sizes", public_ids: ids, dry_run: false, confirm: "apply" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(data && data.error ? data.error : "Übernahme fehlgeschlagen");
		}
		const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
		showFeedbackToast?.(`${data.applied || 0} übernommen${skipped ? `, ${skipped} übersprungen` : ""}.`, "success");
		await loadSettlementSizeAudit();
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
		syncSettlementSizeApplyButton();
	}
}

document.addEventListener("change", (event) => {
	const target = event.target;
	if (!target || !target.closest || !target.closest("[data-wiki-sync-panel-section='sizes']")) {
		return;
	}
	if (target.classList.contains("settlement-size-item__check")) {
		const id = target.dataset.publicId;
		if (target.checked) {
			settlementSizeSelected.add(id);
		} else {
			settlementSizeSelected.delete(id);
		}
		syncSettlementSizeApplyButton();
		return;
	}
	if (target.classList.contains("settlement-size-group__check")) {
		const key = target.dataset.group;
		settlementSizeConflicts
			.filter((c) => !c.ambiguous && settlementSizeTransitionLabel(c) === key)
			.forEach((c) => {
				if (target.checked) {
					settlementSizeSelected.add(c.public_id);
				} else {
					settlementSizeSelected.delete(c.public_id);
				}
			});
		renderSettlementSizeList();
		syncSettlementSizeApplyButton();
		return;
	}
	if (target.id === "settlement-size-selectall") {
		settlementSizeConflicts
			.filter((c) => !c.ambiguous && c.dir > 0)
			.forEach((c) => {
				if (target.checked) {
					settlementSizeSelected.add(c.public_id);
				} else {
					settlementSizeSelected.delete(c.public_id);
				}
			});
		renderSettlementSizeList();
		syncSettlementSizeApplyButton();
	}
});

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	const nameButton = event.target.closest(".settlement-size-item__name");
	if (nameButton) {
		settlementSizeFocusOnMap(nameButton.dataset.publicId);
		return;
	}
	if (event.target.closest("#settlement-size-reload")) {
		void loadSettlementSizeAudit();
		return;
	}
	if (event.target.closest("#settlement-size-apply")) {
		void applySettlementSizeSelection();
	}
});

window.loadSettlementSizeAudit = loadSettlementSizeAudit;
