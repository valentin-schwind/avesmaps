// Die Darstellungstafel der Landschaften: Ton und Deckkraft der Flaechen, Farbe, Schriftgroesse
// und Zoomband der Namen. Entwurf: docs/superpowers/specs/2026-08-24-landschaften-darstellung-design.md
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE DER ZAHLEN-VORGABEN. Der Server kennt sie nicht -- er
// speichert nur die Uebersteuerung und gibt sie zurueck. Laege dieselbe Tafel auch dort, gaebe es
// sie zweimal und sie liefen auseinander. Dieselbe Arbeitsteilung wie bei den Zoombaendern
// (js/map-features/location-zoom-bands.js).
//
// 🔴 UND SIE ENTHAELT KEINE FARBE. Die rund 20 Namenstoene stehen in css/features/map-labels.css,
// die 33 Flaechentoene in css/base/tokens.css -- der Aufrufer liest den Token und reicht ihn
// herein; dieses Modul entscheidet nur, ob eine Uebersteuerung ihn schlaegt. Eine Farbe zweimal
// aufzuschreiben ist Divergenz mit Anlauf (AGENTS.md §12).
//
// Geladen von index.html (die Karte, VOR map-features-labels.js) UND von
// html/landschaften-editor.html (das Fenster, das die Tafel anzeigt und schreibt).

// ---- Die Deckkraft je EBENE ------------------------------------------------------------------
// 🔴 ZIFFER FUER ZIFFER aus css/features/ecosystem-layer.css, Stand 24.08.2026. Sie ist NICHT eine
// Zahl fuer alle: ein derographischer Behaelter steht bei 0,16, weil er ein Behaelter ist und die
// Karte darunter tragen soll; Vegetation und Topographie bei 0,72 (Owner 2026-08-04: „die Farben
// kraeftiger"), die Klimabaender bei 0,30.
// 💣 Wer daraus eine einzige Zahl macht, zieht die vier zusammen -- und drei der vier Aussagen sind
// dann falsch.
const AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT = {
	derographisch: 0.16,
	vegetation: 0.72,
	topographie: 0.72,
	klima: 0.30,
};

// ---- Die Schriftgroesse ----------------------------------------------------------------------
// 🔴 GERECHNET, NICHT ABGESCHRIEBEN: dieselbe Formel wie getScaledLabelSize in
// map-features-labels.js, mit der Grundgroesse 18 aus index.html.
//   zoomRatio   = min(1, z / 5)                    VISUAL_MAX_ZOOM_LEVEL
//   ueberVisual = clamp(z - 5, 0, 2)               seit 23.08.2026, „nach unten hin groesser"
//   groesse     = round(18 * (0.5 + zoomRatio*0.5) * (1 + ueberVisual*0.08))
//
// ⚠️ DIE EINE STELLE, an der die Zoombaender-Regel „die Vorgabe reproduziert das heutige Bild
// Ziffer fuer Ziffer" nicht ganz gelten kann: heute traegt JEDES Label seine eigene Grundgroesse
// (12-50). Es gibt keine Kurve je Art, die man abschreiben koennte. Jedes Label, das nicht auf 18
// steht, aendert beim Ausliefern sichtbar seine Groesse -- der Preis dafuer, dass die Groesse
// global wird (Entwurf §5.5).
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_BASIS = 18;
const AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX = 5;
const AVESMAPS_ECOSYSTEM_DISPLAY_TIEF_SCHRITT = 0.08;
const AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS = { min: 4, max: 30 };

// ---- Die Vorgaben je Art ----------------------------------------------------------------------
// 🔴 NICHT BINDEND (Entwurf §6). Der Editor stellt weiter jedes Label einzeln; diese vier Werte
// erscheinen bei ihm nur als MARKE auf dem Reglerbalken. Die Zahlen sind die heutigen Vorgaben aus
// index.html (min_zoom 0, max_zoom 7, curve_label_max 1, priority 3).
// ⚠️ Bewusst UNIFORM ueber alle Arten: eine Staffelung je Art hat nie jemand entschieden, und eine
// geratene Vorgabe saehe aus wie eine getroffene.
// Die Grundvorgabe -- sie gilt für jede Art, die unten keine eigene Zeile hat.
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE = { ab: 0, bis: 7, curveMax: 1, prio: 3 };

