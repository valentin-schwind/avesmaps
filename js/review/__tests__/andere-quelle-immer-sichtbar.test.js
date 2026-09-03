// „Andere Quelle" steht IMMER zur Verfügung -- auch wenn eine Wiki-Quelle zugewiesen ist.
// Owner 31.08.2026: „man kann andere quellen hinzufügen, selbst wenn es eine wiki-quelle gibt".
//
// 🔴 DIE ALTE REGEL WAR EIN ENTWEDER-ODER und stand ausgeschrieben im Kopf von
// js/review/review-other-source.js: „shown ONLY when NO wiki entry is assigned -- a wiki source
// always takes precedence". Sie stammt aus der Zeit VOR dem Mehrquellen-System (`sources` +
// `feature_sources`, AGENTS.md §5), in dem ein Objekt beliebig viele Quellen tragen darf. Seither
// war sie tote Rechtsprechung -- und für den Benutzer war sie nicht als Regel erkennbar, sondern
// als Zufall: „bei Straßen gehts, manchmal gehts, manchmal nicht" (Owner, derselbe Tag).
//
// ⚠️ Der Riegel hing an DREI Editoren (Weg, Landschaftslabel, Territorium/Region) und wurde in
// allen dreien entfernt -- eine Regel, die einen von drei Erzeugern bindet, ist keine Regel.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/andere-quelle-immer-sichtbar.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8").replace(/\r\n/g, "\n");

// ---- 1. Kein Abschnitt startet mehr versteckt --------------------------------------------------
// 💣 Das `hidden` im Markup war die zweite Hälfte des Riegels: ohne den Schalter, der es wieder
// wegnimmt, wäre der Abschnitt für immer weg. Beides muss zusammen fallen.
const html = lies("index.html");
// ⚠️ „region-edit" stand hier bis zum 03.09.2026: der Kartendialog „Herrschaftsgebiet bearbeiten" traegt
// „Andere Quelle" seither gar nicht mehr -- er montiert das geteilte Quellen-Bauteil (Schritt 2 des
// Quellen-Umbaus, docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md). Der Wegedialog
// folgte am selben Tag (Schritt 3, docs/superpowers/specs/2026-09-03-quellen-wege-design.md); bis die
// Beschriftung nachzieht, gilt die Regel hier fuer sie allein.
["label-edit"].forEach((prefix) => {
	const id = `id="${prefix}-other-source-section"`;
	const pos = html.indexOf(id);
	assert.ok(pos > 0, `der Abschnitt ${prefix} steht in index.html`);
	const tag = html.slice(html.lastIndexOf("<", pos), html.indexOf(">", pos) + 1);
	assert.ok(!/\shidden(\s|>|=)/.test(tag),
		`${prefix}-other-source-section startet nicht versteckt -- Tag: ${tag}`);
});

// ---- 2. Niemand schaltet den Abschnitt mehr aus ------------------------------------------------
// 🔴 Die Zusicherung sucht die BEZEICHNER, nicht die Wirkung: solange keiner von ihnen mehr
// existiert, kann kein Erzeuger die Regel unbemerkt wiederbeleben.
const dateien = [];
(function sammle(verzeichnis) {
	fs.readdirSync(verzeichnis, { withFileTypes: true }).forEach((eintrag) => {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			if (eintrag.name !== "__tests__" && eintrag.name !== "third-party") { sammle(voll); }
			return;
		}
		if (eintrag.name.endsWith(".js")) { dateien.push(voll); }
	});
})(path.join(repoRoot, "js"));

const schuldige = dateien.filter((datei) =>
	/toggleOtherSourceSection|toggleLabelOtherSourceSection|toggleTerritoryOtherSourceSection/
		.test(fs.readFileSync(datei, "utf8")));
assert.deepStrictEqual(schuldige.map((d) => path.relative(repoRoot, d)), [],
	"kein Modul kennt den Ausblende-Schalter mehr");

// ---- 3. Und die geschriebene Regel ist auch weg ------------------------------------------------
// 🪤 Eine tote Regel im Kommentar ist schlimmer als keine: der nächste Leser baut sie nach.
// (AGENTS.md §8 nennt genau diesen Fall -- eine Zeile, die monatelang das Gegenteil der gelebten
// Praxis behauptete, und ein Reviewer, der korrekten Code danach beanstandete.)
const modul = lies("js/review/review-other-source.js");
assert.ok(!/ONLY when NO wiki/i.test(modul),
	"der Kopf von review-other-source.js behauptet das Entweder-Oder nicht mehr");

// ---- 4. Die Gegenprobe: das Feld funktioniert weiterhin ----------------------------------------
// ⚠️ Ohne diese vier Zeilen wäre Abschnitt 2 auch dann grün, wenn jemand das ganze Bauteil
// gelöscht hätte -- „niemand schaltet es aus" ist für ein nicht vorhandenes Feld trivial wahr.
["readOtherSourceFromForm", "writeOtherSourceToForm", "renderOtherSourcePreview"].forEach((name) => {
	assert.ok(new RegExp(`function ${name}\\(`).test(modul), `${name} gibt es weiterhin`);
});
// Und die drei Editoren füllen den Abschnitt beim Öffnen weiterhin -- daher kommt die Vorschau,
// die vorher als Nebenwirkung am Ausblende-Schalter hing.
["label-edit"].forEach((prefix) => {
	const treffer = dateien.filter((datei) =>
		fs.readFileSync(datei, "utf8").includes(`writeOtherSourceToForm("${prefix}"`));
	assert.ok(treffer.length >= 1, `${prefix} wird beim Öffnen weiterhin gefüllt`);
});

console.log("andere-quelle-immer-sichtbar: alle Zusicherungen erfuellt");
