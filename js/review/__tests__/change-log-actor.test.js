// Wer steht in einer Zeile des Änderungsprotokolls? (Befund A39, Owner-Entscheid (b)).
//
// 💣 NICHT JEDE ÄNDERUNG STAMMT VON EINEM MENSCHEN. Die Import-Tür moderiert mit einem Token; dort
// gibt es keine `username`, und die Zeile schrieb bis zum 06.08.2026 „unbekannt" — eine Behauptung
// über einen Menschen, den es nie gab. Jetzt reist ein Herkunftsvermerk im `after_json` mit.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Regel:
// ein Stub, der die geprüfte Funktion ersetzt, zertifiziert den Stub. Die Datei hat keine
// Nebenwirkung beim Laden — sie deklariert nur.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-actor.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "review-panels-change-log.js"), "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const changeLogEntryActor = sandbox.changeLogEntryActor;
assert.strictEqual(typeof changeLogEntryActor, "function", "die echte Funktion ist geladen");

// ---- Der Fall, um den es geht --------------------------------------------------------------------

assert.strictEqual(
	changeLogEntryActor({ username: "", actor_source: "import" }),
	"Import",
	"eine Entscheidung der Import-Tuer heisst 'Import', nicht 'unbekannt'",
);

// 💣 Faengt: der Vermerk ueberdeckt den Namen einer Person. Die Rangfolge ist Absicht -- eine echte
// `username` gewinnt IMMER, denn der Vermerk kommt aus dem after_json und ist die weichere Quelle.
assert.strictEqual(
	changeLogEntryActor({ username: "Valentin", actor_source: "import" }),
	"Valentin",
	"ein echter Name gewinnt gegen jeden Vermerk",
);

// Der uebliche Fall bleibt, wie er war.
assert.strictEqual(changeLogEntryActor({ username: "Valentin" }), "Valentin", "ein Mensch steht mit Namen da");

// 💣 Faengt: „unbekannt" verschwindet ganz. Es ist weiterhin die richtige Antwort, wenn WIRKLICH
// niemand bekannt ist -- ein Eintrag aus der Zeit vor dieser Aenderung zum Beispiel.
assert.strictEqual(changeLogEntryActor({}), "unbekannt", "ohne alles bleibt es unbekannt");
assert.strictEqual(changeLogEntryActor({ username: "", actor_source: "" }), "unbekannt", "leere Felder ebenso");
assert.strictEqual(changeLogEntryActor(null), "unbekannt", "und null wirft nicht");
assert.strictEqual(changeLogEntryActor(undefined), "unbekannt", "undefined auch nicht");

// ⚠️ Ein unbekannter Vermerk wird DURCHGEREICHT, nicht verschluckt. Kommt eines Tages eine zweite
// maschinelle Quelle dazu und vergisst jemand die Beschriftung, steht ihr Schluessel da -- haesslich,
// aber wahr. „unbekannt" waere an dieser Stelle die Luege, gegen die dieser Befund angetreten ist.
assert.strictEqual(
	changeLogEntryActor({ actor_source: "discord-bot" }),
	"discord-bot",
	"ein unbenannter Vermerk wird gezeigt, nicht zu 'unbekannt' verschluckt",
);

console.log("change-log-actor ok");
