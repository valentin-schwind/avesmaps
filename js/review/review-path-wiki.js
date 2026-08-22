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

// 🔴 EINE Umsetzung, zwei Aufrufer: js/review/review-paths.js:148/224 nennt den Weg beim Namen,
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
		// 🔴 Der dritte Zustand kommt aus dem Kartenpayload: der reicht ALLE Eigenschaften des Features
		// durch (api/app/map-features.php), und `update_path_details` schreibt den Merker seither in
		// genau dieses Feld zurueck (applyPathFeatureResponse mischt die Antwort hinein).
		// ⚠️ Ein WERT, keine Lesefunktion -- anders als der Wegtyp darunter. Das Haekchen wohnt IM
		// Bauteil; ausserhalb gibt es nichts, was sich zwischendurch aendern koennte.
		kein_artikel: pathEditFeature.properties.wiki_no_article === true,
		// 💣 Eine LESEFUNKTION, kein Wert: der Wegtyp steht im Formular gleich ueber dem Kasten und
		// kann sich zwischen `laden` und dem Druck auf „Sync" geaendert haben. Eingefroren boete die
		// Vorschau dann einen Wechsel an, den die Auswahl daneben laengst zeigt.
		feature_subtype: () => pathWikiElement("path-edit-type")?.value
			|| (pathEditFeature && pathEditFeature.properties ? pathEditFeature.properties.feature_subtype : "") || "",
		// 🔴 Die Feldherkunft -- aus demselben Kartenpayload wie der dritte Zustand darueber: der
		// reicht ALLE Eigenschaften durch, und `update_path_details` schreibt sie seit dem
		// 22.08.2026 zurueck. Ohne sie bliebe die Beschriftung fuer immer grau, und das Vorhaekeln
		// der Sync-Vorschau verhielte sich, als haette nie jemand etwas von Hand gesetzt.
		field_origins: pathEditFeature.properties.field_origins || null,
	});
}

// 🔴 WELCHE FELDER SEIT DEM OEFFNEN AUS DEM WIKI KAMEN -- die Merkliste DIESES Dialogs. Der Server
// stempelt daraus die Feldherkunft, und nur fuer Felder, deren Wert sich wirklich aendert.
// 💣 ZWEI OBERFLAECHEN, ZWEI MERKLISTEN, EINE REGEL: der Wege-Editor (js/pages/wege-editor.js)
// fuehrt seine eigene -- anderes Dokument, eigenes `window`, die zwei sehen einander nicht.
let pathWikiUebernommen = new Set();

/** Die Felder, die dieses Speichern als Wiki-Uebernahme nennt -- fuer `buildPathEditPayload`. */
function getPathWikiUebernommenPayload() {
	return Array.from(pathWikiUebernommen);
}

/**
 * ⚠️ Ein frisch geoeffneter Dialog hat nichts uebernommen. Ohne das Leeren truege die Merkliste die
 * Uebernahmen des ZULETZT geoeffneten Weges weiter, und dessen Wegtyp bekaeme beim naechsten
 * Speichern die Herkunft „aus dem Wiki" fuer einen Wert, der nie aus einem Wiki kam.
 */
function resetPathWikiUebernommen() {
	pathWikiUebernommen = new Set();
}

