// Stroemungs-Sektion im "Weg bearbeiten"-Dialog (Flussrichtung spec §6): zeigt den
// Richtungsstatus des angeklickten Fluss-Segments, dreht/setzt die Richtung WEG-WEIT
// (set_flow: flip | set_dir; set_dir vervollstaendigt teilgerichtete Wege anker-konsistent,
// Anker bleiben unangetastet) und pflegt den weg-weiten Stroemungsfaktor (Clamp 1,0-3,0).
// Nur fuer Flussweg-Segmente sichtbar. Writes: dry_run:false + confirm:"apply" (weg-weit
// ist hier das DESIGN, kein Blast-Radius-Dialog wie beim Entfernen noetig).
//
// 🔴 UND SEIT DEM 05.10.2026 GEHT ES AUCH JE ABSCHNITT (Meldung #7996, Thomas, Grosser Fluss --
// Delta; Entwurf docs/superpowers/specs/2026-10-05-flussrichtung-je-abschnitt-design.md).
// `set_dir` richtet ausschliesslich die HAUPTKETTE, und ein Delta besteht fast nur aus
// Abschnitten daneben: am Grossen Fluss waren 24 von 79 ohne Richtung, 22 davon Abzweigungen,
// und KEINER lag auf der Kette. Ob ein Arm an einer Verzweigung zu- oder abfliesst, ist
// geometrisch nicht entscheidbar -- also entscheidet es ein Mensch, Abschnitt fuer Abschnitt
// (`#path-flow-segment`: `dir` setzt, `flip` + `scope:"segment"` dreht).
// ⚠️ Der Popup-Shortcut darunter bleibt WAY-WEIT und zweizustaendig -- der Einzelgriff gehoert
// ins Detailpanel, wie schon das Vervollstaendigen (Anker-Entwurf 2026-07-06).

function pathFlowElement(id) {
	return document.getElementById(id);
}

function pathFlowCurrentFlow() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature || !pathEditFeature.properties) {
		return null;
	}
	return pathEditFeature.properties.flow || null;
}

function pathFlowIsRiverSegment() {
	if (typeof pathEditFeature === "undefined" || !pathEditFeature) {
		return false;
	}
	return normalizePathSubtype(pathEditFeature.properties?.feature_subtype) === "Flussweg";
}

// Weg-weiter Blick: das angeklickte Segment kann selbst richtungslos sein (Zufahrt), obwohl
// der Weg gerichtet ist -> Button-Beschriftung am WEG festmachen. Client-Spiegel der
// Weg-Identitaet (exakter Name ODER gleicher wiki_key); autoritativ entscheidet der Server.
function pathFlowWaySegmentsFor(feature) {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || !feature) {
		return [];
	}
	const name = String(feature.properties?.name || "");
	const wikiKey = String(feature.properties?.wiki_path?.wiki_key || "");
	return pathData.filter((path) => {
		if (normalizePathSubtype(path.properties?.feature_subtype) !== "Flussweg") {
			return false;
		}
		const sameName = name !== "" && String(path.properties?.name || "") === name;
		const sameWiki = wikiKey !== "" && String(path.properties?.wiki_path?.wiki_key || "") === wikiKey;
		return sameName || sameWiki;
	});
}

function pathFlowWaySegments() {
	return pathFlowWaySegmentsFor(typeof pathEditFeature === "undefined" ? null : pathEditFeature);
}

// Popup-Shortcut (Editmode, direkt am Segment): gerichteter Weg -> umkehren, richtungsloser
// Weg -> festlegen. Vervollstaendigen teilgerichteter Wege bleibt bewusst im Detailpanel.
function pathFlowShortcutModeFor(feature) {
	const wayHasDirection = pathFlowWaySegmentsFor(feature).some((path) => {
		const dir = path.properties?.flow?.dir;
		return dir === "forward" || dir === "reverse";
	});
	return wayHasDirection ? "flip" : "set_dir";
}

function pathFlowShortcutLabelFor(feature) {
	return pathFlowShortcutModeFor(feature) === "flip" ? "Strömung umkehren" : "Strömung festlegen";
}

