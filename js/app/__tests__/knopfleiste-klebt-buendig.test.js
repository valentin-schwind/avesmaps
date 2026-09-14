"use strict";

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Die Knopfleiste der Meldeformulare klebt BUENDIG an der Unterkante des Rumpfes.
//
// 💣 DREI DEKLARATIONEN, EIN WERT. Der Rumpf (.avm-fenster__rumpf) traegt `--avm-col-pad`, die
//    Knopfleiste (.location-report-form__actions) liegt IN ihm und klebt per `sticky`. Damit sie
//    von Kante zu Kante und bis zur Unterkante reicht, hebt sie sein Polster auf -- und das an
//    ZWEI Stellen: der negative Aussenrand holt sie im Fluss an die Kante, ein negativer `bottom`
//    tut dasselbe im geklebten Zustand, weil `sticky` sich nach der CONTENT-Box des Rumpfes
//    richtet und nicht nach seiner Kante.
//    Bis zum 14.09.2026 stand dort `bottom: 0` -- mit der Begruendung, ein negativer Wert lasse
//    die Leiste beim Scrollen wandern. Im Browser gemessen stand sie in acht Fenstern in JEDER
//    Scrollstellung 7,6 bis 8,4px zu hoch, und im Streifen darunter scrollte Inhalt durch. Die
//    Wanderung des ersten Versuchs kam vom FEHLENDEN negativen Aussenrand, nicht vom `bottom`;
//    gemessen war damals die Bewegung, nicht die Lage.
//
// ⭐ Deshalb liest diese Datei die Tokens AUS dem Polster, statt `--space-6` abzuschreiben: wer das
//    Polster aendert und die Leiste vergisst -- oder umgekehrt --, wird hier rot.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/knopfleiste-klebt-buendig.test.js
// ═══════════════════════════════════════════════════════════════════════════════════════════

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

