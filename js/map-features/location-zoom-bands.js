// Die Zoombänder: wann eine Ortsklasse erscheint, wie groß ihr Punkt ist, wie groß ihr Name.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE DER VORGABEWERTE. Der Server kennt sie nicht -- er
// speichert nur die Übersteuerung und gibt sie zurück. Läge dieselbe Tafel auch dort, gäbe es sie
// zweimal und sie liefen auseinander.
//
// Geladen von index.html (die Karte, VOR js/config.js) UND von
// html/wiki-sync-settlement-editor.html (das Fenster, das sie anzeigt und zurücksetzt).

const AVESMAPS_ZOOM_BAND_MAX_ZOOM = 8;

// Schranken für einen von Hand eingetragenen Wert. Alles außerhalb fällt auf die Vorgabe zurück.
const AVESMAPS_ZOOM_BAND_LIMITS = {
	marker: { min: 0.5, max: 100 }, // Außendurchmesser in px
	label: { min: 4, max: 30 },     // Schriftgröße in pt
};

// 🔴 AUFGABE 8B -- GLOBALE Abstände, kein Wert je Ortsklasse/Zoomstufe (Owner-Entscheid
// 16.08.2026, Prototyp docs/zoombaender-mockup.html). Eigene, engere Schranke als marker/label:
// 0 bis 20 px in 0,5-px-Schritten (Vorgabe im Fenster).
const AVESMAPS_LOCATION_LABEL_SPACING_LIMITS = { min: 0, max: 20 };

// 🔴 „drift" braucht eine EIGENE, weitere Schranke als die anderen drei: er ist kein Abstand
// zwischen zwei Dingen, sondern ein DECKEL darauf, wie weit eine Ausweichstelle den Namen von
// seiner Normalstellung wegrückt (Owner 22.08.2026: „den maximalen versatz ... will ich begrenzen
// bis sie verschwinden").
//
// 💣 DIE SPANNE RICHTET SICH NACH DEM SEITENWECHSEL, und der hängt an der NAMENSLÄNGE -- nicht an
// einer festen Geometrie. Springt der Name auf die andere Seite des Punktes, rückt er um seine
// eigene Breite plus zweimal den Spalt weg: live gemessen 78 bis 203 px, Median 123. Der größte
// über den ganzen Bestand erreichbare Wert (längster Name je Ortsklasse in DEREN größter Schrift,
// 2882 Namen) ist 287 px. 300 liegt darüber, die Vorgabe schneidet also nichts weg -- und die
// Arbeit des Reglers passiert zwischen 0 und 203, also auf gut zwei Dritteln seines Weges.
//
// ⚠️ Der senkrechte Anteil ist dagegen klein (höchstens Kastenhöhe + Versatz, rund 50 px). Eine
// Spanne, die nur ihn abdeckt, kann den Seitenwechsel nicht verhindern -- und der ist das, was ein
// Betrachter als „zu weit weg" sieht.
const AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS = { min: 0, max: 300 };

// Die Schranke eines einzelnen globalen Abstands. Ohne eigenen Eintrag gilt die enge Vorgabe --
// eine Zeile je Schlüssel, damit ein neuer Abstand nicht stillschweigend die Schranke eines
// fremden erbt.
const AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY = { drift: AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS };

function avesmapsLocationLabelSpacingLimits(key) {
	return AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY[key] || AVESMAPS_LOCATION_LABEL_SPACING_LIMITS;
}

