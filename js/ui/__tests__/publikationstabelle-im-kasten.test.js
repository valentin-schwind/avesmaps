// Die Publikationstabelle bleibt IM Quellenkasten -- vollbreit bis an dessen Rahmen, nie darueber.
//
// 💣 DER BEFUND (Owner-Bild 09.09.2026, Infopanel „Franfeld"): die Tabelle stand 9px je Seite
// AUSSERHALB von `.fs-src--box` und schnitt dabei quer durch dessen Rahmen. Im Browser gegen die
// echten Blaetter gemessen -- Kasten 18..367, Tabelle 9..376.
//
// 🔴 URSACHE: eine Ausnahme, die sich auf einen FREMDEN Vorfahren bezog. Die Vollbreite stand nur
// als `.avesmaps-infopanel .fs-src-tablewrap { margin-inline: calc(-1 * var(--infopanel-pad-x)) }`
// (18px) -- gerechnet fuer eine Zeit, in der der Quellenblock KEIN gerahmter Kasten war, sondern
// an der Sektionskante des Panels sass. Seit `.fs-src--box` traegt er 1px Rahmen und 8px Polster:
// 18 - 8 - 1 = 9px Ueberstand. Ein Mass, das seinen Wirt ueberspringt, ueberlebt dessen naechsten
// Umbau nicht -- der Trenner zwei Regeln darueber macht es seit jeher richtig (−8px = das
// Seitenpolster des Kastens) und blieb deshalb heil.
//
// ⚠️ Und es war nicht nur eine Ausnahme fuers Panel: das Karten-Popup hatte gar keine, dort sass
// der Tabellentext 9px weiter innen als „Quelle(n):" darueber. Eine Regel gilt jetzt beiden.
//
// Der Test liest CSS, weil Node kein CSS rechnet; gesichert ist damit die RECHNUNG
// (Wrapper-Ausrueckung + Zellpolster == Seitenpolster des Kastens), nicht das Bild.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/publikationstabelle-im-kasten.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const css = lies("css/features/feature-sources.css").replace(/\/\*[\s\S]*?\*\//g, "");

function regel(selektor) {
	const re = new RegExp("(^|\\})\\s*" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "m");
	const t = re.exec(css);
	assert.ok(t, "Regel fuer " + selektor + " steht im Blatt");
	return t[2];
}
function px(block, eigenschaft) {
	const re = new RegExp("(?:^|;)\\s*" + eigenschaft + "\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px");
	const t = re.exec(block);
	assert.ok(t, eigenschaft + " steht mit einem px-Wert da");
	return Number(t[1]);
}

// ---- 1. Das Seitenpolster des Kastens ist die eine Zahl, an der alles haengt -------------------
const kasten = regel(".fs-src--box");
const kastenPad = /padding:\s*\d+(?:\.\d+)?px\s+(\d+(?:\.\d+)?)px/.exec(kasten);
assert.ok(kastenPad, ".fs-src--box nennt sein Seitenpolster in der padding-Kurzform");
const PAD = Number(kastenPad[1]);
assert.ok(PAD > 0, "das Seitenpolster ist eine echte Zahl");

// ---- 2. Der Wrapper rueckt GENAU um dieses Polster aus -- wie der Trenner daneben --------------
const wrap = regel(".fs-src-tablewrap");
assert.strictEqual(px(wrap, "margin-left"), -PAD,
	"die Tabelle rueckt links um das Seitenpolster des Kastens aus -- nicht mehr (sonst laeuft sie ueber den Rahmen) und nicht weniger");
assert.strictEqual(px(wrap, "margin-right"), -PAD, "dasselbe rechts");

const trenner = regel(".fs-src-trenner");
const trennerSeite = /margin:\s*(?:0|\d+(?:\.\d+)?px)\s+(-?\d+(?:\.\d+)?)px/.exec(trenner);
assert.ok(trennerSeite, ".fs-src-trenner nennt seine Seitenausrueckung");
assert.strictEqual(Number(trennerSeite[1]), -PAD,
	"Trenner und Tabelle ruecken um DIESELBE Zahl aus -- beide sind das Seitenpolster des Kastens, keine freien Werte");

// ---- 3. Die Zellen holen das Polster zurueck: der Text steht auf der Textkante des Kastens -----
for (const zelle of [".fs-src-table th", ".fs-src-table td"]) {
	const block = regel(zelle);
	const kurz = /padding:\s*\d+(?:\.\d+)?px\s+(\d+(?:\.\d+)?)px/.exec(block);
	assert.ok(kurz, zelle + " nennt sein Seitenpolster");
	assert.strictEqual(Number(kurz[1]), PAD,
		zelle + ": Zellpolster == Ausrueckung, sonst steht der Tabellentext nicht auf derselben Kante wie die uebrigen Zeilen");
}

// ---- 4. KEINE Ausnahme, die den Kasten ueberspringt -------------------------------------------
// Genau das war der Fehler: ein Mass des PANELS an einem Element, das im Kasten sitzt.
assert.ok(!/\.avesmaps-infopanel[^{]*\.fs-src-tablewrap/.test(css),
	"keine Panel-Ausnahme fuer den Tabellen-Wrapper -- ihr Mass (--infopanel-pad-x) kennt den Kasten nicht und zieht die Tabelle aus ihm heraus");
assert.ok(!/\.avesmaps-infopanel[^{]*\.fs-src-table\s+(?:th|td)/.test(css),
	"und keine fuer die Zellen -- ihr 18px-Polster war nur der Ausgleich fuer eben jene Ausrueckung");
assert.ok(!/\.fs-src-tablewrap[^}]*--infopanel-pad-x/.test(css),
	"der Wrapper misst sich nie am Panel-Polster: er sitzt im Kasten, nicht an der Sektionskante");

// ---- 5. Das gescopte Bauprodukt traegt dieselbe Rechnung --------------------------------------
// 💣 css/pages/political-territory-editor-inline.css wird aus diesem Blatt GENERIERT (AGENTS.md
// §10). Eine hier reparierte Regel, die dort noch alt steht, ist im Territoriumseditor weiter kaputt.
const scoped = lies("css/pages/political-territory-editor-inline.css").replace(/\/\*[\s\S]*?\*\//g, "");
const wrapScoped = /#political-territory-editor-host\s+\.fs-src-tablewrap\s*\{([^}]*)\}/.exec(scoped);
assert.ok(wrapScoped, "das Bauprodukt kennt den Wrapper");
assert.strictEqual(px(wrapScoped[1], "margin-left"), -PAD, "Bauprodukt links -- `node tools/scope_editor_css.js` gelaufen?");
assert.strictEqual(px(wrapScoped[1], "margin-right"), -PAD, "Bauprodukt rechts");
assert.ok(!/\.avesmaps-infopanel[^{]*\.fs-src-tablewrap/.test(scoped),
	"und es traegt die gefallene Panel-Ausnahme nicht mehr");

console.log("OK publikationstabelle-im-kasten (" + PAD + "px Kastenpolster, Wrapper und Zellen folgen ihm)");
