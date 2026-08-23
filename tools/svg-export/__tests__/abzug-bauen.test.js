// Der naechtliche Laeufer: baut er mit DEMSELBEN Bauer denselben Abzug, den die manuelle
// Seite mit allen Haekchen erzeugt? Lauf:
//   node tools/svg-export/__tests__/abzug-bauen.test.js
//
// ⚠️ Ohne Netz. Geprueft wird die Zusammenstellung (Einstellungen, Farben, Ergebnisform) an
// einer Fixture -- der echte Abruf gegen avesmaps.de laeuft im Workflow und wird dort mit
// derselben Liste (abzug-pruefung.js) abgenommen.
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const L = require("../abzug-bauen.js");
const P = require("../abzug-pruefung.js");
const T = require("../tokens-tafel.js");
const B = require("../../../js/pages/svg-export-build.js");
const FX = require("./fixture.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const token = T.svgxTokenLeser(path.join(WURZEL, "css", "base", "tokens.css"));

// ---- 1. Die Einstellungen SIND die der manuellen Seite ---------------------------------
// 🔴 Wer hier eine Zahl aendert, aendert, was die API ausliefert -- und der manuelle Export
// sagt dann etwas anderes. Diese Zusicherungen sind der Grund, warum das auffaellt.
const E = L.ABZUG_EINSTELLUNGEN;
assert.strictEqual(E.sizePx, 32768, "die geforderte Exportgroesse");
assert.strictEqual(E.dialect, "inkscape");
assert.strictEqual(E.dialect, B.SVGX_DIALECTS.INKSCAPE, "und zwar der Wert des Bauers, nicht ein Wort");
assert.strictEqual(E.semantics, true, "volle avm:*-Semantik");
assert.strictEqual(E.smooth, false, "keine Linienglaettung");
assert.strictEqual(E.smoothAreas, false, "keine Flaechenglaettung");
assert.strictEqual(E.strokeScale, 1, "100 % ist der Kartenzustand");
assert.strictEqual(E.registrationMarks, false, "Passmarken sind fuer Photoshop, nicht fuer die API");
// 💣 `{}` heisst ALLES. svgxSubgroupEnabled schliesst nur bei ausdruecklichem `false` aus --
// eine Aufzaehlung waere eine Liste, die niemand nachfuehrt, und eine neue Wegart fiele
// lautlos heraus. Genau diese Falle steht im Bauer als Kommentar.
assert.deepStrictEqual(E.subgroups, {}, "keine Aufzaehlung von Unterarten");
assert.deepStrictEqual(E.layers, {}, "keine Aufzaehlung von Ebenen");
assert.strictEqual(B.svgxSubgroupEnabled(E.subgroups, "EineGanzNeueWegart"), true,
	"und der Bauer liest das auch so");

// ---- 2. Die Zeichenreihenfolge der Landschaften ----------------------------------------
// 💣 In SVG liegt das Erste unten. Die acht Klimabaender decken die GANZE Karte -- kaemen sie
// zuletzt, laege ein Farbschleier ueber Wald, Meer und Gebirge.
assert.deepStrictEqual(L.ECOSYSTEM_ARTEN, ["klima", "derographisch", "vegetation", "topographie"]);
const kitt = fs.readFileSync(path.join(WURZEL, "js", "pages", "svg-export-page.js"), "utf8");
const kittArten = /ecosystemKinds:\s*\[([^\]]+)\]/.exec(kitt);
assert.ok(kittArten, "der Kitt fuehrt seine Reihenfolge noch");
assert.deepStrictEqual(
	kittArten[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean),
	L.ECOSYSTEM_ARTEN,
	"Laeufer und Browser holen die Landschaften in DERSELBEN Reihenfolge -- sonst sieht der "
	+ "eine Abzug anders aus als der andere, und niemand sucht den Fehler in einer Liste");

// ---- 3. Die Farben: dieselben Vorgaben wie im Browser ----------------------------------
const oekosysteme = FX.OEKOSYSTEME;
const farben = L.vorgabeFarben(oekosysteme, token);
assert.strictEqual(farben.areaColors.see, "#82befe", "Owner-Vorgabe schlaegt den Token");
assert.strictEqual(farben.areaColors.wald, "#589a64");
assert.strictEqual(farben.areaColors.gebirge, "#acaea2");
assert.strictEqual(farben.areaColors.meer, token("--color-ecosystem-topographie-meer"),
	"wofuer es keine Vorgabe gibt, kommt aus dem Token -- wie auf der Karte");
assert.strictEqual(farben.wayColors.Reichsstrasse, "#f5ffe9");
assert.strictEqual(farben.wayColors.Flussweg, "#4c89c6");
// 💣 SVGX_PLACE_KINDS fuehrt OBJEKTE. Ein forEach ueber das Objekt selbst ergaebe den
// Schluessel "[object Object]", und weil der Bauer dann still auf SVGX_PLACE_COLOR
// zurueckfaellt, saehe man dem Abzug nichts an.
B.SVGX_PLACE_KINDS.forEach((art) => {
	assert.strictEqual(farben.placeColors[art.slug], "#e33b35", `${art.slug} traegt die Markerfarbe`);
});
assert.ok(!("[object Object]" in farben.placeColors), "keine verunglueckten Schluessel");
// 🔴 Konturen sind vorbelegt, aber AUS -- eine Kontur gehoert dem Bearbeiten, nicht dem
// Ansehen (AGENTS.md sec.12).
assert.deepStrictEqual(farben.wayOutlines, {});
assert.deepStrictEqual(farben.areaOutlines, {});

