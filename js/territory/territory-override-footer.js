"use strict";
(function () {
function installPoliticalTerritoryEditorOverrideFooter(frame, regionEntry) {
	const doc = getPoliticalTerritoryEditorFrameDocument(frame);
	if (!doc || doc.getElementById("political-territory-local-override-footer")) return;

	const style = doc.createElement("style");
	style.textContent = `
		.local-override-footer {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px;
			align-items: center;
			margin-top: 12px;
			padding: 10px 12px;
			border: 1px solid #cdb79f;
			border-radius: 8px;
			background: #fff4df;
			color: #4f3b29;
		}
		.local-override-footer[hidden] { display: none !important; }
		.local-override-footer__text { font-weight: 700; }
		.local-override-footer__text small { display: block; margin-top: 2px; color: #806c59; font-weight: 400; }
		.local-override-footer__actions { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
		@media (max-width: 620px) { .local-override-footer { grid-template-columns: 1fr; } .local-override-footer__actions { justify-content: stretch; } .local-override-footer__actions button { flex: 1; } }
	`;
	doc.head.append(style);

	const footer = doc.createElement("div");
	footer.id = "political-territory-local-override-footer";
	footer.className = "local-override-footer";
	footer.hidden = true;
	footer.innerHTML = `
		<div class="local-override-footer__text">
			Lokale Einstellung aktiv. Globale Darstellung wird überschrieben.
			<small>Diese Werte gelten nur für diese Geometrie, bis sie zurückgesetzt oder global übernommen werden.</small>
		</div>
		<div class="local-override-footer__actions">
			<button class="secondary" type="button" data-local-override-action="reset">Zurücksetzen zu global</button>
			<button type="button" data-local-override-action="promote">Zu global machen</button>
		</div>
	`;
	const footerTarget = doc.querySelector(".manual-data-box")
		|| doc.querySelector(".manual-data-panel")
		|| doc.querySelector("form")
		|| doc.querySelector("main")
		|| doc.body;
	footerTarget?.append(footer);

	footer.querySelector('[data-local-override-action="reset"]')?.addEventListener("click", () => {
		void resetPoliticalTerritoryEditorLocalDisplay(regionEntry);
	});
	footer.querySelector('[data-local-override-action="promote"]')?.addEventListener("click", () => {
		void promotePoliticalTerritoryEditorLocalDisplay(frame);
	});

	doc.querySelectorAll("#displayNameInput, #alternateCoatInput, #zoomFromInput, #zoomToInput, #colorInput, #transparencyInput, #startYearInput, #endYearInput, #existsUntilTodayInput").forEach((element) => {
		["input", "change"].forEach((eventName) => {
			element.addEventListener(eventName, () => {
				activePoliticalTerritoryEditorPendingLocalOverride = true;
				syncPoliticalTerritoryEditorOverrideFooterVisibility(true);
			});
		});
	});
}
function syncPoliticalTerritoryEditorOverrideFooterVisibility(isVisible) {
	const { frame } = getPoliticalTerritoryEditorElements();
	if (frame && activePoliticalTerritoryEditorRegion) {
		installPoliticalTerritoryEditorOverrideFooter(frame, activePoliticalTerritoryEditorRegion);
	}
	const doc = getPoliticalTerritoryEditorFrameDocument();
	const footer = doc?.getElementById("political-territory-local-override-footer");
	if (footer) footer.hidden = !isVisible;
}

function suppressPoliticalTerritoryEditorOverrideFooter(durationMs = 2000) {
	const duration = Number(durationMs);
	const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 2000;
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = Date.now() + safeDuration;
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	syncPoliticalTerritoryEditorOverrideFooterVisibility(false);
}

function clearPoliticalTerritoryEditorOverrideFooterSuppression() {
	activePoliticalTerritoryEditorOverrideFooterSuppressedUntil = 0;
}

function isPoliticalTerritoryEditorOverrideFooterSuppressed() {
	return activePoliticalTerritoryEditorOverrideFooterSuppressedUntil > Date.now();
}

async function refreshPoliticalTerritoryEditorOverrideFooter(regionEntry = activePoliticalTerritoryEditorRegion) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry || {});
	if (!geometryPublicId) return;
	try {
		const state = await submitPoliticalTerritoryDisplayOverrideAction({
			action: "state",
			geometry_public_id: geometryPublicId,
		});
		const hasOverride = Boolean(state?.has_override || activePoliticalTerritoryEditorPendingLocalOverride);
		if (isPoliticalTerritoryEditorOverrideFooterSuppressed()) {
			if (!hasOverride) {
				clearPoliticalTerritoryEditorOverrideFooterSuppression();
			}
			syncPoliticalTerritoryEditorOverrideFooterVisibility(false);
			return;
		}
		syncPoliticalTerritoryEditorOverrideFooterVisibility(hasOverride);
	} catch (error) {
		console.warn("Lokaler Darstellungsstatus konnte nicht gelesen werden:", error);
	}
}

