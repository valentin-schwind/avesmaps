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
		const versatzVon = (k) => (relativ
			? { dx: k.dx - basis.x, dy: k.dy - basis.y }
			: { dx: k.dx, dy: k.dy });

		let gewaehlt = null;
		let gewaehltesRect = null;
		for (const kandidat of kandidaten) {
			// 🔴 DER DECKEL: eine Stelle, die den Namen weiter als `maxDrift` von seiner
			// Normalstellung wegrückte, wird gar nicht erst probiert. Bleibt darunter nichts frei,
			// fällt das Label unten durch auf den Ausblend-Weg -- „begrenzen, bis sie verschwinden".
			// ⚠️ Nur bei relativen (Orts-)Kandidaten: freie Kartenlabels tragen keinen `drift`.
			if (relativ && typeof kandidat.drift === "number" && kandidat.drift > maxDrift) {
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

		// 🔴 EIN FLÄCHEN-LABEL WIRD NIE AUSGEBLENDET (Owner 2026-07-28). Für Siedlungen und freie
		// Labels ist Verstecken die richtige Antwort auf Gedränge; eine Landschaft ist etwas anderes:
		// ihr Label ist der einzige garantierte Anfasser ihrer Fläche. Sein Rechteck wandert TROTZDEM
		// in die Belegung -- es ist sichtbar, also ist es ein Hindernis.
		const gesetzt = gruppe !== "";
		if (gesetzt) {
			const v = versatzVon(kandidaten[0]);
			belegt.push({ ...translateLabelRect(rect, v.dx, v.dy), group: gruppe });
		}
		ergebnisse[i] = { kandidat: kandidaten[0], kollidiert: !gesetzt, rect: null };
	});

	return { ergebnisse, belegt };
}

// ⚠️ NUR FÜR DIE NODE-TESTS -- klassische <script>-Bausteine teilen ihre obersten `const` im
// Browser über die globale lexikalische Umgebung, `vm.runInThisContext` tut das nicht.
if (typeof globalThis !== "undefined") {
	globalThis.LOCATION_LABEL_GAP = LOCATION_LABEL_GAP;
	globalThis.AVESMAPS_LABEL_PRIORITY_BY_TYPE = AVESMAPS_LABEL_PRIORITY_BY_TYPE;
}
