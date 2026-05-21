"use strict";

function normalizePoliticalTerritoryEditorPreviewText(value) {
	return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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