/**
 * Die Vorgabe JE ART, am Livebestand gemessen (24.08.2026, 939 Beschriftungen in 28 Arten).
 *
 * 🔴 Vorher stand hier für alle Arten dasselbe: z0 bis z7. Gemessen weichen davon **933 von 939**
 * Beschriftungen ab -- die uniforme Vorgabe war für praktisch jede falsch. Ein Wald erscheint
 * typischerweise ab z4, ein Gebirge ab z2, eine Wüstenoase ab z5.
 *
 * ⚠️ DAS BEWEGT HEUTE KEINE EINZIGE BESCHRIFTUNG. Alle 939 tragen ihr eigenes `min_zoom`, und die
 * fünf ohne `max_zoom` gehören Arten, deren Median dort 7 ist -- also genau der alte Wert. Die
 * Vorgabe wirkt erst auf Beschriftungen, die von hier an entstehen.
 *
 * 💣 Der Kommentar hinter jeder Zeile nennt die EINIGKEIT: bei `wuestenoase` stehen alle 9 auf
 * z5, bei `graslandschaft` nur ein Drittel. Wer eine Zeile ändert, sieht damit sofort, ob er eine
 * gefundene Regel anfasst oder eine Zahl, die ohnehin nur ein Drittel trägt.
 *
 * ⚠️ NUR `ab` und `bis`. `prio` hat in 939 Beschriftungen genau 4 Ausreisser -- sein Median IST
 * der Grundwert. Und `curveMax` ist von aussen nicht vollständig messbar (die Nutzlast trägt ihn
 * nur, wo eine Kurve gerechnet wurde); dafür ist „Median ermitteln" im Fenster die Quelle.
 *
 * ⭐ Diese Tafel ist ein SCHNAPPSCHUSS. Sie veraltet, sobald die Editoren weiterarbeiten --
 * deshalb misst das Fenster beim Öffnen neu und bietet die Übernahme an.
 */
const AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART = {
	auenlandschaft: { ab: 4 },   // 10 Namen, 40 % einig
	// 🔴 DIESE ZEILE UND `vulkan` SIND KEIN GEMESSENER MEDIAN MEHR, SONDERN EIN OWNER-ENTSCHEID --
	// UND SIE GELTEN (27.08.2026: „berggipfel und vulkane sollen ab Z4 erscheinen“). Fuer jede andere
	// Art raet diese Tafel nur; fuer die zwei Gipfelarten schlaegt sie das eigene Band des Labels
	// (avesmapsLabelImBand). Ohne das waere die Anweisung wirkungslos geblieben: live traegt JEDER
	// der 73 Gipfel ein eigenes min_zoom (z2: 2, z3: 30, z4: 19, z5: 17, z6: 5).
	// 💣 Wer hier „Alle uebernehmen“ im Darstellungs-Fenster drueberschreibt, verschiebt damit eine
	// Entscheidung und nicht bloss eine Marke.
	berggipfel: { ab: 4 },   // Owner-Entscheid 27.08.2026 (gemessener Median war ebenfalls 4)
	ebene: { ab: 3 },   // 2 Namen, 50 % einig
	fluss: { ab: 4 },   // 21 Namen, 67 % einig
	flussdelta: { ab: 2 },   // 2 Namen, 50 % einig
	flussland_flusstal: { ab: 3 },   // 31 Namen, 94 % einig
	gebirge: { ab: 2 },   // 76 Namen, 87 % einig
	graslandschaft: { ab: 3 },   // 6 Namen, 33 % einig
	hochebene: { ab: 3 },   // 3 Namen, 67 % einig
	huegelland: { ab: 3 },   // 21 Namen, 43 % einig
	insel: { ab: 2 },   // 103 Namen, 56 % einig
	inselgruppe: { ab: 2 },   // 5 Namen, 40 % einig
	kontinent: { bis: 3 },   // 1 Namen, 100 % einig
	kueste: { ab: 2 },   // 5 Namen, 80 % einig
	kulturlandschaft: { ab: 5 },   // 8 Namen, 63 % einig
	meer: { ab: 2 },   // 32 Namen, 78 % einig
	region: { ab: 2 },   // 125 Namen, 46 % einig
	see: { ab: 4 },   // 144 Namen, 73 % einig
	sonstiges: { ab: 4 },   // 1 Namen, 100 % einig
	steppe: { ab: 2 },   // 10 Namen, 90 % einig
	suempfe_moore: { ab: 3 },   // 45 Namen, 49 % einig
	tal: { ab: 2 },   // 29 Namen, 55 % einig
	tiefebene: { ab: 3 },   // 5 Namen, 80 % einig
	vulkan: { ab: 4 },   // Owner-Entscheid 27.08.2026 -- die EINE geaenderte Ziffer (Median war 3)
	wadi: { ab: 5 },   // 4 Namen, 75 % einig
	wald: { ab: 4 },   // 163 Namen, 67 % einig
	wueste: { ab: 2 },   // 5 Namen, 60 % einig
	wuestenoase: { ab: 5 },   // 9 Namen, 100 % einig
};

