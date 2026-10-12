"use strict";

// Die API-Adresse der ROUTINEN -- und die eine Adresse, die bewusst NICHT mitwandert.
//
// 💣 DER ANLASS (12.10.2026). Die alte Anwendung ist auf `legacy.avesmaps.de` gezogen, `avesmaps.de`
// traegt seither Avesmaps3D und hat kein `api/` mehr. Vier Stellen holten ihre Daten weiter von der
// alten Adresse, und keine davon meldet sich beim Benutzer:
//   * der Nachpruefer des Deploys -- er faehrt NACH dem Upload einen echten Abruf und meldete
//     seither bei JEDEM Deploy „Die Karte ist tot ... erwaege einen Revert". Ein Waechter, der
//     falsch zeigt, ist schlimmer als keiner: man gewoehnt sich an seinen Alarm, und dann ist er
//     einmal echt. Genau diese Lehre steht im Workflow daneben ueber wackelnde Tests.
//   * das Mastodon-Relais, alle 30 Minuten -- BELEGT rot: Lauf 38303732794 vom 12.10.2026 20:21
//     endete mit „relay-next.php antwortete mit HTTP 404" bei `AVESMAPS_BASIS: https://avesmaps.de`.
//   * die naechtliche SVG-Abzug-Routine (03:17 UTC), die ihre Kartendaten dort holt.
//   * die Paritaetspruefung der wiki_key-Faltung, die gegen die Live-Tabelle vergleicht
//     (AGENTS.md §5 nennt sie mit der Hand).
//
// 🔴 UND DIE GEGENPROBE IST DER EIGENTLICHE INHALT DIESES TESTS: `https://avesmaps.de/ns/export/1`
// ist ein XML-NAMENSRAUM, keine Abrufadresse -- eine Kennung, die im erzeugten SVG steht und die
// jeder fremde Leser des Abzugs kennt. Ein Suchen-und-Ersetzen ueber „avesmaps.de" nimmt sie mit und
// bricht damit den Export-Vertrag, ohne dass ein Abruf je fehlschlaegt. Darum steht sie hier
// ausdruecklich als Zusicherung drin und nicht als Ausnahme in einer Wortliste.
//
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, die CI LF (AGENTS.md §9).

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..");
const lies = (datei) => fs.readFileSync(path.join(WURZEL, datei), "utf8").replace(/\r\n/g, "\n");

// § A -- Wer seine Daten holt, holt sie vom Wirt, der `api/` traegt.
// Je Eintrag: die Datei, die Zeile, die dort stehen MUSS, und warum sie es muss.
const ABRUFER = [
	{
		datei: ".github/workflows/deploy-avesmaps-strato.yml",
		muss: 'ziel="https://legacy.avesmaps.de/api/app/map-features.php"',
		warum: "der Nachpruefer des Deploys -- zeigt er falsch, meldet jeder Deploy einen toten Deploy",
	},
	{
		datei: ".github/workflows/mastodon-relais.yml",
		muss: "${{ inputs.base_url || 'https://legacy.avesmaps.de' }}",
		warum: "das Relais holt die Warteschlange; zeigt es falsch, sendet Mastodon nichts mehr",
	},
	{
		datei: ".github/workflows/svg-export-abzug.yml",
		muss: "${{ inputs.base_url || 'https://legacy.avesmaps.de' }}",
		warum: "die naechtliche Abzug-Routine holt dort ihre Kartendaten",
	},
	{
		datei: "tools/social/mastodon-relais.mjs",
		muss: 'process.env.AVESMAPS_BASIS || "https://legacy.avesmaps.de"',
		warum: "der Rueckfall des Laeufers, wenn ihn jemand von Hand faehrt",
	},
	{
		datei: "tools/svg-export/abzug-bauen.js",
		muss: 'process.env.AVESMAPS_BASE_URL || "https://legacy.avesmaps.de"',
		warum: "derselbe Rueckfall beim Abzug-Laeufer",
	},
	{
		datei: "tools/wikidump/verify-live-key-parity.php",
		muss: "'https://legacy.avesmaps.de/api/app/political-territory-wiki.php?limit=2000'",
		warum: "die Paritaetspruefung der wiki_key-Faltung gegen den Livebestand",
	},
];

for (const { datei, muss, warum } of ABRUFER) {
	const quelle = lies(datei);
	assert.ok(
		quelle.includes(muss),
		`${datei}: erwartet „${muss}" -- ${warum}`
	);
	// Dieselbe Zeile darf die alte Adresse nicht DANEBEN noch einmal nennen: ein zweiter Rueckfall
	// waere die zweite Wahrheit, und beim naechsten Umzug zieht jemand nur eine von beiden nach.
	const ohneNeue = quelle.split(muss).join("@@GEPRUEFT@@");
	const alteAbrufe = [...ohneNeue.matchAll(/https:\/\/(?:www\.)?avesmaps\.de\/api\//g)];
	assert.strictEqual(
		alteAbrufe.length,
		0,
		`${datei}: ${alteAbrufe.length} Abruf(e) zeigen weiter auf avesmaps.de/api/ -- ${warum}`
	);
}

// § B -- GEGENPROBE: der XML-Namensraum des SVG-Abzugs bleibt, wo er ist.
// 🔴 Er ist eine KENNUNG. Wanderte er mit, traegt jeder neue Abzug einen anderen Namensraum als
//    jeder alte, und ein Leser, der auf den bekannten prueft, findet nichts mehr -- lautlos, weil
//    kein Abruf dabei fehlschlaegt.
const NAMENSRAUM = "https://avesmaps.de/ns/export/1";
for (const datei of ["js/pages/svg-export-build.js", "tools/svg-export/abzug-pruefung.js"]) {
	assert.ok(
		lies(datei).includes(NAMENSRAUM),
		`${datei}: der XML-Namensraum „${NAMENSRAUM}" muss unveraendert bleiben -- er ist eine Kennung, keine Adresse`
	);
}

// § C -- Und die Namensraum-Kennung ist in BEIDEN Dateien dieselbe Zeichenkette. Sie steht zweimal
// im Haus (Erzeuger und Pruefer); laufen die auseinander, meldet die Abnahme des Abzugs einen
// Fehler, den der Abzug nicht hat.
const ausErzeuger = /const SVGX_NS_AVM = "([^"]+)"/.exec(lies("js/pages/svg-export-build.js"));
assert.ok(ausErzeuger, "SVGX_NS_AVM nicht in js/pages/svg-export-build.js gefunden");
assert.strictEqual(ausErzeuger[1], NAMENSRAUM, "Der Erzeuger schreibt einen anderen Namensraum als der Pruefer erwartet");

console.log(`api-adresse-der-routinen: OK (${ABRUFER.length} Abrufer, Namensraum unveraendert)`);
