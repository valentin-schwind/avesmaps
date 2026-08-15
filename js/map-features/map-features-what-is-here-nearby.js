// „In der Nähe" -- was rund um eine angeklickte Kartenstelle liegt.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md §5
//
// Rechnet AUSSCHLIESSLICH im Browser, aus dem schon geladenen Kartenpayload -- keine Anfrage.
// Deshalb steht diese Haelfte des Panels sofort da, waehrend der Endpunkt noch antwortet.

"use strict";

// 1 Karteneinheit = 3 Meilen. Der Wert steht in js/config.js als DISTANCE_SCALING_FACTOR und darf
// nur EINMAL im Haus stehen -- hier wird er gelesen, nicht abgeschrieben.
const WIH_MEILEN_JE_EINHEIT = typeof DISTANCE_SCALING_FACTOR !== "undefined" ? DISTANCE_SCALING_FACTOR : 3;

// Die drei Zahlen der Auswahlregel (§5 des Entwurfs), jede mit gemessenem Anlass.
const WIH_ORTE = 3;
const WIH_WEGE = 4;
const WIH_WEG_SCHRANKE = 1.5;

// 💣 Die Namens- und Typregel fuer Wege gibt es bereits -- NICHT neu erfinden:
//   - getPathTitleName(path)      (js/map-features/map-features-path-domain.js) liest ZUERST
//     wiki_path.name (die Weg-IDENTITAET), erst danach display_name/original_name, gefiltert
//     durch shouldShowRoutePathDisplayName (js/routing/route-node.js) -- die kennt alle drei
//     Muell-Muster: den nackten Subtyp, "<Subtyp>-<n>" UND generisch "<Wort>-<Zahl>" ("Meer-835").
//     Ein eigener Regex hier haette den Wiki-Namen-Kanal ignoriert und genau den Fehler wiederholt,
//     den path-domain.js:29-33 als bereits einmal passiert beschreibt.
//   - getPathTypeLabel(subtype)   (dieselbe Datei) liefert die Prosa ("Straße", "Wüstenpfad"),
//     durch tr() gefuehrt -- unsere Subtyp-SCHLUESSEL ("Strasse", "Wuestenpfad") sind Join-Keys,
//     keine Anzeigetexte.
// 💣 Beide Funktionen leben nur im BROWSER (path-domain.js/route-node.js sind reine <script>-Globale
// ohne module.exports). Unter Node -- also in diesem Test -- gibt es sie nicht: der Wächter
// (typeof … === "function") faengt genau das ab, ist also fuer den TEST da, nicht fuer den Browser,
// wo beide laengst vor dieser Datei geladen sind (index.html: path-domain.js Zeile 3144,
// route-node.js Zeile 3203, diese Datei Zeile 3241). Der Rueckfall OHNE Funktion nimmt den rohen
// Namen -- KEIN eigener Regex, sonst waere Befund 1 nur verschoben, nicht behoben.

/**
 * Die rechtweisende Peilung von (fx,fy) nach (tx,ty), in Grad, 0 = Norden, im Uhrzeigersinn.
 *
 * 💣 atan2(dx, dy) -- die Argumente sind VERTAUSCHT gegenueber der Schulform atan2(dy, dx).
 * Nur so ist 0 Grad Norden und die Zaehlrichtung dieselbe wie bei CSS `rotate()`. Mit der
 * gewohnten Reihenfolge zeigt jeder Pfeil an der Diagonale gespiegelt, und das faellt bei genau
 * N/O/S/W nicht auf.
 * ⚠️ Es gilt nur, weil y auf dieser Karte nach NORDEN waechst (Riva y=790 im Norden, Al'Anfa
 * y=152 im Sueden). Die Kachelnamen `map_x_-y` tragen ein negatives y -- wer von dort abliest,
 * dreht jeden Pfeil auf den Kopf.
 */
function avesmapsWhatIsHereBearing(fx, fy, tx, ty) {
	const grad = Math.atan2(tx - fx, ty - fy) * 180 / Math.PI;
	return (grad + 360) % 360;
}

