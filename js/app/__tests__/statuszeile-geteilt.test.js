"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8").replace(/\r\n/g, "\n");

// 🔴 .avm-status stand bis zum 26.09.2026 in editor-body.css, weil BEIDE Welten sie brauchten:
// die sechs Editor-SEITEN (iframes, editor-page.css) und die App (index.html, styles.css) --
// dort zuletzt fuer das Fenster "Garetien Importer". Seit dessen Rueckbau (26.09.2026, gemessen:
// kein Selektor dieser Datei kommt noch in index.html vor) bindet NUR NOCH editor-page.css die
// Datei; sie bleibt trotzdem in editor-body.css stehen, wie editor-row.css, map-status-circle.css
// und wiki-override.css ihre Formen behalten.
const body = lies("css/components/editor-body.css");
const page = lies("css/components/editor-page.css");

assert.ok(/^\.avm-status \{/m.test(body), ".avm-status muss in editor-body.css stehen");
assert.ok(!/^\.avm-status \{/m.test(page), ".avm-status darf nicht mehr in editor-page.css stehen");
assert.ok(page.includes('@import url("editor-body.css")'), "editor-page.css bindet editor-body.css");
assert.ok(!lies("css/styles.css").includes('@import url("components/editor-body.css")'),
	"styles.css bindet editor-body.css wieder -- letzter Nutzer war das Fenster \"Garetien "
	+ "Importer\" (index.html), zurueckgebaut am 26.09.2026");

// 💣 SIE DARF DIE KURZ-ALIASE NICHT MEHR LESEN. --soft/--line/--mut/--ok/--bad stehen im :root
// von editor-page.css; in index.html sind sie UNDEFINIERT, und `color: var(--mut)` ohne Rueckfall
// ist dann ungueltig. Der Block muss die echten Tokens nennen.
const block = body.slice(body.indexOf("\n.avm-status {"));
const bisEndeRoh = block.slice(0, block.indexOf("\n.avm-tabs") === -1 ? block.length : block.indexOf("\n.avm-tabs"));
// 🔴 Pruefrunde 06.09.2026, Befund 3: EIN Quelltexttest darf Kommentare nicht mitlesen
// (AGENTS.md §9 / die globalen Zusicherungen des Briefs). Ohne das Strippen kann eine Prosa-
// Erklaerung, die einen Tokennamen woertlich nennt, eine echte Mutation an der Deklaration
// daneben verdecken -- gemessen ueberlebten sonst `var(--color-panel-soft)` → `var(--soft)` und
// ein Pixel-Literal statt `--avm-status-pad`.
const bisEnde = bisEndeRoh.replace(/\/\*[\s\S]*?\*\//g, "");
["--mut", "--soft", "--line", "--ok", "--bad"].forEach((alias) => {
	assert.ok(!new RegExp("var\\(" + alias + "\\)").test(bisEnde),
		"Alias " + alias + " erreicht index.html nicht -- echtes Token nennen");
});
["--color-text-muted", "--color-panel-soft", "--color-divider"].forEach((token) => {
	assert.ok(bisEnde.includes(token), token + " fehlt in .avm-status");
});
// 💣 Ohne diese Zusicherung faengt keine der obigen ein Pixel-Literal: `padding: 6px 14px;`
// statt `padding: var(--avm-status-pad);` enthaelt keinen der gesuchten Aliase und keinen der
// gesuchten Farb-/Rand-Tokens -- eine eigene, gezielte Zusicherung dafuer.
assert.ok(bisEnde.includes("var(--avm-status-pad)"),
	"das Innenpolster muss --avm-status-pad nennen, kein Pixel-Literal");
console.log("OK -- 13 Zusicherungen");
