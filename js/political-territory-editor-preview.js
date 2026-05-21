"use strict";

function normalizePoliticalTerritoryEditorPreviewText(value) {
	return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function isTreeNodeAssignedToMap(node) {
	return Boolean(node?.row?.map_assigned) || Number(node?.row?.map_geometry_count || 0) > 0;
}

function getTreeCoverageStatus(node) {
	const ownAssigned = isTreeNodeAssignedToMap(node);
	const children = Array.isArray(node?.children) ? node.children : [];

	if (children.length === 0) {
		return {
			kind: ownAssigned ? "all" : "none",
			ownAssigned,
			hasAnyCoverage: ownAssigned,
			isComplete: ownAssigned
		};
	}

	const childStatuses = children.map(getTreeCoverageStatus);
	const hasAnyChildCoverage = childStatuses.some((status) => status.hasAnyCoverage);
	const allChildrenComplete = childStatuses.every((status) => status.isComplete);
	const hasAnyCoverage = ownAssigned || hasAnyChildCoverage;

	if (ownAssigned && allChildrenComplete) {
		return { kind: "all", ownAssigned, hasAnyCoverage, isComplete: true };
	}
	if (ownAssigned) {
		return { kind: "own-only", ownAssigned, hasAnyCoverage, isComplete: false };
	}
	if (hasAnyChildCoverage && allChildrenComplete) {
		return { kind: "all", ownAssigned, hasAnyCoverage, isComplete: true };
	}
	if (hasAnyChildCoverage) {
		return { kind: "children-only", ownAssigned, hasAnyCoverage, isComplete: false };
	}

	return { kind: "none", ownAssigned, hasAnyCoverage: false, isComplete: false };
}

function getTreeMapStatus(node) {
	const status = getTreeCoverageStatus(node);
	if (status.kind === "all") {
		return {
			kind: "all",
			label: status.ownAssigned
				? "Gebiet und Untergebiete sind auf der Karte vorhanden"
				: "Alle Untergebiete sind auf der Karte vorhanden"
		};
	}
	if (status.kind === "own-only") {
		return {
			kind: "own-only",
			label: "Gebiet ist auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig"
		};
	}
	if (status.kind === "children-only") {
		return {
			kind: "children-only",
			label: "Gebiet ist indirekt durch Untergebiete auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig"
		};
	}
	return { kind: "none", label: "Gebiet und Untergebiete fehlen auf der Karte" };
}

function renderDropZone() {
	const dropZone = document.getElementById("dropZone");
	if (!dropZone) {
		return;
	}

	if (!dropZone.classList.contains("has-selection")) {
		dropZone.textContent = "Herrschaftsgebiet aus dem Wiki hier mit Drag'n'drop zuweisen";
	}
}

function showEmptyDetails(message = "") {
	const detailInfo = document.getElementById("detailInfo");
	const breadcrumb = document.getElementById("breadcrumb");
	const infoBox = document.getElementById("infoBox");
	const normalizedMessage = normalizePoliticalTerritoryEditorPreviewText(message);

	if (detailInfo) {
		detailInfo.textContent = normalizedMessage ? "Fehler" : "Noch kein Gebiet ausgewählt.";
	}
	if (breadcrumb) {
		breadcrumb.textContent = "";
	}
	if (infoBox) {
		infoBox.innerHTML = normalizedMessage
			? `<p class="info-error"></p>`
			: `<p class="info-empty">Wählen Sie ein Herrschaftsgebiet aus dem Baum aus.</p>`;
		const error = infoBox.querySelector(".info-error");
		if (error) {
			error.textContent = normalizedMessage;
		}
	}
}

function renderManualCoatPreview(url) {
	const preview = document.getElementById("manualCoatPreview");
	if (!preview) {
		return;
	}

	const normalizedUrl = normalizePoliticalTerritoryEditorPreviewText(url);
	preview.innerHTML = "";

	if (!normalizedUrl) {
		const empty = document.createElement("span");
		empty.textContent = "kein Wappen";
		preview.appendChild(empty);
		return;
	}

	const image = document.createElement("img");
	image.alt = "Wappen-Vorschau";
	image.loading = "lazy";
	image.decoding = "async";
	image.src = normalizedUrl;
	image.addEventListener("error", () => {
		preview.innerHTML = "";
		const error = document.createElement("span");
		error.textContent = "nicht ladbar";
		preview.appendChild(error);
	});

	preview.appendChild(image);
}

function updateWikiCoatPreviewFromManualInput() {
	const input = document.getElementById("alternateCoatInput");
	renderManualCoatPreview(input?.value || "");
}
