const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Der Deploy-Schritt „Karte nach dem Deploy einmal abrufen" ist die letzte Wache vor einer toten
// Karte: er ruft `map-features.php` ab und schlaegt Alarm, wenn nicht `ok:true` zurueckkommt.
//
// 🪤 Am 24.08.2026 meldete er ZWEIMAL „Die Karte ist tot ... erwaege einen Revert", waehrend die
// Karte live HTTP 200 und 19,9 MB lieferte. Grund: GitHub startet jeden `shell: bash`-Schritt mit
// `bash --noprofile --norc -e -o pipefail`, und das `set -uo pipefail` IM Skript kann das `-e`
// nicht wieder abschalten -- `set` schaltet nur EIN, nie aus (dafuer gaebe es `set +e`). Ein
// einzelner fehlgeschlagener Verbindungsaufbau (curl-Exit 7) toetete den Schritt damit an der
// ersten Zuweisung: die drei Versuche liefen nie, die erklaerende Meldung erschien nie, und der
// Schritt endete mit Exit 7 statt mit seiner eigenen 1. Beide Fehlschlaege dauerten exakt 20,2 s
// -- das `sleep 20` und sonst nichts.
//
// 💣 Deshalb faehrt dieser Test den Schritt unter GENAU der Zeile, mit der GitHub ihn startet. Ein
// Lauf ohne `-e` ist gruen und beweist nichts -- er misst eine Umgebung, die es nicht gibt.
//
// ⚠️ Der Nachbarschritt „Run the unit tests" schreibt dasselbe `set -uo pipefail` und ist trotzdem
// heil: dort steht jeder fehlbare Aufruf in einer `if`-Bedingung, und darin greift `-e` nicht. Das
// ist die Bauform, an der man sich hier orientiert -- kein Zufall, sondern der Hausweg.
//
// Aus der Wurzel des Repos:  node tools/__tests__/deploy-kartenprobe.test.js

const wurzel = path.join(__dirname, "..", "..");
const WORKFLOW = path.join(wurzel, ".github/workflows/deploy-avesmaps-strato.yml");
const SCHRITT = "Karte nach dem Deploy einmal abrufen";

// ---- Das Skript aus dem Workflow schneiden -------------------------------------------------------
// ⚠️ Ohne YAML-Bibliothek (das Projekt hat keinen Build und keine Abhaengigkeiten): der Block nach
// `run: |` laeuft bis zur ersten nichtleeren Zeile, die WENIGER eingerueckt ist als seine erste.
function schrittSkript(name) {
	const zeilen = fs.readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
	const i = zeilen.findIndex((l) => l.includes("- name: " + name));
	assert.ok(i >= 0, "Schritt nicht gefunden: " + name);
	const j = zeilen.findIndex((l, n) => n > i && /^\s*run: \|\s*$/.test(l));
	assert.ok(j > i, "kein `run: |` unter dem Schritt");
	const einzug = (zeilen[j + 1].match(/^ */) || [""])[0].length;
	const raus = [];
	for (let n = j + 1; n < zeilen.length; n++) {
		const l = zeilen[n];
		if (l.trim() !== "" && (l.match(/^ */) || [""])[0].length < einzug) { break; }
		raus.push(l.slice(einzug));
	}
	return raus.join("\n");
}

const skript = schrittSkript(SCHRITT);
assert.ok(/curl/.test(skript), "der Schritt ruft die Karte per curl ab");
assert.ok(/for versuch in/.test(skript), "und wiederholt den Abruf");

// ---- Die Umgebung nachbauen ----------------------------------------------------------------------
const bau = fs.mkdtempSync(path.join(os.tmpdir(), "kartenprobe-"));
const bin = path.join(bau, "bin");
fs.mkdirSync(bin);

// `sleep` wird abgekuerzt -- der Schritt wartet echte 20 s plus zweimal 25 s, und ein Test, der
// siebzig Sekunden braucht, wird beim naechsten Aufraeumen ausgelassen.
fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

// Der curl-Ersatz spielt drei Faelle, gesteuert ueber PROBE_FALL.
// 💣 Er bedient `-o <datei>` wirklich: der Schritt liest die ANTWORT aus dieser Datei und nur den
// Statuscode von stdout. Ein Ersatz, der alles nach stdout schreibt, laesst jeden Fall wie „leere
// Antwort" aussehen, und der Test prueft dann etwas anderes als den echten Ablauf.
// ⚠️ Bewusst ohne CRLF in den Kopfzeilen: der Schritt nimmt ohnehin nur `tail -1`.
const curlErsatz = [
	"#!/bin/sh",
	"ziel=",
	"while [ $# -gt 0 ]; do",
	"  case \"$1\" in",
	"    -o) ziel=\"$2\"; shift 2 ;;",
	"    *) shift ;;",
	"  esac",
	"done",
	"case \"$PROBE_FALL\" in",
	"  kein_verbindungsaufbau)",
	"    exit 7 ;;",
	"  lebt)",
	"    printf '%s' '{\"ok\":true,\"revision\":4711,\"features\":[]}' > \"$ziel\"",
	"    echo 'HTTP/2 200'; echo; printf '200'; exit 0 ;;",
	"  serverfehler)",
	"    printf '%s' 'Internal Server Error' > \"$ziel\"",
	"    echo 'HTTP/2 500'; echo; printf '500'; exit 0 ;;",
	"esac",
	"exit 0",
].join("\n") + "\n";
fs.writeFileSync(path.join(bin, "curl"), curlErsatz, { mode: 0o755 });

