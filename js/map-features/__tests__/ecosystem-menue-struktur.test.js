// Die Struktur des Flächenmenüs: welche Untermenüs es gibt, wo sie stehen, und dass jedes eine
// Glyphe hat.
//
// 💣 DIE GLYPHE IST PFLICHT, NICHT ZIERDE. Ohne `content` im CSS entsteht das ::before gar nicht,
// die BESCHRIFTUNG wird zum ersten Rasterelement und beginnt bei 12 statt bei 41 px. Genau das ist
// in diesem Menü dreimal passiert und steht dreimal als Warnung in map-context-menu.css.
//
// 💣 UND DIE ZWEITE LISTE. Eine Gruppe steht in AREA_GROUPS (wie sie heisst) UND in AREA_MENU_ORDER
// (wo sie steht). Fehlt der zweite Eintrag, funktioniert alles -- die Gruppe landet nur an der
// falschen Stelle, naemlich hinter „Kopieren …", weil sie dann durch den Rueckfall „vor den ersten
// gefaehrlichen Eintrag" laeuft. Ein Fehler, den man im Diff nicht sieht und im Menue uebersieht.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const css = fs.readFileSync(path.join(wurzel, "css/components/map-context-menu.css"), "utf8");
const quelle = fs.readFileSync(
	path.join(wurzel, "js/map-features/map-features-ecosystem-context-action.js"),
	"utf8"
);

// ---- die Gruppen, die es geben muss --------------------------------------------------------------
//
const GRUPPEN = ["new-area", "form", "mit-anderer", "unterflaechen", "stapel"];

function hatGlyphe(attribut, wert) {
	// Die Regel darf mehrere Selektoren tragen; gesucht wird der Block, der zu diesem Attributwert
	// gehört, und darin ein `content:`.
	const regel = new RegExp(`\\[${attribut}="${wert}"\\]::before[^{]*\\{[^}]*content\\s*:`, "s");
	return regel.test(css);
}

GRUPPEN.forEach((gruppe) => {
	assert.ok(
		hatGlyphe("data-ecosystem-area-group", gruppe),
		`Die Gruppe "${gruppe}" hat keine Glyphenregel in map-context-menu.css -- `
			+ "ihr Öffner beginnt dann bei 12 statt bei 41 px."
	);
});

