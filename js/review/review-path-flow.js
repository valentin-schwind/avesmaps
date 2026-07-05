// Stroemungs-Sektion im "Weg bearbeiten"-Dialog (Flussrichtung spec §6): zeigt den
// Richtungsstatus des angeklickten Fluss-Segments, dreht/setzt die Richtung WEG-WEIT
// (set_flow: flip | set_dir; set_dir vervollstaendigt teilgerichtete Wege anker-konsistent,
// Anker bleiben unangetastet) und pflegt den weg-weiten Stroemungsfaktor (Clamp 1,0-3,0).
// Nur fuer Flussweg-Segmente sichtbar. Writes: dry_run:false + confirm:"apply" (weg-weit
// ist hier das DESIGN, kein Blast-Radius-Dialog wie beim Entfernen noetig).

function pathFlowElement(id) {
	return document.getElementById(id);
}

function pathFlowCurrentFlow() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		return null;
	}
	return pathEditFeature.properties.flow || null;
}

function pathFlowIsRiverSegment() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return false;
	}
	return normalizePathSubtype(pathEditFeature.properties?.feature_subtype) === "Flussweg";
}

// Weg-weiter Blick: das angeklickte Segment kann selbst richtungslos sein (Zufahrt), obwohl
// der Weg gerichtet ist -> Button-Beschriftung am WEG festmachen. Client-Spiegel der
// Weg-Identitaet (exakter Name ODER gleicher wiki_key); autoritativ entscheidet der Server.
function pathFlowWaySegmentsFor(feature) {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || !feature) {
		return [];
	}
	const name = String(feature.properties?.name || "");
	const wikiKey = String(feature.properties?.wiki_path?.wiki_key || "");
	return pathData.filter((path) => {
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return false;
		}
		const sameName = name !== "" && String(path.properties?.name || "") === name;
		const sameWiki = wikiKey !== "" && String(path.properties?.wiki_path?.wiki_key || "") === wikiKey;
		return sameName || sameWiki;
	});
}

function pathFlowWaySegments() {
	return pathFlowWaySegmentsFor(typeof pathEditFeature === "undefined" ? null : pathEditFeature);
}

// Popup-Shortcut (Editmode, direkt am Segment): gerichteter Weg -> umkehren, richtungsloser
// Weg -> festlegen. Vervollstaendigen teilgerichteter Wege bleibt bewusst im Detailpanel.
function pathFlowShortcutModeFor(feature) {
	const wayHasDirection = pathFlowWaySegmentsFor(feature).some((path) => {
		const dir = path.properties?.flow?.dir;
		return dir === "forward" || dir === "reverse";
	});
	return wayHasDirection ? "flip" : "set_dir";
}

function pathFlowShortcutLabelFor(feature) {
	return pathFlowShortcutModeFor(feature) === "flip" ? "Strömung umkehren" : "Strömung festlegen";
}

