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
		shareCode = (typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search)).get("s") || "";
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
				// Echte Parameter wiederherstellen -> App laedt normal mit dem geteilten Zustand. Der
				// Kurzlink-Code speichert nur den Planer-Zustand; Ansichts-/Mode-Flags, die der Nutzer der
				// Kurzlink-URL vorangestellt hat (z. B. ?infopanel=true), sollen den Redirect ueberleben --
				// sonst ginge etwa der Infopanel-Modus beim Aufloesen verloren.
				const restored = new URLSearchParams(data.query);
				try {
					const current = typeof window.avesmapsSearchParams === "function" ? window.avesmapsSearchParams() : new URLSearchParams(window.location.search);
					["infopanel", "lang", "edit"].forEach((key) => {
						const value = current.get(key);
						if (value && !restored.has(key)) {
							restored.set(key, value);
						}
					});
				} catch (mergeError) {
					/* egal -- dann eben ohne die vorangestellten Flags */
				}
				window.location.replace(`${window.location.pathname}?${restored.toString()}`);
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
	// Die Adressleiste spiegelt den Planer-Zustand seit der Owner-Entscheidung 2026-07-06 NICHT mehr
	// (js/map-features/map-features-layer-state.js syncPlannerStateToUrl schreibt die URL nicht mehr).
	// Die Abfrage-Parameter daher direkt aus dem Planer-Zustand aufbauen statt aus window.location.search
	// zu lesen (das wäre jetzt der unveränderten, ggf. leeren geöffneten URL).
	const params = typeof buildPlannerSearchParams === "function"
		? buildPlannerSearchParams()
		: new URLSearchParams(window.location.search);
	// Editor-/Debug-Flags gehören nicht in einen geteilten Link (öffentliche Ansicht). Ebenso die
	// Wiki-Deep-Link-Parameter (?siedlung/?staat/?region/?strasse/?fluss) und der ältere
	// ?place=<publicId>-Fokus-Parameter (js/map-features/map-features-share-pin.js) -- sie
	// fokussieren beim Laden ein Objekt und sollen nicht in einen später geteilten ?s=-Code einwandern
	// (ein Kurzlink-Code darf keinen Fokus-Parameter re-embedden). "lang" wird ebenfalls nie geteilt
	// (buildPlannerSearchParams setzt es ohnehin nicht -- das kam frueher nur ueber syncPlannerStateToUrl
	// in die Adressleiste -- der Delete bleibt als Sicherheitsnetz bestehen).
	const wikiDeeplinkParams = typeof WIKI_DEEPLINK_PARAM_NAMES !== "undefined"
		? WIKI_DEEPLINK_PARAM_NAMES
		: ["siedlung", "staat", "region", "strasse", "fluss"];
	["s", "edit", "debugMap", "serverrouting", "clientrouting", "lang", "place", ...wikiDeeplinkParams].forEach((key) => params.delete(key));
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
			showFeedbackToast(apiErrorMessage(data, "Kurzlink konnte nicht erstellt werden."), "warning");
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

// Kontextmenue-Eintrag "Link teilen" ein-/ausblenden (beim Oeffnen aufgerufen). Der Button im
// Routenplaner wird direkt mit der Reise-Uebersicht gerendert (showRoutePlan), nur wenn eine
// Route existiert -> dort ist keine separate Sichtbarkeitslogik noetig.
function syncShareLinkContextMenuAction() {
	const entry = document.querySelector('[data-context-action="share-map-link"]');
	if (entry) {
		entry.hidden = !hasShareableRoute();
	}
}

// Button (in der Reise-Uebersicht) bzw. delegiert.
$(document).on("click", "#share-link-button", function (event) {
	event.preventDefault();
	void createAndCopyShareLink();
});
