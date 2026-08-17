// Der reine Rechner hinter der Override-Zeile (Aufgabe 1,
// docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md §3.1).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { avesmapsWikiFeldStand, avesmapsWikiFeldNormalize } = require("../wiki-feld-herkunft.js");

const felder = [
	{ wiki: "name", karte: "name", label: "Name" },
	{ wiki: "art", karte: "", label: "Art" },                       // Anzeige-Zeile ohne Ziel
	{ wiki: "ortsgroesse", karte: "feature_subtype", label: "Ortsgröße" },
	{ wiki: "einwohner", karte: "einwohner", label: "Einwohner" },
	{ wiki: "oberhaupt", karte: "oberhaupt", label: "Herrscher" },
];

// ── Der Abnahmefall aus dem Mockup: Ferdok ──────────────────────────────────────────────────────
const stand = avesmapsWikiFeldStand(
	felder,
	{ name: "Ferdok", feature_subtype: "grossstadt", einwohner: "6.100", oberhaupt: "Growin Sohn des Bregdan" },
	{ name: "Ferdok", ortsgroesse: "stadt", einwohner: "5.900", oberhaupt: "Growin Sohn des Bregdan", art: "Handelsstadt" },
	{ einwohner: "manual", oberhaupt: "wiki" }
);

// 🔴 EINE ANZEIGE-ZEILE (`karte: ""`) KOMMT NICHT VOR -- sie hat kein Kartenziel, kann also weder
// abweichen noch zurueckgesetzt werden. Dieselbe Regel wie in der Diff-Rechnung; so tragen die
// Kraftlinien ihre vier Wiki-Felder.
assert.deepStrictEqual(Object.keys(stand), ["name", "feature_subtype", "einwohner", "oberhaupt"]);
assert.strictEqual(stand.art, undefined, "eine Anzeige-Zeile (karte: \"\") ist im Ergebnis gelandet");

// Gleicher Wert, keine Herkunft -> die Zeile bleibt still (kein Durchstreichen, kein ↺).
assert.strictEqual(stand.name.abweicht, false);
assert.strictEqual(stand.name.herkunft, "", "ein Feld ohne Eintrag traegt eine erfundene Herkunft");

// Weicht ab, Herkunft unbekannt -> durchgestrichen + ↺, aber Beschriftung NICHT braun.
assert.strictEqual(stand.feature_subtype.abweicht, true);
assert.strictEqual(stand.feature_subtype.wikiWert, "stadt");
assert.strictEqual(stand.feature_subtype.herkunft, "");

// Weicht ab UND von uns -> durchgestrichen + ↺ + braune Beschriftung.
assert.strictEqual(stand.einwohner.abweicht, true);
assert.strictEqual(stand.einwohner.wikiWert, "5.900");
assert.strictEqual(stand.einwohner.herkunft, "manual");

// 🔴 Herkunft "wiki" wird MITGEFUEHRT, obwohl die Zeile nichts anzeigt -- sie wirkt beim Vorhaekeln
// (wiki-assign-diff.js), nicht an der Beschriftung. Ohne diese Zusicherung koennte jemand sie beim
// „Aufraeumen" fallen lassen, weil sie sichtbar folgenlos ist.
assert.strictEqual(stand.oberhaupt.abweicht, false);
assert.strictEqual(stand.oberhaupt.herkunft, "wiki");

// ── Die Normalisierungsprobe ────────────────────────────────────────────────────────────────────
// 💣 WORTGLEICH ZU avesmapsWikiAssignDiffNormalize, und das ist tragend: zwei Normalisierungen sind
// zwei Wahrheiten -- die Zeile zeigte eine Abweichung, die die Sync-Vorschau daneben nicht listet,
// also ein ↺, das nichts zu holen hat.
const raender = avesmapsWikiFeldStand(
	[{ wiki: "einwohner", karte: "einwohner" }],
	{ einwohner: "  5.900  " }, { einwohner: "5.900" }, {}
);
assert.strictEqual(raender.einwohner.abweicht, false,
	"erwartet: KEINE Abweichung -- beide Seiten werden beschnitten. Weicht sie ab, haengt die Zeile "
	+ "an einer Formatierung statt am Inhalt, und die Sync-Vorschau daneben widerspricht ihr.");

