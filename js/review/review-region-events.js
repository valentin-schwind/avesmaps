$(document).on("click", "[data-region-edit-tab]", function (event) {
	event.preventDefault();
	const key = this.dataset.regionEditTab || "";
	const tab = findRegionEditTab(key);
	if (!tab || key === activeRegionEditTabKey) {
		return;
	}

	snapshotActiveRegionEditTab();
	activeRegionEditTabKey = key;
	populateRegionEditForm(tab.region, { preserveTabs: true });
	renderRegionEditTabs();
});

$(document).on("click", "[data-region-edit-tab-close]", async function (event) {
	event.preventDefault();
	event.stopPropagation();
	const key = this.dataset.regionEditTabClose || "";
	const tabIndex = regionEditTabs.findIndex((tab) => tab.key === key);
	if (tabIndex <= 0) {
		return;
	}

	snapshotActiveRegionEditTab();
	const tab = regionEditTabs[tabIndex];
	if (isRegionEditTabDirty(tab)) {
		const closeChoice = await askRegionTabCloseChoice();
		if (closeChoice === "save") {
			try {
				await saveRegionEditTab(tab);
				await loadPoliticalTerritoryOptions();
				schedulePoliticalTerritoryLayerReload({ immediate: true });
				showFeedbackToast("Herrschaftsgebiet gespeichert.", "success");
			} catch (error) {
				console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
				setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
				return;
			}
		} else if (closeChoice !== "discard") {
			return;
		}
	}

	regionEditTabs.splice(tabIndex, 1);
	if (activeRegionEditTabKey === key) {
		const nextTab = regionEditTabs[Math.max(0, tabIndex - 1)] || regionEditTabs[0] || null;
		activeRegionEditTabKey = nextTab?.key || "";
		if (nextTab) {
			populateRegionEditForm(nextTab.region, { preserveTabs: true });
		}
	}
	renderRegionEditTabs();
});

$(document).on("click", "[data-region-parent-id]", function (event) {
	event.preventDefault();
	const toggleKey = this.dataset.regionTreeToggle || "";
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	const isLeaf = this.dataset.regionTreeLeaf === "1";
	if (toggleKey && (!isLeaf || event.target?.closest?.(".political-territory-parent-tree__toggle") || (this.dataset.regionTreeGroup === "1" && !territoryPublicId))) {
		if (regionParentCollapsedKeys.has(toggleKey)) {
			regionParentCollapsedKeys.delete(toggleKey);
		} else {
			regionParentCollapsedKeys.add(toggleKey);
		}
		populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
		return;
	}

	if (!territoryPublicId) {
		return;
	}
	if (!isLeaf) {
		setRegionEditStatus("Nur der unterste Knoten kann einer Geometrie zugewiesen werden.", "pending");
		return;
	}

	regionParentSelectedTreeId = territoryPublicId;
	document.querySelectorAll("#region-edit-parent-tree [data-region-parent-id]").forEach((button) => {
		button.classList.toggle("is-selected", button === this);
	});
	const territoryName = this.querySelector(".political-territory-parent-tree__name")?.textContent || "Herrschaftsgebiet";
	setRegionEditStatus(`${territoryName} ausgewählt.`, "success");
});

$(document).on("dblclick", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	event.preventDefault();
	event.stopPropagation();
	const toggleKey = this.dataset.regionTreeToggle || "";
	if (!toggleKey) {
		return;
	}

	if (regionParentCollapsedKeys.has(toggleKey)) {
		regionParentCollapsedKeys.delete(toggleKey);
	} else {
		regionParentCollapsedKeys.add(toggleKey);
	}
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
});

$(document).on("dragstart", "#region-edit-parent-tree [data-region-territory-id]", function (event) {
	const territoryPublicId = this.dataset.regionTerritoryId || "";
	if (!territoryPublicId || this.dataset.regionTreeLeaf !== "1" || !event.originalEvent?.dataTransfer) {
		event.preventDefault();
		return;
	}

	event.originalEvent.dataTransfer.effectAllowed = "copy";
	event.originalEvent.dataTransfer.setData("text/plain", territoryPublicId);
	event.originalEvent.dataTransfer.setData("application/x-avesmaps-territory", territoryPublicId);
});

