// „Abzug hinterlegen" legt BEIDE Fassungen ab -- roh UND geglättet.
//
// 🚩 DER BEFUND, DER IHN AUSGELÖST HAT (Owner 08.09.2026): `GET /api/svg-export.php?smooth=1`
// lieferte r117439 mit 17,16 MB, während die rohe Schublade längst r117906 trug. Der Owner hatte
// „geglättet" angehakt und den Knopf gedrückt -- gebaut und hinterlegt wurde trotzdem nur die
// rohe Fassung. Die geglättete entstand ausschliesslich im nächtlichen Lauf um 03:17 UTC.
//
// 💣 DIE STILLE HÄLFTE IST DAS EIGENTLICHE PROBLEM. Die Erfolgsmeldung sagte „Die API liefert ab
// sofort diese Datei aus" und meinte damit die eine Schublade. Nichts war rot, nichts fehlte
// sichtbar -- die andere Fassung war einfach alt, und das sieht man einer SVG-Datei nicht an.
// Genau deshalb steht diese Zusicherung hier: sie ist billig und der Fehler ist es nicht.
//
// ⚠️ Gemessen wird der QUELLTEXT. Der Kitt ist eine IIFE für den Browser, hängt an `document`,
// `fetch` und einem DOM voller Bedienelemente; hier läuft kein Browser. Was der Quelltext nicht
// beweist -- dass der Upload wirklich durchläuft --, gehört in die Abnahme mit Editor-Sitzung.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/abzug-hinterlegt-beide-fassungen.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };

// 💣 Kommentare raus, bevor gemessen wird -- sonst bestätigt sich der Test an der Begründung,
// die vor genau diesem Fehler warnt. Zeilenendenneutral (CRLF hier, LF im Deploy-Tor).
function ohneKommentare(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(/\r?\n/)
		.map((z) => z.replace(/(^|[^:])\/\/.*$/, "$1"))
		.join("\n");
}
const lies = (...t) => ohneKommentare(fs.readFileSync(path.join(wurzel, ...t), "utf8"));

const KITT = lies("js", "pages", "svg-export-page.js");
const BAUER = lies("js", "pages", "svg-export-build.js");
const LAEUFER = lies("tools", "svg-export", "abzug-bauen.js");

// ---- A. Der Browser kennt die geglättete Fassung überhaupt --------------------------------------
// Ohne diese Zeile KANN der Knopf sie nicht bauen -- das war die Ursache, nicht ein vergessener
// Aufruf: `SVGX_ABZUG_EINSTELLUNGEN_GLATT` stand nur in `module.exports` (Node), nie am `window`.
// 🪤 GEMESSEN IM BROWSER-BLOCK, nicht in der ganzen Datei. `module.exports` führt dieselbe
// Zeile für Node, und ein Regex auf `ABZUG_EINSTELLUNGEN_GLATT:` trifft auch
// `SVGX_ABZUG_EINSTELLUNGEN_GLATT:` -- die Zusicherung wäre grün geblieben, obwohl dem
// Browser genau das fehlt, woran der Fehler hing. Eine Mutationsprobe hat es gezeigt.
const browserBlock = BAUER.slice(BAUER.indexOf("window.AvesmapsSvgExport"),
	BAUER.indexOf("module.exports"));
pruefe(browserBlock.length > 0, "der Browser-Export-Block ist auffindbar");
pruefe(/(?<!SVGX_)ABZUG_EINSTELLUNGEN_GLATT:/.test(browserBlock),
	"der Bauer reicht die geglätteten Einstellungen auch an den BROWSER heraus");

// ---- B. Der Hinterlegen-Bau führt beide Fassungen ----------------------------------------------
const bauStart = KITT.indexOf("async function baueApiAbzuege(");
pruefe(bauStart !== -1, "der Bau des API-Abzugs heisst baueApiAbzuege (Mehrzahl)");
const bauRumpf = KITT.slice(bauStart, KITT.indexOf("async function hinterlegeEine("));
pruefe(bauRumpf.includes("E.ABZUG_EINSTELLUNGEN,"), "die rohe Fassung wird gebaut");
pruefe(bauRumpf.includes("E.ABZUG_EINSTELLUNGEN_GLATT"), "die geglättete Fassung wird gebaut");