/** Der Abstand eines Punktes zu einer Strecke, samt Fusspunkt. */
function avesmapsWhatIsHereFootPoint(p, a, b) {
	const vx = b[0] - a[0];
	const vy = b[1] - a[1];
	const l2 = vx * vx + vy * vy;
	let t = l2 ? (((p.x - a[0]) * vx + (p.y - a[1]) * vy) / l2) : 0;
	t = Math.max(0, Math.min(1, t));
	const fx = a[0] + t * vx;
	const fy = a[1] + t * vy;
	return { d: Math.hypot(p.x - fx, p.y - fy), fx: fx, fy: fy };
}

/**
 * Die Nachbarschaft eines Punktes: die drei naechsten Ortschaften, dazu je Wegart hoechstens ein
 * Weg und hoechstens vier -- keiner weiter als das Anderthalbfache der weitesten gezeigten
 * Ortschaft. Alles zusammen nach Entfernung sortiert.
 *
 * 🔴 Fix-Runde 7 (Schlussprüfung): rechnet aus `locationData`/`pathData`, NICHT mehr aus dem rohen
 * `window.avesmapsMapFeatureData`-Payload. Der urspruengliche Entwurf verlangte die rohen Features,
 * weil die aufbereiteten Listen "andere Feldnamen und getauschte Koordinaten" haetten -- das stimmt
 * fuer Orte (siehe unten), aber NICHT fuer Wege: `pathData`-Eintraege sind `{...feature}`-Spreads
 * mit `properties.feature_type`/`feature_subtype` und `geometry.coordinates` bereits in `[x, y]` --
 * exakt die Form, fuer die getPathTitleName/getPathTypeLabel gebaut sind. Fuer Orte kostet die
 * Umstellung einen Koordinatentausch, liefert dafuer drei Dinge FERTIG statt selbst nachzubauen:
 * `locationTypeLabel` (bereits durch tr() gelaufen, behebt denselben Fehler wie Fix-Runde 1 fuer
 * Wege -- vorher stand hier `settlement_class_label`, eine denormalisierte Zeichenkette zweier
 * auseinandergelaufener Schreiber, 38 Orte auf „Grosse Stadt" haengengeblieben), `isHidden` und den
 * aufgeloesten Kreuzungstyp.
 *
 * 🔴 Fix-Runde 7, C1 (Critical): VERSTECKTE ORTE fallen hier raus, ueber isHiddenLocation
 * (map-features-location-marker-rendering.js) -- denselben Riegel, den fuenf andere Ausgaenge im
 * Haus schon benutzen (Marker, Namensschild, Wegpunktsuche, Router-Kandidat, Etappenliste). Diese
 * Liste war der sechste Ausgang und der einzige ungeriegelte: ein Rechtsklick neben einen
 * versteckten Ort deckte Name, Entfernung und Peilung auf, und der Klick fuehrte in die volle
 * Infobox. KEIN zweites Praedikat -- derselbe Riegel wie ueberall sonst.
 *
 * ⚠️ DER MASSSTAB DER SCHRANKE IST DIE ORTSLISTE, NICHT DIE WEGELISTE. Eine relative Schranke
 * braucht einen Massstab, der nicht mitwandert -- das ist die teuer bezahlte Lehre vom
 * Querfeldein-Ausstiegspunkt (14.08.2026), wo drei Fassungen an einem Tag daran scheiterten.
 *
 * ⚠️ Ortschaften haben KEINE Schranke: dass die naechste Stadt 35 Meilen entfernt ist, IST die
 * Antwort (am Seepunkt gemessen).
 *
 * @param {{x:number,y:number}} punkt
 * @param {list} locations `locationData` (js/routing/routing.js)
 * @param {list} paths `pathData` (js/map-features/map-features-path-prepare.js)
 */