$(document).on("dragover", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-parent-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-parent-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	const activeTerritoryId = document.getElementById("region-edit-territory-public-id")?.value || "";
	if (territoryPublicId.startsWith("wiki:")) {
		setRegionEditStatus("Wiki-Knoten bitte in die Zuweisungsflaeche unter dem Baum ziehen.", "pending");
		return;
	}
	if (!territoryPublicId || territoryPublicId === activeTerritoryId) {
		return;
	}

	updateRegionParentDropTarget(territoryPublicId);
});

$(document).on("dragover", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.add("is-drag-over");
	if (event.originalEvent?.dataTransfer) {
		event.originalEvent.dataTransfer.dropEffect = "copy";
	}
});

$(document).on("dragleave", "#region-edit-assignment-drop", function () {
	this.classList.remove("is-drag-over");
});

$(document).on("drop", "#region-edit-assignment-drop", function (event) {
	event.preventDefault();
	this.classList.remove("is-drag-over");
	const dataTransfer = event.originalEvent?.dataTransfer;
	const territoryPublicId = dataTransfer?.getData("application/x-avesmaps-territory") || dataTransfer?.getData("text/plain") || "";
	if (!territoryPublicId) {
		return;
	}

	void assignRegionGeometryToWikiTreeLeaf(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht zugewiesen werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
	});
});

$(document).on("click", "[data-region-assignment-breadcrumb-id]", function (event) {
	event.preventDefault();
	const territoryPublicId = this.dataset.regionAssignmentBreadcrumbId || "";
	void openRegionVisualTabFromBreadcrumb(territoryPublicId).catch((error) => {
		console.error("Herrschaftsgebiet konnte nicht geöffnet werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht geöffnet werden.", "error");
	});
});

$(document).on("click", "#region-edit-assignment-clear", function (event) {
	event.preventDefault();
	void clearRegionGeometryAssignment().catch((error) => {
		console.error("Geometrie konnte nicht freigegeben werden:", error);
		setRegionEditStatus(error.message || "Geometrie konnte nicht freigegeben werden.", "error");
	});
});

$(document).on("input change", "[data-region-assignment-zoom-min], [data-region-assignment-zoom-max]", function (event) {
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const territoryPublicId = summaryElement?.dataset?.regionAssignmentActiveId || "";
	if (!territoryPublicId) {
		return;
	}

	const minInputElement = summaryElement.querySelector("[data-region-assignment-zoom-min]");
	const maxInputElement = summaryElement.querySelector("[data-region-assignment-zoom-max]");
	if (!(minInputElement instanceof HTMLInputElement) || !(maxInputElement instanceof HTMLInputElement)) {
		return;
	}

	const changedField = this.dataset.regionAssignmentZoomField || "";
	const normalizedZoom = updatePoliticalTerritoryDraftZoom(territoryPublicId, minInputElement.value, maxInputElement.value, changedField);
	if (!normalizedZoom) {
		return;
	}

	minInputElement.value = normalizedZoom.minText;
	maxInputElement.value = normalizedZoom.maxText;
	syncRegionAssignmentFormZoomInputs(normalizedZoom.minText, normalizedZoom.maxText);
	if (event.type === "change") {
		renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId);
	}
});

