// Die Platzierung der Beschriftung -- REIN, ohne DOM, ohne Leaflet, ohne Modulzustand.
//
// 🔴 DIESE DATEI IST DIE EINZIGE FASSUNG DES VERFAHRENS. Sie hat zwei Aufrufer:
//   1. die Karte      (js/map-features/map-features-label-collisions.js)
//   2. das Vorschaupanel im Fenster „Zoombänder" (html/wiki-sync-settlement-editor.html)
// Der Prototyp docs/zoombaender-vorschau-mockup.html trug eine zweite Fassung, damit er allein per
// file:// läuft -- genau das darf im Fenster nicht passieren: eine Vorschau, die beim ersten
// Eingriff etwas anderes zeigt als die Karte, ist schlimmer als keine Vorschau.
//
// 💣 NICHTS HIER DARF `document`, `window`, `map` ODER EINEN GLOBALEN ZUSTAND ANFASSEN. Der einzige
// Zugriff nach außen ist avesmapsLocationLabelSpacing() (die drei Regler + der Deckel), und der ist
// selbst rein. Wer hier eine Messung einbaut, nimmt dem Vorschaupanel die Grundlage.

// ---- Die Abstände: gespeicherter Stand ODER eine mitgegebene Übersteuerung -----------------------
// 🔴 Das Vorschaupanel im Fenster zeigt Werte, die noch NICHT gespeichert sind. Es reicht sie
// deshalb als `abstaende` durch, statt _avesmapsLocationZoomBands umzubiegen -- ein Fenster, das
// den globalen Zustand anfasst, um sich selbst zu zeichnen, ist eine Falle für den nächsten Leser.
// Ohne Übersteuerung gilt der angewandte Stand, und die Karte ruft genau so.
function avesmapsLabelSpacingOf(abstaende, key) {
	if (abstaende && typeof abstaende[key] === "number" && Number.isFinite(abstaende[key])) {
		return abstaende[key];
	}
	return avesmapsLocationLabelSpacing(key);
}

// 🔴 Die Rangfolge der Ortsklassen -- wer zuerst einen Platz bekommt. Geteilt, damit das
// Vorschaupanel dieselbe Ordnung zeigt wie die Karte; stand bis 22.08.2026 nur im Kollisionslöser.
const AVESMAPS_LABEL_PRIORITY_BY_TYPE = {
	metropole: 100,
	grossstadt: 90,
	stadt: 80,
	kleinstadt: 70,
	dorf: 60,
	gebaeude: 60,
	stadtviertel: 60,
};

// Der Mindestspalt zwischen Marker und Name, wenn keine Markergröße bekannt ist.
// 🔴 Stand bis 22.08.2026 in js/map-features/map-features.js und wurde NUR vom Kollisionslöser
// gelesen -- hierher gezogen, damit das Fenster nicht die ganze Kartendatei laden muss.
const LOCATION_LABEL_GAP = 11;

// ---- Rechteck-Mathe -----------------------------------------------------------------------------
// Box, nur um (dx, dy) verschoben -> Kandidaten lassen sich in JS rechnen, statt nach jedem Offset
// erneut getBoundingClientRect aufzurufen (Layout-Thrashing, ~12k erzwungene Reflows pro Zoom).
function translateLabelRect(rect, dx, dy) {
	return {
		left: rect.left + dx,
		right: rect.right + dx,
		top: rect.top + dy,
		bottom: rect.bottom + dy,
		width: rect.width,
		height: rect.height,
	};
}

function rectanglesOverlap(firstRect, secondRect) {
	return firstRect.left < secondRect.right
		&& firstRect.right > secondRect.left
		&& firstRect.top < secondRect.bottom
		&& firstRect.bottom > secondRect.top;
}

function expandRect(rect, padding) {
	return {
		left: rect.left - padding,
		right: rect.right + padding,
		top: rect.top - padding,
		bottom: rect.bottom + padding,
		width: rect.width + padding * 2,
		height: rect.height + padding * 2,
	};
}

// ---- Die Grundstellung: rechts neben dem Marker --------------------------------------------------
// 🔴 EINE Formel, zwei Aufrufer: getLocationNameLabelOffset (die Karte) und das Vorschaupanel.
// ⚠️ Die 0.531 statt 0.5 ist Absicht -- Mixed-Case-Worte wirken optisch tiefer als die reine
// Versalhöhe, der Text sitzt deshalb minimal höher.
function avesmapsLabelBaseOffset(markerAussenradius, labelHoehePx, abstaende) {
	return {
		x: Math.round(markerAussenradius + avesmapsLabelSpacingOf(abstaende, "spalt")),
		y: -(Math.round(labelHoehePx * 0.531 * 10) / 10),
	};
}

