// DIE FUGE zwischen Listen-Nutzlast und Vorbelegung -- gemessen, nicht nachgebaut (Discord #135).
//
// 🔴 WARUM ES DIESEN TEST GIBT. Der Fix vom 20.09.2026 14:36 war sachlich richtig und trotzdem
// wirkungslos: „Berge über Donfanger“ blieb ein einzelner Gipfel. Sein Test fütterte
// `garetienZielVorbelegung` mit `geometrie: quadrat(...)` -- einem Feld, das für ein PUNKTZIEL in
// der echten Nutzlast nie ein Polygon trägt. Die Regel war grün, die Fuge ungeprüft.
//
// 💣 DIE LEHRE, UND SIE IST ÄLTER ALS DIESER FALL: eine Fixture, die ihr Feld selbst erfindet,
// prüft den Test gegen sich selbst. Gemessen wird deshalb der SCHLÜSSEL -- was der Server schickt
// gegen das, was der Browser liest. Weichen sie ab, ist dieser Test rot, auch wenn beide Hälften
// für sich genommen funktionieren.
//
// ⚠️ Der Transport selbst (trägt die Listen-Nutzlast die Punkte überhaupt?) steht in
// api/_internal/import/__tests__/garetien-berg-quellpunkte-test.php und wird dort am echten
// Listenbauer gefahren. Hier geht es nur um die Naht.
//
// Run: node js/review/__tests__/garetien-berg-vorbelegung-fuge.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: Arbeitskopie CRLF, `actions/checkout` LF (AGENTS.md §9).
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").replace(/\r\n/g, "\n");
let checks = 0;

// ---- Seite 1: Welchen Schlüssel schickt der SERVER? ----------------------------------------------

const listePhp = lies("api/_internal/import/garetien-liste.php");

// Der Block, der eine Objektzeile der Arbeitsliste baut -- daneben stehen `geometrie` und
// `geometrie_typ`, die der Karte gehören.
assert.ok(/'geometrie_typ'\s*=>/.test(listePhp),
	"Vorbedingung: die Objektzeile der Arbeitsliste trägt `geometrie_typ`"); checks++;

const SCHLUESSEL = "quellpunkte";
assert.ok(new RegExp("'" + SCHLUESSEL + "'\\s*=>").test(listePhp),
	`der Server schickt die rohe Punktliste als \`${SCHLUESSEL}\` (Discord #135)`); checks++;

// 🔴 Sie kommt aus `after.punkte` -- der Stelle, die der Planbau genau dafür anlegt. Aus
// `after.geometry` gelesen wäre es wieder die Mitte, und der Fehler wäre unverändert da.
const quellZeile = listePhp.split("\n").find((z) => z.includes("'" + SCHLUESSEL + "'"));
assert.ok(/punkte/.test(quellZeile),
	"und zwar aus der rohen Punktliste des Vorschlags, nicht aus der Ziel-Geometrie"); checks++;

// ---- Seite 2: Welchen Schlüssel liest der BROWSER? -----------------------------------------------

const importerJs = lies("js/review/review-garetien-importer.js");

function schneide(kopf) {
	const von = importerJs.indexOf(kopf);
	assert.ok(von > -1, `${kopf} steht in der Datei`); checks++;
	let tiefe = 0;
	for (let i = importerJs.indexOf("{", von); i < importerJs.length; i++) {
		if (importerJs[i] === "{") { tiefe++; }
		else if (importerJs[i] === "}") {
			tiefe--;
			if (tiefe === 0) { return importerJs.slice(von, i + 1); }
		}
	}
	assert.fail(`der Rumpf von ${kopf} ist nicht abgegrenzt`);
}

function konstante(name) {
	const i = importerJs.indexOf(name);
	assert.ok(i > -1, `${name} steht in der Datei`); checks++;
	return importerJs.slice(i, importerJs.indexOf("\n", i));
}

const code = [
	konstante("const AVESMAPS_GARETIEN_FORMEN = ["),
	// Die Formen-Tabelle ist mehrzeilig -- ihren Rumpf bis zur schliessenden Klammer nehmen.
	importerJs.slice(importerJs.indexOf("const AVESMAPS_GARETIEN_FORMEN = ["),
		importerJs.indexOf("];", importerJs.indexOf("const AVESMAPS_GARETIEN_FORMEN = [")) + 2),
	schneide("function garetienFormPunkte"),
	schneide("function garetienMoeglicheFormen"),
	schneide("function garetienFlaecheMeilen2"),
	konstante("const AVESMAPS_GARETIEN_BERGFAMILIE"),
	konstante("const AVESMAPS_GARETIEN_BERG_SCHWELLE_MEILEN2"),
	konstante("const AVESMAPS_GARETIEN_GEBIRGE_SCHWELLE_MEILEN2"),
	schneide("function garetienZielVorbelegung"),
].slice(1).join("\n");

const kasten = { console, Number, Math, String, Array, Object, Boolean };
kasten.globalThis = kasten;
vm.createContext(kasten);
vm.runInContext(`${code} this.__vorbelegung = garetienZielVorbelegung; this.__formen = garetienMoeglicheFormen; this.__flaeche = garetienFlaecheMeilen2;`,
	kasten, { filename: "review-garetien-importer.js" });