$(document).on("input change", "#region-edit-min-zoom, #region-edit-max-zoom", function () {
	const territoryPublicId = String(document.getElementById("region-edit-territory-public-id")?.value || "").trim();
	if (!territoryPublicId) {
		return;
	}

	const minInputElement = document.getElementById("region-edit-min-zoom");
	const maxInputElement = document.getElementById("region-edit-max-zoom");
	if (!(minInputElement instanceof HTMLInputElement) || !(maxInputElement instanceof HTMLInputElement)) {
		return;
	}

	const changedField = this.id === "region-edit-max-zoom" ? "max" : "min";
	const normalizedZoom = updatePoliticalTerritoryDraftZoom(territoryPublicId, minInputElement.value, maxInputElement.value, changedField);
	if (!normalizedZoom) {
		return;
	}

	minInputElement.value = normalizedZoom.minText;
	maxInputElement.value = normalizedZoom.maxText;
	const summaryElement = document.getElementById("region-edit-assignment-summary");
	const summaryTerritoryId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (summaryTerritoryId === territoryPublicId) {
		const summaryMinInput = summaryElement.querySelector("[data-region-assignment-zoom-min]");
		const summaryMaxInput = summaryElement.querySelector("[data-region-assignment-zoom-max]");
		if (summaryMinInput instanceof HTMLInputElement) {
			summaryMinInput.value = normalizedZoom.minText;
		}
		if (summaryMaxInput instanceof HTMLInputElement) {
			summaryMaxInput.value = normalizedZoom.maxText;
		}
	}
});

$(document).on("input change", "[data-region-assignment-field]", function () {
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const territoryPublicId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (!territoryPublicId) {
		return;
	}

	const field = this.dataset.regionAssignmentField || "";
	if (field === "color") {
		const value = String(this.value || "#888888").trim() || "#888888";
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { color: value }, { color: value });
		syncRegionAssignmentFormFieldValues({ color: value });
		return;
	}

	if (field === "opacity") {
		const opacityPercent = Math.max(0, Math.min(100, Number.parseInt(String(this.value || "33"), 10) || 0));
		const opacity = opacityPercent / 100;
		const labelElement = this.closest(".political-territory-assignment-summary__field")?.querySelector("span");
		if (labelElement) {
			labelElement.textContent = `Transparenz ${opacityPercent}%`;
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { opacity }, { opacity });
		syncRegionAssignmentFormFieldValues({ opacityPercent });
		return;
	}

	if (field === "name") {
		const value = normalizeParentheticalSpacing(String(this.value || "").trim());
		if (this.value !== value) {
			this.value = value;
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { name: value, displayName: value }, { name: value });
		syncRegionAssignmentFormFieldValues({ name: value });
		syncRegionAssignmentBreadcrumbName(territoryPublicId, value);
		return;
	}

	if (field === "coat") {
		const value = String(this.value || "").trim();
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { coat_of_arms_url: value, coatOfArmsUrl: value }, { coat_of_arms_url: value });
		syncRegionAssignmentFormFieldValues({ coatOfArmsUrl: value });
		const imageElement = summaryElement.querySelector(".political-territory-assignment-summary__coat");
		if (imageElement instanceof HTMLImageElement) {
			imageElement.src = value;
			imageElement.hidden = value === "";
		}
		return;
	}

	if (field === "valid-from") {
		const value = String(this.value || "").trim();
		const number = value === "" ? null : Number.parseInt(value, 10);
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_from_bf: number, validFromBf: number }, { valid_from_bf: value });
		syncRegionAssignmentFormFieldValues({ validFromBfText: value });
		return;
	}

	if (field === "valid-open") {
		const isOpen = this.checked === true;
		const validToInput = summaryElement.querySelector("[data-region-assignment-field='valid-to']");
		if (validToInput instanceof HTMLInputElement) {
			validToInput.disabled = isOpen;
			if (isOpen) {
				validToInput.value = "";
			}
		}
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_to_bf: isOpen ? null : null, validToBf: isOpen ? null : null }, { valid_to_open: isOpen, valid_to_bf: isOpen ? "" : String(validToInput?.value || "") });
		syncRegionAssignmentFormFieldValues({ validToOpen: isOpen, validToBfText: isOpen ? "" : String(validToInput?.value || "") });
		return;
	}

	if (field === "valid-to") {
		const openInput = summaryElement.querySelector("[data-region-assignment-field='valid-open']");
		const isOpen = openInput instanceof HTMLInputElement ? openInput.checked : false;
		const value = isOpen ? "" : String(this.value || "").trim();
		const number = value === "" ? null : Number.parseInt(value, 10);
		applyPoliticalTerritoryDraftPatch(territoryPublicId, { valid_to_bf: number, validToBf: number }, { valid_to_open: isOpen, valid_to_bf: value });
		syncRegionAssignmentFormFieldValues({ validToBfText: value, validToOpen: isOpen });
	}
});

