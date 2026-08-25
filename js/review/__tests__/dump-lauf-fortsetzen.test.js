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
	TREIBER.includes("function avesmapsWikiDumpAktiverLeselauf(PDO $pdo, string $dumpStempel"),
	"der Treiber muss den offenen Lesevorgang benennen koennen -- und dabei die Dump-Datei verlangen"
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

// --- 💣 DERSELBE DUMP, und nur ein frischer Lauf ----------------------------
// Acht der elf Phasen zaehlen SEITEN in der XML-Datei. Setzt ein Lauf auf einer ANDEREN
// Datei fort, springt er mitten hinein: die ersten 200.000 Seiten des neuen Dumps werden
// nie gelesen, der Lauf meldet trotzdem 'abgeschlossen', und cleanup_state erklaert genau
// diesen halben Stand zum einzig verbleibenden. Das ist nicht theoretisch --
// avesmapsWikiDumpEnsureDumpPresentOrFail laedt bei fehlender Datei selbst einen frischen
// Dump herunter.
assert.ok(
	/laufStempel\s*!==\s*\$dumpStempel/.test(leser) || /\$dumpStempel\s*!==\s*\$laufStempel/.test(leser),
	"💣 ein Lauf darf nur fortgesetzt werden, wenn er an DIESELBE Dump-Datei gebunden ist"
);
assert.ok(
	/laufStempel\s*===\s*''/.test(leser),
	"🔴 und ein Lauf OHNE Stempel (von vor dieser Aenderung) gilt als nicht fortsetzbar -- die sichere Richtung ist einmal von vorn, nicht mitten in eine fremde Datei"
);
assert.ok(
	leser.includes("AVESMAPS_WIKI_DUMP_FORTSETZEN_MAX_ALTER_SEKUNDEN"),
	"⚠️ und nur solange er frisch ist: ein abgebrochener Lauf wird NIE auf failed gesetzt, ohne Altersgrenze bietet der Knopf dieselbe Leiche unbegrenzt wieder an"
);

// Der Stempel selbst muss die Datei wirklich unterscheiden koennen.
const stempel = schneide(TREIBER, "avesmapsWikiDumpDateiStempel", "function avesmapsWikiDumpDateiStempel(", "\n}");
assert.ok(
	stempel.includes("filesize") && stempel.includes("filemtime"),
	"der Fingerabdruck braucht Groesse UND Aenderungszeit -- eine allein wiederholt sich zu leicht"
);

// --- Und der Endpunkt reicht ihn herein, aus der HERUNTERGELADENEN Datei ----
// 🪤 avesmapsWikiDumpPreferredReadPath wechselt je nach Frische zwischen .bz2 und dem
// entpackten Schnellzugriff. Ein Stempel daraus spraenge mitten im Lauf um und verboete
// das Fortsetzen genau dann, wenn es richtig waere.
assert.ok(
	ENDPUNKT.includes("$status['aktiver_lauf'] = avesmapsWikiDumpAktiverLeselauf("),
	"die Statusabfrage muss ihn wirklich mitliefern -- sonst kann der Client nicht danach fragen"
);
const statusZweig = ENDPUNKT.slice(
	ENDPUNKT.indexOf("$status['aktiver_lauf']"),
	ENDPUNKT.indexOf("$status['aktiver_lauf']") + 600
);
assert.ok(
	statusZweig.includes("avesmapsWikiDumpDateiStempel(avesmapsWikiDumpStoragePath())"),
	"💣 der Stempel kommt aus der heruntergeladenen Datei, nicht aus der bevorzugten Lesefassung"
);
assert.ok(
	!statusZweig.includes("EnsureDumpPresent"),
	"🔴 und die Statusabfrage darf dabei KEINEN Dump nachladen -- sie wird bei jedem Oeffnen des Panels gefahren"
);


// --- B) der Client fragt danach und reicht die Kennung weiter ----------------
const start = schneide(REVIEW, "startWikiSyncDumpRead", "async function startWikiSyncDumpRead()", "\n}");
assert.ok(
	start.includes("findeOffenenDumpLauf()"),
	"startWikiSyncDumpRead muss nach einem offenen Lauf fragen"
);
// 🪤 Geprüft wird die EIGENSCHAFT, nicht der Wortlaut. Die erste Fassung verglich die
// Aufrufzeile wörtlich und fiel um, als der Aufruf einen zweiten Mitfahrer bekam (die
// Zeitmessung) -- obwohl an der Verdrahtung nichts fehlte. Ein Test, der an einer
// Formulierung hängt statt an der Tatsache, meldet Arbeit, wo keine ist.
assert.ok(
	start.includes('runWikiSyncDumpLoop("read_step"') && /runId:\s*fortsetzen/.test(start),
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
