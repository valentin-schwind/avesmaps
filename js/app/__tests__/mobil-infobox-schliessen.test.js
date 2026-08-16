// Am Telefon die Infobox schliessen -- ohne dabei den Routenplaner aufzureissen.
//
// 🔴 DIESER TEST EXISTIERT WEGEN EINES GEMELDETEN FEHLERS (Owner, 16.08.2026): „das infopanel geht
// auf, aber wenn ich es zumach geht automatisch das routenpanel auf". Die Kausalitaet ist dabei
// UMGEKEHRT zu dem, was es sich anfuehlt -- und genau deshalb steht sie hier:
//
//   1. Am Telefon ist die Infobox --avesmaps-ip-w breit (gemessen 351px auf 375px Schirm). Es
//      bleibt ein rund 24px schmaler Streifen Karte an der LINKEN Kante.
//   2. Die Info-Randlasche ist am Telefon ausgeblendet (css/features/infopanel.css, Absicht seit
//      12.08.2026) -- es gibt also keinen Griff, mit dem man die Box zumacht.
//   3. Der Planer-Griff #toggle-button sitzt eingeklappt bei `left: 0`, ist --avesmaps-tab-w
//      (26px) breit und mittig hoch. Er bedeckt damit den GANZEN tippbaren Streifen.
//   4. Wer dort tippt, um die Box wegzuklicken, trifft den Planer-Griff. Der oeffnet den Planer --
//      und `setRoutePlannerCollapsed(false)` ruft am Telefon `avesmapsInfopanelCollapse()`
//      (js/ui/route-planner-toggle.js). Die Box faellt zu, der Planer steht offen.
//
// Von aussen ununterscheidbar von „Zumachen oeffnet den Planer". Der Fehler war vier Tage alt
// (93d3e69e / 0785a409, 11.-12.08.2026) und lag an KEINEM der drei Bauteile allein.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/mobil-infobox-schliessen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 Dieselbe Falle wie in map-corner-actions.test.js und im 11px-Waechter: die Prosa dieser
 *  Dateien schreibt genau das hin, wonach gesucht wird. Ein Treffer im Kommentar ist kein Beweis,
 *  sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt. */
const ohneKommentare = (quelle) => quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const mapLayout = ohneKommentare(read("css", "layout", "map-layout.css"));
const infopanelCss = ohneKommentare(read("css", "features", "infopanel.css"));
const infopanelJs = read("js", "map-features", "map-features-infopanel.js");

let checks = 0;

// ---- 1. Der Planer-Griff liegt nicht mehr im tippbaren Streifen ---------------------------------
//
// 💣 Faengt den gemeldeten Fehler direkt. Ohne diese Regel ist der Griff das EINZIGE, was man in
// dem 24px-Streifen treffen kann -- ein Tipper auf die Karte ist dort gar nicht moeglich.
const griffRegel = mapLayout.match(
	/html\.avesmaps-phone\.avesmaps-infopanel-open #toggle-button \{([\s\S]*?)\n\}/
);
assert.ok(griffRegel,
	"css/layout/map-layout.css hat keine Regel `html.avesmaps-phone.avesmaps-infopanel-open "
	+ "#toggle-button`. Ohne sie liegt der Planer-Griff am Telefon im einzigen Streifen Karte, den "
	+ "eine offene Infobox uebrig laesst -- und jeder Versuch, die Box wegzutippen, oeffnet "
	+ "stattdessen den Routenplaner (Owner-Meldung 16.08.2026).");
checks++;

// 💣 `pointer-events: none` ist der tragende Teil, nicht die Blende: ein unsichtbarer Knopf, der
// Tipper schluckt, ist schlimmer als ein sichtbarer -- steht so schon ueber der Nachbarregel fuer
// #map-corner-actions.
assert.ok(/pointer-events:\s*none/.test(griffRegel[1]),
	"Die Regel blendet den Planer-Griff hoechstens aus, nimmt ihm aber nicht die Tipper. "
	+ "Unsichtbar UND anklickbar ist der schlimmste der drei Zustaende: der Fehler bleibt, nur "
	+ "sieht man jetzt nicht mehr, worauf man trifft.");
checks++;

// 💣 KEIN `display: none` -- aus demselben Grund wie beim Knopfbund nebenan: syncMapCornerStack
// (js/ui/ui-controls.js) misst mit getBoundingClientRect(), ein ausgeblendetes Element misst 0, und
// der Guard `if (!hoehe) return` liesse die veraltete Zahl stehen.
assert.ok(!/display:\s*none/.test(griffRegel[1]),
	"Die Regel benutzt `display: none`. Verborgen, aber gelayoutet (visibility + pointer-events) "
	+ "misst sich weiter richtig -- ein ausgeblendetes Element misst 0 und laesst die "
	+ "Stapelzahl --avesmaps-corner-stack veralten.");