async function resetPoliticalTerritoryEditorLocalDisplay(regionEntry = activePoliticalTerritoryEditorRegion) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry || {});
	if (!geometryPublicId) return;
	if (!window.confirm("Lokale Darstellung verwerfen und wieder globale Einstellungen verwenden?")) return;

	await submitPoliticalTerritoryDisplayOverrideAction({
		action: "reset_local",
		geometry_public_id: geometryPublicId,
	});
	activePoliticalTerritoryEditorPromoteNextSave = false;
	suppressPoliticalTerritoryEditorOverrideFooter();
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") showFeedbackToast("Lokale Darstellung zurückgesetzt.", "success");
	const assignmentModule = getPoliticalTerritoryEditorElements().frame?.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (typeof assignmentModule?.reload === "function") {
		await assignmentModule.reload();
		installPoliticalTerritoryEditorOverrideFooter(getPoliticalTerritoryEditorElements().frame, regionEntry);
	}
	void refreshPoliticalTerritoryEditorOverrideFooter(regionEntry);
}

async function promotePoliticalTerritoryEditorLocalDisplay(frame = getPoliticalTerritoryEditorElements().frame) {
	activePoliticalTerritoryEditorPromoteNextSave = true;
	const assignmentModule = frame?.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (typeof assignmentModule?.save !== "function") {
		activePoliticalTerritoryEditorPromoteNextSave = false;
		throw new Error("Die lokale Darstellung konnte nicht global übernommen werden.");
	}
	await assignmentModule.save();
}

async function submitPoliticalTerritoryDisplayOverrideAction(payload) {
	const response = await fetch(POLITICAL_TERRITORY_DISPLAY_OVERRIDES_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
		body: JSON.stringify(payload),
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || result?.ok === false) {
		throw new Error(result?.error || `Darstellungs-Override fehlgeschlagen: HTTP ${response.status}`);
	}
	return result;
}

async function snapshotPoliticalTerritoryEditorGlobals(value = {}) {
	const displays = Array.isArray(value.displays) ? value.displays : [];
	if (displays.length < 1) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "snapshot_globals",
		displays,
	});
}

async function restorePoliticalTerritoryEditorGlobals(snapshotResult) {
	const snapshots = Array.isArray(snapshotResult?.snapshots) ? snapshotResult.snapshots : [];
	if (snapshots.length < 1) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "restore_globals",
		snapshots,
	});
}

async function clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId) {
	if (!geometryPublicId) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "reset_local",
		geometry_public_id: geometryPublicId,
	});
}
window.AvesmapsPoliticalTerritoryOverrideFooter = {
	install: installPoliticalTerritoryEditorOverrideFooter,
	refresh: refreshPoliticalTerritoryEditorOverrideFooter,
	syncVisibility: syncPoliticalTerritoryEditorOverrideFooterVisibility,
	suppress: suppressPoliticalTerritoryEditorOverrideFooter,
	clearSuppression: clearPoliticalTerritoryEditorOverrideFooterSuppression,
	isSuppressed: isPoliticalTerritoryEditorOverrideFooterSuppressed,
	resetLocalDisplay: resetPoliticalTerritoryEditorLocalDisplay,
	promoteLocalDisplay: promotePoliticalTerritoryEditorLocalDisplay,
	snapshotGlobals: snapshotPoliticalTerritoryEditorGlobals,
	restoreGlobals: restorePoliticalTerritoryEditorGlobals,
	clearLocalOverrides: clearPoliticalTerritoryEditorLocalOverrides,
};
})();