// Die Wiki-Zuweisung des Wegs im KARTENDIALOG („Weg bearbeiten"). Seit dem 16.08.2026 zeichnet und
// bedient sie das gemeinsame Bauteil (js/ui/wiki-assign.js, Huelle „label-wiki"); diese Datei
// steuert nur noch den DATENWEG bei -- Stand lesen, zuweisen, loesen, Sync ins Formular.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Zwilling: js/pages/wege-editor.js (dieselbe Zuweisung im Editorfenster, Huelle „dt"). Was BEIDE
// brauchen, steht in js/ui/wiki-assign-weg.js -- die zwei laufen in verschiedenen Dokumenten und
// koennen keine Funktion voneinander sehen.
//
// 🔴 DER SCHREIBWEG REICHT WEITER ALS DAS GEWAEHLTE SEGMENT, und das ist kein Nebeneffekt, sondern
// die Sache selbst: `assign_to` erfasst jedes aktive Wegstueck, dessen Name denselben Match-Key
// traegt wie das gewaehlte (api/_internal/wiki/paths.php:1050), und schreibt ihnen allen den
// kanonischen Wiki-Namen. „Entfernen" reicht noch weiter (Namens-Key UNION wiki_key) und fragt
// deshalb vorher zurueck.

const PATH_WIKI_API_URL = "/api/edit/wiki/paths.php";

// Die eine Steuerung des Bauteils. 🔴 Vor jedem Neuaufbau abgeraeumt: der Dialog dient nacheinander
// verschiedenen Wegen, und ein liegengebliebener Zuhoerer schriebe auf den vorigen.
let pathWikiAssign = null;

function pathWikiElement(id) {
	return document.getElementById(id);
}
function pathWikiPost(body) {
	return fetch(PATH_WIKI_API_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
}

function pathWikiCurrentFeaturePublicId() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return "";
	}
	return (pathEditFeature.properties && pathEditFeature.properties.public_id) || pathEditFeature.id || "";
}

function pathWikiCurrentAssignment() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		return null;
	}
	const wiki = pathEditFeature.properties.wiki_path;
	return wiki && wiki.wiki_key ? wiki : null;
}

// 🔴 EINE Umsetzung, zwei Aufrufer: js/review/review-paths.js:142/218 nennt den Weg beim Namen,
// den der SERVER ihm gibt. Die Rechnung selbst steht seit dem 16.08.2026 in
// js/ui/wiki-assign-weg.js, weil sie auch das Editorfenster braucht -- hier bleibt nur der Name,
// unter dem die zwei Aufrufer sie kennen.
function pathWikiCanonicalName(wiki) {
	return avesmapsWikiAssignWegKanonischerName(wiki);
}

// Applies the segments_updated payload of assign_to/clear_assign to the local pathData:
// fresh revision (the 409 fix -- expected_revision must match the server again), the
// R1/R2 name, and the wiki_path object. show_label is deliberately untouched (R3).
function applyWikiPathSegmentsUpdate(segmentsUpdated) {
	if (!Array.isArray(segmentsUpdated) || typeof findPathByPublicId !== "function") {
		return;
	}
	segmentsUpdated.forEach((segment) => {
		const path = findPathByPublicId(String(segment?.public_id || ""));
		if (!path || !path.properties) {
			return;
		}
		path.properties.revision = segment.revision;
		path.properties.name = segment.name;
		path.properties.display_name = segment.display_name;
		path.properties.original_name = segment.display_name;
		if (segment.wiki_path) {
			path.properties.wiki_path = segment.wiki_path;
		} else {
			delete path.properties.wiki_path;
		}
		if ("flow" in segment) {
			if (segment.flow) {
				path.properties.flow = segment.flow;
			} else {
				delete path.properties.flow;
			}
		}
		if (typeof refreshPathLayerPopup === "function") {
			refreshPathLayerPopup(path);
		}
	});
	if (segmentsUpdated.length && typeof syncPathLabels === "function") {
		syncPathLabels();
	}
}

/**
 * 🔴 WIRFT, WENN KEIN WEG IM DIALOG STEHT -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
 * Ein `laden`, das im Fehlerfall etwas Leeres AUFLOEST, ist vom Zustand „nichts zugewiesen" nicht
 * zu unterscheiden; das Bauteil haelte sich fuer geladen, und der Schreibweg des Wegs trifft ALLE
 * gleichnamigen Segmente zugleich.
 *
 * ⚠️ Hier laeuft kein HTTP: die Zuweisung steht im bereits geladenen Feature. Der Fehlerfall ist
 * deshalb „gar kein Feature", und der wird genauso behandelt.
 */
