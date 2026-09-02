/*
 * „Freie Labels markieren" -- der Teil, der das DOM anfasst.
 * =========================================================
 * Die REGEL („traegt diese Beschriftung die Markierung?") steht nebenan in
 * freie-label-markierung.js und ist bewusst rein. Hier steht alles, was sie nicht darf: das
 * Auswahlfeld samt seinen Zeilen, der Farbton und das Nachziehen der zwei Zeichenflaechen.
 *
 * Owner 02.09.2026: „alle freien labels vom typ z.B. ‚Fluss‘ markieren (roter rahmen) […] mein
 * ziel ist eigentlich die zu entfernen, die wir doppelt auf der karte haben (z.B. Inoscha)".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * 💣 EIN RAHMEN, KEIN SCHEIN -- UND DAS IST DIE TRAGENDE ENTSCHEIDUNG
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Pruefhaken „Keine Wiki-Zuweisung" faerbt seit dem 01.09.2026 den HALO einer Beschriftung rot
 * (createLabelIcon, map-features-labels.js). Beide Werkzeuge sind gleichzeitig einschaltbar und
 * beide sprechen ueber DIESELBEN Objekte -- ein zweiter roter Schein waere von dem ersten nicht zu
 * unterscheiden, und ein Editor wuesste bei einem roten Namen nicht mehr, welches der beiden
 * gerade spricht. Unterschieden wird deshalb an der FORM, nicht am Ton: Schein = „fehlt etwas",
 * Kasten = „das ist die Art, die du gerade suchst".
 * ⚠️ Wer das je zusammenlegt, nimmt dem Editor die Antwort auf die Frage „warum ist der rot?".
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

(function () {
	"use strict";

	const FELD = "#freeLabelMarkSelect";

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
			&& typeof map !== "undefined" && Boolean(map);
	}

	/**
	 * Was ist gewaehlt?
	 *
	 * 💣 DER RIEGEL `IS_EDIT_MODE` STEHT HIER, nicht nur am ausgeblendeten Menueeintrag. Das Feld
	 * steht zwar in keinem geteilten Link (anders als die Pruefhaken -- siehe unten), aber ein
	 * `<select>` im DOM ist auch fuer einen Besucher da, sobald es jemand per Konsole oder
	 * Erweiterung anfasst. Dieselbe Falle, die bei „Offene Wegenden" ueber `?toggleOpenPathEnds=1`
	 * schon einmal zugeschnappt ist.
	 *
	 * 🔴 KEIN URL-PARAMETER, ANDERS ALS DIE ACHT PRUEFHAKEN. Die reisen im geteilten Link mit, weil
	 * ein Editor einem anderen einen Befund zeigen will. Hier gibt es keinen Befund zu zeigen (die
	 * Regel rechnet nichts aus, sie leuchtet nur eine Art an), und der Zustand ist die Dauer einer
	 * Aufraeumsitzung wert, nicht die eines Links.
	 */
	window.avesmapsFreieLabelMarkierungWahl = function avesmapsFreieLabelMarkierungWahl() {
		if (!istVerfuegbar()) {
			return AVESMAPS_FREIE_LABEL_KEINE;
		}
		const feld = document.querySelector(FELD);
		return feld ? String(feld.value || AVESMAPS_FREIE_LABEL_KEINE) : AVESMAPS_FREIE_LABEL_KEINE;
	};

	/**
	 * Traegt diese Beschriftung den Rahmen? Der Einstieg fuer die zwei Zeichenflaechen.
	 */
	window.avesmapsFreieLabelMarke = function avesmapsFreieLabelMarke(label) {
		if (typeof avesmapsFreieLabelMarkiert !== "function") {
			return false;
		}
		return avesmapsFreieLabelMarkiert(label, avesmapsFreieLabelMarkierungWahl());
	};

	// --- die Farbe ------------------------------------------------------------------------------
	// 🔴 SIE STEHT NICHT MEHR HIER, sondern im Trichter (label-markierungen.js, `avesmapsLabelMarkeFarbe`).
	// Seit es ZWEI Werkzeuge mit einem Kasten gibt, muss die Stelle, die den Kasten malt, aus der Marke
	// auf die Farbe schliessen koennen -- eine Farbfunktion je Werkzeug hiesse, dass der Maler die
	// Werkzeuge kennt. Der Token bleibt `--color-check-free-label`.

	// --- das Auswahlfeld ------------------------------------------------------------------------

	/**
	 * Die Zeilen des Felds aus dem geladenen Bestand bauen.
	 *
	 * 💣 DIE GEWAEHLTE ART UEBERLEBT DAS NEUAUFBAUEN. `prepareLabelData` laeuft auch nach einem
	 * Live-Abgleich im Editor -- wer gerade „Fluss" markiert hat und waehrenddessen jemand anders
	 * eine Beschriftung speichert, saehe seine Auswahl sonst lautlos auf „Keine" zurueckfallen und
	 * hielte das fuer einen verschluckten Klick.
	 * ⚠️ Nur, wenn es die Art noch GIBT: war sie die letzte ihrer Sorte, faellt die Wahl auf
	 * „Keine" -- eine ausgewaehlte Zeile, die nicht mehr in der Liste steht, waere ein Feld, das
	 * etwas anderes anzeigt als es tut.
	 */
	window.avesmapsFreieLabelMarkierungFeldFuellen = function avesmapsFreieLabelMarkierungFeldFuellen() {
		const feld = document.querySelector(FELD);
		if (!feld || typeof avesmapsFreieLabelArtenListe !== "function") {
			return;
		}
		const bestand = (typeof labelData !== "undefined" && Array.isArray(labelData)) ? labelData : [];
		const zeilen = avesmapsFreieLabelArtenListe(bestand);
		const vorher = String(feld.value || AVESMAPS_FREIE_LABEL_KEINE);

		feld.textContent = "";
		const anlegen = (wert, text) => {
			const option = document.createElement("option");
			option.value = wert;
			option.textContent = text;
			feld.appendChild(option);
		};
		// ⚠️ Durch `tr()`, wie jeder angezeigte Artname im Haus (siehe die Anmerkung ueber
		// AVESMAPS_LABEL_ART_NAMEN: die Tabelle uebersetzt nicht, wer den Namen ANZEIGT, legt tr()
		// darum). Ohne Uebersetzung faellt jeder Wert auf das deutsche Wort zurueck -- der Rueckfall
		// ist der zweite Parameter, nicht ein leeres Feld.
		const uebersetzt = (schluessel, deutsch, params) => (typeof tr === "function"
			? tr(schluessel, deutsch, params)
			: deutsch);
		anlegen(AVESMAPS_FREIE_LABEL_KEINE, uebersetzt("display.freeLabels.none", "Keine"));
		anlegen(AVESMAPS_FREIE_LABEL_ALLE,
			uebersetzt("display.freeLabels.all", `Alle (${bestand.length})`, { count: bestand.length }));
		zeilen.forEach((zeile) => anlegen(zeile.art,
			`${uebersetzt("spotlight.labelType." + zeile.art, zeile.name)} (${zeile.anzahl})`));

		const gibtEsNoch = vorher === AVESMAPS_FREIE_LABEL_KEINE
			|| vorher === AVESMAPS_FREIE_LABEL_ALLE
			|| zeilen.some((zeile) => zeile.art === vorher);
		feld.value = gibtEsNoch ? vorher : AVESMAPS_FREIE_LABEL_KEINE;
	};

	// --- das Nachziehen -------------------------------------------------------------------------

	/**
	 * Zwei Zeichenflaechen, ein Aufruf.
	 *
	 * 💣 GETRENNT GERUFEN GINGE DAS SCHIEF, und zwar unsichtbar: ein gebogener Name (Canvas) und
	 * ein gerader (divIcon) koennen zur SELBEN Landschaft gehoeren und nebeneinander auf der Karte
	 * stehen. Zoege nur eine Flaeche nach, traegt der eine den Kasten und der andere nicht -- und
	 * das liest sich wie ein Befund, nicht wie ein halb gezeichnetes Bild. Genau diese
	 * Haelfte-rot-Haelfte-nicht-Lage hat „Offene Wegenden" am 22.08.2026 gekostet.
	 *
	 * ⚠️ Die Kurvenlabel-Ablage ist nur nach Zoomstufe und Ausschnitt gestempelt -- ohne das
	 * Verwerfen bliebe der gemalte Name ohne seinen Kasten stehen, weil sich an beidem nichts
	 * geaendert hat.
	 */
	window.avesmapsSyncFreieLabelMarkierung = function avesmapsSyncFreieLabelMarkierung() {
		if (!istVerfuegbar()) {
			return;
		}
		// 💣 SEIT DEM 02.09.2026 AUCH DIE SICHTBARKEIT: ein markierter Name ueberspringt sein Zoomband
		// (Owner: „dass ich auf allen zoomstufen die markierungen sehe"). Ohne diesen Aufruf kaemen die
		// Funde ausserhalb ihres Bandes erst beim naechsten Zoomschritt auf die Karte -- und das sieht
		// aus wie ein verschluckter Klick, nicht wie eine fehlende Zeile.
		if (typeof syncLabelVisibility === "function") {
			syncLabelVisibility();
		}
		if (typeof avesmapsLabelIconsNeuBauen === "function") {
			avesmapsLabelIconsNeuBauen();
		}
		if (typeof avesmapsKurvenlabelAblageVerwerfen === "function") {
			avesmapsKurvenlabelAblageVerwerfen();
		}
	};
})();