checks++;

// ---- 2. Es gibt einen Weg, die Box zu schliessen ------------------------------------------------
//
// 🔴 Wenn der Planer-Griff weg ist, MUSS ein anderer Weg her -- sonst hat die Regel oben die Box
// unschliessbar gemacht und aus einem Aergernis eine Sackgasse. Die Sitzung vom 12.08.2026 hat den
// Weg schon benannt (css/features/infopanel.css: „kommt die Frage wieder, gehoert ein ✕ in den
// Panelkopf -- nicht die Lasche zurueck"); Owner-Entscheid 16.08.2026: oben rechts.
assert.ok(/avesmaps-infopanel__close/.test(infopanelJs),
	"js/map-features/map-features-infopanel.js baut keinen Schliess-Knopf "
	+ "(.avesmaps-infopanel__close). Am Telefon ist die Randlasche ausgeblendet -- ohne ✕ und ohne "
	+ "erreichbaren Kartenstreifen gaebe es GAR KEINEN Weg mehr, die Infobox zuzumachen.");
checks++;

// 💣 Faengt: der Knopf wird gebaut, aber nie eingehaengt. Sieht im Diff vollstaendig aus.
assert.ok(/panel\.appendChild\(\s*schliessen\s*\)|panel\.appendChild\(schliessen\)/.test(infopanelJs),
	"Der Schliess-Knopf wird nicht an das Panel gehaengt. Er gehoert IN das Panel (nicht an den "
	+ "body): am Telefon faehrt das Panel per transform herein, und ein Knopf daneben bliebe stehen.");
checks++;

// 💣 Faengt den stillen Blindgaenger: ein ✕, das nichts tut. Es muss denselben Weg gehen wie die
// Randlasche, nicht einen zweiten Zustand aufmachen.
assert.ok(/schliessen\.addEventListener\(\s*["']click["']/.test(infopanelJs),
	"Der Schliess-Knopf hat keinen Klick-Zuhoerer -- ein Knopf, der nichts tut.");
checks++;

// ---- 3. Der ✕ ist eine Telefon-Sache ------------------------------------------------------------
//
// ⚠️ Am Zeiger bleibt die Randlasche der Weg (sie ist dort sichtbar und trifft niemanden). Ein
// zweiter Schliesser danebem waere doppelt -- und die Designsprache haelt Bedienelemente knapp.
// 💣 Diese Zusicherung hiess zuerst nur „irgendwo steht .avesmaps-infopanel__close" -- und war
// damit blind: die Mutationsprobe benannte die GESTALTUNGS-Regel um, und der Test blieb gruen, weil
// der Selektor auch in der Telefon-Einengung darunter vorkommt. Der Knopf haette seine ganze Form
// verlieren koennen. Geprueft wird deshalb die Regel SELBST, samt der Verankerung, die der Owner
// vorgegeben hat („✕ oben rechts im panelkopf", 16.08.2026).
const stilRegel = infopanelCss.match(/(?:^|\n)\.avesmaps-infopanel__close \{([\s\S]*?)\n\}/);
assert.ok(stilRegel,
	"css/features/infopanel.css hat keine eigene Regel `.avesmaps-infopanel__close` -- der "
	+ "Schliess-Knopf waere ein ungestylter Systemknopf mitten im Panel.");
checks++;

assert.ok(/position:\s*absolute/.test(stilRegel[1])
	&& /\btop:/.test(stilRegel[1]) && /\bright:/.test(stilRegel[1]),
	"Der ✕ ist nicht oben rechts verankert (Owner 16.08.2026: „✕ oben rechts im "
	+ "panelkopf“). Ohne `position: absolute` + top/right schwimmt er im Flusslayout mit.");
checks++;

const nurTelefon = infopanelCss.match(/html:not\(\.avesmaps-phone\)[^{]*\.avesmaps-infopanel__close\s*\{([\s\S]*?)\n\}/);
assert.ok(nurTelefon && /display:\s*none/.test(nurTelefon[1]),
	"Der ✕ ist nicht auf das Telefon eingeengt. Am Zeiger traegt die Randlasche das Schliessen "
	+ "bereits -- zwei Schliesser nebeneinander sind einer zu viel.");
checks++;

// 💣 Faengt: der Knopf bekommt nur ein Zeichen und keinen Namen. „✕" ist fuer einen Screenreader
// nichts; dieselbe Regel wie beim Planer-Griff, dessen Wort im Knopf bleibt und nur unsichtbar wird.
assert.ok(/schliessen\.setAttribute\(\s*["']aria-label["']/.test(infopanelJs),
	"Der Schliess-Knopf traegt kein aria-label. Ein blosses ✕ hat keinen zugaenglichen Namen.");
checks++;

console.log(`mobil-infobox-schliessen: ${checks} Pruefungen bestanden.`);
