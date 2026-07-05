// Stroemungs-Sektion im "Weg bearbeiten"-Dialog (Flussrichtung spec §6): zeigt den
// Richtungsstatus des angeklickten Fluss-Segments, dreht/setzt die Richtung WEG-WEIT
// (set_flow: flip | set_dir) und pflegt den weg-weiten Stroemungsfaktor (Clamp 1,0-3,0).
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
function pathFlowWaySegments() {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return [];
	}
	const name = String(pathEditFeature.properties?.name || "");
	const wikiKey = String(pathEditFeature.properties?.wiki_path?.wiki_key || "");
	return pathData.filter((path) => {
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return false;
		}
		const sameName = name !== "" && String(path.properties?.name || "") === name;
		const sameWiki = wikiKey !== "" && String(path.properties?.wiki_path?.wiki_key || "") === wikiKey;
		return sameName || sameWiki;
	});
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
	const wayHasDirection = waySegments.some((path) => {
		const wayDir = path.properties?.flow?.dir;
		return wayDir === "forward" || wayDir === "reverse";
	});
	const directionButton = pathFlowElement("path-flow-direction");
	if (directionButton) {
		directionButton.textContent = wayHasDirection ? "Richtung umdrehen (ganzer Fluss)" : "Richtung festlegen";
		directionButton.dataset.flowMode = wayHasDirection ? "flip" : "set_dir";
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
	if (event.target.closest("#path-flow-direction")) {
		const button = pathFlowElement("path-flow-direction");
		const mode = button?.dataset.flowMode === "flip" ? "flip" : "set_dir";
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, [mode]: true },
			(result) => mode === "flip"
				? `Richtung umgedreht (${result.flipped} Segmente).`
				: `Richtung festgelegt (${result.directed} von ${result.segments} Segmenten${result.segments > result.directed ? " — Abzweige bleiben ohne Richtung" : ""}).`
		);
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
