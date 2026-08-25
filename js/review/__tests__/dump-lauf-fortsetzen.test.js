const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Ein abgebrochener Dump-Lauf laesst sich FORTSETZEN, statt bei Null zu beginnen.
//
// 💣 DER SCHADEN, DEN DAS BEHEBT: "Dump holen" rief immer `start_read` und bekam damit einen
// NEUEN Lauf. Der Lauf selbst war laengst fortsetzbar -- die Zeile in wiki_sync_runs traegt
// Phase und Cursor, und runWikiSyncDumpLoop nimmt seit jeher ein `runId` entgegen. Es fehlte
// allein die Auskunft, DASS noch einer offen ist. An einem Abend mit drei Abbruechen in Phase
// 10 von 11 war nicht der Fehler der Schaden, sondern dass jeder Versuch wieder eine Stunde
// kostete.
//
// Geprueft wird die VERDRAHTUNG, denn genau die fehlte:
//   A) der Status-Endpunkt liefert den offenen Lauf ueberhaupt,
//   B) startWikiSyncDumpRead fragt danach und reicht die Kennung in die Schleife,
//   C) beim Fortsetzen entfaellt der Neu-Abruf des Dumps -- er tauschte dem laufenden Lesen
//      sonst die Grundlage unter den Fuessen weg,
//   D) und ohne offenen Lauf bleibt alles wie vorher.
//
// Lauf vom Repo-Wurzelverzeichnis:  node js/review/__tests__/dump-lauf-fortsetzen.test.js

const REVIEW = fs.readFileSync(path.join(__dirname, "..", "review-wiki-sync.js"), "utf8");
const ENDPUNKT = fs.readFileSync(
	path.join(__dirname, "..", "..", "..", "api", "edit", "wiki", "dump.php"),
	"utf8"
);
const TREIBER = fs.readFileSync(
	path.join(__dirname, "..", "..", "..", "api", "_internal", "wiki", "dump-hybrid-driver.php"),
	"utf8"
);

function schneide(quelle, was, beginn, ende) {
	const start = quelle.indexOf(beginn);
	assert.ok(start >= 0, `${was}: "${beginn}" nicht gefunden`);
	const schluss = quelle.indexOf(ende, start);
	assert.ok(schluss > start, `${was}: Ende nicht nach dem Beginn gefunden`);
	return quelle.slice(start, schluss + ende.length);
}

// --- A) der Server liefert den offenen Lauf ---------------------------------
assert.ok(
	TREIBER.includes("function avesmapsWikiDumpAktiverLeselauf(PDO $pdo): ?array"),
	"der Treiber muss den offenen Lesevorgang benennen koennen"
);
const leser = schneide(TREIBER, "avesmapsWikiDumpAktiverLeselauf", "function avesmapsWikiDumpAktiverLeselauf(", "\n}");
assert.ok(
	leser.includes("status = 'running'"),
	"💣 nur ein LAUFENDER Lauf wird fortgesetzt -- ein abgeschlossener ist nichts, was man fortsetzt"
);
assert.ok(
	leser.includes("ORDER BY id DESC") && leser.includes("LIMIT 1"),
	"und nur der neueste, sonst wird eine Leiche wiederbelebt"
);
assert.ok(
	ENDPUNKT.includes("$status['aktiver_lauf'] = avesmapsWikiDumpAktiverLeselauf($pdo);"),
	"die Statusabfrage muss ihn wirklich mitliefern -- sonst kann der Client nicht danach fragen"
);

// --- B) der Client fragt danach und reicht die Kennung weiter ----------------
const start = schneide(REVIEW, "startWikiSyncDumpRead", "async function startWikiSyncDumpRead()", "\n}");
assert.ok(
	start.includes("findeOffenenDumpLauf()"),
	"startWikiSyncDumpRead muss nach einem offenen Lauf fragen"
);
assert.ok(
	start.includes('runWikiSyncDumpLoop("read_step", { runId: fortsetzen })'),
	"🪤 und die Kennung WIRKLICH weiterreichen -- ohne sie legt runWikiSyncDumpLoop einen neuen Lauf an, " +
		"und der ganze Fund waere wirkungslos"
);

const finder = schneide(REVIEW, "findeOffenenDumpLauf", "async function findeOffenenDumpLauf()", "\n}");
assert.ok(
	finder.includes("antwort?.aktiver_lauf"),
	"💣 fetchWikiSyncDumpStatus liefert `status` bereits AUSGEPACKT -- ein zweites `.status` " +
		"laeuft ins Leere und findet nie einen offenen Lauf"
);
assert.ok(
	/catch\s*\([^)]*\)\s*\{[^}]*return null/s.test(finder),
	"eine gescheiterte Statusabfrage darf den Knopf nicht blockieren: ohne Auskunft eben von vorn"
);

// --- C) beim Fortsetzen KEIN neuer Dump-Abruf --------------------------------
const abrufStelle = start.indexOf('submitWikiSyncDumpAction("fetch_dump")');
assert.ok(abrufStelle > 0, "der Dump-Abruf muss im Ablauf stehen");
const davor = start.slice(0, abrufStelle);
assert.ok(
	/if\s*\(!fortsetzen\)\s*\{/.test(davor),
	"💣 beim Fortsetzen entfaellt der Neu-Abruf: ein frischer Download taeuschte dem laufenden " +
		"Lesen eine andere Datei unter -- Cursor und Inhalt passten dann nicht mehr zusammen"
);

// --- D) ohne offenen Lauf bleibt alles beim Alten ----------------------------
assert.ok(
	start.includes("if (!fortsetzen && !window.confirm("),
	"ohne Fortsetzung muss die gewohnte Rueckfrage weiterhin kommen -- der Knopf darf nicht " +
		"stillschweigend etwas anderes tun als bisher"
);

console.log("dump-lauf-fortsetzen: alle Zusicherungen erfuellt");