// 🔴 GENAU die Zeile, mit der GitHub `shell: bash` startet (sie steht in jedem Lauf im Protokoll).
// Aendert GitHub sie, gehoert sie hier nachgezogen -- sonst prueft der Test eine andere Umgebung.
const GITHUB_SHELL = ["--noprofile", "--norc", "-e", "-o", "pipefail"];

function fahre(fall) {
	const datei = path.join(bau, "schritt.sh");
	fs.writeFileSync(datei, skript);
	const r = cp.spawnSync("bash", GITHUB_SHELL.concat([datei]), {
		encoding: "utf8",
		env: Object.assign({}, process.env, {
			PROBE_FALL: fall,
			PATH: bin + path.delimiter + process.env.PATH,
		}),
	});
	return { code: r.status, aus: (r.stdout || "") + (r.stderr || "") };
}

// ---- A. Kein Verbindungsaufbau: DREI Versuche, dann die erklaerende Meldung ----------------------
// 🔴 Das ist der gemessene Fall. Vor der Reparatur: Exit 7, null Versuche, keine Meldung.
const keiner = fahre("kein_verbindungsaufbau");
const versuche = (keiner.aus.match(/Versuch [123]:/g) || []).length;
assert.strictEqual(versuche, 3,
	"alle drei Versuche laufen wirklich, gefunden: " + versuche + "\n--- Ausgabe ---\n" + keiner.aus);
assert.strictEqual(keiner.code, 1,
	"und der Schritt endet mit seiner eigenen 1, nicht mit curls " + keiner.code);
assert.ok(/::error/.test(keiner.aus), "die erklaerende Fehlermeldung erscheint");

// 🪤 Auf die ::error-ZEILE zielen, nicht auf die ganze Ausgabe. Die erste Fassung pruefte `keiner.aus`
// -- und die Versuchszeilen darueber sagen selbst schon „der Host war nicht zu erreichen". Die
// Zusicherung war damit von der falschen Zeile erfuellt: eine wieder zusammengelegte Fehlermeldung
// blieb in der Mutationsprobe gruen. Eine Zusicherung, die ihr Subjekt woanders findet, prueft nichts.
const fehlerzeile = (keiner.aus.match(/::error[^\n]*/) || [""])[0];
assert.ok(/nicht zu erreichen|Verbindung/i.test(fehlerzeile),
	"die Fehlermeldung nennt die Erreichbarkeit als Ursache: " + fehlerzeile);

// 🔴 Und die schaerfere Haelfte: sie darf NICHT zum Revert raten. Die Karte war live, als das
// zweimal passierte -- ein Revert-Rat fuer einen gesunden Deploy ist schlimmer als keine Meldung.
// ⚠️ Geprueft wird die EMPFEHLUNG, nicht das Wort: die neue Meldung sagt ausdruecklich „Ein Revert
// ist hier der falsche Reflex" und enthaelt es damit voellig zu Recht. Ein `!/revert/i` schlug
// genau daran fehl -- die Zusicherung war schaerfer als ihre Absicht.
assert.ok(!/erw(ae|ä)ge einen revert/i.test(fehlerzeile),
	"und EMPFIEHLT keinen Revert, wenn der Server nie geantwortet hat: " + fehlerzeile);

// ---- B. Die Karte lebt: EIN Abruf, Exit 0 --------------------------------------------------------
const lebt = fahre("lebt");
assert.strictEqual(lebt.code, 0, "eine lebende Karte laesst den Schritt gruen durch:\n" + lebt.aus);
assert.ok(/Karte lebt/.test(lebt.aus), "und wird als solche gemeldet");
assert.ok(/4711/.test(lebt.aus), "die Kartenfassung steht im Log -- sonst weiss niemand, WAS live ist");
// ⚠️ map-features.php ist ein Perf-Brennpunkt (CLAUDE.md): kein zweiter Abruf, wenn der erste reicht.
assert.strictEqual((lebt.aus.match(/Versuch [123]:/g) || []).length, 0,
	"kein zweiter Abruf nach einem erfolgreichen ersten");

// ---- C. Der Server antwortet, aber falsch: DREI Versuche, dann Absage ----------------------------
// ⚠️ Der Unterschied zu A ist der Grund, warum es beide gibt: hier ist der DEPLOY verdaechtig, dort
// das Netz. Beide Male drei Versuche, aber nicht dieselbe Diagnose.
const kaputt = fahre("serverfehler");
assert.strictEqual((kaputt.aus.match(/Versuch [123]:/g) || []).length, 3,
	"drei Versuche auch hier:\n" + kaputt.aus);
assert.strictEqual(kaputt.code, 1, "und eine Absage");
assert.ok(/500/.test(kaputt.aus), "der HTTP-Code steht im Log");

// 🔴 Und die Zusicherung, um die es in diesem Fall eigentlich geht: hier faellt die ANDERE Diagnose.
// Der Server hat geantwortet -- also ist der Deploy verdaechtig, und hier ist ein Revert richtig.
// Ohne sie ueberlebt eine Mutation, die den Zaehler `antworten` nie erhoeht: dann bekaeme AUCH ein
// dreimal fehlerhaft antwortender Server die Meldung „nicht erreichbar", und die Trennung, fuer die
// dieser ganze Umbau da ist, waere lautlos wieder weg.
const fehlerzeileC = (kaputt.aus.match(/::error[^\n]*/) || [""])[0];
assert.ok(/Karte ist tot/.test(fehlerzeileC),
	"ein antwortender, aber kaputter Server bekommt die Deploy-Diagnose: " + fehlerzeileC);
assert.ok(!/nicht zu erreichen/i.test(fehlerzeileC),
	"und NICHT die Netz-Diagnose: " + fehlerzeileC);

fs.rmSync(bau, { recursive: true, force: true });
console.log("deploy-kartenprobe: alle Zusicherungen gruen");