// ---- Die Abstaende der Namen: wie sie einander ausweichen ------------------------------------
// 🔴 DREI ZAHLEN, GLOBAL UEBER ALLE ARTEN (Owner 31.08.2026). Eine Staffelung je Art hat fuer 28
// Landschaftsarten nie jemand entschieden, und eine geratene Vorgabe saehe aus wie eine getroffene
// -- dieselbe Begruendung wie bei AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE darueber.
// Entwurf: docs/superpowers/specs/2026-08-31-landschaften-label-kollision-design.md
//
//   repel    Luft um jeden Namen, bevor die Kollision geprueft wird
//   versatz  Schrittweite EINES Ausweichschritts (der Ring waechst in diesen Schritten)
//   drift    wie weit ein Name hoechstens von seinem Punkt wegruecken darf. Darueber verschwindet
//            er -- seit dem 31.08.2026 auch dann, wenn eine Flaeche an ihm haengt.
//
// 💣 DIE 72 IST AM LAUFENDEN BROWSER GEMESSEN, NICHT GERECHNET. Im gemeldeten Fall („Gruene
// Zwillinge", drei Namen auf einem Punkt) stehen bei 40 nur einer, bei 56 zwei und ab 64 alle drei;
// die 72 gibt dem Fall eine Stufe Luft, weil 64 ihn auf den Pixel genau loest. Ueber den ganzen
// Livebestand (~900 Namen, 31.08.2026) verschwinden bei 72 an z4 acht Namen statt heute 37 -- und
// heute ueberlappen zusaetzlich 29, was danach keiner mehr tut.
//
// 🪤 UND HIER STAND ZWEI STUNDEN LANG 56, WEIL DIE MESSUNG DIE NAMEN ZU KLEIN GERECHNET HAT.
// `createLabelIcon` rendert das Namensbild MIT Halo (getLabelHaloParams); ein blanker
// `renderMapLabelToImage`-Aufruf, wie ihn eine Messung naheliegenderweise macht, liefert ein Bild,
// das 6 px schmaler und 6 px flacher ist. Bei einem 40 px hohen Namen sind das 15 % -- genug, um
// eine Simulation gruen aussehen zu lassen, waehrend der echte Fall im Browser einen Namen
// verliert. ⭐ Die Gegenprobe, die es gefunden hat, kostet nichts: das gerechnete Bildmass gegen die
// `width`/`height` des `<img>` im DOM halten, bevor irgendetwas darauf aufgebaut wird.
//
// ⚠️ Die Landschaftsnamen lasen bis dahin den Repel der ORTSCHAFTEN mit
// (measureLabelCollisionRect fiel auf avesmapsLocationLabelSpacing("repel") zurueck) -- eine
// Kopplung, die nirgends stand. Mit diesen drei Werten liest jede Familie ihren eigenen.
const AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE = { repel: 2, versatz: 8, drift: 72 };