// 🔴 DAS HEUTIGE BILD, ZIFFER FÜR ZIFFER (Entwurf §3.2). `null` = auf dieser Stufe gibt es diese
// Klasse nicht -- die erste gefüllte Zelle IST die Erscheinungsstufe.
// Die Markerwerte sind aus der abgeschafften geometrischen Kurve gerechnet und wie bisher auf zwei
// Stellen gerundet; z7 erbt z6, weil der Zeichner dort geklemmt hat. Bewacht von
// __tests__/zoombaender-vorgabe.test.js -- wer hier eine Zahl ändert, ändert die Karte.
// 🔴 z8 ERBT z7, ausnahmslos: die Zoomstufe 8 gibt es auf der Karte noch nicht (index.html setzt
// maxZoom: 7), also hat niemand entschieden, wie sie aussehen soll. Erben ändert zur Laufzeit
// nichts -- die Karte fragt nie eine Stufe über 7 ab.
const AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS = {
	marker: {
		metropole: [6.65, 9.4, 13.3, 18.81, 26.6, 37.62, 53.2, 53.2, 53.2],
		grossstadt: [3.99, 5.86, 8.6, 12.62, 18.52, 27.18, 39.9, 39.9, 39.9],
		stadt: [1.33, 2.26, 3.84, 6.52, 11.07, 18.79, 31.92, 31.92, 31.92],
		kleinstadt: [null, 1.33, 2.39, 4.29, 7.7, 13.82, 24.82, 24.82, 24.82],
		dorf: [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74, 17.74],
		gebaeude: [null, null, null, 1.33, 2.8, 5.9, 12.42, 12.42, 12.42],
	},
	label: {
		metropole: [8, 9, 11, 13, 17, 19, 19, 19, 19],
		grossstadt: [8, 8.5, 10, 12, 15, 17, 17, 17, 17],
		stadt: [null, null, 9, 11, 13, 15, 15, 15, 15],
		kleinstadt: [null, null, null, 9.5, 11, 13, 13, 13, 13],
		dorf: [null, null, null, null, 10, 11, 11, 11, 11],
		gebaeude: [null, null, null, null, 9, 9, 9, 9, 9],
	},
	// 🔴 AUFGABE 8B: drei GLOBALE Abstände -- keine Zeile je Ortsklasse/Zoomstufe, nur je EINE Zahl.
	// Vorgabewerte wörtlich aus den bisherigen Konstanten übernommen (die einzige Quelle bleibt diese
	// Datei; die Konstanten selbst wurden entfernt bzw. werden nur noch von hier abgeleitet):
	//   spalt   = LOCATION_NAME_LABEL_GAP (4, war js/map-features/map-features-location-name-labels.js)
	//   repel   = LOCATION_LABEL_COLLISION_PADDING (2, war js/map-features/map-features.js)
	//   versatz = LOCATION_LABEL_SHIFT_SMALL (8, war js/map-features/map-features.js)
	// 🔴 22.08.2026 -- „drift" ist der VIERTE und einzige, der vorher keine Konstante hatte: es gab
	// keinen Deckel, ein Name durfte so weit abheben, wie die weiteste Ausweichstelle reicht. Die
	// Vorgabe 300 liegt über dem größten erreichbaren Drift (gemessen 287) und schneidet deshalb
	// nichts weg (siehe AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS) -- beim Ausliefern ändert sich nichts.
	abstaende: { spalt: 4, repel: 2, versatz: 8, drift: 300 },
};

// Eine Zeile gegen ihre Vorgabe normalisieren.
//
// 💣 `null` UND `fehlt` SIND ZWEI VERSCHIEDENE DINGE. `null` ist eine Aussage („hier nicht"),
// alles andere Unbrauchbare ist ein Nichtwissen („nimm die Vorgabe"). Wer beide gleich behandelt,
// macht entweder das Ausblenden unmöglich oder löscht bei jedem Formatwechsel die halbe Karte.
function avesmapsZoomBandNormalizeRow(row, defaultRow, limits) {
	const result = [];
	let erschienen = false;
	for (let z = 0; z <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; z += 1) {
		const raw = Array.isArray(row) ? row[z] : undefined;
		let value;
		if (raw === null) {
			value = null;
		} else if (typeof raw === "number" && Number.isFinite(raw) && raw >= limits.min && raw <= limits.max) {
			value = raw;
		} else {
			value = defaultRow[z] ?? null;
		}
		// 💣 KEIN LOCH. Ab der ersten gefüllten Zelle erbt jede leere den letzten Wert -- ein Ort,
		// der bei z3 sichtbar, bei z4 weg und bei z5 wieder da ist, sieht wie ein Fehler aus, egal
		// wie er entstanden ist. Damit kann auch ein von Hand verbogener Datenbankwert keins bauen.
		if (value === null && erschienen) {
			value = result[z - 1];
		}
		if (value !== null) {
			erschienen = true;
		}
		result.push(value);
	}
	return result;
}

// AUFGABE 8B: ein einzelner globaler Abstand. Anders als eine Zeile hat er KEINE Loch-Regel und
// KEIN `null` = "unsichtbar" -- ein Abstand ist immer eine Zahl. Fehlend, unbrauchbar oder außerhalb
// der Schranke ist ein Nichtwissen wie bei einer Zelle (Punkt 4), nur ohne Punkt 3 (es gibt kein
// "hier nicht" für einen globalen Abstand).
function avesmapsZoomBandNormalizeSpacingValue(raw, defaultValue, limits) {
	if (typeof raw === "number" && Number.isFinite(raw) && raw >= limits.min && raw <= limits.max) {
		return raw;
	}
	return defaultValue;
}

