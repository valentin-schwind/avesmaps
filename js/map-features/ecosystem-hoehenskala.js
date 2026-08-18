// Landschaften — die Höhenskala im Topographie-Dialog (Fall #79, Entwurf
// docs/superpowers/specs/2026-08-18-hoehenskala-legende-design.md).
//
// REINER RECHNER. Aus den Gipfeln einer Fläche und dem Weisspunkt des Zeichners entstehen hier
// Marken, Beschriftungen und Achsenwerte — kein DOM, kein `fetch`, kein Modulzustand. Das Malen und
// das Messen der Textbreiten macht der Dialog (map-features-ecosystem-properties.js).
//
// 🔴 DER WEISSPUNKT KOMMT AUS DEM ZEICHNER, er wird hier nie nachgerechnet. Er steht in
// map-features-ecosystem-height-render.js:298 als `Math.max(HEIGHT_WHITE_SCHRITT * 0.02, ...hmax)`
// über ALLE geladenen Gebirgsflächen. Eine zweite Rechnung wäre eine zweite Wahrheit, und die
// Legende erklärte irgendwann eine andere Karte als die sichtbare.

// Die schräge Beschriftung. Der Winkel steht hier UND im CSS (`transform: rotate(52deg)`) — beide
// Werte gehören zusammen: aus ihm folgen der Mindestabstand unten und die Polsterung über dem
// Balken. Wer ihn ändert, ändert drei Stellen.
const HOEHENSKALA_WINKEL_GRAD = 52;
// Zeilenhöhe der Beschriftung in px (font-size 11 → line-height 14, live gemessen 18.08.2026).
const HOEHENSKALA_ZEILENHOEHE_PX = 14;
// 💣 ZUSAMMENGEFASST WIRD NACH PLATZ, NICHT NACH GLEICHHEIT. Zwei Schriftlinien unter dem Winkel
// stehen `dx * sin(winkel)` auseinander; wird das kleiner als die Zeilenhöhe, stossen sie zusammen.
// 14 / sin(52°) = 17,8 -> 18 px. Bei Weisspunkt 9.000 sind das rund 390 Schritt.
const HOEHENSKALA_MIN_ABSTAND_PX = Math.ceil(
	HOEHENSKALA_ZEILENHOEHE_PX / Math.sin(HOEHENSKALA_WINKEL_GRAD * Math.PI / 180));
// 💣 DIESELBE ZAHL WIE IM FELDBAU. Ein Gipfel ohne erfasste Höhe bekommt dort
// ECOSYSTEM_HEIGHT_PLACEHOLDER (map-features-ecosystem-height-field.js:516-518) und wird auch so
// GEMALT. Wer ihn hier auslässt oder auf 0 setzt, zeigt ihn woanders, als die Karte ihn zeichnet.
const HOEHENSKALA_PLATZHALTER_SCHRITT = 5000;
// Die Namensspalte der Beschriftung: Vorgabe und Untergrenze. Darunter lohnt kein Name mehr — dann
// kippt die Zeile lieber auf die andere Seite (siehe avesmapsHoehenskalaNamensbreite).
const HOEHENSKALA_NAME_BREITE_PX = 76;
const HOEHENSKALA_NAME_MIN_PX = 24;
// Abstand zwischen Name und Zahl (`gap` im CSS).
const HOEHENSKALA_NAME_ZAHL_LUECKE_PX = 4;

