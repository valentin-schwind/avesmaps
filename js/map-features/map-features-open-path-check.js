// Prüfhaken „Offene Wegenden" (Idee #86, Thomas 20.08.2026): welche Wege enden weder auf einem Ort
// noch auf einer Kreuzung. Nur für Editoren, nur wenn der Haken im Anzeige-Menü an ist.
//
// 🔴 DER BEFUND IST KEIN SCHÖNHEITSFEHLER. `getLocationAtPathEndpoint` ist genau die Rechnung, mit der
// BEIDE Graphbauer einen Weg annehmen oder verwerfen — der Browser in `addRegularPathToGraph`
// (js/routing/route-graph-routing.js:135-139) und der Server in
// `avesmapsAddClientCompatiblePathConnection` (api/_internal/routing/client-graph.php:232-234), beide
// mit derselben Zwei-Stufen-Suche und derselben Toleranz. Findet sie an EINEM Ende nichts, existiert
// der ganze Weg für die Routenfindung nicht. Live gemessen 22.08.2026: 51 Wege, 53 offene Enden, und
// 42 davon sind ein LOSER STOSS — zwei bis vier Wegenden auf demselben Punkt, auf dem keine Kreuzung
// sitzt (östlich von Abszint liegen vier Pfade so).
//
// 💣 DIE RECHNUNG WIRD NICHT NACHGEBAUT, SIE WIRD GERUFEN. Eine zweite, „schnellere" Endpunktsuche
// hier wäre die zweite Wahrheit: die Zwei-Stufen-Regel (exakter Treffer < 0,01 schlägt den 0,5-Kasten,
// sonst niedrigster Index) ist am 07.08.2026 aus einem Fehlstand heraus entstanden und hängt an
// Feinheiten, die man beim Abschreiben verliert — 541 von 11.662 Endpunkten gingen damals an den
// falschen Ort. Wer sie ändern will, ändert sie an ihren zwei Stellen (JS + PHP), nicht hier.
//
// ⚠️ ZWEI ZEICHEN FÜR DIESELBE LÜCKE, UND DAS IST ABSICHT. Discord #43 markiert offene Wegenden
// bereits bernsteinfarben und gestrichelt (map-features-location-detach-edit.js) — aber nur die aus
// der EIGENEN Merkliste: was dieser Browser gerade per Strg vom Ort weggezogen hat, ein flüchtiger
// Arbeitszustand. Dieser Haken fragt den GESAMTBESTAND. Gleiche Rechnung, andere Herkunft, andere
// Aussage — deshalb rot und durchgezogen. Treffen beide auf dieselbe Stelle, liegen die Ringe
// ineinander; das ist selten (die Merkliste ist normalerweise leer) und liest sich richtig.
(function initialisiereOffeneWegenden() {
	// Mindestbreite der roten Linie. 💣 Sie ist tragend, nicht Kosmetik: `getPathWidthScale` fährt eine
	// Wegart auf kleinen Zoomstufen auf 0 herunter, und ein Weg der Breite 0 ist auf der Karte, aber
	// unsichtbar — der Haken hätte seinen Fund dann „eingeblendet" und trotzdem nichts gezeigt.
	const BEFUND_MINDESTBREITE = 3.5;
	const BEFUND_RING_GROESSE = 30;

	let befundIndex = null;
	let ringGruppe = null;
	let ringMarker = [];
	// 💣 EIGENE LISTE, NICHT DER INDEX. Welche Wege gerade rot GEZEICHNET sind, muss auch dann bekannt
	// sein, wenn der Index nicht mehr gerechnet werden darf -- und beim Ausschalten darf er das nicht
	// (siehe die Begründung in avesmapsSyncOpenPathEndCheck). Ohne diese Liste blieben die Wege nach dem
	// Ausschalten rot: die Ringe verschwanden, die Linien nicht. Im Browser gemessen, 22.08.2026.
	let zuletztGefaerbt = [];

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
			&& typeof L !== "undefined" && typeof map !== "undefined" && Boolean(map);
	}

	// --- die Rechnung -------------------------------------------------------

	function baueIndex() {
		const wege = new Set();
		const stellen = [];

		if (typeof pathData === "undefined" || !Array.isArray(pathData)
			|| typeof locationData === "undefined" || !Array.isArray(locationData) || locationData.length === 0) {
			// 💣 Kein Bestand, kein Urteil. Vor dem Eintreffen der Features fände die Endpunktsuche
			// NIRGENDS einen Ort und der Haken meldete schlagartig alle 6.023 Wege als kaputt.
			// Der Index bleibt darum ungesetzt und wird beim nächsten Aufruf neu versucht.
			return null;
		}

		pathData.forEach((path) => {
			const koordinaten = path?.geometry?.coordinates;
			if (!Array.isArray(koordinaten) || koordinaten.length < 2) {
				return;
			}

			[["start", koordinaten[0]], ["end", koordinaten[koordinaten.length - 1]]].forEach(([ende, punkt]) => {
				if (!Array.isArray(punkt) || punkt.length < 2) {
					return;
				}
				if (getLocationAtPathEndpoint(punkt)) {
					return;
				}
				wege.add(path);
				stellen.push({ path, ende, koordinate: punkt });
			});
		});

		return { wege, stellen };
	}

	function holeIndex() {
		if (!befundIndex) {
			befundIndex = baueIndex();
		}
		return befundIndex;
	}

	// --- was andere Module fragen --------------------------------------------

	// Ist der Haken an? 💣 Der Riegel `IS_EDIT_MODE` steht HIER und nicht nur am ausgeblendeten
	// Menüeintrag: `?toggleOpenPathEnds=1` im geteilten Link erreicht sonst auch einen Besucher.
	window.avesmapsIsOpenPathEndCheckActive = function avesmapsIsOpenPathEndCheckActive() {
		return istVerfuegbar() && $("#toggleOpenPathEnds").is(":checked");
	};

	// Hat dieser Weg ein offenes Ende? Beantwortet die Frage unabhängig vom Haken — die Färbung
	// entscheidet der Aufrufer. Set-Zugriff, also auch im Zoom-Pfad billig.
	window.avesmapsPathHasOpenEnd = function avesmapsPathHasOpenEnd(path) {
		if (!path) {
			return false;
		}
		const index = holeIndex();
		return Boolean(index && index.wege.has(path));
	};

	window.avesmapsOpenPathEndCount = function avesmapsOpenPathEndCount() {
		const index = holeIndex();
		return index ? index.stellen.length : 0;
	};

	// Der Bestand hat sich geändert (Weg gezeichnet, Kreuzung gesetzt, Ort verschoben) — beim nächsten
	// Zugriff neu rechnen. Gerufen aus refreshPlannerAfterFeatureChange (js/routing/route-render.js),
	// dem einen Sammelpunkt nach JEDER Feature-Änderung.
	window.avesmapsInvalidateOpenPathEndCheck = function avesmapsInvalidateOpenPathEndCheck() {
		befundIndex = null;
	};

	// --- die Fundstellen-Ringe ------------------------------------------------

	function erzeugeRingIcon() {
		return L.divIcon({
			className: "open-path-check-marker",
			html: '<span class="open-path-check-marker__ring"></span>',
			iconSize: [BEFUND_RING_GROESSE, BEFUND_RING_GROESSE],
			iconAnchor: [BEFUND_RING_GROESSE / 2, BEFUND_RING_GROESSE / 2],
		});
	}

	function baueRingTooltip(stelle) {
		const name = (typeof getPathDisplayName === "function" && getPathDisplayName(stelle.path)) || "Weg";
		const sicher = typeof escapeHtml === "function" ? escapeHtml(name) : name;
		return `<strong>Offenes Wegende</strong> — ${sicher}<br>`
			+ "Hier liegt weder Ort noch Kreuzung: der Weg wird beim Routen verworfen.<br>"
			+ "Klick: Weg bearbeiten und Ende anschließen.";
	}

	function holeRingGruppe() {
		if (!ringGruppe) {
			ringGruppe = L.layerGroup().addTo(map);
		}
		return ringGruppe;
	}

	function zeichneRinge(stellen) {
		const gruppe = holeRingGruppe();
		ringMarker.forEach((marker) => gruppe.removeLayer(marker));
		ringMarker = [];

		stellen.forEach((stelle) => {
			const marker = L.marker([stelle.koordinate[1], stelle.koordinate[0]], {
				icon: erzeugeRingIcon(),
				pane: "measurementHandlesPane",
				keyboard: false,
				bubblingMouseEvents: false,
			});
			marker.bindTooltip(baueRingTooltip(stelle), { direction: "top", offset: [0, -16] });
			// ⭐ Das Reparatur-Verb: eine Diagnoseliste, aus der man nicht reparieren kann, sammelt ihre
			// Funde nur an. Derselbe Griff wie beim bernsteinfarbenen Ring aus Discord #43.
			marker.on("click", (event) => {
				L.DomEvent.stop(event);
				if (typeof startPathGeometryEdit === "function") {
					startPathGeometryEdit(stelle.path);
				}
			});
			marker.addTo(gruppe);
			ringMarker.push(marker);
		});
	}

	function raeumeRinge() {
		if (!ringGruppe) {
			return;
		}
		ringMarker.forEach((marker) => ringGruppe.removeLayer(marker));
		ringMarker = [];
	}

	// --- der eine Aufruf ------------------------------------------------------

	// 🔴 EINE Funktion für Ringe UND Wegsichtbarkeit. Genau daran ist „Unverbunden" anderthalb Jahre
	// gescheitert: markiert wurde nur, was eine ANDERE Einstellung ohnehin sichtbar ließ, und das waren
	// nie die gesuchten Objekte. Deshalb zieht `syncPathVisibility` unten die Wege nach, die dieser Haken
	// einblendet — Ring und Einblendung hängen am selben Aufruf und können nicht auseinanderlaufen.
	// `zieheWegeNach: false` nur für Aufrufer, die syncPathVisibility ohnehin gerade selbst gefahren sind
	// (applyDisplayOptions). Ein zweiter Durchlauf kostet dort 6.023 Wege für nichts.
	window.avesmapsSyncOpenPathEndCheck = function avesmapsSyncOpenPathEndCheck({ zieheWegeNach = true } = {}) {
		if (!istVerfuegbar()) {
			return;
		}

		// 💣 DER INDEX WIRD NUR BEI EINGESCHALTETEM HAKEN GERECHNET. Er kostet am Livebestand 465 ms
		// (6.023 Wege × 2 Enden gegen 4.972 Orte, linear -- `getLocationAtPathEndpoint` hat kein
		// Ortsraster, und eins hier danebenzustellen wäre die zweite Wahrheit). Diese Funktion läuft aber
		// bei JEDEM applyDisplayOptions und nach JEDER Feature-Änderung: stünde `holeIndex()` vor der
		// Abfrage, zahlte jeder Editor die halbe Sekunde dauernd, ohne den Haken je angefasst zu haben.
		let index = null;
		if (!avesmapsIsOpenPathEndCheckActive()) {
			raeumeRinge();
		} else {
			index = holeIndex();
			zeichneRinge(index ? index.stellen : []);
		}

		if (zieheWegeNach && typeof syncPathVisibility === "function") {
			syncPathVisibility();
		}

		// 💣 Die Sichtbarkeit allein genügt nicht: `syncPathVisibility` hängt Layer nur an die Karte und
		// ab, es fasst den STIL nicht an -- und `getPathStyleColors` läuft sonst nur beim Anlegen des
		// Layers. Ohne diese Schleife käme ein Weg beim Einschalten zwar auf die Karte, aber in seiner
		// alten Farbe.
		// 🔴 UND SIE MUSS BEIDE MENGEN TREFFEN: die jetzigen Funde UND die zuletzt gefärbten. Beim
		// Ausschalten ist `index` absichtlich null (nicht rechnen ohne Haken) -- ohne `zuletztGefaerbt`
		// bliebe dann jede rote Linie rot stehen, während ihr Ring schon weg ist. Genau so gemessen.
		const nachzuziehen = new Set(zuletztGefaerbt);
		if (index) {
			index.wege.forEach((path) => nachzuziehen.add(path));
		}
		zuletztGefaerbt = index ? [...index.wege] : [];
		if (typeof updatePathLayerStyle === "function") {
			nachzuziehen.forEach((path) => updatePathLayerStyle(path));
		}
	};

	// Der Zuschnitt der roten Linie. Liegt hier und nicht in getPathStyleColors, damit die Breite und die
	// Begründung ihrer Untergrenze beieinanderstehen.
	//
	// 💣 DER TOKEN WIRD AUSGELESEN, NICHT DURCHGEREICHT. Leaflet schreibt `color` beim Canvas-Renderer in
	// den 2D-Kontext und beim SVG-Renderer in das Präsentationsattribut `stroke` — in BEIDEN löst `var()`
	// nicht auf, die Linie bliebe schwarz bzw. unsichtbar. Hausmuster wie in den Landschaften-Modulen.
	// Einmal gelesen und behalten: der Wert ist in tokens.css gepinnt (kein Dark-Override, er liegt auf
	// den immer hellen Kartenkacheln), und ein Aufruf je Weg und Zoomstufe wäre 6.023 × getComputedStyle.
	let befundFarbe = "";
	window.avesmapsOpenPathEndStyle = function avesmapsOpenPathEndStyle(basisBreite) {
		if (!befundFarbe) {
			befundFarbe = getComputedStyle(document.documentElement)
				.getPropertyValue("--color-path-open-end").trim() || "#e01b24";
		}
		return {
			farbe: befundFarbe,
			breite: Math.max(Number(basisBreite) || 0, BEFUND_MINDESTBREITE),
		};
	};
})();