// ---- und dasselbe für die EINZELEINTRÄGE ---------------------------------------------------------
//
// 🪤 Diese Prüfung fehlte bis zum 23.08.2026: sie galt nur den Gruppen, nicht den Aktionen. Genau
// deshalb ging „Beschriftung bearbeiten" ohne Glyphe live, und der Owner sah es sofort — die Zeile
// begann 29 px weiter links als alle anderen. Eine Zusicherung, die die halbe Menge prüft, liest
// sich wie eine, die die ganze prüft.
// ⚠️ Die Liste wird AUS AREA_MENU_ORDER gelesen, nicht danebengeschrieben: ein neuer Eintrag ist
// damit automatisch erfasst, ohne dass jemand diese Datei kennt.
const AKTIONEN = [...listeLesen("AREA_MENU_ORDER").matchAll(/\{\s*typ:\s*"aktion",\s*id:\s*"([^"]+)"/g)]
	.map((treffer) => treffer[1]);

assert.ok(AKTIONEN.length >= 3, "AREA_MENU_ORDER führt kaum Einzeleinträge -- die Leseregel stimmt nicht mehr");

AKTIONEN.forEach((aktion) => {
	assert.ok(
		hatGlyphe("data-ecosystem-area-action", aktion),
		`Der Eintrag "${aktion}" hat keine Glyphenregel in map-context-menu.css -- `
			+ "seine Beschriftung beginnt dann bei 12 statt bei 41 px und steht aus der Flucht."
	);
});

// ---- beide Listen kennen dieselben Gruppen -------------------------------------------------------

function listeLesen(name) {
	const start = quelle.indexOf(`const ${name} = [`);
	assert.notStrictEqual(start, -1, `${name} nicht gefunden`);
	const ende = quelle.indexOf("\n\t];", start);
	assert.notStrictEqual(ende, -1, `${name} nicht geschlossen`);
	return quelle.slice(start, ende);
}

const gruppenListe = listeLesen("AREA_GROUPS");
const reihenfolgeListe = listeLesen("AREA_MENU_ORDER");

GRUPPEN.forEach((gruppe) => {
	assert.ok(
		gruppenListe.includes(`id: "${gruppe}"`),
		`AREA_GROUPS kennt die Gruppe "${gruppe}" nicht -- sie hätte keine Beschriftung.`
	);
	assert.ok(
		reihenfolgeListe.includes(`id: "${gruppe}"`),
		`AREA_MENU_ORDER kennt die Gruppe "${gruppe}" nicht -- sie landete hinter "Kopieren …".`
	);
});

// ---- die Reihenfolge selbst ----------------------------------------------------------------------
//
// Die Zielreihenfolge verschränkt Gruppen und Einzeleinträge. Genau deshalb steht beides in EINER
// Liste: ein Register nur über die Gruppen hätte keinen Anker, an dem sich „Neue Fläche" relativ zu
// „Fläche bearbeiten" einordnen könnte.
const ERWARTET = [
	"new-area",
	"edit-geometry",
	// „Beschriftung bearbeiten" (23.08.2026) -- direkt hinter „Flaeche bearbeiten", weil beide
	// dasselbe Objekt betreffen. Er ist kein Schmuck: seit der Kurvenriegel den Label-Marker auch im
	// Bearbeiten-Modus abmeldet, ist er der EINZIGE Weg zu einer bestehenden Beschriftung.
	"edit-label",
	"form",
	"mit-anderer",
	"unterflaechen",
	"stapel",
	"ecosystem-properties",
	"send-to",
];

const gefunden = [...reihenfolgeListe.matchAll(/id:\s*"([^"]+)"/g)].map((treffer) => treffer[1]);
assert.deepStrictEqual(
	gefunden,
	ERWARTET,
	"AREA_MENU_ORDER weicht von der Zielreihenfolge ab.\n"
		+ `  erwartet: ${ERWARTET.join(" · ")}\n`
		+ `  gefunden: ${gefunden.join(" · ")}`
);

// ---- „Fläche löschen" bleibt gefährlich und damit zuletzt ----------------------------------------
//
// 🪤 Es steht bewusst NICHT im Register: das Register ordnet, was geordnet werden muss, und
// Zerstörendes fällt ohnehin durch die Gefahren-Regel ans Ende. Stünde es drin, gäbe es zwei
// Regeln für dieselbe Stellung.
assert.ok(
	!gefunden.includes("delete"),
	'„Fläche löschen" gehört nicht ins Register -- die Gefahren-Regel sortiert es bereits ans Ende.'
);

// ---- UND JEDER per addEntry ANGEHAENGTE EINTRAG braucht ebenfalls eine Glyphe -----------------
//
// 🪤 Die Pruefung darueber liest AREA_MENU_ORDER -- dort stehen aber nur die Eintraege des OBERSTEN
// Menues. Was in einer Gruppe haengt („Form aendern" usw.), steht dort NICHT und war damit
// ungedeckt. Aufgefallen beim Eintrag „Labelkurve aktualisieren" am 23.08.2026.
// ⚠️ Gelesen wird die QUELLE, nicht eine Liste daneben: ein neuer Eintrag ist damit automatisch
// erfasst, ohne dass jemand diese Datei kennt.
const ANGEHAENGT = [...quelle.matchAll(/addEcosystemAreaMenuEntry\(\{\s*action:\s*"([^"]+)"/g)]
	.map((t) => t[1]);
assert.ok(ANGEHAENGT.length >= 1, "keine per addEntry angehaengten Eintraege gefunden -- Leseregel pruefen");
ANGEHAENGT.forEach((aktion) => {
	assert.ok(
		hatGlyphe("data-ecosystem-area-action", aktion),
		`Der angehaengte Eintrag "${aktion}" hat keine Glyphenregel in map-context-menu.css -- `
			+ "seine Beschriftung beginnt dann bei 12 statt bei 41 px."
	);
});

// ---- „Labelkurve aktualisieren": die Sichtbarkeitsregel ist die EINSTELLUNG, nicht die Kurve --------
// 💣 Nach einer Formaenderung ist die gerechnete Kurve gerade WEG (ihr Fingerabdruck stimmt nicht
// mehr) -- und genau dann braucht man den Eintrag. Wer auf `curveLine` prueft, blendet ihn in dem
// Augenblick aus, in dem er gebraucht wird.
assert.ok(quelle.includes("function regionHatKurvenbeschriftung("),
	'die Sichtbarkeitsregel fuer „Labelkurve aktualisieren" fehlt');
assert.ok(quelle.includes("zeile.curve_label === true"),
	"die Sichtbarkeit muss die EINSTELLUNG lesen (curve_label), nicht die gerechnete Kurve");
const sichtStart = quelle.indexOf("function regionHatKurvenbeschriftung(");
const sichtEnde = quelle.indexOf("function registerAreaMenuCurveRefreshEntry(");
assert.ok(sichtEnde > sichtStart, "die zwei Bauteile stehen beieinander");
assert.ok(!quelle.slice(sichtStart, sichtEnde).includes("curveLine"),
	"die Sichtbarkeitsregel darf NICHT auf curveLine schauen");

// 🔴 Und sie laeuft ueber `refresh_curve` (Faehigkeit `edit`), NICHT ueber den Sammellauf
// (curve-labels-run.php, Faehigkeit `admin`). Owner: ein Killer-Vorgang gehoert nicht in die Hand
// jedes Editors, eine einzelne lokale Bearbeitung schon.
assert.ok(quelle.includes('postEcosystemEdit("refresh_curve"'),
	"der Eintrag muss die Einzel-Aktion rufen");
assert.ok(!quelle.includes("curve-labels-run.php"),
	"der Eintrag darf NICHT den admin-pflichtigen Sammellauf ausloesen");

console.log("ok - ecosystem-menue-struktur");
