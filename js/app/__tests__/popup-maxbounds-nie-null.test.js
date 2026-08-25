// Waehrend ein Popup offen ist, setzt bootstrap.js die Kartengrenzen aus (damit Leaflets
// `_panInsideMaxBounds` den autoPan der Infobox nicht zurueckzieht). Dieser Test sichert, WOMIT.
//
// 💣 DER FEHLER, DEN ER FAENGT (07.07. -- 25.08.2026 live, vom Owner per Konsolenauszug gemeldet):
// dort stand `map.options.maxBounds = null`. `setMaxBounds()` ist aber die EINZIGE Stelle, die
// Leaflets moveend-Listener `_panInsideMaxBounds` an- und abhaengt -- wer das Feld direkt nullt,
// laesst den Listener stehen. Der laeuft dann in `panInsideBounds(null)`, und dort faengt ihn nichts:
// `toLatLngBounds(null)` liefert ein LEERES, aber truthy `LatLngBounds`, der Guard `if (!bounds)` in
// `_limitCenter` laesst es durch, und `_getBoundsOffset` projiziert `getNorthEast()` -> `undefined.lng`.
// Live gemessen: `map.panInsideBounds(null)` wirft woertlich
// "Cannot read properties of undefined (reading 'lng')".
//
// ⚠️ Der Wurf war der harmlose Teil. Leaflets `fire()` hat kein try/catch -- die Listener-Kette bricht
// am Werfer ab. `_panInsideMaxBounds` stand an Position 3 von 12, die NEUN dahinter fielen aus
// (Kachel-Nachladen, Marker-/Label-Sichtbarkeit, Politik-Ebene, Wege-Culling, Overlay-`redraw`s).
// Gegenprobe im selben Lauf: mit gueltigem maxBounds lief die Kette komplett durch.
//
// 🔴 Statisch geprueft, nicht im Browser -- wie bootstrap-panes.test.js daneben: bootstrap.js baut beim
// Laden eine echte Karte auf und ist nicht require-bar. Geprueft wird die ECHTE Datei als Text.
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(__dirname, "..", "bootstrap.js"), "utf8");
const config = fs.readFileSync(path.join(wurzel, "js", "config.js"), "utf8");

let failures = 0;
const fail = (text) => {
	console.error(`FAIL: ${text}`);
	failures += 1;
};

// Gegenprobe, damit der Test nicht still leerlaeuft, wenn der Handler umbenannt oder entfernt wird.
if (!source.includes("function keepPopupReadableDespiteMaxBounds(")) {
	fail("keepPopupReadableDespiteMaxBounds gibt es nicht mehr in bootstrap.js -- prueft der Test noch das Richtige?");
}

const zuweisungen = [...source.matchAll(/map\.options\.maxBounds\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
if (zuweisungen.length === 0) {
	fail("keine einzige Zuweisung an map.options.maxBounds gefunden -- prueft der Test noch das Richtige?");
}

// Die Wiederherstellung ist erlaubt: `savedMaxBounds` kommt aus map.options.maxBounds und ist im
// Handler per `if (!savedMaxBounds) return;` als truthy geprueft, bevor irgendetwas passiert.
const ERLAUBT_ROH = new Set(["savedMaxBounds"]);
const platzhalter = new Set();
zuweisungen.forEach((wert) => {
	if (ERLAUBT_ROH.has(wert)) {
		return;
	}
	if (/^(null|undefined|false|0|""|'')$/.test(wert)) {
		fail(`map.options.maxBounds = ${wert} -- ein falsy Wert laesst Leaflets moveend-Listener stehen und `
			+ "wirft dann bei jedem Popup-autoPan (siehe Kopf dieser Datei). Weite Grenzen statt nichts.");
		return;
	}
	if (/^[A-Za-z_$][\w$]*$/.test(wert)) {
		platzhalter.add(wert);
		return;
	}
	fail(`map.options.maxBounds = ${wert} -- weder die Wiederherstellung noch ein benannter Grenzwert. `
		+ "Der Test kann nicht pruefen, ob das ein gueltiges LatLngBounds ist.");
});

// Der eingesetzte Grenzwert muss ein LatLngBounds aus vier ENDLICHEN Zahlen sein, das die Karte
// weitraeumig umschliesst.
const kartenMass = (name) => {
	const treffer = config.match(new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`));
	return treffer ? Number(treffer[1]) : null;
};
const breite = kartenMass("IMG_WIDTH");
const hoehe = kartenMass("IMG_HEIGHT");
if (!breite || !hoehe) {
	fail("IMG_WIDTH/IMG_HEIGHT nicht aus js/config.js lesbar -- prueft der Test noch das Richtige?");
}

platzhalter.forEach((name) => {
	const def = source.match(new RegExp(`const\\s+${name}\\s*=\\s*L\\.latLngBounds\\(\\s*\\[([^\\]]+)\\]\\s*,\\s*\\[([^\\]]+)\\]\\s*\\)`));
	if (!def) {
		fail(`${name} wird map.options.maxBounds zugewiesen, ist aber nicht als `
			+ "`const … = L.latLngBounds([…], […])` in bootstrap.js definiert.");
		return;
	}
	const [suedLat, westLng] = def[1].split(",").map((t) => Number(t.trim()));
	const [nordLat, ostLng] = def[2].split(",").map((t) => Number(t.trim()));
	const zahlen = { suedLat, westLng, nordLat, ostLng };

	// 💣 Endlich, nicht Infinity. Ein unendlicher Rand projiziert zu NaN, `Math.abs(NaN) <= 1` ist
	// false, und `unproject(NaN)` setzt die Karte auf einen NaN-Mittelpunkt -- die NaN-Pan-Klasse, die
	// im Projekt schon einmal die Routenfindung gerissen hat. Ein Wurf waere dann durch etwas
	// Schlimmeres ersetzt: einer stillen, kaputten Karte.
	Object.entries(zahlen).forEach(([feld, zahl]) => {
		if (!Number.isFinite(zahl)) {
			fail(`${name}.${feld} ist ${feld in zahlen ? String(zahl) : "unlesbar"} -- die vier Ecken muessen `
				+ "ENDLICHE Zahlen sein (Infinity projiziert zu NaN und setzt die Karte auf einen NaN-Mittelpunkt).");
		}
	});
	if (!Object.values(zahlen).every(Number.isFinite) || !breite || !hoehe) {
		return;
	}

	// Die Box muss die Karte auf jeder Seite um mindestens eine Kartenbreite ueberragen: eine knappe
	// Box waere wieder ein Clamp und naehme genau den autoPan zurueck, um den es hier geht.
	const reserveOk = suedLat <= -hoehe && westLng <= -breite && nordLat >= 2 * hoehe && ostLng >= 2 * breite;
	if (!reserveOk) {
		fail(`${name} = [[${suedLat}, ${westLng}], [${nordLat}, ${ostLng}]] umschliesst die Karte `
			+ `(0..${breite} x 0..${hoehe}) nicht weitraeumig genug -- Leaflet wuerde wieder clampen und den `
			+ "autoPan der Infobox zuruecknehmen.");
	}
});

if (failures > 0) {
	console.error(`popup-maxbounds-nie-null.test: ${failures} Fehlschlag/Fehlschlaege`);
	process.exit(1);
}
console.log(`popup-maxbounds-nie-null.test: OK (${zuweisungen.length} Zuweisungen, `
	+ `Grenzwert ${[...platzhalter].join(", ") || "keiner"}, Karte ${breite}x${hoehe})`);