// Ein-Klick-Aktion aus dem Segment-Popup, ohne den "Weg bearbeiten"-Dialog: schreibt weg-weit
// (wie die Panel-Buttons), aktualisiert pathData/Popups/Pfeile und schliesst das Popup.
async function submitPathFlowShortcut(path) {
	const publicId = String(path?.properties?.public_id || path?.id || "");
	if (!publicId) {
		return;
	}
	const mode = pathFlowShortcutModeFor(path);
	if (typeof map !== "undefined" && typeof map.closePopup === "function") {
		map.closePopup();
	}
	try {
		const result = await pathWikiPost({ action: "set_flow", public_id: publicId, [mode]: true, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(result?.error?.message || result?.error || "Aktion fehlgeschlagen");
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		renderPathFlowSection();
		if (typeof window.avesmapsRedrawRiverFlowArrows === "function") {
			window.avesmapsRedrawRiverFlowArrows();
		}
		showFeedbackToast?.(mode === "flip"
			? `Strömung umgekehrt (${result.flipped} Segmente).`
			: `Strömung festgelegt (${result.directed} von ${result.segments} Segmenten${result.segments > result.directed ? " — Abzweige bleiben ohne Richtung" : ""}).`, "info");
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

function renderPathFlowSection() {
	const section = pathFlowElement("path-flow-section");
	if (!section) {
		return;
	}
	if (!pathFlowIsRiverSegment()) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	const flow = pathFlowCurrentFlow();
	const dir = flow?.dir === "forward" || flow?.dir === "reverse" ? flow.dir : null;
	const stateElement = pathFlowElement("path-flow-state");
	if (stateElement) {
		stateElement.textContent = dir
			? (flow?.source === "verlauf-sync" ? "bekannt (aus Wiki)" : "bekannt (manuell)")
			: "unbekannt";
	}
	const waySegments = pathFlowWaySegments();
	const directedCount = waySegments.filter((path) => {
		const wayDir = path.properties?.flow?.dir;
		return wayDir === "forward" || wayDir === "reverse";
	}).length;
	const wayHasDirection = directedCount > 0;
	const directionButton = pathFlowElement("path-flow-direction");
	if (directionButton) {
		directionButton.textContent = wayHasDirection ? "Richtung umdrehen (ganzer Fluss)" : "Richtung festlegen";
		directionButton.dataset.flowMode = wayHasDirection ? "flip" : "set_dir";
	}
	// Teilgerichteter Weg (z. B. Grosser Fluss: nur die wiki-ableitbaren Etappen tragen dir):
	// Rest der Hauptkette anker-konsistent vervollstaendigen. Abzweige bleiben immer dirlos,
	// daher kann der Button auch bei voll gerichteter Kette sichtbar sein -- der Server
	// antwortet dann mit dem klaren "already fully directed"-Fehler (Server ist autoritativ).
	const completeButton = pathFlowElement("path-flow-complete");
	if (completeButton) {
		completeButton.hidden = !(wayHasDirection && directedCount < waySegments.length);
	}
	const factorInput = pathFlowElement("path-flow-factor");
	const saveButton = pathFlowElement("path-flow-factor-save");
	if (factorInput) {
		const rawFactor = Number(flow?.factor);
		factorInput.value = (Number.isFinite(rawFactor) ? Math.min(3, Math.max(1, rawFactor)) : 1.5).toFixed(1);
		// Faktor editierbar, sobald ein Wiki-Weg zugewiesen ODER der Weg gerichtet ist
		// (Owner-Anforderung 3).
		const hasWiki = Boolean(pathEditFeature.properties?.wiki_path?.wiki_key);
		factorInput.disabled = !hasWiki && !wayHasDirection;
		if (saveButton) {
			saveButton.disabled = factorInput.disabled;
		}
	}
}

async function submitPathFlowAction(body, buildSuccessMessage) {
	const status = pathFlowElement("path-flow-status");
	try {
		const result = await pathWikiPost({ ...body, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(result?.error?.message || result?.error || "Aktion fehlgeschlagen");
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		renderPathFlowSection();
		if (typeof window.avesmapsRedrawRiverFlowArrows === "function") {
			window.avesmapsRedrawRiverFlowArrows();
		}
		const message = buildSuccessMessage(result);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "info");
	} catch (error) {
		const message = "Fehler: " + (error.message || error);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "error");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	const directionTrigger = event.target.closest("#path-flow-direction, #path-flow-complete");
	if (directionTrigger) {
		const mode = directionTrigger.id === "path-flow-complete" ? "set_dir"
			: (directionTrigger.dataset.flowMode === "flip" ? "flip" : "set_dir");
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, [mode]: true },
			(result) => {
				if (mode === "flip") {
					return `Richtung umgedreht (${result.flipped} Segmente).`;
				}
				if (Number(result.directed_before) > 0) {
					return `Richtung vervollständigt (${result.directed} Segmente ergänzt, ${result.directed_before} waren schon gerichtet — Abzweige bleiben ohne Richtung).`;
				}
				return `Richtung festgelegt (${result.directed} von ${result.segments} Segmenten${result.segments > result.directed ? " — Abzweige bleiben ohne Richtung" : ""}).`;
			}
		);
		return;
	}
	if (event.target.closest("#path-flow-factor-save")) {
		const publicId = pathWikiCurrentFeaturePublicId();
		const factorInput = pathFlowElement("path-flow-factor");
		if (!publicId || !factorInput) {
			return;
		}
		const factor = Number(factorInput.value);
		if (!Number.isFinite(factor)) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, factor },
			(result) => `Strömungsfaktor ${Number(result.factor ?? factor).toFixed(1)} übernommen (${result.factor_updated} Segmente).`
		);
	}
});