// ---- 4. Der ganze Durchlauf an einer Fixture -------------------------------------------
// 🔴 Die Fixture liegt in fixture.js -- dieselbe, die endpunkt-ablauf.js dem echten Endpunkt
// unterschiebt. Zwei Fixtures hiessen: der Unit-Test prueft eine Karte, der Ablauf eine andere.
const mapFeatures = FX.MAP_FEATURES;
const territories = FX.TERRITORIES;

const ergebnis = B.svgxBuildDocument(Object.assign({}, E, {
	mapFeatures: mapFeatures,
	territories: territories,
	ecosystems: oekosysteme,
	ecoRevision: FX.ECO_REVISION,
	exportedAt: FX.EXPORTIERT,
}, farben));

const svg = ergebnis.parts.join("");

// Die Abnahmeliste -- DIESELBE, die der Workflow an der echten Datei fahren wird.
const abnahme = P.pruefeAbzug(svg);
assert.deepStrictEqual(abnahme.befunde, [], "die Abnahmeliste muss durchlaufen");
assert.ok(abnahme.geprueft >= 20, `die Liste ist nicht leer: ${abnahme.geprueft} Punkte`);
const struktur = P.pruefeStruktur(svg);
assert.deepStrictEqual(struktur.befunde, [], "Gruppen ausgeglichen, kein rohes &");

// Und die Fassungen stehen wirklich drin, nicht bloss irgendeine Zahl.
assert.ok(svg.includes('avm:kartenfassung="76178"'), "die Kartenfassung kommt aus dem Payload");
assert.ok(svg.includes('avm:landschaftsfassung="21358"'));
assert.ok(svg.includes('avm:exportiert="2026-08-23T03:17:00.000Z"'));
// 💣 einheit_px = Kantenlaenge / viewBox. Bei 32768 sind das genau 32 Pixel je Einheit; die
// Bild-Pipeline rechnet damit.
assert.ok(svg.includes('avm:einheit_px="32"'), "32768 / 1024 = 32");

// ---- 5. 💣 DIE ABNAHMELISTE MUSS SCHARF SEIN -------------------------------------------
// Eine Zusicherung, die ihr Subjekt trivial erfuellt, ist keine. Also: nimm dem Abzug je eine
// Eigenschaft weg und sieh nach, ob die Liste das MERKT.
const mutationen = [
	['viewBox="0 0 1024 1024"', 'viewBox="0 0 512 512"', "viewBox 0 0 1024 1024"],
	['width="32768"', 'width="8192"', "32768 x 32768"],
	['avm:geglaettet="nein"', 'avm:geglaettet="ja"', 'avm:geglaettet="nein"'],
	['avm:flaechen_geglaettet="nein"', 'avm:flaechen_geglaettet="ja"', 'avm:flaechen_geglaettet="nein"'],
	['avm:landschaftsfassung="21358"', 'avm:landschaftsfassung=""', "avm:landschaftsfassung gesetzt"],
	['avm:kind="ort"', 'avm:kind="ortx"', "avm:kind=ort"],
	['avm:type="Flussweg"', 'avm:type="Trockenweg"', "Gewaesser: Flusswege"],
];
mutationen.forEach(([suchen, ersetzen, erwarteterBefund]) => {
	const kaputt = svg.split(suchen).join(ersetzen);
	assert.notStrictEqual(kaputt, svg, `die Mutation "${suchen}" trifft ueberhaupt etwas`);
	const r = P.pruefeAbzug(kaputt);
	assert.ok(r.befunde.includes(erwarteterBefund),
		`"${erwarteterBefund}" muss anschlagen, gemeldet wurde: ${r.befunde.join(", ") || "nichts"}`);
});
// Und die Strukturpruefung merkt eine fehlende Klammer.
assert.ok(!P.pruefeStruktur(svg.replace("</g>", "")).ok, "eine fehlende Gruppenklammer faellt auf");
assert.ok(!P.pruefeStruktur(svg + "Fisch & Chips").ok, "ein rohes & faellt auf");

// ---- 6. Die Stueckliste wandert unveraendert in die Datei -------------------------------
// 💣 Nie ein einziger Riesenstring durch Aneinanderhaengen -- und der Hash muss zu genau den
// Bytes gehoeren, die auf der Platte landen, denn er wird spaeter der ETag.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avm-svgx-"));
const ziel = path.join(tmp, "probe.svg");
L.schreibeAbzug(ergebnis.parts, ziel).then((mass) => {
	const geschrieben = fs.readFileSync(ziel);
	assert.strictEqual(mass.bytes, geschrieben.length, "die gemeldete Groesse ist die echte");
	assert.strictEqual(mass.bytes, Buffer.byteLength(svg, "utf8"));
	assert.strictEqual(geschrieben.toString("utf8"), svg, "Byte fuer Byte dieselbe Datei");
	const crypto = require("crypto");
	assert.strictEqual(mass.sha256, crypto.createHash("sha256").update(geschrieben).digest("hex"),
		"der Hash gehoert zu DIESEN Bytes -- er wird der ETag");
	fs.unlinkSync(ziel);
	fs.rmdirSync(tmp);
	console.log(`abzug-bauen: ok (${abnahme.geprueft} Abnahmepunkte, ${mutationen.length} Mutationen)`);
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
