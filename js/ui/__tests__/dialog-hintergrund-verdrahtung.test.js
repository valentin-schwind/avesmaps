const assert = require("assert");
const fs = require("fs");
const path = require("path");

/*
 * Dass die sieben Fenster das Bauteil auch WIRKLICH rufen -- und zwar jedes seinen eigenen
 * Schliesser.
 *
 * 🪤 Ein reiner Quelltexttest kann das hier nicht: der Verdrahtungsblock in bootstrap.js traegt einen
 * Kommentar, der vor dem Lauschen am `document` warnt, und das Modul ebenfalls. Ein Test, der nach
 * "document" sucht, schlaegt an der Warnung an, die vor dem Muster warnt. Deshalb wird der Block
 * hier AUSGESCHNITTEN UND AUSGEFUEHRT, mit gefaelschtem document und gefaelschten Schliessern.
 */

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const bootstrapQuelle = fs.readFileSync(path.join(WURZEL, "js", "app", "bootstrap.js"), "utf8");
const indexQuelle = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");

// Die Owner-Entscheidung vom 02.09.2026, als Gegenprobe zur Verdrahtung. Wer ein Fenster
// herausnimmt oder hinzufuegt, kommt hier vorbei.
//
// 🔴 Der verkleinerte Konflikte-Dialog steht bewusst NICHT dabei: er ist ein Arbeitsfenster neben
// der Karte, kein Modal. Ebenso wenig die vier Landschafts-Fenster, die an der Karte arbeiten --
// die reichen Zeiger durch und bekaemen den Klick ohnehin nie.
const ERWARTET = {
	"location-report-overlay": "setLocationReportDialogOpen",
	"location-edit-overlay": "setLocationEditDialogOpen",
	"path-edit-overlay": "setPathEditDialogOpen",
	"powerline-edit-overlay": "setPowerlineEditDialogOpen",
	"region-edit-overlay": "setRegionEditDialogOpen",
	"wiki-sync-resolve-overlay": "setWikiSyncResolveDialogOpen",
	"wiki-sync-dump-credentials-overlay": "closeWikiSyncDumpCredentialsPrompt",
};
const IDS = Object.keys(ERWARTET);

// -----------------------------------------------------------------------------------------------
// 1. Der Verdrahtungsblock wird ausgeschnitten und gefahren. Gefaelscht sind nur document und die
//    Schliesser; das Bauteil selbst ist das echte.
// -----------------------------------------------------------------------------------------------
const blockTreffer = bootstrapQuelle.match(
	/\[\s*\r?\n\s*\["location-report-overlay"[\s\S]*?avesmapsDialogHintergrundSchliessenById\(overlayId, schliessen\)\);/
);
assert.ok(blockTreffer, "Der Verdrahtungsblock in js/app/bootstrap.js wurde nicht gefunden");
const block = blockTreffer[0];

// Ein Overlay-Knoten, der seine Zuhoerer sammelt (dasselbe Minimal-DOM wie im Bauteil-Test).
function knoten(id) {
	const zuhoerer = new Map();
	return {
		id,
		addEventListener(art, fn) {
			if (!zuhoerer.has(art)) { zuhoerer.set(art, []); }
			zuhoerer.get(art).push(fn);
		},
		hintergrundKlick() {
			const self = this;
			["pointerdown", "pointerup", "click"].forEach((art) => {
				(zuhoerer.get(art) || []).forEach((fn) => fn({ target: self, button: 0 }));
			});
		},
	};
}

const overlays = new Map(IDS.map((id) => [id, knoten(id)]));
const angefragteIds = [];
let documentZuhoerer = 0;

global.document = {
	getElementById(id) {
		angefragteIds.push(id);
		return overlays.get(id) || null;
	},
	// 🔴 DIE TRAGENDE REGEL, und deshalb gemessen statt gelesen: haengte der Zuhoerer am document,
	// waere der Kartenklick des Ablaufs "Neue Position vorschlagen" ein Hintergrundklick -- und
	// Schliessen heisst dort `resetForm: true`.
	addEventListener() { documentZuhoerer += 1; },
};

const { avesmapsDialogHintergrundSchliessenById } = require("../dialog-hintergrund-schliessen.js");

const gerufen = [];
const schliesser = IDS.map((id) => ERWARTET[id]);
// eslint-disable-next-line no-new-func
new Function(
	"avesmapsDialogHintergrundSchliessenById",
	...schliesser,
	block
)(
	avesmapsDialogHintergrundSchliessenById,
	...schliesser.map((name) => (...args) => gerufen.push({ name, args }))
);

// -----------------------------------------------------------------------------------------------
// 2. Alle sieben Fenster sind angeschlossen -- und ein Hintergrundklick ruft GENAU ihren Schliesser.
//    (Ein vertauschtes Paar faellt sonst nie auf: alle sieben Aufrufe sehen gleich aus.)
// -----------------------------------------------------------------------------------------------
IDS.forEach((id) => {
	assert.ok(angefragteIds.includes(id), `#${id} wird nicht verdrahtet`);
	gerufen.length = 0;
	overlays.get(id).hintergrundKlick();
	assert.strictEqual(gerufen.length, 1, `Hintergrundklick auf #${id} schliesst nicht (genau einmal erwartet)`);
	assert.strictEqual(gerufen[0].name, ERWARTET[id], `#${id} ruft den falschen Schliesser`);
});

// -----------------------------------------------------------------------------------------------
// 3. Kein Zuhoerer am document. Siehe die Begruendung oben -- das ist die Regel, an der der Ablauf
//    "Neue Position vorschlagen" haengt.
// -----------------------------------------------------------------------------------------------
assert.strictEqual(documentZuhoerer, 0, "Das Bauteil darf nicht am document lauschen");

// -----------------------------------------------------------------------------------------------
// 4. Die sieben Kennungen gibt es in index.html wirklich. `#label-edit-overlay` ist genau so
//    gestorben: die Kennung verschwand, drei Leser blieben stehen und trafen ins Leere.
//    ⚠️ HTML-Kommentare vorher weg -- sonst zaehlt eine Kennung, die nur in einem Kommentar steht.
// -----------------------------------------------------------------------------------------------
const indexOhneKommentare = indexQuelle.replace(/<!--[\s\S]*?-->/g, "");
IDS.forEach((id) => {
	assert.ok(
		indexOhneKommentare.includes(`id="${id}"`),
		`#${id} steht nicht (mehr) in index.html -- die Verdrahtung trifft ins Leere`
	);
});

// -----------------------------------------------------------------------------------------------
// 5. Die Ladereihenfolge ist ein Vertrag (AGENTS.md §3): das Bauteil muss VOR bootstrap.js stehen,
//    das es ruft.
// -----------------------------------------------------------------------------------------------
const posBauteil = indexOhneKommentare.indexOf('src="js/ui/dialog-hintergrund-schliessen.js"');
const posBootstrap = indexOhneKommentare.indexOf('src="js/app/bootstrap.js"');
assert.ok(posBauteil > -1, "index.html laedt js/ui/dialog-hintergrund-schliessen.js nicht");
assert.ok(posBootstrap > -1, "index.html laedt js/app/bootstrap.js nicht");
assert.ok(posBauteil < posBootstrap, "Das Bauteil muss VOR bootstrap.js geladen werden");

console.log("dialog-hintergrund-verdrahtung.test.js: alle Zusicherungen erfuellt");
