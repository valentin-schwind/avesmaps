// Die MERKLISTE `wiki_uebernommen` -- und zwar in JEDER Oberflaeche, die sie braucht.
//
// 🔴 DIE EINE REGEL, die dieser Test bewacht: wer einen Wert aus dem Wiki ins Formular holt, MUSS
// das beim Speichern sagen. Der Server stempelt daraus die Feldherkunft
// (avesmapsFieldOriginsStempeln); sagt eine Oberflaeche nichts, stempelt er ihre Uebernahmen als
// „von uns" -- die harmlose Richtung, aber die Auskunft ist falsch, und der naechste Abgleich
// laesst genau die Felder in Ruhe, die er selbst gefuellt hat.
//
// 💣 UND DESHALB PRUEFT ER NICHT EINE OBERFLAECHE, SONDERN ALLE. Genau diese Fehlerklasse -- eine
// Regel, die einen von mehreren Erzeugern bindet -- ist am 14.08.2026 die Verkehrsmittel-Sperre
// gewesen (zwei von vier Erzeugern gebunden, die Kutsche fuhr querfeldein) und am 17.08.2026 der
// Literatur-Stempler. Die Objektart `landschaft` hat ZWEI Oberflaechen; eine allein genuegt nicht.
//
// ⭐ DIE LISTE WIRD NICHT GEPFLEGT, SONDERN GEFUNDEN: der Test liest das Feldregister
// (js/ui/wiki-assign-registry.js), nimmt jede Objektart mit mindestens einem KARTENZIEL
// (`karte !== ""`) und sucht deren Oberflaechen ueber `subject: "<name>"` im Repo. Eine neue
// Oberflaeche fuer eine dieser Objektarten meldet sich hier von selbst -- niemand muss daran
// denken.
//
// 🪤 UND DIE MERKLISTE UND DER RUMPF STEHEN NICHT IMMER IN DERSELBEN DATEI. Beim Ort fuehrt
// js/review/review-settlement-wiki.js die Liste und js/review/review-locations.js baut den Rumpf --
// der erste Entwurf dieses Tests forderte beides je Datei und meldete den ORT als Luecke, obwohl er
// seit dem 17.08.2026 live und richtig ist. Das Paar steht deshalb ausdruecklich in RUMPF_WOANDERS.
//
// ⚠️ WAS ER NICHT FAENGT, damit niemand mehr hineinliest, als drinsteht: er prueft, DASS eine
// Oberflaeche ihre Uebernahmen meldet, nicht WELCHE. Ein , das ein einzelnes Feld vergisst,
// bleibt hier gruen -- dagegen hilft nur, dass jede Oberflaeche ihre Wiki-Werte an genau EINER
// Stelle ins Formular schreibt (), und genau daneben steht das .
//
// Run: node js/ui/__tests__/wiki-uebernommen-alle-oberflaechen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");

let checks = 0;

// ---- Welche Objektarten brauchen es? Aus dem Register, nicht aus dem Kopf --------------------
// Im vm-Sandkasten ausgewertet, nicht nachgebaut: dieselbe Bauform wie
// js/pages/__tests__/ort-wiki-override-form.test.js -- geprueft wird die ECHTE Datei.

const registry = vm.runInNewContext(
	lies("js/ui/wiki-assign-registry.js") + "\nAVESMAPS_WIKI_ASSIGN_REGISTRY;", {}
);

const mitKartenziel = Object.keys(registry).filter((art) =>
	(registry[art].felder || []).some((zeile) => String(zeile.karte || "") !== ""));

// 🔴 Territorium fuehrt seinen Override seit jeher SELBST (`metadata_overrides_json` im
// Territoriumseditor, html/wiki-sync-monitor.html) und geht nicht ueber `wiki_uebernommen`. Es ist
// die einzige Ausnahme, und sie ist aelter als diese Regel -- keine Luecke.
const EIGENER_WEG = new Set(["territorium"]);