// 💣 `versatz` HAT EINE UNTERGRENZE UEBER NULL, und das ist kein Geschmack: ein Versatz von 0
// liesse den Kandidatenbauer endlos schleifen. Er faengt das selbst ab (avesmapsFreeLabelCandidate-
// Placements), aber ein Regler, der einen unbrauchbaren Wert erst anbietet und dann verwirft, ist
// eine Falle fuer den, der ihn bedient.
const AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS = {
	repel: { min: 0, max: 20 },
	versatz: { min: 2, max: 24 },
	drift: { min: 0, max: 150 },
};

// ---- Kollision je NAMENSART: nimmt der Name teil, und darf er verschoben werden? --------------
// 🔴 ZWEI HAEKCHEN, UND SIE HAENGEN VONEINANDER AB (Owner 02.09.2026: „berggipfel werden derzeit in
// die kollisionserkennung aufgenommen und verschoben").
//   teil   nimmt dieser Name am Ausweichen ueberhaupt teil? Aus heisst: er steht, wo er steht --
//          er wird nie verschoben, nie ausgeblendet, und er belegt NICHTS.
//   fest   er nimmt teil, aber ER rueckt nicht: sein Rechteck wird VORGELEGT (wie das eines Namens
//          auf einer gerechneten Kurve), die anderen weichen ihm aus.
//
// 🔴 DIE VORGABE IST DAS HEUTIGE BILD, Ziffer fuer Ziffer: teilnehmen ja, verschieben ja. Beim
// Ausliefern aendert sich damit nichts -- dieselbe Regel wie bei den Zoombaendern.
//
// 💣 `fest` HEISST AUCH: NIE AUSGEBLENDET. Findet ein festgenagelter Name keinen Platz, bleibt er
// stehen und ueberlappt notfalls. Die Gegenrichtung („steht still ODER verschwindet") machte aus
// „verschieb meine Gipfel nicht" ein „loesch meine Gipfel" -- gemessen an der Kartenlage waere
// genau das der haeufige Fall, weil ein Gipfel dicht bei seinen Nachbarn steht.
//
// ⚠️ `fest` OHNE `teil` HAT KEINEN GEGENSTAND -- wer gar nicht teilnimmt, wird ohnehin nicht
// verschoben. Der gespeicherte Wert bleibt trotzdem stehen (das Fenster macht das Haekchen nur
// stumm), damit er unveraendert zurueckkommt, wenn `teil` wieder gesetzt wird.
const AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE = { teil: true, fest: false };

/**
 * Die Kollisionsregel einer Namensart, wie sie WIRKT: `{ teil, fest }`.
 *
 * 🔴 FAELLT OFFEN AUS: alles, was keine ausdrueckliche Uebersteuerung ist (fehlender Schluessel,
 * kaputter Wert, kein Boolean), gilt als Vorgabe -- also als „so wie heute". Der schlimmste Fall
 * eines kaputten Einstellungswertes ist damit „es bleibt beim Alten" und nie „alle Namen
 * verschwinden".
 * ⚠️ Steht im Kollisionsdurchgang und laeuft je Beschriftung und je Bild -- kein Wurf, keine
 * Meldung, dieselbe Begruendung wie bei avesmapsEcosystemDisplayAbstand.
 */
function avesmapsEcosystemDisplayKollision(subtype) {
	return avesmapsEcosystemKollisionAus(avesmapsEcosystemDisplayTeil("kollision")[String(subtype || "")]);
}

/**
 * Dieselbe Regel, aber aus einem MITGEGEBENEN Satz -- ohne den Modulzustand anzufassen.
 *
 * 🔴 DAFUER GIBT ES EINEN GRUND, und er steht als Warnung im Landschaften-Editor: wer die
 * Arbeitstafel des Fensters per avesmapsEcosystemDisplayInstall in dieses Modul schiebt, macht aus
 * dem Vorgabengeber einen Spiegel des Fensters -- danach liefert es beim Zuruecksetzen den gerade
 * getippten Wert als „Vorgabe" zurueck (am 24.08.2026 im Browser gemessen, von keinem Test).
 * Das Fenster reicht seinen Satz deshalb HEREIN, statt ihn dort abzulegen.
 */