function avesmapsWhatIsHereNearby(punkt, locations, paths) {
	const orte = [];
	const wegeJeArt = new Map();

	(locations || []).forEach(function (location) {
		if (!location || !Array.isArray(location.coordinates)) {
			return;
		}
		// 💣 isHiddenLocation lebt nur im BROWSER (map-features-location-marker-rendering.js, reines
		// <script>-Global, kein module.exports) -- derselbe Wächter wie bei getPathTitleName/
		// getPathTypeLabel unten, aus demselben Grund: fuer den Node-Test da, im Browser laengst
		// geladen (index.html: Zeile 3138 vor Zeile 3249).
		if (typeof isHiddenLocation === "function" && isHiddenLocation(location)) {
			return;
		}
		// 🔴 locationData speichert [lat, lng] = [y, x] (Leaflet-Form) -- diese Funktion rechnet in
		// x/y wie der Endpunkt und wie die Wege-Haelfte unten. NUR hier wird getauscht.
		const x = location.coordinates[1];
		const y = location.coordinates[0];
		orte.push({
			art: location.locationTypeLabel || "",
			name: location.name || "",
			meilen: Math.hypot(punkt.x - x, punkt.y - y) * WIH_MEILEN_JE_EINHEIT,
			peilung: avesmapsWhatIsHereBearing(punkt.x, punkt.y, x, y),
		});
	});

	(paths || []).forEach(function (feature) {
		const p = feature && feature.properties;
		const g = feature && feature.geometry;
		if (!p || !g) {
			return;
		}
		const cs = g.coordinates || [];
		let bester = null;
		for (let i = 0; i < cs.length - 1; i += 1) {
			const treffer = avesmapsWhatIsHereFootPoint(punkt, cs[i], cs[i + 1]);
			if (!bester || treffer.d < bester.d) {
				bester = treffer;
			}
		}
		if (!bester) {
			return;
		}
		const subtype = p.feature_subtype || p.type || "";
		const art = typeof getPathTypeLabel === "function" ? getPathTypeLabel(subtype) : subtype;
		const name = typeof getPathTitleName === "function"
			? getPathTitleName(feature)
			: String(p.display_name || p.original_name || p.name || "").trim();
		const zeile = {
			art: art,
			name: name,
			meilen: bester.d * WIH_MEILEN_JE_EINHEIT,
			peilung: avesmapsWhatIsHereBearing(punkt.x, punkt.y, bester.fx, bester.fy),
		};
		const bisher = wegeJeArt.get(art);
		if (!bisher || zeile.meilen < bisher.meilen) {
			wegeJeArt.set(art, zeile);
		}
	});

	orte.sort((a, b) => a.meilen - b.meilen);
	const gezeigteOrte = orte.slice(0, WIH_ORTE);
	// Der Massstab steht FEST, bevor auch nur ein Weg geprueft wird.
	const schranke = gezeigteOrte.length
		? gezeigteOrte[gezeigteOrte.length - 1].meilen * WIH_WEG_SCHRANKE
		: Infinity;

	const gezeigteWege = [...wegeJeArt.values()]
		.filter((w) => w.meilen <= schranke)
		.sort((a, b) => a.meilen - b.meilen)
		.slice(0, WIH_WEGE);

	return [...gezeigteOrte, ...gezeigteWege].sort((a, b) => a.meilen - b.meilen);
}

const WIH_KOMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
// Deutscher Text zugleich als tr()-Standardwert UND als Node-Rueckfall ohne tr -- dieselbe
// Doppelrolle wie ueberall sonst in diesem Haus (siehe avesmapsWhatIsHereNearbyMarkup).
const WIH_KOMPASS_WORT = {
	N: "Norden", NO: "Nordost", O: "Osten", SO: "Südost",
	S: "Süden", SW: "Südwest", W: "Westen", NW: "Nordwest",
};

/**
 * Das Peil-Pfeilchen. Es dreht sich um die ECHTE Peilung, nicht um eine von acht
 * Himmelsrichtungen: am gemessenen Landpunkt stehen drei Zeilen auf „W" -- bei 259,1°, 283,8°
 * und 284,2°. Das Wort wirft 25° weg, der Pfeil nicht.
 *
 * ⭐ Inline-SVG mit `fill: currentColor`, KEIN Unicode-Pfeil: ein Zeichen saehe auf jedem Geraet
 * anders aus und reiste durch die i18n-Tabelle mit -- dieselbe Begruendung, mit der die
 * Markierungs-Kacheln Bilder aus img/menu/ tragen statt Emoji.
 *
 * 🔴 Die Nadel zeigt UNBEHANDELT nach Norden. Ein Pfeil mit Ruhelage nach rechts braeuchte
 * `rotate(peilung - 90deg)` -- eine zweite Zahl im Kopf, die irgendwann jemand vergisst.
 *
 * ⚠️ Das WORT bleibt, nur unsichtbar: aria-label liest ein Screenreader vor, title zeigt es an.
 * Es ist eine SICHTBARE (vorgelesene) Zeichenkette und laeuft deshalb durch tr() -- Schluessel
 * `whatIsHere.dir.<klein>` (z. B. `whatIsHere.dir.no`), Englisch in js/app/i18n-en.js.
 */