// 🪤 Kommentare RAUS, bevor gesucht wird: die Regel erklaert ihre Falle im Klartext und schreibt
//    dabei `bottom: 0` hin -- ein Test, der Kommentare mitliest, schlaegt an der Warnung an.
const ohneKommentare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Alle Regeln eines Blatts als [Kopf, Deklarationen]. Der Kopf darf weder `{` noch `}` noch `;`
// enthalten -- so faellt eine @media-Huelle heraus, die Regeln darin nicht.
const regeln = (css) => [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

// ⚠️ Der Doppelpunkt direkt hinter dem Namen ist tragend: `margin` darf `margin-bottom` nicht treffen.
const deklaration = (block, name) => {
	const m = new RegExp("(?:^|;)\\s*" + name + "\\s*:\\s*([^;]+)").exec(block);
	return m ? m[1].trim().replace(/\s+/g, " ") : null;
};

const bauteilCss = ohneKommentare(lies("css", "components", "fenster.css"));
const meldeCss = ohneKommentare(lies("css", "components", "location-report-dialog.css"));

// ---- 1 · Das Polster des Rumpfes -------------------------------------------------------------
//
// Der Rumpf liest --avm-col-pad, und die Huelle der Meldefenster setzt ihn lokal. Aus DIESEM Wert
// kommen die beiden Tokens, an denen die Leiste gemessen wird -- nicht aus einer Abschrift.
const rumpfPolster = regeln(bauteilCss).filter(([kopf, block]) =>
	kopf === ".avm-fenster__rumpf" && deklaration(block, "padding") !== null);
assert.strictEqual(rumpfPolster.length, 1,
	`fenster.css: genau EINE Regel .avm-fenster__rumpf setzt das Polster -- gesehen: ${rumpfPolster.length}`);
assert.strictEqual(deklaration(rumpfPolster[0][1], "padding"), "var(--avm-col-pad)",
	"der Rumpf traegt --avm-col-pad -- sonst hebt die Leiste ein Polster auf, das es nicht gibt");

const huellen = regeln(meldeCss).filter(([kopf, block]) =>
	kopf === ".location-report-dialog" && deklaration(block, "--avm-col-pad") !== null);
assert.strictEqual(huellen.length, 1,
	`location-report-dialog.css: genau EINE Huellenregel setzt --avm-col-pad -- gesehen: ${huellen.length}`);
const polster = deklaration(huellen[0][1], "--avm-col-pad");
const zerlegt = /^var\((--[\w-]+)\) var\((--[\w-]+)\)$/.exec(polster);
assert.ok(zerlegt,
	`--avm-col-pad ist ZWEI Tokens, senkrecht und waagerecht -- gesehen: ${polster}. Steht dort eine`
	+ " andere Form, muss die Leiste neu hergeleitet werden, nicht dieser Test angepasst");
const [, senkrecht, waagerecht] = zerlegt;
const aufgehoben = (token) => `calc(-1 * var(${token}))`;

// ---- 2 · Die Leiste hebt GENAU dieses Polster auf, im Fluss UND geklebt ----------------------
const leisten = regeln(meldeCss).filter(([kopf]) => kopf === ".location-report-form__actions");
assert.strictEqual(leisten.length, 1,
	`location-report-dialog.css: die Regel .location-report-form__actions gibt es genau einmal -- gesehen: ${leisten.length}`);
const leiste = leisten[0][1];

assert.strictEqual(deklaration(leiste, "position"), "sticky",
	"die Knopfleiste klebt am Fuss des Rumpfes (position: sticky) -- sonst wandert sie mit dem Inhalt aus dem Bild");
assert.strictEqual(deklaration(leiste, "bottom"), aufgehoben(senkrecht),
	`die Leiste klebt um das untere Rumpfpolster tiefer (bottom: ${aufgehoben(senkrecht)}) -- mit`
	+ " `bottom: 0` steht sie um das Polster ueber der Unterkante, und darunter scrollt Inhalt durch");
assert.strictEqual(deklaration(leiste, "margin"), `0 ${aufgehoben(waagerecht)} ${aufgehoben(senkrecht)}`,
	"und ihr Aussenrand hebt dasselbe Polster seitlich und unten auf -- ohne den unteren endet das"
	+ " Formular um das Polster vor der Kante, und die Leiste rutscht am Scrollende dorthin");

// ---- 3 · Keine zweite Regel verschiebt sie ---------------------------------------------------
//
// 💣 Faengt: die Regel oben stimmt, aber eine spaetere mit hoeherer Spezifitaet (etwa
//    `#location-report-dialog .location-report-form__actions`, die es fuer `grid-column` gibt)
//    setzt `bottom` oder den Aussenrand zurueck -- dann ist die Rechnung oben gruen und die
//    Leiste trotzdem daneben.
const alleCss = (verzeichnis) => fs.readdirSync(verzeichnis, { withFileTypes: true }).flatMap((e) =>
	e.isDirectory() ? alleCss(path.join(verzeichnis, e.name))
		: e.name.endsWith(".css") ? [path.join(verzeichnis, e.name)] : []);
const dateien = alleCss(path.join(WURZEL, "css"));
assert.ok(dateien.length > 50, `der Laeufer muss die CSS-Dateien wirklich finden -- gesehen: ${dateien.length}`);

const LAGE = ["position", "bottom", "inset", "inset-block", "inset-block-end", "margin", "margin-bottom", "margin-block", "margin-block-end"];
let gesehen = 0;
const fremd = [];
for (const datei of dateien) {
	const relativ = path.relative(WURZEL, datei).replace(/\\/g, "/");
	for (const [kopf, block] of regeln(ohneKommentare(fs.readFileSync(datei, "utf8")))) {
		// Ein `:not(.location-report-form__actions)` nimmt die Leiste AUS -- das trifft sie nicht.
		const trifft = kopf.replace(/:not\([^)]*\)/g, "").split(",")
			.some((teil) => /\.location-report-form__actions(?![\w-])/.test(teil));
		if (!trifft) continue;
		gesehen += 1;
		if (relativ === "css/components/location-report-dialog.css" && kopf === ".location-report-form__actions") continue;
		const gesetzt = LAGE.filter((name) => deklaration(block, name) !== null);
		if (gesetzt.length) fremd.push(`${relativ}: ${kopf} { ${gesetzt.join(", ")} }`);
	}
}
assert.ok(gesehen >= 2,
	`der Laeufer muss die Regeln der Leiste wirklich sehen (die eigene und die grid-column-Regel) -- gesehen: ${gesehen}`);
assert.deepStrictEqual(fremd, [],
	"eine zweite Regel setzt Lage oder Aussenrand der Knopfleiste und hebt die Rechnung oben auf:\n  "
	+ fremd.join("\n  "));

console.log(`knopfleiste-klebt-buendig: Polster ${senkrecht} / ${waagerecht}, bottom und Aussenrand passen, ${dateien.length} CSS-Dateien ohne zweite Lage-Regel`);