// ⚠️ Läuft über die Schlüssel der VORGABE, nicht über die des Gespeicherten: eine unbekannte
// Klasse in der Datenbank wird damit still ignoriert. Der Browser führt die Liste, nicht der Server.
function avesmapsResolveLocationZoomBands(stored) {
	const source = (stored && typeof stored === "object" && !Array.isArray(stored)) ? stored : {};
	const resolved = {};
	["marker", "label"].forEach((kind) => {
		const storedKind = (source[kind] && typeof source[kind] === "object" && !Array.isArray(source[kind]))
			? source[kind]
			: {};
		resolved[kind] = {};
		Object.keys(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS[kind]).forEach((locationType) => {
			resolved[kind][locationType] = avesmapsZoomBandNormalizeRow(
				storedKind[locationType],
				AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS[kind][locationType],
				AVESMAPS_ZOOM_BAND_LIMITS[kind]
			);
		});
	});
	// 🔴 RÜCKWÄRTSKOMPATIBEL: eine vor Aufgabe 8b gespeicherte Übersteuerung kennt "abstaende" gar
	// nicht -- ein fehlender Abschnitt ist dasselbe Nichtwissen wie ein fehlender Schlüssel darin,
	// nicht anders zu behandeln als ein leeres Objekt.
	const storedAbstaende = (source.abstaende && typeof source.abstaende === "object" && !Array.isArray(source.abstaende))
		? source.abstaende
		: {};
	resolved.abstaende = {};
	Object.keys(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende).forEach((key) => {
		resolved.abstaende[key] = avesmapsZoomBandNormalizeSpacingValue(
			storedAbstaende[key],
			AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende[key],
			avesmapsLocationLabelSpacingLimits(key)
		);
	});
	return resolved;
}

let _avesmapsLocationZoomBands = avesmapsResolveLocationZoomBands(null);

function avesmapsLocationZoomBands() {
	return _avesmapsLocationZoomBands;
}

function avesmapsApplyLocationZoomBands(stored) {
	const next = avesmapsResolveLocationZoomBands(stored);
	const changed = JSON.stringify(next) !== JSON.stringify(_avesmapsLocationZoomBands);
	_avesmapsLocationZoomBands = next;
	return changed;
}

// Der Wert einer Zelle, oder null („auf dieser Stufe gibt es diese Klasse nicht").
function avesmapsLocationZoomBandValue(kind, locationType, zoomLevel) {
	const row = _avesmapsLocationZoomBands[kind] && _avesmapsLocationZoomBands[kind][locationType];
	if (!row) {
		return null;
	}
	const rounded = Math.round(Number(zoomLevel));
	const z = Number.isFinite(rounded) ? Math.max(0, Math.min(AVESMAPS_ZOOM_BAND_MAX_ZOOM, rounded)) : 0;
	return row[z];
}

// AUFGABE 8B -- der Zugriff, den die Zeichner rufen: der wirksame Wert eines globalen Abstands
// ("spalt" | "repel" | "versatz"), oder die Vorgabe, solange noch nichts geladen/angewendet wurde.
function avesmapsLocationLabelSpacing(key) {
	const abstaende = _avesmapsLocationZoomBands.abstaende;
	if (abstaende && typeof abstaende[key] === "number") {
		return abstaende[key];
	}
	return AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.abstaende[key];
}

// Die Erscheinungsstufe: die erste gefüllte Zelle. null = diese Klasse erscheint nirgends.
function avesmapsLocationZoomBandMinZoom(kind, locationType) {
	const row = _avesmapsLocationZoomBands[kind] && _avesmapsLocationZoomBands[kind][locationType];
	if (!row) {
		return null;
	}
	const index = row.findIndex((value) => value !== null);
	return index < 0 ? null : index;
}

const AVESMAPS_ZOOM_BANDS_ENDPOINT = "api/app/zoom-bands.php";

// ⚠️ Wird NICHT beim Laden dieser Datei gerufen. Der Ortseditor lädt sie ebenfalls und holt seine
// Werte über seinen eigenen, angemeldeten Endpunkt -- ein Aufruf hier würde dort eine zweite,
// nutzlose Anfrage auslösen. Der Aufruf steht in js/config.js.
//
// 🔴 Fällt still aus: ohne Antwort bleiben die Vorgabewerte, und die Karte zeichnet wie bisher.
function avesmapsLoadLocationZoomBands() {
	return fetch(AVESMAPS_ZOOM_BANDS_ENDPOINT, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((payload) => {
			if (!payload || payload.ok !== true) {
				return false;
			}
			return avesmapsApplyLocationZoomBands(payload.bands);
		})
		.catch(() => false);
}

// ⚠️ NUR FÜR DIE NODE-TESTS. Im Browser teilen klassische <script>-Bausteine ihre obersten `const`
// über die globale lexikalische Umgebung; `vm.runInThisContext` tut das NICHT -- ein zweites Skript
// sähe AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS dort nicht. Funktionsdeklarationen wandern von selbst
// ins globale Objekt, die Konstanten nicht.
if (typeof globalThis !== "undefined") {
	globalThis.AVESMAPS_ZOOM_BAND_MAX_ZOOM = AVESMAPS_ZOOM_BAND_MAX_ZOOM;
	globalThis.AVESMAPS_ZOOM_BAND_LIMITS = AVESMAPS_ZOOM_BAND_LIMITS;
	globalThis.AVESMAPS_LOCATION_LABEL_SPACING_LIMITS = AVESMAPS_LOCATION_LABEL_SPACING_LIMITS;
	globalThis.AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS = AVESMAPS_LOCATION_LABEL_DRIFT_LIMITS;
	globalThis.AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY = AVESMAPS_LOCATION_LABEL_SPACING_LIMITS_BY_KEY;
	globalThis.AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;
}
