// Nach einem Abgleich zeigt die Übersichtsleiste im Menüband das neue Datum -- ohne Neuladen.
//
//   node js/review/__tests__/sync-leiste-auffrischen.test.js
//
// 💣 DIE LÜCKE, DIE DIESER TEST SCHLIESST. Die Leiste („Karten 17.08.") lebt in index.html, gesynct
// wird aber in einem IFRAME (html/citymap-editor.html, html/game-literature-editor.html). Deren
// `onApplied` frischte nur die eigenen Anzeigen auf -- und die eine, die nach „Datum" aussah, liest
// `citymap_staged`, also den DUMP-Zeitpunkt, nicht den Abgleich. Ergebnis am 25.08.2026: im Fenster
// rückte ein Datum vor, in der Leiste dahinter nicht, und beide heißen „gesynct".
//
// Zwei Wege, und BEIDE müssen verdrahtet sein -- eine Regel, die einen von zwei Erzeugern bindet,
// ist keine (AGENTS.md, die Vier-Erzeuger-Falle):
//   LAUF       -> startWikiSync{Citymaps,GameLiterature}Sync frischt SELBST auf (sie laufen im
//                 Elterndokument, die Leiste steht daneben).
//   ÜBERNAHME  -> der Editor ruft über window.parent zurück (refreshRibbonSyncedRail).
//
// ⚠️ Statisch. Die Editoren sind ganze Seiten mit Netzwerkpfaden; was hier zählt, ist die Verdrahtung,
// und die ist am Quelltext ablesbar. Dieselbe Bauart wie sync-synced-ids.test.js nebenan.

const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");

let fehler = 0;
function pruefe(bedingung, text) {
	if (!bedingung) {
		console.error("FEHLER: " + text);
		fehler++;
	}
}

// ---- 1. Der LAUF frischt selbst auf -------------------------------------------------------------
const panel = lies("js", "review", "review-wiki-sync.js");

pruefe(
	/^async function refreshWikiSyncKindSyncedStatus\(/m.test(panel),
	"refreshWikiSyncKindSyncedStatus ist eine globale Funktion -- nur so erreicht sie ein Iframe über window.parent"
);

/** Den Rumpf einer top-level `async function <name>()` herausschneiden (Klammern gezählt). */
function rumpf(quelle, name) {
	const kopf = quelle.indexOf(`async function ${name}(`);
	pruefe(kopf >= 0, `${name} steht in review-wiki-sync.js`);
	if (kopf < 0) return "";
	let tiefe = 0;
	for (let i = kopf; i < quelle.length; i++) {
		if (quelle[i] === "{") tiefe++;
		else if (quelle[i] === "}") {
			tiefe--;
			if (tiefe === 0) return quelle.slice(kopf, i + 1);
		}
	}
	pruefe(false, `${name} schließt`);
	return "";
}

for (const name of ["startWikiSyncCitymapsSync", "startWikiSyncGameLiteratureSync"]) {
	pruefe(
		rumpf(panel, name).includes("refreshWikiSyncKindSyncedStatus()"),
		`${name} frischt die Leiste auf -- der LAUF stempelt „zuletzt gesynct" (Owner 25.08.2026)`
	);
}

// ---- 2. Die ÜBERNAHME frischt über das Elternfenster auf ----------------------------------------
//
// 💣 Gezählt, nicht bloß gefunden: beide Editoren öffnen das Vorschau-Blatt an ZWEI Stellen -- einmal
// nach dem Abgleich, einmal über „Wieder öffnen" bei einer liegengebliebenen Vorschau. Ein `includes`
// wäre schon nach der ersten grün und ließe die zweite still ohne Auffrischung stehen.

for (const [datei, kuerzel] of [
	["citymap-editor.html", "ce"],
	["game-literature-editor.html", "ae"],
]) {
	const quelle = lies("html", datei);

	pruefe(
		/function refreshRibbonSyncedRail\(\)/.test(quelle),
		`${datei}: refreshRibbonSyncedRail ist da`
	);
	pruefe(
		quelle.includes("typeof p.refreshWikiSyncKindSyncedStatus === \"function\""),
		`${datei}: der Ruf ans Elternfenster ist geprüft, nicht geraten -- der Editor läuft auch eigenständig`
	);

	const onApplied = (quelle.match(/onApplied:/g) || []).length;
	const gerufen = (quelle.match(/refreshRibbonSyncedRail\(\);/g) || []).length;
	pruefe(onApplied >= 2, `${datei}: beide Öffner des Vorschau-Blattes sind noch da (gefunden ${onApplied})`);
	pruefe(
		gerufen === onApplied,
		`${datei}: JEDES onApplied frischt die Leiste auf (${gerufen} Rufe für ${onApplied} Öffner)`
	);

	// Die Gegenprobe: die editoreigene Zeile bleibt, was sie war. Sie beantwortet eine ANDERE Frage
	// („liegt ein Dump zum Syncen bereit?"), und sie durch die Leisten-Auffrischung zu ersetzen wäre
	// genau die Verwechslung, aus der der Befund entstand.
	pruefe(
		quelle.includes(`refresh${kuerzel === "ce" ? "Ce" : "Ae"}SyncedInfo`),
		`${datei}: die editoreigene Statuszeile bleibt bestehen`
	);
}

if (fehler > 0) {
	console.error(`\n${fehler} Prüfung(en) fehlgeschlagen.`);
	process.exit(1);
}
console.log("OK sync-leiste-auffrischen");