// ---- Der Wiki-Override an der Wegtyp-Zeile ------------------------------------------------------
// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md
//
// 💣 DER WEGTYP TRAEGT EINEN SCHLUESSEL („Reichsstrasse", angezeigt „Reichsstraße"). Ohne die
// Uebersetzung stuende der Join-Key durchgestrichen neben einem Auswahlfeld, das die Beschriftung
// zeigt -- genau der Befund, der beim Ort am 17.08.2026 live sichtbar wurde und sich wie ein
// Tippfehler las. Die Beschriftungen kommen aus dem AUSWAHLFELD SELBST: was dort steht, ist per
// Definition das, was der Editor liest.
function pathWikiZeichneAbweichungen() {
	if (typeof avesmapsWikiFeldStand !== "function" || typeof avesmapsWikiAssignSubject !== "function") {
		return;
	}
	if (!pathEditFeature || !pathEditFeature.properties) {
		return;
	}
	const select = pathWikiElement("path-edit-type");
	const beschriftungen = {};
	Array.from((select && select.options) || []).forEach((option) => {
		beschriftungen[option.value] = option.textContent || option.value;
	});
	const stand = avesmapsWikiFeldStand(
		(avesmapsWikiAssignSubject("weg") || {}).felder || [],
		{ feature_subtype: String(select?.value || pathEditFeature.properties.feature_subtype || "") },
		avesmapsWikiAssignWegWerte(pathWikiCurrentAssignment()),
		avesmapsWikiAssignWegHerkunft(pathEditFeature.properties.field_origins),
		{ feature_subtype: beschriftungen }
	);
	document.querySelectorAll("#path-edit-overlay [data-path-wiki-alt]").forEach((zelle) => {
		const feld = zelle.getAttribute("data-path-wiki-alt") || "";
		const s = stand[feld];
		zelle.replaceChildren();
		const vonUns = Boolean(s && s.abweicht && s.herkunft === "manual");
		// Die Hervorhebung sitzt an der BESCHRIFTUNG, nicht an der Zelle. Als Klasse gesetzt statt
		// per `:has()`: jene Elternauswahl faellt bei fehlender Browserfaehigkeit LAUTLOS aus, und
		// die Zeile saehe dann aus wie eine mit unbekannter Herkunft -- also wie der andere Zustand.
		zelle.parentElement?.classList.toggle("has-wiki-ovr", vonUns);
		if (!s || !s.abweicht) {
			return;
		}
		const alt = document.createElement("span");
		alt.className = "dt-old";
		alt.textContent = s.wikiAnzeige;
		alt.title = (vonUns ? "Von uns gesetzt. " : "Weicht vom Wiki ab. ") + "Wiki-Stand: " + s.wikiAnzeige;
		const knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "dt-reset";
		knopf.textContent = "↺";
		knopf.title = "Auf Wiki-Stand zurücksetzen";
		// ⚠️ Der Knopf sitzt IN einem `<label>`: ohne diesen Riegel reichte der Klick an das Feld
		// durch und fokussierte es, waehrend sich sein Wert aendert.
		knopf.addEventListener("click", (ereignis) => {
			ereignis.preventDefault();
			ereignis.stopPropagation();
			pathWikiFeldZuruecksetzen(s.wikiWert);
		});
		zelle.append(alt, knopf);
	});
}

/**
 * ↺ an der Wegtyp-Zeile: genau diesen einen Wert aus dem Wiki ins Formular holen.
 * ⭐ ES IST DIE SYNC-UEBERNAHME EINER EINZIGEN ZEILE -- derselbe Weg, dieselbe Merkliste, kein
 * zweiter Schreibpfad. Geschrieben wird mit „Speichern".
 */
function pathWikiFeldZuruecksetzen(wikiWert) {
	const select = pathWikiElement("path-edit-type");
	// 💣 Nur, wenn die Auswahl den Schluessel kennt -- dieselbe zweite Haelfte des Riegels wie in
	// pathWikiSyncUebernehmen.
	if (!select || !Array.from(select.options).some((option) => option.value === wikiWert)) {
		return;
	}
	select.value = wikiWert;
	pathWikiUebernommen.add("feature_subtype");
	// Der Wegtyp entscheidet, welche Transportmittel angeboten werden -- die Weiche haengt am
	// `change`-Ereignis, also wird es echt ausgeloest (wortgleich zu pathWikiSyncUebernehmen).
	select.dispatchEvent(new Event("change", { bubbles: true }));
	pathWikiZeichneAbweichungen();
	if (typeof setPathEditStatus === "function") {
		setPathEditStatus("Aus dem Wiki übernommen — noch nicht gespeichert.");
	}
}

