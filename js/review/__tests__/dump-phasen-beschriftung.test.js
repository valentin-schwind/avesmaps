const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Jede Dump-Phase muss eine deutsche Beschriftung haben -- und ihre QUELLE nennen.
//
// 💣 VIER PHASEN HATTEN GAR KEINE und zeigten dem Editor ihren englischen Schluessel:
// "adventures", "citymaps", "lore", "organisations". Der Rueckfall in
// renderWikiSyncDumpProgress ist `WIKI_SYNC_DUMP_PHASE_LABELS[phaseKey] || phaseKey` -- er kann
// also gar nicht auffallen: es steht einfach etwas Falsches da, und zwar in der einzigen Zeile,
// die waehrend eines 40-Minuten-Laufs ueberhaupt etwas ueber den Fortschritt sagt.
//
// ⭐ Deshalb wird die Liste gegen die WAHRHEIT geprueft, nicht gegen sich selbst: die
// Phasenreihenfolge steht in avesmapsWikiDumpHybridPhaseOrder() im PHP. Eine neue Phase dort
// macht diesen Test rot, bevor der Owner ihren Schluessel auf dem Knopf lesen muss.
//
// 🔴 Und jede Phase traegt ihre Quelle (Owner 25.08.2026): "(Wiki: Online)" heisst, sie fragt
// das Wiki und zahlt 20 Sekunden je Anfrage; "(Wiki: Dump)" heisst, sie liest nur die
// heruntergeladene Datei. Ohne die Angabe steht ein Lauf minutenlang auf derselben Zeile, und
// niemand kann sehen, ob das teuer oder kaputt ist.
//
// Lauf vom Repo-Wurzelverzeichnis:  node js/review/__tests__/dump-phasen-beschriftung.test.js

const REVIEW = fs.readFileSync(path.join(__dirname, "..", "review-wiki-sync.js"), "utf8");
const TREIBER = fs.readFileSync(
	path.join(__dirname, "..", "..", "..", "api", "_internal", "wiki", "dump-hybrid-driver.php"),
	"utf8"
);

// --- Die Phasenreihenfolge aus dem PHP, ueber die Konstanten aufgeloest ------
function phasenAusPhp(quelle) {
	const werte = new Map();
	const konstante = /const (AVESMAPS_WIKI_DUMP_PHASE_[A-Z_]+) = '([^']+)';/g;
	let treffer;
	while ((treffer = konstante.exec(quelle)) !== null) {
		werte.set(treffer[1], treffer[2]);
	}
	assert.ok(werte.size > 0, "die Phasenkonstanten muessen im Treiber auffindbar sein");

	const start = quelle.indexOf("function avesmapsWikiDumpHybridPhaseOrder(): array");
	assert.ok(start > 0, "avesmapsWikiDumpHybridPhaseOrder() nicht gefunden");
	const rumpf = quelle.slice(start, quelle.indexOf("\n}", start));

	const reihenfolge = [];
	const benutzt = /AVESMAPS_WIKI_DUMP_PHASE_[A-Z_]+/g;
	while ((treffer = benutzt.exec(rumpf)) !== null) {
		const wert = werte.get(treffer[0]);
		if (wert && !reihenfolge.includes(wert)) {
			reihenfolge.push(wert);
		}
	}
	return reihenfolge;
}

// --- Die Beschriftungsliste aus dem JS --------------------------------------
function beschriftungenAusJs(quelle) {
	const start = quelle.indexOf("const WIKI_SYNC_DUMP_PHASE_LABELS = {");
	assert.ok(start > 0, "WIKI_SYNC_DUMP_PHASE_LABELS nicht gefunden");
	const block = quelle.slice(start, quelle.indexOf("\n};", start));

	const liste = {};
	const zeile = /^\s*([a-z_]+):\s*"([^"]*)",/gm;
	let treffer;
	while ((treffer = zeile.exec(block)) !== null) {
		liste[treffer[1]] = treffer[2];
	}
	return liste;
}

const phasen = phasenAusPhp(TREIBER);
const beschriftungen = beschriftungenAusJs(REVIEW);

assert.ok(phasen.length >= 10, `es muessen alle Arbeitsphasen gefunden werden, waren aber ${phasen.length}`);

