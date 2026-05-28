"use strict";

(function initTerritoryEditorCoatRestore() {
	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function isValidImageUrl(value) {
		const rawUrl = normalizeText(value);
		if (!rawUrl) {
			return false;
		}

		try {
			const url = new URL(rawUrl, window.location.origin);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch (error) {
			return false;
		}
	}

	function getWikiCoatUrl() {
		const link = document.querySelector('[data-role="wiki-coat-link"]');
		const href = normalizeText(link?.getAttribute("href") || link?.href || "");
		return isValidImageUrl(href) ? href : "";
	}

	function syncRestoreButtonVisibility() {
		const button = document.getElementById("restoreCoatButton");
		if (!button) {
			return;
		}

		button.hidden = !getWikiCoatUrl();
	}

	function restoreWikiCoat() {
		const wikiCoatUrl = getWikiCoatUrl();
		const input = document.getElementById("alternateCoatInput");
		const updateButton = document.getElementById("updateCoatButton");

		if (!wikiCoatUrl || !input) {
			return;
		}

		input.value = wikiCoatUrl;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("change", { bubbles: true }));
		updateButton?.click();
	}

	function init() {
		const button = document.getElementById("restoreCoatButton");
		const infoBox = document.getElementById("infoBox");

		if (!button) {
			return;
		}

		button.addEventListener("click", restoreWikiCoat);
		syncRestoreButtonVisibility();

		if (infoBox) {
			new MutationObserver(syncRestoreButtonVisibility).observe(infoBox, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["href", "src"]
			});
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