function avesmapsEcosystemKollisionAus(eigen) {
	const raus = {
		teil: AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE.teil,
		fest: AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE.fest,
	};
	if (eigen && typeof eigen === "object" && !Array.isArray(eigen)) {
		if (typeof eigen.teil === "boolean") { raus.teil = eigen.teil; }
		if (typeof eigen.fest === "boolean") { raus.fest = eigen.fest; }
	}
	return raus;
}

/**
 * Die ROLLE eines freien Kartenlabels im Kollisionsdurchgang -- „aus" | „fest" | „beweglich".
 *
 * 🔴 EINE Ableitung, drei Leser: der Durchgang selbst (map-features-label-collisions.js), die
 * Namen auf gerechneten Kurven (map-features-path-label-canvas-overlay.js) und das Fenster
 * „Darstellung", das den Satz darunter schreibt. Eine Regel, die einen von drei Erzeugern bindet,
 * ist keine Regel -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre (AGENTS.md §11).
 * ⚠️ Das Fenster geht ueber avesmapsEcosystemKollisionsRolleAus -- siehe dort, warum.
 */
function avesmapsEcosystemDisplayKollisionsRolle(subtype) {
	return avesmapsEcosystemKollisionsRolleAus(avesmapsEcosystemDisplayKollision(subtype));
}

/** Die Rolle aus einem fertigen `{ teil, fest }`. Der eine Ort, an dem die drei Namen entstehen. */
function avesmapsEcosystemKollisionsRolleAus(regel) {
	if (!regel || regel.teil !== true) { return "aus"; }
	return regel.fest === true ? "fest" : "beweglich";
}

// 🔴 Die Karte kennt Stufe 8 nicht (maxZoom: 7 in js/app/bootstrap.js). z8 erbt z7 -- dieselbe
// Regel wie bei den Zoombaendern.
const AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX = 7;

// Die geladene Uebersteuerung. Leer heisst: die Vorgabe gilt.
let _avesmapsEcosystemDisplayUeber = {};

/**
 * Die geladene Tafel ablegen. ⚠️ Alles, was keine Tafel ist (null, ein String, kaputtes JSON),
 * gilt als „nichts uebersteuert" -- die Karte darf an einem kaputten Einstellungswert nicht
 * haengenbleiben.
 */
function avesmapsEcosystemDisplayInstall(stored) {
	_avesmapsEcosystemDisplayUeber = (stored && typeof stored === "object" && !Array.isArray(stored))
		? stored
		: {};
	_avesmapsEcosystemDisplayKurveCache = null;
}

/** Ein Abschnitt der Tafel, immer als Objekt. */
function avesmapsEcosystemDisplayTeil(name) {
	const teil = _avesmapsEcosystemDisplayUeber[name];
	return (teil && typeof teil === "object" && !Array.isArray(teil)) ? teil : {};
}


// Die gemerkte Kurventafel, damit nicht jedes Label ein frisches Objekt baut.
// ⚠️ Ungueltig gemacht wird sie in avesmapsEcosystemDisplayInstall -- die einzige Stelle, an der
// sich die Uebersteuerung aendern kann.
let _avesmapsEcosystemDisplayKurveCache = null;