// --- (a) keine Phase ohne Beschriftung --------------------------------------
const ohne = phasen.filter((p) => !beschriftungen[p]);
assert.deepStrictEqual(
	ohne,
	[],
	`💣 diese Phasen zeigen dem Editor ihren englischen Schluessel statt eines Namens: ${ohne.join(", ")}`
);

// --- (b) und keine Beschriftung ohne Phase (Leichen) ------------------------
const bekannt = new Set([...phasen, "completed"]);
const verwaist = Object.keys(beschriftungen).filter((k) => !bekannt.has(k));
assert.deepStrictEqual(
	verwaist,
	[],
	`diese Beschriftungen gehoeren zu keiner Phase mehr: ${verwaist.join(", ")}`
);

// --- (c) jede Arbeitsphase nennt ihre Quelle --------------------------------
// 🔴 Ausgenommen ist allein die letzte: "Parsen und schreiben" fragt weder das Wiki noch liest
// sie den Dump -- sie arbeitet mit dem, was die zehn davor gesammelt haben. Eine Quellenangabe
// waere dort eine Behauptung.
const ohneQuelle = phasen
	.filter((p) => p !== "parse_and_upsert")
	.filter((p) => !/\(Wiki: (Online|Dump)\)$/.test(beschriftungen[p]));
assert.deepStrictEqual(
	ohneQuelle,
	[],
	`diesen Phasen fehlt die Quellenangabe "(Wiki: Online)" oder "(Wiki: Dump)": ${ohneQuelle.join(", ")}`
);

// --- (d) die drei teuren Phasen sind als Online gekennzeichnet --------------
// 💣 Namentlich festgenagelt, nicht gezaehlt: WELCHE online geht, entscheidet die Laufzeit
// (20 s je Anfrage). Eine Phase faelschlich als "Dump" zu beschriften, verspraeche dem Owner
// Sekunden und liesse ihn Minuten warten.
for (const online of ["online_class_map", "online_building_map", "online_continent_map"]) {
	assert.ok(
		beschriftungen[online].endsWith("(Wiki: Online)"),
		`${online} fragt das Wiki und muss das auch sagen: "${beschriftungen[online]}"`
	);
}
for (const ausDump of ["wikitext_collect", "redirect_aliases", "publication_sources", "adventures", "citymaps", "lore", "organisations"]) {
	assert.ok(
		beschriftungen[ausDump].endsWith("(Wiki: Dump)"),
		`${ausDump} liest nur die Datei und muss das auch sagen: "${beschriftungen[ausDump]}"`
	);
}

// --- (e) und der Server laesst keine Phase ohne Satz ------------------------
// Die Spalte `message` der Laufzeile ist die zweite Oberflaeche. Sie kann sich mit der Liste
// oben keinen Ort teilen (PHP gegen JS), muss aber genauso vollstaendig sein.
const meldung = TREIBER.slice(
	TREIBER.indexOf("function avesmapsWikiDumpHybridPhaseMessage"),
	TREIBER.indexOf("\n}", TREIBER.indexOf("function avesmapsWikiDumpHybridPhaseMessage"))
);
const ohneSatz = phasen.filter((p) => {
	const konstante = Object.entries({
		online_class_map: "CLASS_MAP",
		online_building_map: "BUILDING_MAP",
		online_continent_map: "CONTINENT_MAP",
		redirect_aliases: "REDIRECT_ALIASES",
		wikitext_collect: "WIKITEXT_COLLECT",
		publication_sources: "PUBLICATION_SOURCES",
		adventures: "GAME_LITERATURE",
		citymaps: "CITYMAPS",
		lore: "LORE",
		organisations: "ORGANISATIONS",
		parse_and_upsert: "PARSE_AND_UPSERT",
	}).find(([schluessel]) => schluessel === p);
	return konstante ? !meldung.includes(`AVESMAPS_WIKI_DUMP_PHASE_${konstante[1]}:`) : false;
});
assert.deepStrictEqual(
	ohneSatz,
	[],
	`avesmapsWikiDumpHybridPhaseMessage faellt bei diesen Phasen auf "Dump-Read laeuft." zurueck: ${ohneSatz.join(", ")}`
);

console.log(`dump-phasen-beschriftung: alle ${phasen.length} Phasen benannt und mit Quelle versehen`);