// Ein-Klick-Aktion aus dem Segment-Popup, ohne den "Weg bearbeiten"-Dialog: schreibt weg-weit
// (wie die Panel-Buttons), aktualisiert pathData/Popups/Pfeile und schliesst das Popup.
async function submitPathFlowShortcut(path) {
	const publicId = String(path?.properties?.public_id || path?.id || "");
	if (!publicId) {
		return;
	}
	const mode = pathFlowShortcutModeFor(path);
	if (typeof map !== "undefined" && typeof map.closePopup === "function") {
		map.closePopup();
	}
	try {
		const result = await pathWikiPost({ action: "set_flow", public_id: publicId, [mode]: true, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(result?.error?.message || result?.error || "Aktion fehlgeschlagen");
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		renderPathFlowSection();
		if (typeof window.avesmapsRedrawRiverFlowArrows === "function") {
			window.avesmapsRedrawRiverFlowArrows();
		}
		// 💣 DERSELBE SATZBAUER wie im Detailpanel. Hier stand bis zum 05.10.2026 ein eigener
		// Wortlaut („— Abzweige bleiben ohne Richtung", ohne Zahl) -- zwei Fassungen desselben
		// Sachverhalts, und der Kommentar an `pathFlowOffeneAbschnitteSatz` behauptete gleichzeitig
		// EINEN Erzeuger. Gefunden von einem Pruefagenten.
		showFeedbackToast?.(mode === "flip"
			? `Strömung umgekehrt (${result.flipped} Segmente).`
			: `Strömung festgelegt (${result.directed} von ${result.segments} Segmenten).${pathFlowOffeneAbschnitteSatz(result)}`, "info");
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

// Leert die Rückmeldung der Sektion. 💣 WIRD BEIM ÖFFNEN EINES ABSCHNITTS GERUFEN, nicht bei
// jedem Rendern: die Meldung gehört dem Abschnitt, der sie ausgelöst hat.
// 🔴 Ohne das liest ein Editor beim nächsten Arm die Meldung des vorigen und hält ihn für
// erledigt — und dieses Feature macht genau das zum Hauptablauf: am Großen Fluss 22 Arme
// hintereinander. `resetPathEditForm` leert nur `#path-edit-status`, diese Zeile fasste nie
// jemand an. Gefunden von einem Prüfagenten im echten Browser.
// ⚠️ NICHT in `renderPathFlowSection` selbst: die läuft auch nach einer Wiki-Zuweisung am
// SELBEN Abschnitt (review-path-wiki.js), und dort ist die Meldung noch gültig.
// 💣 ZWEI Befüller rufen sie (`populatePathEditForm` und der Gruppen-Befüller daneben) --
// `stroemung-je-abschnitt.test.js` zählt sie, damit ein dritter nicht ohne sie auskommt.
function pathFlowClearStatus() {
	const status = pathFlowElement("path-flow-status");
	if (status) {
		status.textContent = "";
	}
}

function renderPathFlowSection() {
	const section = pathFlowElement("path-flow-section");
	if (!section) {
		return;
	}
	if (!pathFlowIsRiverSegment()) {
		section.hidden = true;
		return;
	}
	section.hidden = false;
	const flow = pathFlowCurrentFlow();
	const dir = flow?.dir === "forward" || flow?.dir === "reverse" ? flow.dir : null;
	const stateElement = pathFlowElement("path-flow-state");
	if (stateElement) {
		stateElement.textContent = dir
			? (flow?.source === "verlauf-sync" ? "bekannt (aus Wiki)" : "bekannt (manuell)")
			: "unbekannt";
	}
	const waySegments = pathFlowWaySegments();
	const directedCount = waySegments.filter((path) => {
		const wayDir = path.properties?.flow?.dir;
		return wayDir === "forward" || wayDir === "reverse";
	}).length;
	const wayHasDirection = directedCount > 0;
	// 🔴 Der Zusatz „(ganzer Fluss)" kommt nur, wenn es wirklich mehr als einen Abschnitt gibt --
	// bei einem einteiligen Weg gibt es nichts zu unterscheiden, und ein Zusatz, der auf nichts
	// zeigt, liest sich wie ein Hinweis auf einen fehlenden zweiten Knopf.
	// 💣 UND ER GILT BEIDEN ZWEIGEN. Der erste Bau band ihn nur an „festlegen", waehrend
	// „umdrehen" ihn unbedingt trug (so stand es schon vor diesem Umbau da) -- ein einteiliger,
	// gerichteter Fluss zeigte damit „Richtung umdrehen (ganzer Fluss)" ohne Gegenstueck, und die
	// Regel war an EINEM von zwei Erzeugern gebunden. Genau diese Falle hat dieses Haus bei der
	// Verkehrsmittel-Sperre und bei der Ausstiegsregel je einmal bezahlt. Gefunden von einem
	// Pruefagenten, nicht vom Test -- Test E prueft nur den ungerichteten einteiligen Fall.
	const mehrteilig = waySegments.length > 1;
	const ganzerFluss = mehrteilig ? " (ganzer Fluss)" : "";
	const directionButton = pathFlowElement("path-flow-direction");
	if (directionButton) {
		directionButton.textContent = (wayHasDirection ? "Richtung umdrehen" : "Richtung festlegen") + ganzerFluss;
		directionButton.dataset.flowMode = wayHasDirection ? "flip" : "set_dir";
	}
	// Der Abschnitt, einzeln (Meldung #7996). 💣 Gemessen wird DIESER Abschnitt (`dir`), nicht der
	// Weg: genau dafuer gibt es den Knopf -- an einem gerichteten Fluss kann ein Deltaarm dirlos
	// sein, und das ist der Normalfall, nicht die Ausnahme.
	// 💣 ERST DIE KETTE, DANN DIE ARME -- deshalb haengt der Knopf auch an `wayHasDirection`.
	// Zwei Gruende, und der zweite ist eine gemessene Falle:
	// (a) Fachlich: wohin ein Deltaarm fliesst, kann niemand entscheiden, solange unbekannt ist,
	//     wohin der Hauptstrom fliesst. Ein Arm vor der Kette zu richten ist die falsche Reihenfolge.
	// (b) Technisch: `avesmapsPathFlowPlanSetDir` wirft `no_anchor_on_chain`, sobald es Anker gibt,
	//     aber keinen AUF der Kette. Wer an einem ganz richtungslosen Fluss zuerst einen Abzweig
	//     richtet, kann die Hauptkette danach nicht mehr per Knopf richten -- am Grossen Fluss
	//     waeren das 44 Abschnitte von Hand. Gemessen an der T-Form-Fixture, gefunden von einem
	//     Pruefagenten. Diese Reihenfolge-Sperre ist der Riegel davor, und sie kostet nichts:
	//     „Richtung festlegen (ganzer Fluss)" steht in genau diesem Zustand daneben.
	const segmentButton = pathFlowElement("path-flow-segment");
	if (segmentButton) {
		segmentButton.hidden = !(mehrteilig && wayHasDirection);
		segmentButton.textContent = dir ? "Pfeil umdrehen (dieser Abschnitt)" : "Richtung setzen (dieser Abschnitt)";
		segmentButton.dataset.flowMode = dir ? "flip" : "dir";
	}
	// Teilgerichteter Weg (z. B. Grosser Fluss: nur die wiki-ableitbaren Etappen tragen dir):
	// Rest der Hauptkette anker-konsistent vervollstaendigen. Abzweige bleiben immer dirlos,
	// daher kann der Button auch bei voll gerichteter Kette sichtbar sein -- der Server
	// antwortet dann mit einer AUSKUNFT (ok:true, directed:0) und nennt die Zahl der offenen
	// Abzweigungen; die Sichtbarkeitsregel bleibt deshalb bewusst grob, denn ob ein offener
	// Abschnitt auf der Hauptkette liegt, entscheidet der Diameter-Walk im Server, und ein
	// Client, der das nachrechnet, waere die zweite Wahrheit.
	// 🪤 Hier stand bis zum 05.10.2026 „der Server antwortet dann mit dem klaren
	// 'already fully directed'-Fehler". Das war der Zustand, der Meldung #7996 ausgeloest hat.
	const completeButton = pathFlowElement("path-flow-complete");
	if (completeButton) {
		completeButton.hidden = !(wayHasDirection && directedCount < waySegments.length);
	}
	const factorInput = pathFlowElement("path-flow-factor");
	const saveButton = pathFlowElement("path-flow-factor-save");
	if (factorInput) {
		const rawFactor = Number(flow?.factor);
		// Vorbelegung 2,0 wie AVESMAPS_PATH_FLOW_FACTOR_DEFAULT -- ein Weg ohne eigenen Faktor faehrt
		// im Routing auf diesem Wert, das Feld muss ihn also zeigen und nicht einen anderen anbieten.
		// 🔴 NUR NOCH NACH UNTEN (31.08.2026). Hier stand die SIEBTE Fassung des 3er-Riegels, und sie
		// war die sichtbarste: der Server speicherte den eingestellten Wert, das Feld zeigte hoechstens
		// 3,0 -- fuer den Editor sah es aus, als wuerde seine Eingabe zurueckgesetzt.
		// 🪤 Uebersehen wurde sie, weil sie `Math.min(3, ...)` heisst und das Inventar `min(3.0` suchte.
		factorInput.value = (Number.isFinite(rawFactor) ? Math.max(1, rawFactor) : 2.0).toFixed(1);
		// Faktor editierbar, sobald ein Wiki-Weg zugewiesen ODER der Weg gerichtet ist
		// (Owner-Anforderung 3).
		const hasWiki = Boolean(pathEditFeature.properties?.wiki_path?.wiki_key);
		factorInput.disabled = !hasWiki && !wayHasDirection;
		if (saveButton) {
			saveButton.disabled = factorInput.disabled;
		}
	}
}

// Was ist noch offen, und WARUM? 💣 EIN Erzeuger fuer alle Meldungen der Sektion -- vorher stand
// „Abzweige bleiben ohne Richtung" an zwei Stellen abgeschrieben und nannte keine Zahl, waehrend
// der dritte Fall (fertige Kette) gar keinen Satz hatte, weil er als Fehler endete.
// 🔴 Die Zahlen kommen vom SERVER (`undirected_spurs` / `undirected_stubs`): ob ein Abschnitt auf
// der Hauptkette liegt, entscheidet der Diameter-Walk, und ein Client, der das nachrechnet, waere
// die zweite Wahrheit. ⚠️ Faellt still aus, wenn ein alter Server die Felder nicht schickt.
function pathFlowOffeneAbschnitteSatz(result) {
	const abzweige = Number(result?.undirected_spurs) || 0;
	const stummel = Number(result?.undirected_stubs) || 0;
	// 💣 DIE KETTE ZUERST, und sie verweist auf den ANDEREN Knopf. Ein offener Abschnitt auf der
	// Hauptkette ist der EINE Fall, den „Richtung vervollstaendigen" wirklich loest -- stuende hier
	// nur der Einzelknopf, schickte die Meldung den Editor 24-mal von Hand durch etwas, das ein
	// Klick erledigt. Der Server liefert `undirected_on_chain` seit dem Umbau, gelesen hat es
	// zuerst niemand (Befund eines Pruefagenten).
	const aufKette = Number(result?.undirected_on_chain) || 0;
	if (aufKette > 0) {
		const was = aufKette === 1 ? "1 Abschnitt" : `${aufKette} Abschnitte`;
		const verb = aufKette === 1 ? "hat" : "haben";
		return ` ${was} im durchgehenden Lauf ${verb} noch keinen Pfeil — das erledigt „Richtung vervollständigen“.`;
	}
	if (abzweige === 0 && stummel === 0) {
		return "";
	}
	const teile = [];
	if (abzweige > 0) {
		teile.push(abzweige === 1 ? "1 Abzweigung" : `${abzweige} Abzweigungen`);
	}
	if (stummel > 0) {
		teile.push(stummel === 1 ? "1 sehr kurzer Abschnitt" : `${stummel} sehr kurze Abschnitte`);
	}
	const was = teile.join(" und ");
	const verb = abzweige + stummel === 1 ? "hat" : "haben";
	// ⚠️ Der Hinweis nennt den WEG dorthin: der Dialog ist modal, die Pfeile liegen auf der Karte
	// darunter, und der Einzelknopf gilt immer nur dem GEÖFFNETEN Abschnitt.
	return ` ${was} ${verb} noch keinen Pfeil — auf der Karte anklicken und dort „Richtung setzen“.`;
}

async function submitPathFlowAction(body, buildSuccessMessage) {
	const status = pathFlowElement("path-flow-status");
	try {
		const result = await pathWikiPost({ ...body, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true) {
			throw new Error(result?.error?.message || result?.error || "Aktion fehlgeschlagen");
		}
		applyWikiPathSegmentsUpdate(result.segments_updated);
		renderPathFlowSection();
		if (typeof window.avesmapsRedrawRiverFlowArrows === "function") {
			window.avesmapsRedrawRiverFlowArrows();
		}
		const message = buildSuccessMessage(result);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "info");
	} catch (error) {
		const message = "Fehler: " + (error.message || error);
		if (status) {
			status.textContent = message;
		}
		showFeedbackToast?.(message, "error");
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	// Der Abschnitt, einzeln (Meldung #7996): „Richtung setzen" schickt `dir`, „Pfeil umdrehen"
	// einen `flip` mit `scope: "segment"`.
	// 🔴 `dir: "forward"` ist die ZEICHENRICHTUNG und fuer einen Menschen bedeutungslos -- der
	// Editor sieht den Pfeil und dreht ihn mit dem naechsten Klick. Genau dieses Muster hat der
	// Ursprungsentwurf fuer die ganze Kette schon festgelegt („welches Ende, ist egal -- der Editor
	// prueft die Pfeile und drueckt bei Bedarf einmal umdrehen"). Die Woerter forward/reverse
	// erscheinen deshalb NIE in der Oberflaeche.
	const segmentTrigger = event.target.closest("#path-flow-segment");
	if (segmentTrigger) {
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		const umdrehen = segmentTrigger.dataset.flowMode === "flip";
		void submitPathFlowAction(
			umdrehen
				? { action: "set_flow", public_id: publicId, flip: true, scope: "segment" }
				: { action: "set_flow", public_id: publicId, dir: "forward" },
			// 🔴 „Pfeil prüfen" ist keine Hoeflichkeit, sondern der zweite Schritt der Bedienung:
			// gesetzt wird die Zeichenrichtung, und ob sie stimmt, sieht nur ein Mensch auf der
			// Karte. Ohne diesen Satz steht der Editor vor einem Pfeil, von dem er nicht weiss,
			// dass er ihn pruefen soll (Befund eines Pruefagenten im Browser).
			(result) => umdrehen
				? "Pfeil dieses Abschnitts umgedreht."
				: `Richtung gesetzt — Pfeil auf der Karte prüfen, „Pfeil umdrehen“ kehrt ihn um.${pathFlowOffeneAbschnitteSatz(result)}`
		);
		return;
	}
	const directionTrigger = event.target.closest("#path-flow-direction, #path-flow-complete");
	if (directionTrigger) {
		const mode = directionTrigger.id === "path-flow-complete" ? "set_dir"
			: (directionTrigger.dataset.flowMode === "flip" ? "flip" : "set_dir");
		const publicId = pathWikiCurrentFeaturePublicId();
		if (!publicId) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, [mode]: true },
			(result) => {
				if (mode === "flip") {
					return `Richtung umgedreht (${result.flipped} Segmente).`;
				}
				// 🔴 „Die Kette ist fertig" ist seit dem 05.10.2026 KEIN Fehler mehr, sondern eine
				// Auskunft -- der Server antwortet mit ok:true und `directed: 0`. Hier stand vorher
				// nichts fuer diesen Fall, weil er im `catch` landete, und zwar mit dem englischen
				// Satz „Main chain is already fully directed (use flip)." (Meldung #7996).
				if (Number(result.directed) === 0) {
					return `Der durchgehende Lauf hat überall Pfeile.${pathFlowOffeneAbschnitteSatz(result)}`;
				}
				if (Number(result.directed_before) > 0) {
					return `Richtung vervollständigt (${result.directed} Segmente ergänzt, ${result.directed_before} waren schon gerichtet).${pathFlowOffeneAbschnitteSatz(result)}`;
				}
				return `Richtung festgelegt (${result.directed} von ${result.segments} Segmenten).${pathFlowOffeneAbschnitteSatz(result)}`;
			}
		);
		return;
	}
	if (event.target.closest("#path-flow-factor-save")) {
		const publicId = pathWikiCurrentFeaturePublicId();
		const factorInput = pathFlowElement("path-flow-factor");
		if (!publicId || !factorInput) {
			return;
		}
		const factor = Number(factorInput.value);
		if (!Number.isFinite(factor)) {
			return;
		}
		void submitPathFlowAction(
			{ action: "set_flow", public_id: publicId, factor },
			(result) => `Strömungsfaktor ${Number(result.factor ?? factor).toFixed(1)} übernommen (${result.factor_updated} Segmente).`
		);
	}
});