/**
 * Die Kurvenfeinheiten, wie sie WIRKEN.
 *
 * 🔴 Die Vorgaben stehen in AVESMAPS_CURVE_LABEL_DEFAULTS (curve-label-fit.js) und werden hier
 * NICHT abgeschrieben -- eine zweite Tafel liefe beim ersten geaenderten Wert auseinander, und
 * gerade diese Zahlen sind an einem Abnahmebild gemessen worden.
 *
 * 💣 ZWEI Verbraucher lesen sie, und beide MUESSEN durch diese Funktion gehen: avesmapsCurveLabelFit
 * (die Passung) und die Ausweichweite in map-features-path-label-canvas-overlay.js. Eine Regel, die
 * einen von zweien bindet, ist keine Regel -- dieselbe Lehre wie bei der Verkehrsmittel-Sperre.
 * ⚠️ Hier steht mit Absicht KEINE Zahl, wie viele es sind: eine Zahl liest sich wie eine
 * vollstaendige Liste, und niemand zaehlt nach.
 *
 * ⚠️ Der Zugriff auf die Vorgabetafel steht IM RUMPF, nicht auf Dateiebene: `ecosystem-display.js`
 * laedt VOR `curve-label-fit.js` (die Ladereihenfolge in index.html ist ein Vertrag), die Konstante
 * gibt es beim Auswerten dieser Datei also noch gar nicht.
 */
function avesmapsEcosystemDisplayKurve() {
	if (_avesmapsEcosystemDisplayKurveCache) {
		return _avesmapsEcosystemDisplayKurveCache;
	}
	const grund = (typeof AVESMAPS_CURVE_LABEL_DEFAULTS === "object" && AVESMAPS_CURVE_LABEL_DEFAULTS)
		? AVESMAPS_CURVE_LABEL_DEFAULTS
		: {};
	const eigen = avesmapsEcosystemDisplayTeil("kurve");
	const raus = {};
	Object.keys(grund).forEach((feld) => { raus[feld] = grund[feld]; });
	// 🔴 Uebernommen wird nur, was die Vorgabetafel KENNT und was eine endliche Zahl ist. Ein fremder
	// Schluessel aus der Datenbank darf hier keine neue Stellschraube erfinden, und ein NaN aus einem
	// halb getippten Eingabefeld darf die Passung nicht in die Irre schicken.
	Object.keys(eigen).forEach((feld) => {
		if (Object.prototype.hasOwnProperty.call(grund, feld)
			&& typeof eigen[feld] === "number" && Number.isFinite(eigen[feld])) {
			raus[feld] = eigen[feld];
		}
	});
	_avesmapsEcosystemDisplayKurveCache = raus;
	return raus;
}

/** Der Schluessel einer Flaechenart: Ebene UND Art, weil `insel` in zweien vorkommt. */
function avesmapsEcosystemDisplayFlaechenKey(kind, typeKey) {
	return String(kind || "") + ":" + String(typeKey || "");
}

/**
 * Der Ton einer FLAECHE. `tokenTon` ist die Vorgabe, die der Aufrufer aus tokens.css gelesen hat --
 * dieses Modul kennt keine Farbe.
 */
function avesmapsEcosystemDisplayFlaechenTon(kind, typeKey, tokenTon) {
	const eigen = avesmapsEcosystemDisplayTeil("flaeche")[avesmapsEcosystemDisplayFlaechenKey(kind, typeKey)];
	return typeof eigen === "string" && eigen !== "" ? eigen : tokenTon;
}

/**
 * Der Ton eines NAMENS. `tokenTon` kommt aus der CSS-Sonde in getMapLabelTypeStyle.
 * 🔴 Eine Farbe je ART, nicht je Zoomstufe (Owner 23.08.2026: „die farben bleiben gleich").
 */
function avesmapsEcosystemDisplayFarbe(subtype, tokenTon) {
	const eigen = avesmapsEcosystemDisplayTeil("farbe")[String(subtype || "")];
	return typeof eigen === "string" && eigen !== "" ? eigen : tokenTon;
}

/**
 * Die Deckkraft, die WIRKT.
 *
 * 💣 Der globale Wert einer Ebene ueberschreibt den Zeilenwert, er LOESCHT ihn nicht. Ein Haekchen
 * ist keine Datenaenderung -- wer es abnimmt, bekommt seine Arbeit zurueck (Entwurf §5.2).
 * 🔴 „Global" heisst FUER DIESE EBENE, nie fuer alle vier.
 */
