"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8").replace(/\r\n/g, "\n");

// 🔴 .avm-status gehoert BEIDEN Welten: den sechs Editor-SEITEN (iframes, editor-page.css) und
// der App (index.html, styles.css). Sie steht deshalb in editor-body.css -- der Datei, die BEIDE
// laden. Dieselbe Reise wie editor-row.css, map-status-circle.css und wiki-override.css.
const body = lies("css/components/editor-body.css");
const page = lies("css/components/editor-page.css");

assert.ok(/^\.avm-status \{/m.test(body), ".avm-status muss in editor-body.css stehen");
assert.ok(!/^\.avm-status \{/m.test(page), ".avm-status darf nicht mehr in editor-page.css stehen");
assert.ok(page.includes('@import url("editor-body.css")'), "editor-page.css bindet editor-body.css");
assert.ok(lies("css/styles.css").includes('@import url("components/editor-body.css")'),
	"styles.css bindet editor-body.css");

// 💣 SIE DARF DIE KURZ-ALIASE NICHT MEHR LESEN. --soft/--line/--mut/--ok/--bad stehen im :root
// von editor-page.css; in index.html sind sie UNDEFINIERT, und `color: var(--mut)` ohne Rueckfall
// ist dann ungueltig. Der Block muss die echten Tokens nennen.
const block = body.slice(body.indexOf("\n.avm-status {"));
const bisEnde = block.slice(0, block.indexOf("\n.avm-tabs") === -1 ? block.length : block.indexOf("\n.avm-tabs"));
["--mut", "--soft", "--line", "--ok", "--bad"].forEach((alias) => {
	assert.ok(!new RegExp("var\\(" + alias + "\\)").test(bisEnde),
		"Alias " + alias + " erreicht index.html nicht -- echtes Token nennen");
});
["--color-text-muted", "--color-panel-soft", "--color-divider"].forEach((token) => {
	assert.ok(bisEnde.includes(token), token + " fehlt in .avm-status");
});
console.log("OK -- 9 Zusicherungen");
