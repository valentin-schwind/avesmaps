/*
 * Local (per-territory) settlement ray-cast trigger, mirroring the structure
 * of map-features-derived-boundary-context-action.js: a self-contained IIFE
 * that (1) inserts its own button into #region-context-menu next to
 * edit-properties, and (2) intercepts clicks on that button in the document
 * capture phase -- via stopImmediatePropagation() -- before the delegated
 * jQuery handler in map-features.js (bound in the bubble phase) can look the
 * action up in REGION_CONTEXT_ACTIONS. REGION_CONTEXT_ACTIONS is a `const`
 * object literal local to map-features.js and is never mutated from here;
 * this file's own capture-phase listener is entirely how it hooks in.
 *
 * Right-click a territory polygon -> "Siedlungen hier zuordnen" -> a
 * client-side dry-run scoped to just that territory
 * (window.AvesmapsSettlementAssign.computeDryRun({scope:{territoryPublicId}}),
 * see map-features-settlement-territory-assign.js) -> a German summary the
 * owner reviews via window.confirm() (the established pattern for
 * count-bearing "review before write" confirmations in this codebase, e.g.
 * js/review/review-path-sync.js) -> apply() only on explicit confirmation.
 */
(function initSettlementContextAction() {
	"use strict";

	const ACTION = "assign-settlements-here";

	function ensureContextMenuButton() {
		const menu = document.getElementById("region-context-menu");
		if (!menu || menu.querySelector(`[data-region-context-action="${ACTION}"]`)) {
			return;
		}

		const propertiesButton = menu.querySelector('[data-region-context-action="edit-properties"]');
		const button = document.createElement("button");
		button.type = "button";
		button.className = "map-context-menu__item";
		button.dataset.regionContextAction = ACTION;
		button.textContent = "Siedlungen hier zuordnen";
		if (propertiesButton) {
			propertiesButton.insertAdjacentElement("afterend", button);
			return;
		}

		menu.appendChild(button);
	}

	/**
	 * Builds the German owner-facing dry-run summary text used both as the
	 * window.confirm() body and (compressed) as the post-apply success toast.
	 * @param {{assigned: number, changed: number, unassigned: number, skippedManual: number, pairs: Array}} summary
	 * @returns {string}
	 */
	function formatDryRunSummary(summary) {
		const total = summary.pairs.length;
		return [
			`${total} Siedlung(en) würden zugeordnet.`,
			`Neu zugeordnet: ${summary.assigned}`,
			`Geändert: ${summary.changed}`,
			`Nicht zuordenbar: ${summary.unassigned}`,
			`Übersprungen (manuell gesetzt): ${summary.skippedManual}`,
			"",
			"Jetzt übernehmen?",
		].join("\n");
	}

	async function handleContextAction(event) {
		const actionElement = event.target?.closest?.(`[data-region-context-action="${ACTION}"]`);
		if (!actionElement) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const regionEntry = activeRegionContextEntry;
		closeRegionContextMenu();

		if (!window.AvesmapsSettlementAssign || typeof window.AvesmapsSettlementAssign.computeDryRun !== "function") {
			showFeedbackToast("Karte/Engine nicht bereit.", "warning");
			return;
		}

		const territoryPublicId = regionEntry?.territoryPublicId;
		if (!territoryPublicId) {
			showFeedbackToast("Kein Herrschaftsgebiet ausgewählt.", "warning");
			return;
		}

		try {
			showFeedbackToast("Siedlungen werden geprüft...", "info");
			const summary = await window.AvesmapsSettlementAssign.computeDryRun({ scope: { territoryPublicId } });

			if (!summary.pairs.length) {
				showFeedbackToast("Keine Änderungen.", "info");
				return;
			}

			if (!window.confirm(formatDryRunSummary(summary))) {
				return;
			}

			await window.AvesmapsSettlementAssign.apply(summary.pairs, { confirm: "apply" });
			showFeedbackToast(`${summary.pairs.length} Siedlungen zugeordnet.`, "success");
		} catch (error) {
			console.error("Siedlungen konnten nicht zugeordnet werden:", error);
			showFeedbackToast(error.message || "Siedlungen konnten nicht zugeordnet werden.", "warning");
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ensureContextMenuButton, { once: true });
	} else {
		ensureContextMenuButton();
	}
	document.addEventListener("click", (event) => {
		void handleContextAction(event);
	}, true);
})();