function avesmapsEcosystemDisplayDeckkraft(kind, typeKey) {
	const global = avesmapsEcosystemDisplayTeil("global")[String(kind || "")];
	if (global && global.an === true && typeof global.wert === "number") {
		return global.wert;
	}
	const eigen = avesmapsEcosystemDisplayTeil("deckkraft")[avesmapsEcosystemDisplayFlaechenKey(kind, typeKey)];
	if (typeof eigen === "number") {
		return eigen;
	}
	const vorgabe = AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT[String(kind || "")];
	return typeof vorgabe === "number" ? vorgabe : 0.72;
}

/** Die Vorgabegroesse auf einer Zoomstufe -- die echte Formel bei Grundgroesse 18. */
function avesmapsEcosystemDisplayVorgabeGroesse(zoom) {
	const z = Math.max(0, Number(zoom) || 0);
	const ratio = Math.max(0, Math.min(1, z / AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX));
	const ueber = Math.max(0, Math.min(2, z - AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX));
	return Math.round(
		AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_BASIS
		* (0.5 + ratio * 0.5)
		* (1 + ueber * AVESMAPS_ECOSYSTEM_DISPLAY_TIEF_SCHRITT)
	);
}

/**
 * Die Schriftgroesse einer Art auf einer Zoomstufe, in pt.
 * ⚠️ Eine Zeile mit einer LUECKE an dieser Stufe faellt fuer diese Stufe auf die Vorgabe zurueck --
 * nicht die ganze Zeile. „nichts gespeichert" und „hier steht null" sind verschiedene Aussagen.
 */
function avesmapsEcosystemDisplayGroesse(subtype, zoom) {
	const zeile = avesmapsEcosystemDisplayTeil("groesse")[String(subtype || "")];
	const z = Math.max(0, Math.round(Number(zoom) || 0));
	if (Array.isArray(zeile)) {
		const wert = zeile[z];
		if (typeof wert === "number"
			&& wert >= AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS.min
			&& wert <= AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS.max) {
			return wert;
		}
	}
	return avesmapsEcosystemDisplayVorgabeGroesse(z);
}

/**
 * Die vier Vorgaben einer Art: Zoomband, max. Namen, Prioritaet.
 * 🔴 Sie sind eine EMPFEHLUNG, kein Riegel -- der Editor darf abweichen und sieht nur die Marke.
 */
/**
 * Die GRUNDgroesse, die eine Art vorschlaegt -- die eine Zahl, die unter dem Regler des
 * Beschriftungsdialogs als Marke steht.
 *
 * 🔴 Das ist der Wert der Tafel bei ZOOM 5, und das ist keine Wahl: bei z5 ist der Zoomfaktor
 * der Groessenrechnung genau 1,0 (`0.5 + 5/5 * 0.5`, kein Tiefzoom-Zuschlag). Die Grundgroesse
 * IST also per Konstruktion der z5-Wert -- in der Vorgabekurve steht dort die historische 18.
 * ⚠️ Wer hier eine andere Stufe nimmt, verschiebt jeden Vorschlag um den Zoomfaktor jener
 * Stufe, und das faellt nicht auf: die Zahl sieht weiterhin wie eine Schriftgroesse aus.
 */
function avesmapsEcosystemDisplayBasisGroesse(subtype) {
	return avesmapsEcosystemDisplayGroesse(subtype, AVESMAPS_ECOSYSTEM_DISPLAY_VISUAL_MAX);
}

function avesmapsEcosystemDisplayVorgabe(subtype) {
	const eigen = avesmapsEcosystemDisplayTeil("vorgabe")[String(subtype || "")];
	const raus = {};
	const jeArt = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART[String(subtype || "")] || {};
	Object.keys(AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE).forEach((feld) => {
		// Reihenfolge: was der Admin übersteuert hat, dann die gemessene Vorgabe dieser Art, dann
		// der Grundwert. Die mittlere Stufe ist neu -- vorher gab es nur „übersteuert oder uniform".
		const wert = (eigen && typeof eigen[feld] === "number") ? eigen[feld]
			: (typeof jeArt[feld] === "number" ? jeArt[feld] : AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE[feld]);
		raus[feld] = wert;
	});
	return raus;
}

