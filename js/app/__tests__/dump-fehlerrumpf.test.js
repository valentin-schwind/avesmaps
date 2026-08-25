const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Ein PHP-ABBRUCH antwortet mit einem LEEREN Rumpf -- und der Client warf ihn weg.
//
// 💣 DER FALL, DER DAS AUSGELOEST HAT (25.08.2026): "Dump holen" brach mit HTTP 500 ab, und in
// der Konsole stand nur "WikiDump-API antwortet mit HTTP 500." Das ist der RUECKFALLTEXT des
// Clients, nicht die Meldung des Servers -- `readJsonResponse` verschluckt einen Rumpf, der kein
// JSON ist, restlos (`catch { return fallback; }`). Der Server hatte die Ursache mitgeschickt
// oder gar nichts gesagt, und von aussen war beides nicht zu unterscheiden. Eine halbe Stunde
// Ratens waren die Folge.
//
// ⭐ Die Unterscheidung ist die eigentliche Auskunft:
//   - Der Server hat eine Meldung geschickt  -> sie wird gezeigt, wortwoertlich.
//   - Der Rumpf ist LEER                     -> das ist die Signatur eines PHP-Abbruchs, und der
//                                               Satz sagt das, statt eine Zahl zu wiederholen.
//   - Der Rumpf ist etwas anderes (HTML)     -> ein Auszug daraus, ohne Markup, gekuerzt.
//
// Lauf vom Repo-Wurzelverzeichnis:  node js/app/__tests__/dump-fehlerrumpf.test.js

const API_CLIENT_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api-client.js"), "utf8");

// Wie in dubletten-verweis.test.js: Browser-Skript ohne module.exports, also wird die
// Deklaration aus dem ECHTEN Quelltext geschnitten und ausgewertet. Eine hierher kopierte
// Fassung wuerde gar nichts pruefen.
function schneideDeklaration(quelle, was, beginn, ende) {
	const start = quelle.indexOf(beginn);
	assert.ok(start >= 0, `${was}: Beginn "${beginn}" nicht im Quelltext gefunden`);
	const schluss = quelle.indexOf(ende, start);
	assert.ok(schluss > start, `${was}: Ende "${ende}" nicht nach dem Beginn gefunden`);
	return quelle.slice(start, schluss + ende.length);
}

const quelltext = [
	schneideDeklaration(API_CLIENT_SOURCE, "apiErrorMessage", "function apiErrorMessage(", "\n}"),
	schneideDeklaration(API_CLIENT_SOURCE, "wikiDumpAktionsFehlertext", "function wikiDumpAktionsFehlertext(", "\n}"),
].join("\n\n");

const wikiDumpAktionsFehlertext = new Function(`${quelltext}\nreturn wikiDumpAktionsFehlertext;`)();

// --------------------------------------------------- (a) der Server hat etwas gesagt ---
assert.strictEqual(
	wikiDumpAktionsFehlertext(500, { ok: false, error: { code: "server_error", message: "TypeError in foo.php:12" } }, "egal"),
	"TypeError in foo.php:12",
	"eine Servermeldung wird wortwoertlich gezeigt und nicht durch eine Statuszahl ersetzt"
);

// ------------------------------------------------------------- (b) LEERER Rumpf ---
// 💣 Die Zusicherung, um die es geht: leer ist eine AUSSAGE, keine Leerstelle.
const beiLeer = wikiDumpAktionsFehlertext(500, {}, "");
assert.ok(beiLeer.includes("500"), `der Status gehoert weiterhin hinein: ${beiLeer}`);
assert.ok(
	beiLeer.toLowerCase().includes("leer"),
	`ein leerer Rumpf muss als solcher benannt werden, sonst raet der naechste wieder: ${beiLeer}`
);
assert.ok(
	beiLeer.includes("Abbruch"),
	`und er muss sagen, WORAUF das hindeutet (PHP-Abbruch), statt es dem Leser zu ueberlassen: ${beiLeer}`
);

// ------------------------------------------------- (c) Rumpf ohne JSON (HTML o. ae.) ---
const beiHtml = wikiDumpAktionsFehlertext(500, {}, "<br />\n<b>Fatal error</b>:  Allowed memory size exhausted in /x/y.php on line 9\n");
assert.ok(
	beiHtml.includes("Allowed memory size exhausted"),
	`ein nicht-JSON-Rumpf muss im Auszug erscheinen -- das ist die einzige Spur, die es gibt: ${beiHtml}`
);
assert.ok(
	!beiHtml.includes("<b>") && !beiHtml.includes("<br"),
	`aber ohne Markup: der Text landet per textContent in einer Statuszeile: ${beiHtml}`
);

// ------------------------------------------------------------- (d) sehr langer Rumpf ---
const langer = "A".repeat(5000);
const beiLang = wikiDumpAktionsFehlertext(500, {}, langer);
assert.ok(beiLang.length < 500, `ein 5000-Zeichen-Rumpf darf die Statuszeile nicht sprengen (${beiLang.length})`);
assert.ok(beiLang.includes("AAAA"), "der Anfang des Rumpfes muss trotzdem sichtbar sein");

// ------------------------------------- (e) und die Verdrahtung: wird er ueberhaupt benutzt? ---
// 🪤 Ein gruener Leser beweist nichts, solange submitWikiSyncDumpAction weiter response.json()
// ruft und den Rohtext nie sieht. Genau diese Haelfte fehlte vorher.
const aktion = schneideDeklaration(
	API_CLIENT_SOURCE,
	"submitWikiSyncDumpAction",
	"async function submitWikiSyncDumpAction(",
	"\n}"
);
assert.ok(
	aktion.includes("wikiDumpAktionsFehlertext("),
	"submitWikiSyncDumpAction muss den neuen Textbauer wirklich benutzen"
);
assert.ok(
	aktion.includes("response.text()"),
	"und dafuer den ROHTEXT lesen -- response.json() wirft einen nicht-JSON-Rumpf weg, bevor ihn jemand sieht"
);
assert.ok(
	!aktion.includes("readJsonResponse("),
	"der alte, verschluckende Leser darf hier nicht mehr stehen: er kann den Rumpf nur EINMAL lesen"
);

console.log("dump-fehlerrumpf: alle Zusicherungen erfuellt");
