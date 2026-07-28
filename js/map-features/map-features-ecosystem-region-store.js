// Landschaften -- der Schreibkanal und der Regionen-/Art-Bestand.
//
// 🔴 WAS HIER EINMAL STAND UND WARUM ES WEG IST. Diese Datei hiess bis zum 2026-07-27
// `map-features-ecosystem-region-picker.js` und trug den Wähler „Aktive Region" über der Karte: vor
// dem Zeichnen musste feststehen, in WELCHE Region die neue Fläche geht (V3.0b). Das war eine Falle.
// Der Name sitzt auf der REGION, eine Region trägt viele Flächen -- wer den Wähler übersah, hängte
// seinen frischen Wald an die zuletzt gewählte Region und bekam ihn nicht wieder los, weil ein
// Umbenennen dann alle ihre Flächen traf.
//
// Der Weg ist jetzt der von Territorien und Siedlungen: Rechtsklick -> „Neue Vegetation" usw.,
// zeichnen, und beim Schliessen des Polygons entsteht eine EIGENE Region (map-features-ecosystem-draw.js);
// den Steckbrief fragt danach der Eigenschaften-Dialog ab. Damit gibt es keinen Vorher-Zustand mehr,
// den man falsch stehen lassen kann.
//
// Geblieben ist, was mit dem Wähler nie etwas zu tun hatte und überall gebraucht wird: der eine
// Schreibkanal zum Endpunkt und der Bestand an Regionen und Arten, aus dem die Dialoge ihre
// Art-Auswahl füllen.
//
// 🔴 Die Regionsliste kommt aus api/edit/map/ecosystem.php (Aktion list_regions), hinter der
// `edit`-Berechtigung -- NICHT aus dem öffentlichen Lesepfad und NICHT aus der politischen Ebene
// (Hauptplan, Regel 1).

// kind -> Regionen / Arten, wie list_regions sie zuletzt geliefert hat. null = nie geladen.
let ecosystemRegionsByKind = {};
let ecosystemRegionTypesByKind = {};
// Monoton, gleicher Grund wie beim Flächenlader: eine langsame Antwort für eine Ebene, die der Editor
// längst verlassen hat, darf den Bestand nicht überschreiben.
let ecosystemRegionRequestToken = 0;
// Steigt bei JEDER Änderung am Bestand. Wer daraus etwas ableitet (siehe ecosystemLabelIdsWithRegion),
// merkt sich das Ergebnis gegen diesen Zähler statt es je Aufruf neu zu bauen.
let ecosystemRegionCacheStamp = 0;

async function postEcosystemEdit(action, payload = {}) {
	if (!ECOSYSTEM_EDIT_API_URL) {
		throw new Error("Der Landschaften-Editor ist auf diesem Host nicht erreichbar.");
	}

	const response = await fetch(ECOSYSTEM_EDIT_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ action, ...payload }),
	});
	const result = await readJsonResponse(response, null);

	if (!response.ok || result?.ok !== true) {
		const error = new Error(apiErrorMessage(result, `${action} fehlgeschlagen (${response.status}).`));
		// V3.3 braucht EINEN Fehlschlag getrennt von allen anderen: `conflict` (HTTP 409) heisst, dass
		// jemand anderes diese Fläche verschoben hat -- dann ist die lokale Kopie wertlos und nur der
		// Lesepfad kann es klären. Ohne den Code am Fehler müsste der Aufrufer den deutschen Text prüfen.
		error.code = String(result?.error?.code || "");
		error.status = response.status;
		throw error;
	}

	return result;
}

async function loadEcosystemRegions(kind, { force = false } = {}) {
	if (!isKnownEcosystemKind(kind) || (!force && Array.isArray(ecosystemRegionsByKind[kind]))) {
		return;
	}

	const requestToken = (ecosystemRegionRequestToken += 1);
	try {
		const result = await postEcosystemEdit("list_regions", { kind });
		if (requestToken !== ecosystemRegionRequestToken) {
			return;
		}
		ecosystemRegionsByKind[kind] = Array.isArray(result.regions) ? result.regions : [];
		ecosystemRegionTypesByKind[kind] = Array.isArray(result.region_types) ? result.region_types : [];
		ecosystemRegionCacheStamp += 1;
	} catch (error) {
		if (requestToken !== ecosystemRegionRequestToken) {
			return;
		}
		// Eine LEERE Liste, keine fehlende: sonst warten die Dialoge ewig auf ein Art-Vokabular, das nie
		// kommt. Der wahre Grund steht in der Konsole.
		ecosystemRegionsByKind[kind] = [];
		ecosystemRegionTypesByKind[kind] = [];
		ecosystemRegionCacheStamp += 1;
		console.warn("Landschafts-Regionen konnten nicht geladen werden:", error);
	}
}