function pathWikiZustand() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		throw new Error("Kein Weg im Dialog.");
	}
	return avesmapsWikiAssignWegZustand({
		wiki_path: pathWikiCurrentAssignment(),
		// 💣 Eine LESEFUNKTION, kein Wert: der Wegtyp steht im Formular gleich ueber dem Kasten und
		// kann sich zwischen `laden` und dem Druck auf „Sync" geaendert haben. Eingefroren boete die
		// Vorschau dann einen Wechsel an, den die Auswahl daneben laengst zeigt.
		feature_subtype: () => pathWikiElement("path-edit-type")?.value
			|| (pathEditFeature && pathEditFeature.properties ? pathEditFeature.properties.feature_subtype : "") || "",
	});
}

// Was neben dem Zuweisungskasten am Zustand haengt: der Quellen-Abschnitt („Andere Quelle" gibt es
// nur ohne Wiki-Weg), die Namenssperre (R1) und die Zeile „Weg anzeigen" (Way-Labels beschriften
// zugewiesene Wege selbst).
function pathWikiSyncNachbarn() {
	const hasWikiPath = Boolean(pathWikiCurrentAssignment());
	if (typeof toggleOtherSourceSection === "function") {
		toggleOtherSourceSection("path-edit", hasWikiPath);
	}
	const showLabelField = pathWikiElement("path-edit-show-label")?.closest("label");
	if (showLabelField) {
		showLabelField.hidden = hasWikiPath;
	}
	if (typeof syncPathAutoNameControls === "function") {
		syncPathAutoNameControls();
	}
}

async function pathWikiZuweisen(treffer) {
	const publicId = pathWikiCurrentFeaturePublicId();
	if (!publicId) {
		showFeedbackToast?.("Kein Weg ausgewählt.", "error");
		throw new Error("Kein Weg ausgewählt.");
	}
	let result;
	try {
		result = await pathWikiPost(avesmapsWikiAssignWegZuweisungsKoerper(treffer.wiki_key, publicId));
		// 🔴 Wirft bei jedem Nein -- auch bei `type_ok:false`, das mit HTTP 200 kommt.
		avesmapsWikiAssignWegAntwortPruefen(result);
	} catch (error) {
		showFeedbackToast?.("Zuweisen fehlgeschlagen: " + (error.message || error), "error");
		// 💣 Weiterwerfen, NICHT schlucken: das Bauteil malt sonst eine Zuweisung, die es auf dem
		// Server nicht gibt, und beim naechsten Oeffnen des Dialogs ist sie spurlos weg.
		throw error;
	}
	applyWikiPathSegmentsUpdate(result.segments_updated);
	if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
		// Rueckfall fuer einen alten Server ohne segments_updated: wenigstens das oertliche Nest.
		pathEditFeature.properties.wiki_path = treffer.roh || null;
	}
	showFeedbackToast?.(`„${result.wiki_name}" verknüpft (${result.applied} Abschnitte).`, "success");
	pathWikiSyncNachbarn();
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
}