// ---- Die Naht: ein Objekt in der Form, die WIRKLICH über die Leitung kommt -----------------------
//
// 💣 `geometrie` trägt EINEN Punkt (die Mitte des Punktziels) -- genau so, wie die Arbeitsliste sie
// für einen `Berg` baut. Wer hier ein Polygon einsetzt, prüft den Test gegen sich selbst.

// Ein Quadrat von 1870 Meilen² -- die gemeldete Größe von „Berge über Donfanger“.
const seite = Math.sqrt(1870 / 9);
const polygon = [[0, 0], [seite, 0], [seite, seite], [0, seite]];
assert.strictEqual(Math.round(kasten.__flaeche(polygon)), 1870,
	"Vorbedingung: das Testpolygon misst wirklich 1870 Meilen²"); checks++;

const wieVomServer = {
	typ: "Berg",
	ziel: "label",
	subtyp: "berggipfel",
	kind: "",
	geometrie: [[10, 10]],          // die Mitte, EIN Punkt -- so kommt es live an
	geometrie_typ: "Point",
	[SCHLUESSEL]: polygon,          // die rohe Punktliste
};

const belegt = kasten.__vorbelegung(wieVomServer);
assert.strictEqual(belegt.ziel, "region",
	"DIE NAHT: ein großes Berg-Polygon wird als Fläche vorbelegt, obwohl `geometrie` nur die Mitte trägt"); checks++;
assert.strictEqual(belegt.subtyp, "gebirge", "und zwar als Gebirge"); checks++;
assert.strictEqual(belegt.kind, "topographie", "mit der Ebene, die die Zuordnungstabelle dem Typ Gebirge gibt"); checks++;

// 🔴 Und das Fenster muss die Form auch ANBIETEN. Ohne das stünde im Auswahlfeld „Fläche" gar nicht
// zur Wahl, und der Editor könnte die Vorbelegung nicht einmal von Hand herstellen -- der Server
// erlaubt sie längst (avesmapsGaretienPunkteAusVorschlag liest dieselbe Liste).
const formen = kasten.__formen(wieVomServer).map((f) => f.key);
assert.ok(formen.includes("region"),
	"und die Form „Fläche“ wird angeboten -- sonst ist die Vorbelegung nicht einmal von Hand erreichbar"); checks++;
assert.ok(formen.includes("path"), "eine Linie ebenfalls -- dieselbe Punktliste trägt sie"); checks++;

// ---- Gegenproben: die Regel bleibt eng -----------------------------------------------------------

// Ein kleiner Gipfel bleibt ein Gipfel -- auch wenn er ein Polygon mitbringt.
const klein = Object.assign({}, wieVomServer, { [SCHLUESSEL]: [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]] });
assert.strictEqual(kasten.__vorbelegung(klein).ziel, "label",
	"ein kleines Berg-Polygon bleibt ein Gipfel"); checks++;

// Ohne Quellpunkte bleibt alles, wie es war -- ein Punktziel mit nur EINEM Quellpunkt.
const ohne = { typ: "Berg", ziel: "label", subtyp: "berggipfel", kind: "", geometrie: [[10, 10]], geometrie_typ: "Point" };
assert.strictEqual(kasten.__vorbelegung(ohne).ziel, "label",
	"ohne Quellpunkte bleibt es beim Gipfel -- eine fehlende Liste ist nicht „klein“"); checks++;
// 🪤 Als ZEICHENKETTE verglichen: ein Array aus dem vm-Kontext traegt einen fremden
// Array-Prototyp, und `deepStrictEqual` faellt dann bei zeichengleichem Inhalt
// („actual [a,b], expected [a,b]") -- eine Hausfalle, die hier schon zweimal Zeit gekostet hat.
assert.strictEqual(kasten.__formen(ohne).map((f) => f.key).join(","), "label,location",
	"und das Fenster bietet dann nur die Punktformen an"); checks++;

// 🔴 Die ABWÄRTSregel gehört weiter der Bergfamilie und liest die FLÄCHENgeometrie: eine winzige
// Gebirgsfläche beginnt als Gipfel. Sie darf von diesem Umbau nicht berührt werden.
const winzig = { typ: "Gebirge", ziel: "region", subtyp: "gebirge", kind: "topographie",
	geometrie: [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]], geometrie_typ: "Polygon" };
assert.strictEqual(kasten.__vorbelegung(winzig).subtyp, "berggipfel",
	"die Abwärtsregel wirkt unverändert -- eine winzige Gebirgsfläche beginnt als Gipfel"); checks++;

// Und eine große Fläche bleibt Fläche.
const grosseFlaeche = { typ: "Gebirge", ziel: "region", subtyp: "gebirge", kind: "topographie",
	geometrie: polygon, geometrie_typ: "Polygon" };
assert.strictEqual(kasten.__vorbelegung(grosseFlaeche).ziel, "region",
	"eine große Gebirgsfläche bleibt Fläche"); checks++;

console.log(`OK -- ${checks} Zusicherungen (Discord #135: die Fuge zwischen Nutzlast und Vorbelegung)`);