$(document).on("click", "[data-region-assignment-coat-refresh]", function (event) {
	event.preventDefault();
	const summaryElement = this.closest("#region-edit-assignment-summary");
	const inputElement = summaryElement?.querySelector("[data-region-assignment-field='coat']");
	const territoryPublicId = String(summaryElement?.dataset?.regionAssignmentActiveId || "").trim();
	if (!(inputElement instanceof HTMLInputElement) || !territoryPublicId) {
		return;
	}

	const value = String(inputElement.value || "").trim();
	applyPoliticalTerritoryDraftPatch(territoryPublicId, { coat_of_arms_url: value, coatOfArmsUrl: value }, { coat_of_arms_url: value });
	syncRegionAssignmentFormFieldValues({ coatOfArmsUrl: value });
	renderRegionAssignment(regionAssignmentWikiPath, regionAssignmentEnsuredChain, territoryPublicId);
});

$(document).on("click", "#region-edit-parent-clear", function (event) {
	event.preventDefault();
	updateRegionParentDropTarget("");
});

function updateRegionParentFilter(value) {
	regionParentFilterQuery = String(value || "").trim();
	populateRegionParentSelect(regionEditEntry?.region || regionEditEntry || {});
}

// Three-way close confirmation for a dirty region-edit tab. Resolves "save" | "discard" | "cancel".
// (Self-contained modal: no CSS dependency; Escape and backdrop click both resolve "cancel".)
function askRegionTabCloseChoice() {
	return new Promise((resolve) => {
		document.getElementById("region-tab-close-choice")?.remove();

		const overlay = document.createElement("div");
		overlay.id = "region-tab-close-choice";
		overlay.style.cssText = "position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);";

		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		dialog.style.cssText = "background:#fff;color:#222;max-width:420px;width:calc(100% - 32px);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.35);padding:20px 22px;font:14px/1.45 system-ui,sans-serif;";

		const message = document.createElement("p");
		message.style.cssText = "margin:0 0 18px;";
		message.textContent = "Dieser Reiter hat ungespeicherte Änderungen. Vor dem Schließen speichern?";

		const buttonRow = document.createElement("div");
		buttonRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;";

		let settled = false;
		const finish = (choice) => {
			if (settled) {
				return;
			}
			settled = true;
			document.removeEventListener("keydown", onKeydown, true);
			overlay.remove();
			resolve(choice);
		};
		const onKeydown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				finish("cancel");
			}
		};
		const makeButton = (label, choice, primary) => {
			const button = document.createElement("button");
			button.type = "button";
			button.textContent = label;
			button.style.cssText = "padding:7px 14px;border-radius:6px;cursor:pointer;border:1px solid " + (primary ? "var(--color-button-border)" : "var(--color-button-soft-border)") + ";background:" + (primary ? "var(--color-button)" : "var(--color-button-soft)") + ";color:" + (primary ? "var(--color-button-text)" : "var(--color-button-soft-text)") + ";";
			button.addEventListener("click", () => finish(choice));
			return button;
		};

		buttonRow.append(
			makeButton("Abbrechen", "cancel", false),
			makeButton("Verwerfen", "discard", false),
			makeButton("Speichern", "save", true)
		);
		dialog.append(message, buttonRow);
		overlay.append(dialog);
		overlay.addEventListener("click", (event) => {
			if (event.target === overlay) {
				finish("cancel");
			}
		});
		document.addEventListener("keydown", onKeydown, true);
		document.body.append(overlay);
		buttonRow.querySelector("button:last-child")?.focus();
	});
}