async function pathWikiLoesen() {
	const publicId = pathWikiCurrentFeaturePublicId();
	if (!publicId) {
		throw new Error("Kein Weg ausgewählt.");
	}
	// Owner rule (2026-07-05): Entfernen must NEVER strip the whole way unasked. Probe the
	// blast radius first; with more than one segment the default answer is the surgical
	// single-segment clear, and the way-wide clear needs its own explicit confirmation.
	const preview = await pathWikiPost({ action: "clear_assign", public_id: publicId, dry_run: true });
	if (!preview || preview.ok !== true) {
		const text = apiErrorMessage(preview, "Entfernen fehlgeschlagen");
		showFeedbackToast?.("Fehler: " + text, "error");
		throw new Error(text);
	}
	const segmentCount = Number(preview.segments || 0);
	let singleSegment = false;
	if (segmentCount > 1) {
		if (window.confirm(`Die Wiki-Zuordnung „${preview.name || ""}" hängt an ${segmentCount} Segmenten dieses Wegs.\n\nOK = NUR dieses eine Segment lösen (empfohlen)\nAbbrechen = weitere Optionen`)) {
			singleSegment = true;
		} else if (!window.confirm(`Stattdessen den GANZEN Weg entkoppeln?\n\nAlle ${segmentCount} Segmente verlieren die Wiki-Zuordnung und bekommen je einen eigenen generischen Namen.`)) {
			// 🔴 ABGEBROCHEN IST ABGELEHNT. Aufloesen hiesse fuer das Bauteil „geloest" -- der Kasten
			// zeigte „— keine —", waehrend auf dem Server alles unveraendert steht.
			throw new Error("Abgebrochen.");
		}
	}
	let result;
	try {
		result = await pathWikiPost({ action: "clear_assign", public_id: publicId, single_segment: singleSegment, dry_run: false, confirm: "apply" });
		avesmapsWikiAssignWegAntwortPruefen(result);
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
		throw error;
	}
	applyWikiPathSegmentsUpdate(result.segments_updated);
	if (pathEditFeature && pathEditFeature.properties && !Array.isArray(result.segments_updated)) {
		delete pathEditFeature.properties.wiki_path;
	}
	pathWikiSyncNachbarn();
	if (typeof renderPathFlowSection === "function") {
		renderPathFlowSection();
	}
	const nameInput = pathWikiElement("path-edit-name");
	if (nameInput && result.generic_name) {
		nameInput.value = result.generic_name;
	}
	showFeedbackToast?.(singleSegment
		? (result.generic_name ? `Segment vom Weg gelöst (heißt jetzt „${result.generic_name}") — der übrige Weg bleibt verknüpft.` : "Segment vom Weg gelöst — der übrige Weg bleibt verknüpft.")
		: (result.generic_name ? `Wiki-Zuordnung entfernt — Segmente wieder einzeln benannt (dieses: „${result.generic_name}").` : "Wiki-Zuordnung entfernt."), "info");
}

/**
 * ⚠️ ÜBERNEHMEN FÜLLT NUR DAS FORMULAR (Entwurf §6) -- gespeichert wird mit „Speichern". Der
 * Vorgaenger dieses Wegs war der Knopf „↻" neben der Wegtyp-Auswahl (syncPathTypeFromWiki): er
 * schrieb den geratenen Typ ohne Vorschau und ohne Haken hinein und ist mit dem Umbau entfallen.
 */
function pathWikiSyncUebernehmen(zeilen) {
	const wegtyp = avesmapsWikiAssignWegSyncWegtyp(zeilen);
	if (wegtyp === null) {
		return;
	}
	const select = pathWikiElement("path-edit-type");
	if (!select || !Array.from(select.options).some((option) => option.value === wegtyp)) {
		return;
	}
	select.value = wegtyp;
	// Der Wegtyp entscheidet, welche Transportmittel ueberhaupt angeboten werden -- die Weiche
	// haengt am `change`-Ereignis (js/app/bootstrap.js), also wird es echt ausgeloest.
	select.dispatchEvent(new Event("change", { bubbles: true }));
	if (typeof setPathEditStatus === "function") {
		setPathEditStatus("Aus dem Wiki übernommen — noch nicht gespeichert.");
	}
}

/**
 * Baut den Zuweisungskasten neu auf. Heisst weiter `renderPathWikiReference`, weil review-paths.js
 * genau diesen Namen ruft, wenn der Dialog einen Weg bekommt.
 */
function renderPathWikiReference() {
	const host = pathWikiElement("path-wiki-assign-host");
	if (!host) {
		return;
	}
	if (pathWikiAssign) {
		pathWikiAssign.zerstoeren();
		pathWikiAssign = null;
	}
	pathWikiSyncNachbarn();
	pathWikiAssign = avesmapsWikiAssignMount(host, {
		subject: "weg",
		skin: "label-wiki",
		laden: pathWikiZustand,
		// Die Suche antwortet mit FLACHEN Zeilen; erst hier entsteht daraus ein Treffer samt der
		// Abbildung Wiki-Art -> Wegtyp-Schluessel (js/ui/wiki-assign-weg.js).
		trefferAufbereiten: avesmapsWikiAssignWegTreffer,
		zuweisen: pathWikiZuweisen,
		loesen: pathWikiLoesen,
		syncUebernehmen: pathWikiSyncUebernehmen,
	});
}

window.renderPathWikiReference = renderPathWikiReference;
