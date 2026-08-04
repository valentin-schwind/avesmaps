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
//
// 💣 JE EBENE, nicht einer für alle. Mit einem gemeinsamen Zähler verwarfen sich drei parallele
// Aufrufe gegenseitig: jeder zieht seine Marke SYNCHRON, bevor irgendeine Antwort da ist, also gewann
// immer nur der letzte und die beiden anderen Ebenen blieben ungeladen. Das war unsichtbar, solange
// nur die aktive Ebene geladen wurde -- seit Filter, Klon und Trägerzeile alle drei brauchen, fiel
// genau daran die Wiki-Vererbung des Klons aus (gefunden vom Prüf-Agenten, 2026-07-28).
const ecosystemRegionRequestTokens = {};
// Steigt bei JEDER Änderung am Bestand. Wer daraus etwas ableitet (siehe ecosystemPrimaryLabelRegionMap),
// merkt sich das Ergebnis gegen diesen Zähler statt es je Aufruf neu zu bauen.
let ecosystemRegionCacheStamp = 0;

// ---- die Klammer um eine Geste (Owner 2026-07-29) --------------------------------------------------
//
// 💣 Eine boolesche Operation ist NICHT ein Schreibvorgang: „Verschmelzen" ist update_area_geometry auf
// der einen Fläche PLUS delete_area auf der gefressenen, „Zerschneiden" sind sogar drei Aufrufe. Damit
// „Rückgängig" die Geste zurücknimmt und nicht nur ihre letzte Zeile, tragen alle Aufrufe einer Geste
// dieselbe Kennung. Der Server stempelt sie in jede Audit-Zeile und nimmt später die ganze Klammer.
//
// 🔴 Der CLIENT vergibt sie, weil nur er weiß, dass zwei Anfragen dieselbe Absicht sind. Der Server
// sieht zwei unabhängige Aufrufe.
//
// ⭐ Als Umschließung und nicht als Parameter: So erbt JEDER Schreibvorgang innerhalb der Geste die
// Klammer, auch die, an die beim Bauen niemand gedacht hat -- etwa das create_region, das „Zerschneiden"
// nebenbei auslöst. Ein vergessener Parameter wäre genau die Zeile, die ein Rückgängig stehen lässt.
let ecosystemCurrentOperation = null;

async function withEcosystemOperation(label, run) {
	// Verschachtelt heißt: dieselbe Geste. Eine innere Klammer würde die äußere zerreißen.
	if (ecosystemCurrentOperation) {
		return await run();
	}

	const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : "";
	// Ohne Kennung läuft alles wie bisher weiter: jede Zeile ist dann ihre eigene Gruppe. Lieber
	// einzeln zurücknehmbar als gar nicht geschrieben.
	ecosystemCurrentOperation = id ? { id, label: String(label || "") } : null;
	try {
		return await run();
	} finally {
		ecosystemCurrentOperation = null;
	}
}

// Was die laufende Geste an jede Nutzlast hängt -- leer, wenn keine läuft. Eigene Funktion und nicht
// inline im fetch-Aufruf, damit sich genau diese Frage prüfen lässt, ohne einen erreichbaren Endpunkt
// zu brauchen (lokal ist ECOSYSTEM_EDIT_API_URL leer, und es ist ein const).
function ecosystemOperationPayload() {
	if (!ecosystemCurrentOperation) {
		return {};
	}

	return { operation_id: ecosystemCurrentOperation.id, operation_label: ecosystemCurrentOperation.label };
}

async function postEcosystemEdit(action, payload = {}) {
	if (!ECOSYSTEM_EDIT_API_URL) {
		throw new Error("Der Landschaften-Editor ist auf diesem Host nicht erreichbar.");
	}

	const response = await fetch(ECOSYSTEM_EDIT_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({
			action,
			...payload,
			// Läuft gerade eine Geste, reist ihre Klammer an JEDEM Aufruf mit -- ohne dass eine
			// Aufrufstelle sie kennen muss.
			...ecosystemOperationPayload(),
		}),
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

	const requestToken = (ecosystemRegionRequestTokens[kind] = (ecosystemRegionRequestTokens[kind] || 0) + 1);
	try {
		const result = await postEcosystemEdit("list_regions", { kind });
		if (requestToken !== ecosystemRegionRequestTokens[kind]) {
			return;
		}
		ecosystemRegionsByKind[kind] = Array.isArray(result.regions) ? result.regions : [];
		ecosystemRegionTypesByKind[kind] = Array.isArray(result.region_types) ? result.region_types : [];
		ecosystemRegionCacheStamp += 1;
	} catch (error) {
		if (requestToken !== ecosystemRegionRequestTokens[kind]) {
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
	// 🔴 DER EINE ENGPASS zum fähigkeitsgeschützten Endpunkt. Seit die Ebene jedem Besucher offensteht
	// (2026-08-04), liefe sie sonst bei jedem Moduswechsel gegen `list_regions` und bekäme ein 403 --
	// einmal je Besucher, in der Konsole, ohne dass irgendetwas davon besser würde. Der Riegel sitzt
	// hier und nicht an den drei Aufrufstellen: die vierte hätte ihn vergessen.
	if (typeof canOperateEcosystemLayers === "function" && !canOperateEcosystemLayers()) {
		return;
	}
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
let ecosystemLabelIdCache = new Map();

// Label-ID -> Region, aus der Sicht der REGION (ihr primaeres Label). Die andere Richtung -- das Label
// nennt seine Region selbst -- steht am Label und wird in ecosystemRegionOfLabel() dazugelesen.
function ecosystemPrimaryLabelRegionMap() {
	if (ecosystemLabelIdCacheStamp === ecosystemRegionCacheStamp) {
		return ecosystemLabelIdCache;
	}
	const byLabel = new Map();
	Object.keys(ecosystemRegionsByKind || {}).forEach((kind) => {
		(ecosystemRegionsByKind[kind] || []).forEach((region) => {
			const labelPublicId = String(region.label_public_id || "");
			if (labelPublicId !== "") {
				byLabel.set(labelPublicId, region);
			}
		});
	});
	ecosystemLabelIdCache = byLabel;
	ecosystemLabelIdCacheStamp = ecosystemRegionCacheStamp;

	return byLabel;
}

// Die Region eines Labels, aus BEIDEN Richtungen. Der Zeiger am Label ist die kuenftige Wahrheit; der
// Zeiger an der Region deckt die ~124 Bestandslabels ab, die ihn noch nicht tragen. Kein zweites
// System, sondern zwei Rollen derselben Beziehung: "wer gehoert zu mir" und "wer fuehrt mich".
function ecosystemRegionOfLabel(label) {
	const eigener = String(label?.ecosystemRegionPublicId || "");
	if (eigener !== "") {
		const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [];
		let treffer = null;
		kinds.forEach((kind) => {
			(ecosystemRegionsByKind[kind] || []).forEach((region) => {
				if (String(region.public_id || "") === eigener) {
					treffer = region;
				}
			});
		});
		// Auch ohne geladene Regionsliste gilt die Zugehoerigkeit -- dann eben ohne Namen und Flaechenzahl.
		return treffer || { public_id: eigener };
	}

	return ecosystemPrimaryLabelRegionMap().get(String(label?.publicId || "")) || null;
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