// 🔧 NOCH NICHT GEBAUT -- die Restliste des Bauplans
// docs/superpowers/plans/2026-08-18-wiki-override-rest.md. Dieser Eintrag ist die AUFGABE, nicht die
// Erlaubnis: wer eine Objektart hier streicht, muss ihre Oberflaechen vorher versorgt haben. Die
// Gegenrichtung ganz unten sorgt dafuer, dass die Liste schrumpft und nicht waechst.
const NOCH_OFFEN = new Set(["weg"]);

const zuPruefen = mitKartenziel.filter((art) => !EIGENER_WEG.has(art) && !NOCH_OFFEN.has(art));
assert.ok(zuPruefen.length >= 2,
	"weniger als zwei Objektarten zu pruefen -- das Register wurde vermutlich nicht gelesen: "
	+ JSON.stringify(zuPruefen));
checks++;

// ---- Alle Quellen einmal einlesen ------------------------------------------------------------

function alleQuellen(verzeichnis, treffer) {
	for (const eintrag of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		if (eintrag.name === "__tests__" || eintrag.name === "third-party") { continue; }
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { alleQuellen(rel, treffer); }
		else if (/\.(js|html)$/.test(eintrag.name)) { treffer.push(rel); }
	}
	return treffer;
}

const quellen = alleQuellen("js", []).concat(alleQuellen("html", []));
const inhalt = new Map(quellen.map((datei) => [datei, lies(datei)]));

/** Jede Datei, die den Schluessel wirklich in einen Rumpf legt. */
const sender = quellen.filter((datei) => /wiki_uebernommen/.test(inhalt.get(datei)));

function oberflaechenVon(art) {
	const muster = new RegExp('subject:\\s*"' + art + '"');
	return quellen.filter((datei) => muster.test(inhalt.get(datei)));
}

/** Die Bezeichner der Merkliste einer Datei -- alles, was „…ebernommen…" heisst und `.add(` bekommt. */
function merklistenBezeichner(quelle) {
	const treffer = quelle.match(/[A-Za-z_$][\w$]*[Uu]ebernommen[\w$]*/g) || [];
	return [...new Set(treffer)];
}

// 🪤 MERKLISTE UND RUMPF STEHEN NICHT IMMER IN DERSELBEN DATEI, und das ist kein Versehen: beim
// Ort fuehrt review-settlement-wiki.js die Liste (es ist der Kasten, der uebernimmt), waehrend
// review-locations.js den Rumpf des Kartendialogs baut. Diese Zuordnung steht deshalb AUSDRUECKLICH
// hier -- sie ist eine Ausnahme, die man sehen soll, keine Regel, die man raten darf.
const RUMPF_WOANDERS = {
	"js/review/review-settlement-wiki.js": {
		datei: "js/review/review-locations.js",
		bezeichner: "settlementWikiUebernommenFuerPayload",
	},
	// Dasselbe beim Landschaftslabel: der Zuweisungskasten fuehrt die Liste, der Formularbauer
	// daneben legt sie in den Rumpf.
	"js/review/review-label-wiki.js": {
		datei: "js/review/review-labels.js",
		bezeichner: "getLabelWikiUebernommenPayload",
	},
};

// ---- Die Zusicherungen je Oberflaeche --------------------------------------------------------