function avesmapsWhatIsHereDirMarkup(peilung) {
	const kurz = WIH_KOMPASS[Math.round(peilung / 45) % 8];
	const fallback = WIH_KOMPASS_WORT[kurz];
	const wort = typeof tr === "function" ? tr("whatIsHere.dir." + kurz.toLowerCase(), fallback) : fallback;
	const grad = peilung.toFixed(1).replace(".", ",");
	return '<span class="avesmaps-near__dir" style="--avesmaps-dir: ' + peilung.toFixed(1) + 'deg"'
		+ ' role="img" aria-label="' + wort + '" title="' + wort + " (" + grad + '°)">'
		+ '<svg viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">'
		+ '<path d="M0,-6 L3.8,5.2 L0,2.8 L-3.8,5.2 Z"/></svg></span>';
}

/**
 * Der Abschnitt „In der Nähe" -- eigener Klappabschnitt wie Kartensammlung und Literatur, Inhalt
 * aber in DERSELBEN Tabellenform wie die Feldliste darueber (Owner 15.08.2026).
 *
 * ⭐ Der Name ist ein `.avesmaps-traffic-link`: der vorhandene Knopf, der wie ein Link aussieht
 * und auf der Karte hinspringt. Er steht heute schon in der Zeile „Verkehrswege" -- zwei Vokabeln
 * fuer dieselbe Geste waeren genau die Divergenz, vor der AGENTS §12 warnt.
 */
function avesmapsWhatIsHereNearbyMarkup(nachbarn) {
	if (!nachbarn || !nachbarn.length) {
		return "";
	}
	const esc = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s);
	const zeilen = nachbarn.map(function (n) {
		const zahl = n.meilen.toFixed(1).replace(".", ",");
		const name = n.name
			? '<button type="button" class="avesmaps-traffic-link" data-what-is-here-name="'
				+ esc(n.name) + '">' + esc(n.name) + "</button> · "
			: "";
		// 🔴 Fix-Runde 7, I4: durch tr() statt hartkodiert -- derselbe geteilte Schluessel wie
		// js/app/utils.js und js/ui/ui-controls.js (dort ohne &nbsp;, weil beide per .textContent
		// setzen; die englische Zeile in i18n-en.js bleibt deshalb bewusst unveraendert, nur der
		// deutsche Standardwert hier traegt das &nbsp; weiter).
		const meilenText = typeof tr === "function" ? tr("units.miles", zahl + "&nbsp;Meilen", { n: zahl }) : zahl + "&nbsp;Meilen";
		return '<div class="region-info-box__row"><dt>' + esc(n.art) + "</dt><dd>"
			+ name + meilenText + avesmapsWhatIsHereDirMarkup(n.peilung)
			+ "</dd></div>";
	}).join("");

	const titel = typeof tr === "function" ? tr("whatIsHere.nearby", "In der Nähe") : "In der Nähe";
	return '<details class="avesmaps-near infobox-section" open>'
		+ '<summary class="avesmaps-near__head infobox-section__head">' + esc(titel)
		+ ' <span class="avesmaps-near__count infobox-section__count">(' + nachbarn.length + ")</span></summary>"
		+ '<dl class="avesmaps-near__list region-info-box__data">' + zeilen + "</dl></details>";
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWhatIsHereNearby,
		avesmapsWhatIsHereBearing,
		avesmapsWhatIsHereFootPoint,
		avesmapsWhatIsHereNearbyMarkup,
		avesmapsWhatIsHereDirMarkup,
	};
}