// 🔴 HIER STANDEN pathWikiKeinArtikelFuerPayload UND pathWikiKeinArtikelGeaendert -- beide gefallen
// am 16.08.2026 mit dem Haekchen „Kein Wiki-Artikel vorhanden“ (Owner-Entscheid, vier Oberflaechen).
// Sie waren AUSSCHLIESSLICH sein Zubehoer: die eine hob seinen Stand fuer buildPathEditPayload ab,
// die andere meldete „noch nicht gespeichert“, wenn jemand es anklickte.
// 💣 DAMIT SCHICKT DER KARTENDIALOG `wiki_no_article` GAR NICHT MEHR, und das ist die sichere Seite,
// nicht die nachlaessige: avesmapsApplyPathWikiNoArticle (api/_internal/map/features.php) liest
// einen FEHLENDEN Schluessel als „nicht geaendert“ und laesst den gespeicherten Merker in Ruhe --
// die Entscheidung des Konfliktzentrums ueberlebt jedes Speichern aus diesem Dialog.
// ⚠️ Und sie geht auch nicht andersherum verloren: JEDER Zuweiser des Wegs loescht den Merker beim
// Zuweisen (serverseitig, in `assign_to` -- gezaehlt in weg-wiki-no-article-test.php, nicht
// aufgezaehlt). Ein Weg mit Artikel UND Merker ist von hier aus unerreichbar.

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
	// 🔴 DERSELBE VERTRAG WIE BEI `zuweisen` UND `loesen`: wer nichts tun konnte, LEHNT AB. Ein
	// stilles Auflösen hiesse fuer das Bauteil „uebernommen", es schloesse die Vorschau, und der
	// Editor haette den Eindruck, sein Haken sei ins Formular gewandert. Praktisch unerreichbar
	// (der Knopf ist ohne Haken ausgegraut, und der Wegtyp steht in beiden Oberflaechen als
	// `<option>` bereit) -- aber ein Vertrag, der nur an zwei von drei Stellen gilt, ist die
	// Fehlerklasse aus AGENTS.md §11 („eine Regel, die einen von vier Erzeugern bindet").
	const wegtyp = avesmapsWikiAssignWegSyncWegtyp(zeilen);
	if (wegtyp === null) {
		throw new Error("Keine übernehmbare Angabe angehakt.");
	}
	const select = pathWikiElement("path-edit-type");
	if (!select || !Array.from(select.options).some((option) => option.value === wegtyp)) {
		throw new Error("Der Wegtyp „" + wegtyp + "“ steht in der Auswahl nicht zur Verfügung.");
	}
	select.value = wegtyp;
	// 🔴 ZWEITE HAELFTE DER UEBERNAHME: merken, WELCHES Feld aus dem Wiki kam. Ohne sie stempelt der
	// Server es als „von uns", und der naechste Abgleich liesse genau dieses Feld in Ruhe.
	pathWikiUebernommen.add("feature_subtype");
	// Der Wegtyp entscheidet, welche Transportmittel ueberhaupt angeboten werden -- die Weiche
	// haengt am `change`-Ereignis (js/app/bootstrap.js), also wird es echt ausgeloest.
	select.dispatchEvent(new Event("change", { bubbles: true }));
	pathWikiZeichneAbweichungen();
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
	// ⚠️ NACH dem Mounten: der Kasten und die Feldzeile darueber sollen denselben Stand zeigen.
	// Das Bauteil ruft `laden` selbst, aber sein Ergebnis erreicht diesen Zeichner nicht -- er liest
	// die Zuweisung direkt aus `pathEditFeature`.
	pathWikiZeichneAbweichungen();
}

// 🔴 WAEHLEN IM FORMULAR AENDERT DIE ABWEICHUNG. Ohne diesen Zuhoerer bliebe ein durchgestrichener
// Wiki-Stand samt ↺ stehen, nachdem der Editor den Wegtyp von Hand an das Wiki angeglichen hat --
// ein Rueckholangebot fuer etwas, das gar nicht mehr abweicht.
// ⚠️ EINMAL, nicht bei jedem Oeffnen: das Auswahlfeld steht fest in index.html, und
// `renderPathWikiReference` laeuft bei jedem Dialogaufruf -- dort verdrahtet, haetten sich die
// Zuhoerer gestapelt.
function verdrahtePathWikiZeichner() {
	pathWikiElement("path-edit-type")?.addEventListener("change", pathWikiZeichneAbweichungen);
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", verdrahtePathWikiZeichner, { once: true });
	} else {
		verdrahtePathWikiZeichner();
	}
}

window.renderPathWikiReference = renderPathWikiReference;
window.getPathWikiUebernommenPayload = getPathWikiUebernommenPayload;
window.resetPathWikiUebernommen = resetPathWikiUebernommen;
