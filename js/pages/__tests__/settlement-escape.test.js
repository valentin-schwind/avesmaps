// `settlementEscape` (html/wiki-sync-settlement-editor.html) maskiert AUCH Anführungszeichen.
//
// 🚩 DER BEFUND (26.09.2026, beim Stätten-Kasten): die Funktion maskierte über das DOM
// (textContent setzen, innerHTML lesen) und liess damit `"` und `'` durch. Ihr Ergebnis steht in
// der Seite aber an rund 20 Stellen in Attributen -- `value="${settlementEscape(detail.name)}"`,
// `href="…"`, `data-territory-pick="…"` -- und wird an den Quellenkasten als `escape` gereicht,
// der es in `href`, `title`, `value` und `data-*` setzt. Ein Name mit `"` brach das Attribut auf:
// im Formular stand der Name nur bis zum Anführungszeichen, und der Rest wurde zu Attributen.
//
// ⭐ Die Funktion wird AUSGEFÜHRT, nicht gelesen: ein Regex auf `.replace(/"/g` wäre auch dann
// grün, wenn die Zeile im falschen Zweig stünde oder das Ergebnis verworfen würde.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/settlement-escape.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(wurzel, "html", "wiki-sync-settlement-editor.html"), "utf8").replace(/\r\n/g, "\n");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };
const gleich = (ist, soll, was) => { assert.strictEqual(ist, soll, was); pruefungen++; };

// --- Die Funktion ausschneiden: genau EINE Definition, Rumpf per Klammerzählung.
const kopf = "function settlementEscape(";
const treffer = quelle.split(kopf).length - 1;
gleich(treffer, 1, "settlementEscape ist genau einmal definiert (eine zweite, später geladene gewänne)");
const start = quelle.indexOf(kopf);
const rumpfAuf = quelle.indexOf("{", start);
let tiefe = 0;
let ende = -1;
for (let i = rumpfAuf; i < quelle.length; i++) {
	if (quelle[i] === "{") tiefe++;
	else if (quelle[i] === "}") { tiefe--; if (tiefe === 0) { ende = i + 1; break; } }
}
pruefe(ende > rumpfAuf, "Rumpf von settlementEscape gefunden");

// ⚠️ Ohne `document` im Kasten: die Funktion soll kein DOM brauchen. Eine Rückkehr zur alten
// DOM-Fassung wirft hier mit ReferenceError -- das ist gewollt rot.
const kasten = { String };
vm.createContext(kasten);
vm.runInContext(quelle.slice(start, ende) + "\nthis.settlementEscape = settlementEscape;", kasten);
const esc = kasten.settlementEscape;
pruefe(typeof esc === "function", "settlementEscape ist ausführbar");

// --- Die fünf Zeichen einzeln.
gleich(esc('"'), "&quot;", "gerades doppeltes Anführungszeichen wird maskiert");
gleich(esc("'"), "&#39;", "einfaches Anführungszeichen wird maskiert");
gleich(esc("<"), "&lt;", "< wird maskiert");
gleich(esc(">"), "&gt;", "> wird maskiert");
gleich(esc("&"), "&amp;", "& wird maskiert");

// --- & zuerst: ein bereits maskiert aussehender Text wird genau EINMAL maskiert, nie doppelt
// und nie „durchgewunken".
gleich(esc("&quot;"), "&amp;quot;", "& wird vor den übrigen ersetzt (keine Doppelmaskierung, kein Durchwinken)");
gleich(esc('Tom & "Jerry" <b>'), "Tom &amp; &quot;Jerry&quot; &lt;b&gt;", "gemischter Wert");

// --- Leere und Zahlen wie bisher.
gleich(esc(null), "", "null wird zur leeren Zeichenkette");
gleich(esc(undefined), "", "undefined wird zur leeren Zeichenkette");
gleich(esc(0), "0", "0 bleibt 0 (keine Wahrheitswertprüfung)");
gleich(esc("Gareth"), "Gareth", "harmloser Text bleibt unverändert");
gleich(esc("Fürstentum Kosch"), "Fürstentum Kosch", "Umlaute bleiben unverändert");

// --- Der Rundlauf, um den es geht: ein Wert mit beiden Anführungszeichen in BEIDEN Attributformen.
const boese = `Der "Alte" Turm' onmouseover='x`;
for (const [q, name] of [['"', "doppelt"], ["'", "einfach"]]) {
	const markup = `<input value=${q}${esc(boese)}${q} data-x=${q}1${q}>`;
	const wert = markup.slice(`<input value=${q}`.length, markup.indexOf(`${q} data-x=`));
	pruefe(!wert.includes(q), `Attributwert (${name} quotiert) enthält kein rohes ${q} mehr`);
	gleich(wert.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
		boese, `Attribut (${name} quotiert) dekodiert zum Originalwert zurück`);
}

// --- Und die Verdrahtung, derentwegen es zählt: der Quellenkasten bekommt DIESE Funktion.
pruefe(/mountFeatureSourceEditor\([^;]*\{\s*escape:\s*settlementEscape\s*\}\)/.test(quelle),
	"der Quellenkasten wird mit settlementEscape montiert");

console.log(`settlement-escape: ${pruefungen} Prüfungen ok`);