// Jeder Schreibvorgang erhöht ecosystem_revision. Danach sind die gemerkten Regionszeilen veraltet --
// vor allem ihre Flächenzahlen, die der Eigenschaften-Dialog anzeigt. ALLE Ebenen fallen, nicht nur die
// aktive: ein Wechsel darf keinen Stand von vor dem Schreiben zurückgeben.
function invalidateEcosystemRegionCache() {
	ecosystemRegionsByKind = {};
	ecosystemRegionTypesByKind = {};
	ecosystemRegionCacheStamp += 1;
	void loadEcosystemRegions(getActiveEcosystemLayerKind(), { force: true });
	// 💣 Der Filter „nur Labels mit Region" liest ALLE drei Ebenen, hier nachgeladen wird aber nur die
	// aktive. Wäre er an, verschwänden die Beschriftungen der beiden anderen Ebenen nach jedem
	// Schreibvorgang — nicht weil sie keine Region hätten, sondern weil deren Liste gerade leer ist.
	if (typeof isLabelsWithRegionFilterActive === "function" && isLabelsWithRegionFilterActive()) {
		void ensureEcosystemRegionsLoadedForLabelFilter();
	}
}

// Beim Betreten des Modus und bei jedem Ebenenwechsel gerufen. `refresh` nur beim BETRETEN: die
// Flächenzahlen veralten, sobald gezeichnet wird -- aber den Segmentschalter betätigt ein Editor
// ständig, und das darf nicht jedes Mal eine Abfrage auf STRATO auslösen.
function syncEcosystemRegionCache({ refresh = false } = {}) {
	void loadEcosystemRegions(getActiveEcosystemLayerKind(), { force: refresh });
}

// ---- „nur Labels mit Region" ------------------------------------------------------------------------
//
// 🔴 Welche Beschriftungen hängen an einer Landschaftsfläche? Die Antwort steht in den REGIONEN
// (`label_public_id`), nicht in den geladenen Flächen: `ecosystemLayers` hält nur, was gerade im Bild
// ist. Eine Region halb ausserhalb des Ausschnitts zählte sonst als „ohne Label", und ihr Name
// verschwände beim Wegscrollen — ein Filter, der beim Verschieben der Karte sein Ergebnis ändert, ist
// schlimmer als keiner.
//
// Deshalb ALLE drei Ebenen und nicht nur die aktive: der Filter sitzt in der allgemeinen Kartenanzeige
// und wirkt auch ausserhalb des Landschaftsmodus.
// 💣 GEMERKT, nicht je Aufruf gebaut. shouldShowLabelMarker läuft für JEDE der ~590 Beschriftungen bei
// jedem Zoom und jedem Verschieben; ein Set über 133 Regionen pro Label wären ~78 000 Durchläufe je
// Bildwechsel. Der Zähler steigt überall dort, wo der Regionen-Zwischenspeicher sich ändert.
let ecosystemLabelIdCacheStamp = -1;
let ecosystemLabelIdCache = new Set();

function ecosystemLabelIdsWithRegion() {
	if (ecosystemLabelIdCacheStamp === ecosystemRegionCacheStamp) {
		return ecosystemLabelIdCache;
	}
	const ids = new Set();
	Object.keys(ecosystemRegionsByKind || {}).forEach((kind) => {
		(ecosystemRegionsByKind[kind] || []).forEach((region) => {
			const labelPublicId = String(region.label_public_id || "");
			if (labelPublicId !== "") {
				ids.add(labelPublicId);
			}
		});
	});
	ecosystemLabelIdCache = ids;
	ecosystemLabelIdCacheStamp = ecosystemRegionCacheStamp;

	return ids;
}

// Beim Einschalten des Hakens: was noch nicht im Zwischenspeicher liegt, nachladen und danach EINMAL neu
// zeichnen. Ohne das wäre der erste Klick wirkungslos, solange nur eine Ebene geladen ist.
async function ensureEcosystemRegionsLoadedForLabelFilter() {
	const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : ["derographisch", "vegetation", "topographie"];
	await Promise.all(kinds.map((kind) => loadEcosystemRegions(kind)));
	if (typeof syncLabelVisibility === "function") {
		syncLabelVisibility();
	}
}