// 💣 AUS EINEM DATENABRUF. Zwei Durchgänge mit je eigenem Abruf wären ~40 MB und die Last, vor der
// CLAUDE.md ausdrücklich warnt -- die drei Endpunkte sind bekannte Perf-Brennpunkte. Die Regel:
// die Abrufe stehen VOR der Variantenliste, nicht in ihr.
const abrufe = (bauRumpf.match(/await holen\(/g) || []).length;
pruefe(abrufe >= 2, "der Bau holt die Daten wirklich (Gegenprobe gegen einen leeren Rumpf)");
const listeAb = bauRumpf.indexOf("const varianten =");
pruefe(listeAb !== -1, "es gibt eine Variantenliste");
pruefe(bauRumpf.slice(listeAb).indexOf("await holen(") === -1,
	"NACH der Variantenliste wird nichts mehr geholt -- beide Fassungen aus EINEM Datenabruf");

// ---- C. Der Namenszusatz ist der des Läufers ----------------------------------------------------
// 🔴 Dieselbe Schreibweise wie tools/svg-export/abzug-bauen.js -- eine zweite Namensform wäre eine
// zweite Wahrheit über dieselbe Datei.
pruefe(LAEUFER.includes('namensZusatz: "-glatt"'), "der Läufer benennt die glatte Fassung so");
pruefe(bauRumpf.includes('namensZusatz: "-glatt"'), "und der Knopf benennt sie genauso");

// ---- D. Hochgeladen werden BEIDE, nacheinander --------------------------------------------------
const hinterlegen = KITT.slice(KITT.indexOf("async function hinterlegen()"),
	KITT.indexOf("async function erzeugen()"));
pruefe(hinterlegen.includes("baueApiAbzuege()"), "der Knopf holt beide Fassungen");
// 💣 ÜBER ALLE, nicht über eine feste Zahl. `for (let i = 0; i < 1; i++)` ist genau der
// Fehler, der behoben wurde -- er sieht wie eine Schleife aus und lädt eine Fassung hoch.
// Auch das fand erst die Mutationsprobe; ein blosses /for\s*\(/ hätte ihn durchgelassen.
pruefe(/for\s*\([^)]*i\s*<\s*abzuege\.length/.test(hinterlegen),
	"die Schleife läuft über ALLE gebauten Fassungen, nicht über eine feste Zahl");
pruefe(hinterlegen.includes("hinterlegeEine("), "und lädt jede einzeln hoch");
// 💣 Nacheinander, nicht parallel: die Ablage vergibt eine upload_id je Vorgang, und zwei
// gleichzeitige Stückel-Läufe auf STRATO sind genau die Last, die hier schon einmal für einen
// Datenbankausfall gehalten wurde.
pruefe(!/Promise\.all/.test(hinterlegen),
	"nicht parallel -- eine upload_id je Vorgang, und STRATO verträgt keine zwei Stückel-Läufe");

// ---- E. Die Meldung darf nicht mehr die halbe Wahrheit sagen ------------------------------------
// 🔴 Der alte Satz „Die API liefert ab sofort diese Datei aus" war korrekt UND irreführend: er galt
// einer von zwei Schubladen. Wer ihn wieder auf Einzahl zurückdreht, nimmt dem Owner genau die
// Auskunft, deren Fehlen diesen Fehler tagelang verdeckt hat.
pruefe(hinterlegen.includes("beide Fassungen"),
	"die Erfolgsmeldung nennt beide Fassungen");
pruefe(/geglättet/.test(hinterlegen) && /roh/.test(hinterlegen),
	"und benennt sie einzeln, damit man sieht, welche gerade läuft");
// ⚠️ Und der Fehlerfall sagt, dass eine Fassung schon liegen kann -- ein blosses
// „fehlgeschlagen" liesse den Eindruck, es sei nichts passiert.
pruefe(/bereits übernommene/.test(hinterlegen),
	"der Fehlerfall nennt die bereits übernommenen Fassungen");

// ---- F. Die Schublade entscheidet weiterhin der SERVER -------------------------------------------
// 🔴 Aus dem Wurzelattribut avm:geglaettet der Datei, nie aus einem Feld im Rumpf
// (api/_internal/app/svg-export-ablage.php). Schickte der Client die Zuordnung mit, könnte ein
// Handabzug in der falschen Schublade landen -- dieselbe Begründung wie bei X-Avesmaps-Quelle.
const finish = hinterlegen + KITT.slice(KITT.indexOf("async function hinterlegeEine("),
	KITT.indexOf("async function hinterlegen()"));
pruefe(!/glatt:\s*(true|false|abzug\.glatt)/.test(finish.replace(/glatt: variante[^\n]*/g, "")),
	"der Upload teilt dem Server NICHT mit, in welche Schublade die Datei gehört");

console.log("ok -- " + pruefungen + " Zusicherungen");