for (const art of zuPruefen) {
	const oberflaechen = oberflaechenVon(art);
	assert.ok(oberflaechen.length > 0,
		'Objektart "' + art + '" hat ein Kartenziel im Register, aber KEINE Oberflaeche mountet sie '
		+ '(gesucht: subject: "' + art + '"). Entweder ist das Register falsch oder eine Oberflaeche '
		+ "ist verschwunden.");
	checks++;

	for (const datei of oberflaechen) {
		const quelle = inhalt.get(datei);
		const bezeichner = merklistenBezeichner(quelle);

		// (1) Es gibt eine Merkliste, und sie wird beim Uebernehmen GEFUELLT. Eine Liste, die immer
		// leer bleibt, ist dasselbe wie keine -- und sie sieht im Diff aus, als waere die Regel erfuellt.
		const gefuellt = bezeichner.filter((name) =>
			new RegExp(name.replace(/\$/g, "\\$") + "\\s*\\.add\\(").test(quelle));
		assert.ok(gefuellt.length > 0,
			datei + ' (Objektart "' + art + '") fuellt keine Merkliste (kein „…Uebernommen.add("). '
			+ "Wer einen Wert aus dem Wiki ins Formular holt, muss das beim Speichern sagen -- sonst "
			+ "stempelt der Server ihn als „von uns\", und der naechste Abgleich laesst genau dieses "
			+ "Feld in Ruhe. Gefundene Bezeichner: " + (bezeichner.join(", ") || "keine"));
		checks++;

		// (2) Und die Liste erreicht auch wirklich den Speicher-Rumpf.
		// 🔴 Der Schluessel heisst `wiki_uebernommen` und wird serverseitig genau so gelesen
		// (avesmapsFieldOriginsAusWikiLesen, api/_internal/map/field-origins.php). Ein geratener Name
		// faellt LAUTLOS durch: ein fehlender Schluessel heisst dort „nichts kam aus dem Wiki" und ist
		// kein Fehler -- die Luecke wuerde also nirgends auffallen.
		// 🪤 Der erste Entwurf fragte hier bloss „kennt IRGENDEINE sendende Datei einen meiner
		// Bezeichner". Das war zu lose: beide Landschafts-Oberflaechen nennen ihre Liste
		// `wikiUebernommen`, also deckte die eine die andere zu -- eine Mutation, die dem Editorfenster
		// seinen Rumpf wegnahm, blieb gruen. Geprueft wird deshalb DIESE Datei, und ein anderer Ort
		// zaehlt nur, wenn er hier ausdruecklich benannt ist.
		const paar = RUMPF_WOANDERS[datei];
		const selbst = /wiki_uebernommen/.test(quelle);
		const woanders = paar
			&& /wiki_uebernommen/.test(inhalt.get(paar.datei) || "")
			&& (inhalt.get(paar.datei) || "").includes(paar.bezeichner);
		assert.ok(selbst || woanders,
			datei + ' (Objektart "' + art + '") fuellt eine Merkliste (' + gefuellt.join(", ")
			+ "), legt sie aber nicht unter `wiki_uebernommen` in den Speicher-Rumpf -- und ist auch "
			+ "nicht als Paar mit der Datei eingetragen, die das fuer sie tut (RUMPF_WOANDERS). Die "
			+ "Liste erreicht den Server nie, und er stempelt jede Uebernahme als „von uns\".");
		checks++;
	}
}

// ---- Und die Gegenrichtung: die Restliste muss schrumpfen, nicht wachsen ---------------------
// 🔧 Wer eine Objektart in NOCH_OFFEN stehen laesst, die laengst versorgt ist, macht den Test blind.

for (const art of NOCH_OFFEN) {
	assert.ok(mitKartenziel.includes(art),
		'"' + art + '" steht als offen, hat aber gar kein Kartenziel im Register -- der Eintrag ist tot.');
	checks++;

	const versorgt = oberflaechenVon(art).filter((datei) => {
		const bezeichner = merklistenBezeichner(inhalt.get(datei));
		return bezeichner.some((name) =>
			new RegExp(name.replace(/\$/g, "\\$") + "\\s*\\.add\\(").test(inhalt.get(datei)));
	});
	assert.deepStrictEqual(versorgt, [],
		'"' + art + '" steht in NOCH_OFFEN, aber ' + versorgt.join(", ") + " fuellt bereits eine "
		+ "Merkliste. Dann gehoert die Objektart aus der Liste heraus -- sonst wird sie nicht mehr "
		+ "geprueft, und die naechste Oberflaeche darf sie stillschweigend vergessen.");
	checks++;
}

console.log("OK — jede versorgte Objektart meldet ihre Wiki-Uebernahmen (" + checks
	+ " Zusicherungen; geprueft: " + zuPruefen.join(", ")
	+ "; offen: " + ([...NOCH_OFFEN].join(", ") || "keine") + ").");
