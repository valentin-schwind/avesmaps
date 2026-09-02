// Nach einer Wiki-Zuweisung zieht die INFOBOX nach -- ohne F5.
//
// 💣 DER FALL (Owner 02.09.2026: „ich musste nach der zuweisung F5 drücken, um was zu sehen").
// Der Zuweisungskasten zeichnet sich selbst neu, die Infobox daneben nicht: sie hängt an
// `lastPanelRender` und wird nur angestoßen, wenn jemand es sagt. `avesmapsRefreshInfopanel` gibt es
// seit dem 17.07.2026 und trägt in seinem Kopf genau diesen Fall -- er wurde von hier aus nur nie
// gerufen.
//
// 🔴 UND DREI DINGE MÜSSEN ZUSAMMENKOMMEN, sonst ist der Nachzug halb und damit irreführend:
//   1. das Neuzeichnen selbst
//   2. `location.wikiUrl` -- daraus baut der Quellenkasten seine ERSTE Zeile (den Wiki-Artikel)
//   3. das Kanon-Etikett aus `window.__featureKanon` -- die Tafel wird einmal beim Laden gesetzt
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/wiki-assign-infobox-nachzug.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// 💣 Kommentare raus, bevor gemessen wird -- die Begründungen nennen genau die Zeichen, die gesucht
// werden. Ein Test, der seine eigene Dokumentation liest, ist grün und wertlos.
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split(/\r?\n/)
	.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
	.join("\n");
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...t), "utf8"));

const BAUTEIL = lies("js", "ui", "wiki-assign.js");
const ORT = lies("js", "review", "review-settlement-wiki.js");
const PANEL = lies("js", "map-features", "map-features-infopanel.js");

// ---- A. Der Nachzieher steht im GETEILTEN Bauteil -----------------------------------------------
// 💣 Hier und nicht in den sechs Oberflächen: Zuweisen, Lösen und die Sync-Übernahme ändern alle
// drei, was die Infobox zeigt, und es gibt sie für Ort, Weg, Landschaft, Label, Territorium und
// Karte. Sechs Abschriften wären fünf Gelegenheiten, eine zu vergessen.
pruefe(BAUTEIL.includes("function infoboxNachziehen()"), "das Bauteil hat einen Nachzieher");
pruefe(/window\.avesmapsRefreshInfopanel\s*===\s*"function"/.test(BAUTEIL),
	"⚠️ mit typeof-Riegel -- diese Datei läuft auch in den Editor-iframes, wo es die Funktion nicht gibt");
pruefe(!/^\s*window\.avesmapsRefreshInfopanel\(\);\s*$/m.test(BAUTEIL.replace(/\t/g, "")) ||
	BAUTEIL.indexOf("typeof window.avesmapsRefreshInfopanel") < BAUTEIL.indexOf("window.avesmapsRefreshInfopanel()"),
	"der Aufruf steht hinter dem Riegel, nicht davor");