/** Nur die zwei Enden des Zoombands. */
function avesmapsEcosystemDisplayBand(subtype) {
	const v = avesmapsEcosystemDisplayVorgabe(subtype);
	return { ab: v.ab, bis: v.bis };
}

/**
 * Traegt diese Art auf dieser Zoomstufe einen Namen?
 *
 * 🔴 z8 faellt auf z7 zurueck -- die Karte kommt dort nie hin, und ohne den Rueckfall waere die
 * letzte Spalte jeder Tafel per Bauart leer.
 * 💣 „aus" ist als bis < ab kodiert und ergibt hier auf JEDER Stufe false -- ein eigener Schalter
 * daneben waere eine dritte Wahrheit ueber dieselbe Sache (Entwurf §5.3).
 */
function avesmapsEcosystemDisplaySichtbar(subtype, zoom) {
	const b = avesmapsEcosystemDisplayBand(subtype);
	const z = Math.min(Math.max(0, Math.round(Number(zoom) || 0)), AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX);
	return z >= b.ab && z <= b.bis;
}

/**
 * Ein Abstand, wie er WIRKT: "repel" | "versatz" | "drift".
 *
 * 🔴 Ein Wert ausserhalb seiner Grenzen faellt auf die VORGABE zurueck, nicht auf die Grenze. Ein
 * geklemmter Wert saehe aus wie eine Entscheidung; ein Rueckfall ist als Rueckfall erkennbar.
 * ⚠️ Faellt still aus -- kein Wurf, keine Meldung. Diese Funktion steht im Kollisionsdurchgang und
 * laeuft je Beschriftung und je Bild; ein Wurf hier hielte die ganze Karte an.
 */
function avesmapsEcosystemDisplayAbstand(key) {
	const name = String(key || "");
	const vorgabe = AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE[name];
	if (typeof vorgabe !== "number") {
		return 0;
	}
	const eigen = avesmapsEcosystemDisplayTeil("abstaende")[name];
	const grenzen = AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS[name];
	if (typeof eigen === "number" && Number.isFinite(eigen)
		&& eigen >= grenzen.min && eigen <= grenzen.max) {
		return eigen;
	}
	return vorgabe;
}

const AVESMAPS_ECOSYSTEM_DISPLAY_ENDPOINT = "api/app/ecosystem-display.php";

/**
 * Die Tafel holen und einsetzen. Liefert true, wenn danach etwas anderes gilt als die Vorgabe.
 *
 * ⚠️ Wird NICHT beim Laden dieser Datei gerufen -- der Landschaften-Editor laedt sie ebenfalls und
 * holt seine Werte ueber seinen eigenen, angemeldeten Endpunkt; ein Aufruf hier loeste dort eine
 * zweite, nutzlose Anfrage aus. Der Aufruf steht in js/config.js. Dieselbe Arbeitsteilung wie bei
 * avesmapsLoadLocationZoomBands.
 *
 * 🔴 FAELLT STILL AUS: kein Netz, kein Endpunkt, kaputte Antwort -> die Vorgaben bleiben, und die
 * Karte zeichnet wie bisher. Ein Ausfall hier darf sie nicht aufhalten.
 */
function avesmapsLoadEcosystemDisplay() {
	return fetch(AVESMAPS_ECOSYSTEM_DISPLAY_ENDPOINT, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((payload) => {
			if (!payload || payload.ok !== true || !payload.display) {
				return false;
			}
			avesmapsEcosystemDisplayInstall(payload.display);
			return true;
		})
		.catch(() => false);
}

// ⚠️ NUR FUER DIE NODE-TESTS. Im Browser teilen klassische <script>-Bausteine ihre obersten `const`
// ueber die globale lexikalische Umgebung; `vm.runInThisContext` tut das NICHT -- dieselbe
// Begruendung wie in location-zoom-bands.js.
if (typeof globalThis !== "undefined") {
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT = AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART = AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX = AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE = AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS = AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS;
	globalThis.AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE = AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE;
}
