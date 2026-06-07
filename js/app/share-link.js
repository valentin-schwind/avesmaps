/*
 * Kurzlink-Dienst: teilt den aktuellen Planer-/Ansichts-Zustand (Route + Filter + Ansicht) als
 * kurzen Code (avesmaps.de/?s=<code>) und löst diesen beim Laden wieder zur echten URL auf.
 */

const SHARE_LINK_ENDPOINT = "/api/app/share-link.php";

// Beim Laden zuerst pruefen: ?s=<code> -> Parameter vom Server holen und echte URL wiederherstellen.
// Code SYNCHRON erfassen, bevor anderer Code die URL veraendert.
(function resolveShareCodeOnLoad() {
	let shareCode = "";
	try {
		shareCode = new URLSearchParams(window.location.search).get("s") || "";
	} catch (error) {
		shareCode = "";
	}
	if (!shareCode) {
		return;
	}
	fetch(`${SHARE_LINK_ENDPOINT}?code=${encodeURIComponent(shareCode)}`, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((data) => {
			if (data && data.ok && typeof data.query === "string" && data.query) {
				// Echte Parameter wiederherstellen -> App laedt normal mit dem geteilten Zustand.
				window.location.replace(`${window.location.pathname}?${data.query}`);
			} else {
				// Ungueltiger Code -> s entfernen und normal weiterladen.
				try {
					window.history.replaceState(null, "", window.location.pathname);
				} catch (error) {
					/* egal */
				}
			}
		})
		.catch(() => {});
})();

function currentShareQuery() {
	// Sicherstellen, dass die URL den aktuellen Zustand widerspiegelt.
	if (typeof syncPlannerStateToUrl === "function") {
		try {
			syncPlannerStateToUrl();
		} catch (error) {
			/* egal */
		}
	}
	const params = new URLSearchParams(window.location.search);
	// Editor-/Debug-Flags gehören nicht in einen geteilten Link (öffentliche Ansicht).
	["s", "edit", "debugMap", "serverrouting", "clientrouting"].forEach((key) => params.delete(key));
	return params.toString();
}

async function createAndCopyShareLink() {
	const query = currentShareQuery();
	if (!query) {
		showFeedbackToast("Es gibt noch nichts zu teilen – setze zuerst Route oder Filter.", "info");
		return;
	}
	try {
		const response = await fetch(SHARE_LINK_ENDPOINT, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query }),
		});
		const data = await response.json().catch(() => null);
		if (!data || data.ok === false || !data.code) {
			showFeedbackToast((data && data.error) || "Kurzlink konnte nicht erstellt werden.", "warning");
			return;
		}
		const shortUrl = `${window.location.origin}${window.location.pathname}?s=${data.code}`;
		const didCopy = typeof copyTextToClipboard === "function" ? await copyTextToClipboard(shortUrl) : false;
		showFeedbackToast(
			didCopy ? `Kurzlink kopiert: ${shortUrl}` : `Kurzlink: ${shortUrl}`,
			didCopy ? "success" : "warning"
		);
	} catch (error) {
		showFeedbackToast("Kurzlink konnte nicht erstellt werden.", "warning");
	}
}

// Eine teilbare Route existiert, sobald mindestens 2 Wegpunkte auf gültige Orte zeigen.
function hasShareableRoute() {
	if (typeof getWaypointContainers !== "function" || typeof validateLocation !== "function") {
		return false;
	}
	let validCount = 0;
	getWaypointContainers().each(function () {
		const value = String($(this).find(".waypoint-input").val() || "").trim();
		if (value && validateLocation(value)) {
			validCount += 1;
		}
	});
	return validCount >= 2;
}

// "Link teilen"-Button im Routenplaner nur zeigen, wenn es eine teilbare Route gibt.
function updateShareLinkButtonVisibility() {
	const button = document.getElementById("share-link-button");
	if (button) {
		button.hidden = !hasShareableRoute();
	}
}

// Kontextmenue-Eintrag "Link teilen" gleichermassen ein-/ausblenden (beim Oeffnen aufgerufen).
function syncShareLinkContextMenuAction() {
	const entry = document.querySelector('[data-context-action="share-map-link"]');
	if (entry) {
		entry.hidden = !hasShareableRoute();
	}
}

// Button im Routenplaner-Panel.
$(document).on("click", "#share-link-button", function (event) {
	event.preventDefault();
	void createAndCopyShareLink();
});

// Sichtbarkeit reaktiv aktualisieren, wenn sich Wegpunkte ändern.
$(document).on("input change", ".waypoint-input", updateShareLinkButtonVisibility);
$(document).on("click", "#searchButton, #inputLocation, .remove-waypoint", function () {
	window.setTimeout(updateShareLinkButtonVisibility, 0);
});
$(function () {
	updateShareLinkButtonVisibility();
});