// 🔴 ALLE DREI ERFOLGSWEGE. Ein Nachzug, der nur beim Zuweisen greift, lässt die Infobox nach dem
// LÖSEN eine Verbindung zeigen, die es nicht mehr gibt -- schlimmer als gar kein Nachzug.
const rufe = (BAUTEIL.match(/infoboxNachziehen\(\);/g) || []).length;
pruefe(rufe === 3, `alle drei Erfolgswege ziehen nach (Zuweisen, Lösen, Sync) -- gefunden: ${rufe}`);
// Und sie stehen wirklich neben den Zustandswechseln, nicht irgendwo.
const zustaende = (BAUTEIL.match(/infoboxNachziehen\(\);\s*\n\s*ui = neuerZustand\(/g) || []).length;
pruefe(zustaende === 3, `jeder Aufruf steht direkt vor seinem Zustandswechsel -- gefunden: ${zustaende}`);

// ---- B. Die Funktion, auf die er sich stützt, gibt es wirklich ----------------------------------
// 🪤 Ein Aufruf hinter einem typeof-Riegel ist still, wenn das Gegenstück fehlt -- er sähe dann
// genauso aus wie einer, der wirkt.
pruefe(PANEL.includes("window.avesmapsRefreshInfopanel = function"), "avesmapsRefreshInfopanel existiert");
pruefe(PANEL.includes("lastPanelRender()"), "und sie zeichnet den letzten Panel-Inhalt neu");

// ---- C. Der Ort zieht auch das nach, was `wikiSettlement` NICHT abdeckt --------------------------
pruefe(ORT.includes("function settlementWikiInfoboxNachziehen("), "die Ortsoberfläche hat ihren Nachzug");
pruefe(/entry\.location\.wikiUrl\s*=/.test(ORT),
	"🔴 `location.wikiUrl` wird gesetzt -- daraus baut der Quellenkasten die Wiki-Zeile");
pruefe(ORT.includes("window.__featureKanon"), "und das Kanon-Etikett wird angefasst");

// 🔴 BEIDE WEGE: Zuweisen UND Lösen. Nach dem Lösen fällt der Namensraum als Rang 2 weg, das
// Etikett ist ein anderes.
const ortRufe = (ORT.match(/settlementWikiInfoboxNachziehen\(entry, result\);/g) || []).length;
pruefe(ortRufe === 2, `Zuweisen und Lösen rufen ihn -- gefunden: ${ortRufe}`);

// ---- D. 💣 DER KANON WIRD NICHT IM BROWSER GERECHNET --------------------------------------------
// Er kommt aus der Antwort des Servers, aus DERSELBEN Ableitung, die die Nutzlast füllt. Eine zweite
// Rechnung hier wäre genau die Divergenz, an der die Rangfolge im August auseinanderlief (ns 222
// gegen Quellzeile, 31.08.-02.09.2026).
pruefe(/result\.kanon/.test(ORT), "das Etikett kommt aus `result.kanon`");
for (const muster of [/Wiki Aventurica/, /avesmapsWikiNamespace/, /=\s*["']inoffiziell["']/]) {
	pruefe(!muster.test(ORT), `die Ortsoberfläche leitet NICHTS selbst ab (fand ${muster})`);
}

// ⚠️ „nicht mitgeschickt" und „ausdrücklich keins" sind zweierlei: eine alte Serverfassung ohne
// `kanon` darf die Tafel NICHT leeren.
pruefe(ORT.includes('hasOwnProperty.call(result, "kanon")'),
	"ein fehlendes `kanon` lässt die Tafel in Ruhe (nicht dasselbe wie `null`)");
// Und `null` ENTFERNT den Eintrag, statt ihn stehenzulassen -- ein liegengebliebenes Etikett
// behauptet etwas über Quellen, die es nicht mehr gibt.
pruefe(/delete window\.__featureKanon\.abweichungen\[/.test(ORT),
	"🔴 `null` entfernt den Eintrag, statt den alten stehenzulassen");

// ---- E. Der Server liefert ihn -- und rechnet ihn nicht neu -------------------------------------
const LIB = lies("api", "_internal", "app", "feature-sources.php");
const SIED = lies("api", "_internal", "wiki", "settlements.php");
pruefe(LIB.includes("function avesmapsFeatureSourcesKanonFuerEines("), "die Einzel-Ableitung gibt es");
// 💣 Sie leitet nichts selbst ab, sie reicht an die geteilte Ableitung weiter.
const ab = LIB.indexOf("function avesmapsFeatureSourcesKanonFuerEines(");
const bis = LIB.indexOf("\nfunction ", ab + 1);
const block = bis === -1 ? LIB.slice(ab) : LIB.slice(ab, bis);
pruefe(block.includes("avesmapsFeatureSourcesDeriveKanon("),
	"🔴 sie ruft die GETEILTE Ableitung -- keine zweite Rechnung für denselben Wert");
pruefe(!/Wiki Aventurica/.test(block) && !/'inoffiziell'/.test(block),
	"und sie kennt selbst keinen einzigen Etikettenwert");

// Beide Schreibwege geben ihn zurück.
const zuweisen = (SIED.match(/'kanon' => avesmapsFeatureSourcesKanonFuerEines\(/g) || []).length;
pruefe(zuweisen === 2, `assign_to UND clear_assign liefern das Etikett -- gefunden: ${zuweisen}`);
// ⚠️ Beim Lösen mit LEERER Adresse: der Artikel ist weg, der Namensraum darf nicht mehr zählen.
pruefe(/avesmapsFeatureSourcesKanonFuerEines\(\$pdo, 'settlement', \$publicId, ''\)/.test(SIED),
	"das Lösen rechnet mit leerer Adresse, nicht mit der alten");

console.log(`wiki-assign-infobox-nachzug.test.js: ${pruefungen} Pruefungen erfuellt`);
