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

console.log("ok - ecosystem-menue-struktur");