// `null` und `""` sind dasselbe -- sonst meldete ein frisch angelegter Ort ueberall Abweichungen.
const leer = avesmapsWikiFeldStand(
	[{ wiki: "oberhaupt", karte: "oberhaupt" }],
	{ oberhaupt: null }, { oberhaupt: "" }, {}
);
assert.strictEqual(leer.oberhaupt.abweicht, false);

// ⚠️ UND DIE ANDERE RICHTUNG IST KEINE ABWEICHUNG: sagt das Wiki nichts und die Karte etwas, gaebe
// es nichts zurueckzuholen -- ein ↺ wuerde die Angabe LEEREN. Genau dieser Fall ist in der
// Sync-Vorschau der, der NIE vorangehakt ist; die Zeile bleibt deshalb still.
const wikiSchweigt = avesmapsWikiFeldStand(
	[{ wiki: "oberhaupt", karte: "oberhaupt" }],
	{ oberhaupt: "Growin" }, { oberhaupt: "" }, { oberhaupt: "manual" }
);
assert.strictEqual(wikiSchweigt.oberhaupt.abweicht, false,
	"ein leerer Wiki-Wert wird als Abweichung gemeldet -- das ↺ wuerde die Angabe leeren");

// ── Ein unbekannter Herkunftswert ist KEINE Herkunft ────────────────────────────────────────────
// 🔴 Alles ausser "manual"/"wiki" faellt auf „nicht bekannt" zurueck, statt eine Aussage zu
// erfinden -- eine kuenftige dritte Herkunft darf keine braune Beschriftung ausloesen.
const fremd = avesmapsWikiFeldStand(
	[{ wiki: "einwohner", karte: "einwohner" }],
	{ einwohner: "6.100" }, { einwohner: "5.900" }, { einwohner: "community" }
);
assert.strictEqual(fremd.einwohner.herkunft, "");

// Leere/fehlende Eingaben werfen nicht.
assert.deepStrictEqual(avesmapsWikiFeldStand(null, null, null, null), {});
assert.strictEqual(avesmapsWikiFeldNormalize(undefined), "");

// ── 💣 Die Zusicherung, die die Normalisierung an ihren Zwilling BINDET ─────────────────────────
// Eine Probe „beide beschneiden" bleibt gruen, wenn eine der beiden Fassungen spaeter etwas anderes
// tut (etwa Mehrfach-Leerzeichen faltet). Deshalb wird der RUMPF verglichen, nicht das Verhalten an
// drei Beispielen. 🪤 Verglichen wird die Zeile mit `return`, nicht die ganze Funktion: die
// Kommentare darueber duerfen sich unterscheiden, der Ausdruck nicht.
const rumpf = (datei, name) => {
	const quelle = fs.readFileSync(path.join(__dirname, "..", datei), "utf8");
	const treffer = quelle.match(new RegExp("function " + name + "\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}"));
	assert.ok(treffer, "Funktion " + name + " nicht gefunden in " + datei);
	return treffer[1].split("\n").map((z) => z.trim()).filter((z) => z !== "" && !z.startsWith("//")).join(" ");
};
assert.strictEqual(
	rumpf("wiki-feld-herkunft.js", "avesmapsWikiFeldNormalize"),
	rumpf("wiki-assign-diff.js", "avesmapsWikiAssignDiffNormalize"),
	"die zwei Normalisierungen sind auseinandergelaufen -- die Feldzeile und die Sync-Vorschau "
	+ "wuerden sich ueber dieselbe Abweichung uneinig"
);

console.log("wiki-feld-herkunft: alle Zusicherungen erfuellt");