// Tausenderpunkte ohne `toLocaleString`: das hängt an der ICU-Ausstattung des Wirts und liefert im
// nackten Node etwas anderes als im Browser — eine Legende, die auf dem Prüfstand anders aussieht
// als live, ist genau das, was hier niemand gebrauchen kann.
function avesmapsHoehenskalaZahl(schritt) {
	const gerundet = Math.round(Number(schritt) || 0);
	return String(gerundet).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Die Höhe, mit der ein Gipfel in der Skala steht — dieselbe, mit der ihn der Feldbau malt.
function avesmapsHoehenskalaGipfelhoehe(gipfel) {
	const wert = Number(gipfel && gipfel.hoehe);
	return Number.isFinite(wert) && wert > 0 ? wert : HOEHENSKALA_PLATZHALTER_SCHRITT;
}

// ---- Marken -------------------------------------------------------------------------------------
//
// 💣 DIE MARKEN BLEIBEN EINZELN, nur die Beschriftungen werden später gruppiert. Ein Dreieck ist
// 8 px breit und kollidiert erst darunter; zwei Marken 18 px auseinander sind unterscheidbar, ihre
// TEXTE nicht. Zusammen fällt nur, was auf EXAKT derselben Höhe liegt — und das ist der Normalfall,
// weil jeder Gipfel ohne erfasste Höhe auf dem Platzhalter sitzt.
function avesmapsHoehenskalaMarken(gipfel, weisspunkt) {
	const bezug = Number(weisspunkt);
	if (!Number.isFinite(bezug) || bezug <= 0) {
		return [];
	}
	const nachHoehe = new Map();
	(Array.isArray(gipfel) ? gipfel : []).forEach((eintrag) => {
		const schritt = avesmapsHoehenskalaGipfelhoehe(eintrag);
		const name = String((eintrag && eintrag.name) || "").trim();
		if (!nachHoehe.has(schritt)) {
			nachHoehe.set(schritt, []);
		}
		nachHoehe.get(schritt).push(name || "Gipfel ohne Namen");
	});

	return Array.from(nachHoehe.entries())
		.map(([schritt, namen]) => ({
			schritt,
			namen,
			// Über dem Weisspunkt wird auf der Karte geklemmt (`Math.min(1, …)`), also klemmt die
			// Marke mit — sonst zeigte sie neben den Balken.
			prozent: Math.max(0, Math.min(100, schritt / bezug * 100)),
			gruppe: namen.length > 1,
		}))
		.sort((a, b) => a.schritt - b.schritt);
}

// ---- Beschriftungen ------------------------------------------------------------------------------
function avesmapsHoehenskalaBeschriftungen(marken, balkenBreitePx) {
	const breite = Number(balkenBreitePx);
	if (!Array.isArray(marken) || marken.length === 0 || !Number.isFinite(breite) || breite <= 0) {
		return [];
	}

	// Aufsteigend zusammenfassen: solange der nächste Nachbar näher als der Mindestabstand liegt,
	// gehört er in dieselbe Zeile. Gemessen wird gegen die ZULETZT aufgenommene Marke, nicht gegen
	// die erste der Gruppe — sonst reisst eine lange Kette knapper Nachbarn irgendwo willkürlich ab.
	const gruppen = [];
	marken.forEach((marke) => {
		const letzte = gruppen[gruppen.length - 1];
		const vorherige = letzte && letzte[letzte.length - 1];
		const abstand = vorherige ? (marke.prozent - vorherige.prozent) / 100 * breite : Infinity;
		if (letzte && abstand < HOEHENSKALA_MIN_ABSTAND_PX) {
			letzte.push(marke);
		} else {
			gruppen.push([marke]);
		}
	});

	return gruppen.map((gruppe) => {
		const namen = gruppe.reduce((alle, marke) => alle.concat(marke.namen), []);
		const min = gruppe[0].schritt;
		const max = gruppe[gruppe.length - 1].schritt;
		return {
			// Die Zeile setzt an der HÖCHSTEN Marke ihrer Gruppe an — nach oben ist mehr Platz.
			prozent: gruppe[gruppe.length - 1].prozent,
			// ⚠️ Bei verschiedenen Höhen eine SPANNE. Eine einzelne Zahl wäre dort schlicht falsch.
			zahl: min === max
				? avesmapsHoehenskalaZahl(min)
				: avesmapsHoehenskalaZahl(min) + "–" + avesmapsHoehenskalaZahl(max),
			// 💣 Bei mehreren Gipfeln KEIN bevorzugter Name. „Raschtul Kandscharot +1" wäre eine
			// Aussage, die die Daten nicht hergeben — welcher Name zuerst käme, entschiede die
			// Ladereihenfolge. Also die Anzahl, und die Namen in den Tooltip.
			name: namen.length === 1 ? namen[0] : namen.length + " Gipfel",
			namen,
			titel: namen.map((name, i) => {
				const marke = gruppe.find((eintrag) => eintrag.namen.indexOf(name) >= 0);
				return name + " · " + avesmapsHoehenskalaZahl(marke ? marke.schritt : min);
			}).join("\n"),
		};
	});
}

// ---- Die Namensbreite ----------------------------------------------------------------------------
//
// 🔴 GEKÜRZT WIRD DER NAME, NIE DIE HÖHE (Owner 18.08.2026). Hier fällt nur die Zahl, wie breit die
// Namensspalte sein darf; das Kürzen selbst macht `text-overflow` am Namenselement.
//
// 💣 Ein Text der Länge L steht unter dem Winkel und ragt `L * cos(winkel)` nach LINKS. Bei einer
// Marke weit links liefe er aus dem Fenster — dort wird der Name kürzer. Reicht selbst dafür der
// Platz nicht, kippt die ganze Zeile nach rechts oben, statt überzulaufen.
function avesmapsHoehenskalaNamensbreite(prozent, balkenBreitePx, zahlBreitePx) {
	const breite = Number(balkenBreitePx) || 0;
	const zahl = Number(zahlBreitePx) || 0;
	const abstandLinks = Math.max(0, Number(prozent) || 0) / 100 * breite;
	const laengeMoeglich = abstandLinks / Math.cos(HOEHENSKALA_WINKEL_GRAD * Math.PI / 180);
	const fuerDenNamen = laengeMoeglich - zahl - HOEHENSKALA_NAME_ZAHL_LUECKE_PX;

	if (fuerDenNamen < HOEHENSKALA_NAME_MIN_PX) {
		// Nach rechts gekippt: dort steht die volle Breite bis zum rechten Rand zur Verfügung.
		return { breitePx: HOEHENSKALA_NAME_BREITE_PX, gekippt: true };
	}
	return { breitePx: Math.min(HOEHENSKALA_NAME_BREITE_PX, Math.floor(fuerDenNamen)), gekippt: false };
}

// ---- Die Achse -----------------------------------------------------------------------------------
//
// Fünf Werte, auf 50 gerundet — die Auflösung der Geländeregler (`step="50"` in index.html). Die
// Skala ist im Bearbeiten-Modus linear, mehr Stützstellen braucht niemand zum Interpolieren.
function avesmapsHoehenskalaAchse(weisspunkt) {
	const bezug = Number(weisspunkt);
	if (!Number.isFinite(bezug) || bezug <= 0) {
		return [];
	}
	return [0, 25, 50, 75, 100].map((prozent) => ({
		prozent,
		// 🪤 Der oberste Wert wird NICHT gerundet: er ist der Weisspunkt selbst, und genau er ist die
		// Auskunft, um die es geht. Eine gerundete 11.437 -> 11.450 wäre die einzige falsche Zahl der
		// ganzen Legende.
		text: avesmapsHoehenskalaZahl(prozent === 100 ? bezug : Math.round(bezug * prozent / 100 / 50) * 50),
	}));
}

// Alles auf einmal — was der Dialog braucht, in einem Aufruf.
function avesmapsHoehenskala(gipfel, weisspunkt, balkenBreitePx) {
	const marken = avesmapsHoehenskalaMarken(gipfel, weisspunkt);
	return {
		weisspunkt: Number(weisspunkt) || 0,
		marken,
		beschriftungen: avesmapsHoehenskalaBeschriftungen(marken, balkenBreitePx),
		achse: avesmapsHoehenskalaAchse(weisspunkt),
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		HOEHENSKALA_WINKEL_GRAD,
		HOEHENSKALA_ZEILENHOEHE_PX,
		HOEHENSKALA_MIN_ABSTAND_PX,
		HOEHENSKALA_PLATZHALTER_SCHRITT,
		HOEHENSKALA_NAME_BREITE_PX,
		avesmapsHoehenskalaZahl,
		avesmapsHoehenskalaGipfelhoehe,
		avesmapsHoehenskalaMarken,
		avesmapsHoehenskalaBeschriftungen,
		avesmapsHoehenskalaNamensbreite,
		avesmapsHoehenskalaAchse,
		avesmapsHoehenskala,
	};
}