// ---- Die zwölf Ausweichstellen -------------------------------------------------------------------
// 🔴 DIE REIHENFOLGE IST TRAGEND (AGENTS.md §11) und ausdrücklich kein Regler: eine Stelle
// wegzunehmen verschiebt nichts, es LÖSCHT Ortsnamen, weil der Löser früher aufgibt.
//
// 🔴 DER DRIFT EINER STELLE: wie weit sie den Namen von seiner NORMALSTELLUNG wegrückt --
// Luftlinie, waagerecht wie senkrecht. Die Normalstellung („rechts") hat damit Drift 0 und ist bei
// jedem Deckel erlaubt; sie trägt den Rückfall für ein ausgeblendetes Label.
//
// 🔴 MIT EINER AUSNAHME, UND SIE IST DER GANZE UNTERSCHIED ZWISCHEN „daneben" UND „abgehoben":
// DER SEITENWECHSEL NACH LINKS KOSTET NUR SEINEN SENKRECHTEN ANTEIL (`seitenwechsel: true`,
// Owner-Entscheid 24.08.2026, automatisch -- ausdrücklich KEIN eigenes Bedienelement). Ein Name
// links vom Punkt klebt genauso am Punkt wie einer rechts davon: seine dem Punkt zugewandte Kante
// liegt in BEIDEN Fällen `scaledGap` daneben. Zählte man die volle Luftlinie, bezahlte der
// Seitenwechsel die EIGENE NAMENSBREITE (live 78 bis 203 px, Median 123) und wäre bei jedem
// vernünftigen Deckel gesperrt -- gemessen am gespeicherten Stand (Deckel 25) blieben von zwölf
// Stellen genau drei übrig, und Namen wie „Burginum" verschwanden neben ihrem Nachbarn, statt auf
// die freie Seite zu rücken.
//
// 🪤 GENAU DAS WAR VOM 22. BIS 24.08.2026 DER FALL, und die Begründung dafür steht als Warnung im
// Entwurf: „Nordhag (Weiden)" rückte weg. Nachgemessen war der Übeltäter dort aber die MITTIGE
// Stelle über dem Punkt (Anfang 84 px daneben, Entwurf §3), nicht der Seitenwechsel -- §2 desselben
// Entwurfs schrieb ihn dem Seitenwechsel zu und war damit falsch. `top`/`bottom` behalten deshalb
// die volle Luftlinie: sie rücken den Namen wirklich vom Punkt weg.
// 💣 `labelPadX` IST DIE DURCHSICHTIGE INNENPOLSTERUNG DES NAMENSBILDES, und ohne sie steht der
// Name links um `2 x padX` zu weit vom Punkt weg (Owner 24.08.2026: „linksbündig ist - nur mit
// etwas zu viel abstand auf der rechten seite"). Die Karte rendert den Namen auf ein Canvas und
// legt rundum Platz für den Halo dazu -- `labelWidth` ist die Breite des BILDES, nicht des Textes
// (`padX = ceil(fontSizePx * 0.5 + haloExtent)`, rund 10 px bei einem Dorf auf z5).
// Rechts fällt das nicht auf: dort schiebt `leftAdjust = -padX` das Bild zurück, der sichtbare Text
// beginnt also genau bei `baseOffset.x`. Links wurde die volle Bildbreite gespiegelt, und die
// Polsterung zählte doppelt -- einmal als Bildrand, einmal als Abstand.
// 🔴 DIE REGEL IST SPIEGELUNG DES SICHTBAREN TEXTES: rechts beginnt er bei `baseOffset.x`, links
// endet er bei `-scaledGap`. Deshalb `-(labelWidth - 2 * padX)`, also die reine Textbreite.
// ⚠️ Ohne Angabe 0 -- das Vorschaupanel setzt echten Text ohne Polsterung, und beide Aufrufer
// bleiben damit bei ihrer eigenen Metrik richtig.
function avesmapsLabelCandidatePlacements(baseOffset, labelWidth, labelHeight, abstaende, labelPadX) {
	const smallShift = avesmapsLabelSpacingOf(abstaende, "versatz");
	const scaledGap = Math.max(LOCATION_LABEL_GAP, Math.abs(baseOffset.x));
	const verticalCenterOffset = -labelHeight / 2;
	const padX = typeof labelPadX === "number" && Number.isFinite(labelPadX) ? Math.max(0, labelPadX) : 0;
	// Die sichtbare Textbreite. Bei padX = 0 ist sie die Bildbreite -- die alte Rechnung.
	const textWidth = Math.max(0, labelWidth - padX * 2);

	return [
		{ name: "right", dx: baseOffset.x, dy: baseOffset.y },
		{ name: "right-up", dx: baseOffset.x, dy: baseOffset.y - smallShift },
		{ name: "right-down", dx: baseOffset.x, dy: baseOffset.y + smallShift },
		{ name: "top-right", dx: baseOffset.x, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-right", dx: baseOffset.x, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "left", seitenwechsel: true, dx: -textWidth - scaledGap, dy: baseOffset.y },
		{ name: "left-up", seitenwechsel: true, dx: -textWidth - scaledGap, dy: baseOffset.y - smallShift },
		{ name: "left-down", seitenwechsel: true, dx: -textWidth - scaledGap, dy: baseOffset.y + smallShift },
		{ name: "top-left", seitenwechsel: true, dx: -textWidth - scaledGap, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-left", seitenwechsel: true, dx: -textWidth - scaledGap, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "top", dx: -labelWidth / 2, dy: verticalCenterOffset - labelHeight - smallShift },
		{ name: "bottom", dx: -labelWidth / 2, dy: verticalCenterOffset + labelHeight + smallShift },
	].map((stelle) => ({
		...stelle,
		// Der Seitenwechsel zahlt nur, was er den Namen HOCH oder RUNTER schiebt -- die Breite, um
		// die er ihn spiegelt, hält ihn nicht weiter vom Punkt weg (siehe Kopfkommentar).
		drift: stelle.seitenwechsel
			? Math.abs(stelle.dy - baseOffset.y)
			: Math.hypot(stelle.dx - baseOffset.x, stelle.dy - baseOffset.y),
	}));
}

// ---- Die Ausweichstellen eines FREIEN Kartenlabels (Landschaften, Meere, Gipfel) ---------------
// 🔴 EIN LANDSCHAFTSNAME SITZT MITTIG AUF SEINEM PUNKT, nicht neben einem Marker -- die zwölf
// Stellen der Ortsnamen darüber lassen sich deshalb nicht abschreiben. Die Entsprechung ist ein
// Ring um den Punkt, gewachsen in Schritten von `versatz` bis `deckel`.
// Entwurf: docs/superpowers/specs/2026-08-31-landschaften-label-kollision-design.md
//
// 💣 SENKRECHT ZUERST, und das ist begründet, nicht Geschmack: breite Namen überlappen stark
// waagerecht und nur wenig senkrecht, der kürzeste Ausweg ist also nach oben oder unten. Dieselbe
// Begründung steht seit jeher an den Territoriumsnamen (getRegionLabelOffsetCandidates).
//
// 💣 `drift` IST DIE LUFTLINIE, nicht die Ringnummer. Die Diagonale eines Rings liegt um den
// Faktor 1,41 weiter als seine Achse; wer nach Ringnummer deckelt, lässt einen Namen weiter
// wegrücken, als der Regler erlaubt -- und der Regler heißt „wie weit darf er weg".
//
// ⚠️ Bis zum 31.08.2026 gab es hier gar nichts: freie Labels bekamen neun feste Stellen mit
// höchstens ±12 px waagerecht und ±8 px senkrecht (getLabelOffsetCandidates in
// map-features-label-collisions.js). Bei 179-296 px Namensbreite bewegte das nichts, und der
// gemeldete Fall („Grüne Zwillinge") stapelte drei Namen vollständig aufeinander.
const AVESMAPS_FREE_LABEL_DIRECTIONS = [
	[0, -1], [0, 1],            // senkrecht zuerst -- der kürzeste Ausweg bei breiten Namen
	[1, -1], [-1, -1], [1, 1], [-1, 1],
	[1, 0], [-1, 0],
];

function avesmapsFreeLabelCandidatePlacements(versatz, deckel) {
	const stellen = [{ name: "mitte", dx: 0, dy: 0, drift: 0 }];
	const schritt = Number(versatz);
	const grenze = Number(deckel);
	// 💣 EIN VERSATZ VON 0 ODER NaN WÜRDE ENDLOS SCHLEIFEN. Der Regler lässt ihn nicht zu, aber ein
	// kaputter gespeicherter Wert erreicht diese Funktion trotzdem -- und eine Endlosschleife im
	// Kollisionsdurchgang friert die Karte ein, statt nur schlecht auszusehen.
	if (!Number.isFinite(schritt) || schritt <= 0 || !Number.isFinite(grenze) || grenze <= 0) {
		return stellen;
	}
	for (let r = schritt; r <= grenze; r += schritt) {
		for (const [ux, uy] of AVESMAPS_FREE_LABEL_DIRECTIONS) {
			const dx = ux * r;
			const dy = uy * r;
			const drift = Math.hypot(dx, dy);
			if (drift > grenze) { continue; }
			stellen.push({ name: "r" + r + ":" + ux + "," + uy, dx, dy, drift });
		}
	}
	return stellen;
}

// ---- Der Löser: wer bekommt welche Stelle, wer fällt weg ------------------------------------------
// eintraege: [{ kollisionsRect, basisOffset, kandidaten, gruppe, prioritaet, minZoom, relativ }]
//   kollisionsRect  das bei Offset 0 gemessene Rechteck, bereits um „Repel" aufgeweitet
//   relativ         true bei Ortsnamen (Kandidat ist die ZIELlage, der angewandte Offset also
//                   Kandidat - Grundstellung); false bei freien Kartenlabels, deren Kandidat
//                   direkt der Offset ist
// optionen: { maxDrift, seedRects }
//
// Zurück kommt ein Ergebnis JE EINTRAG in der Eingabereihenfolge plus die Endlage aller belegten
// Rechtecke (der Aufrufer schiebt sie in die gemeinsame Belegungskarte).
function avesmapsResolveLabelPlacements(eintraege, optionen) {
	const opts = optionen || {};
	const maxDrift = typeof opts.maxDrift === "number"
		? opts.maxDrift
		: avesmapsLabelSpacingOf(opts.abstaende, "drift");
	const belegt = Array.isArray(opts.seedRects) ? opts.seedRects.slice() : [];
	const ergebnisse = new Array(eintraege.length);

	// Nach Priorität, bei Gleichstand: wer schon länger sichtbar ist, wird zuerst platziert.
	const reihenfolge = eintraege.map((_, i) => i).sort((a, b) => {
		const nachPrio = (eintraege[b].prioritaet || 0) - (eintraege[a].prioritaet || 0);
		return nachPrio || ((eintraege[a].minZoom || 0) - (eintraege[b].minZoom || 0));
	});

	reihenfolge.forEach((i) => {
		const eintrag = eintraege[i];
		const kandidaten = eintrag.kandidaten;
		const rect = eintrag.kollisionsRect;
		if (!rect || rect.width <= 0 || rect.height <= 0) {
			ergebnisse[i] = { kandidat: kandidaten[0], kollidiert: false, rect: null };
			return;
		}
		const gruppe = eintrag.gruppe || "";
		const basis = eintrag.basisOffset || { x: 0, y: 0 };
		const relativ = eintrag.relativ !== false;
		// 💣 DER DECKEL GILT JE EINTRAG, NICHT JE AUFRUF (31.08.2026). Orts- und Landschaftsnamen
		// liegen in EINEM Durchgang -- resolveLabelCollisions ruft diesen Löser einmal mit beiden
		// Familien -- und haben seither EIGENE Regler (Orte: das Fenster „Zoombänder", Landschaften:
		// das Fenster „Darstellung" im Regioneneditor). Ein gemeinsamer Wert ist damit nicht baubar.
		// ⚠️ Fehlt er, gilt wie bisher die Aufrufoption.
		const deckel = (typeof eintrag.maxDrift === "number" && Number.isFinite(eintrag.maxDrift))
			? eintrag.maxDrift
			: maxDrift;
		const versatzVon = (k) => (relativ
			? { dx: k.dx - basis.x, dy: k.dy - basis.y }
			: { dx: k.dx, dy: k.dy });

		let gewaehlt = null;
		let gewaehltesRect = null;
		for (const kandidat of kandidaten) {
			// 🔴 DER DECKEL: eine Stelle, die den Namen weiter als `deckel` von seiner
			// Normalstellung wegrückte, wird gar nicht erst probiert. Bleibt darunter nichts frei,
			// fällt das Label unten durch auf den Ausblend-Weg -- „begrenzen, bis sie verschwinden".
			// 💣 DAS `relativ &&` IST AM 31.08.2026 GEFALLEN: seit die freien Kartenlabels einen
			// echten Kandidatenring MIT `drift` bekommen haben, muss der Deckel auch sie schneiden --
			// sonst hätte der Regler „Drift" der Landschaftsnamen keine Wirkung.
			// ⚠️ Die TYPPRÜFUNG bleibt, und sie ist die sichere Richtung: ein Aufrufer, der schlichte
			// {dx, dy} ohne `drift` übergibt, wird weiterhin nie beschnitten. Der schlimmste Fall ist
			// damit „ein Name weicht weiter aus als gedacht", nicht „alle Namen verschwinden".
			if (typeof kandidat.drift === "number" && kandidat.drift > deckel) {
				continue;
			}
			const v = versatzVon(kandidat);
			const versuch = translateLabelRect(rect, v.dx, v.dy);
			// Ein Rechteck der EIGENEN Fläche zählt nicht als Hindernis; die Vorbelegung
			// (seedRects) hat keine Gruppe und blockiert weiterhin jeden.
			const blockiert = belegt.some((angenommen) => {
				if (gruppe !== "" && angenommen.group === gruppe) { return false; }
				return rectanglesOverlap(versuch, angenommen);
			});
			if (!blockiert) {
				gewaehlt = kandidat;
				gewaehltesRect = versuch;
				belegt.push({ ...versuch, group: gruppe });
				break;
			}
		}

		if (gewaehlt) {
			ergebnisse[i] = { kandidat: gewaehlt, kollidiert: false, rect: gewaehltesRect };
			return;
		}

		// 🔴 WER KEINEN PLATZ FINDET, VERSCHWINDET -- auch ein Flächen-Label (Owner 31.08.2026).
		//
		// 💣 `gruppe` TRUG BIS DAHIN ZWEI BEDEUTUNGEN, und nur eine ist geblieben:
		//    bleibt:  „darf mit Namen DERSELBEN Fläche überlappen" (Owner 2026-07-28, Finsterkamm) --
		//             das steht oben im `blockiert`-Ausdruck und ist unberührt.
		//    fällt:   „wird nie ausgeblendet" -- war genau diese Stelle.
		// Wer die beiden beim nächsten Umbau wieder zusammenzieht, nimmt einem Gebirge seinen
		// zweiten Namen, und das fällt niemandem auf. Abschnitt D in
		// js/map-features/__tests__/label-placement.test.js hält sie auseinander.
		//
		// 🔴 DER GRUND FÜR DIE ALTE REGEL IST ENTFALLEN: sie stand da, weil das Label „der einzige
		// garantierte Anfasser seiner Fläche" war. Seit dem 23.08.2026 trägt es im Bearbeiten-Modus
		// ohnehin keinen Marker mehr, und der Weg zu ihm führt über das Kontextmenü der FLÄCHE
		// („Beschriftung bearbeiten", map-features-ecosystem-context-action.js). Die Owner-Regel von
		// den verwaisten Außenhüllen bleibt damit gewahrt.
		//
		// ⚠️ Ein verstecktes Label ist KEIN Hindernis -- sein Rechteck wandert deshalb nicht in die
		// Belegung. Vorher tat es das, weil es ja sichtbar liegenblieb.
		ergebnisse[i] = { kandidat: kandidaten[0], kollidiert: true, rect: null };
	});

	return { ergebnisse, belegt };
}

// ⚠️ NUR FÜR DIE NODE-TESTS -- klassische <script>-Bausteine teilen ihre obersten `const` im
// Browser über die globale lexikalische Umgebung, `vm.runInThisContext` tut das nicht.
if (typeof globalThis !== "undefined") {
	globalThis.LOCATION_LABEL_GAP = LOCATION_LABEL_GAP;
	globalThis.AVESMAPS_LABEL_PRIORITY_BY_TYPE = AVESMAPS_LABEL_PRIORITY_BY_TYPE;
	globalThis.AVESMAPS_FREE_LABEL_DIRECTIONS = AVESMAPS_FREE_LABEL_DIRECTIONS;
}
