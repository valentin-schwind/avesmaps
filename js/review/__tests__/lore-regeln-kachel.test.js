// Die Kachel „Regeln ableiten" im Vorkommen-Fenster.
//
// 🔴 Der Schwerpunkt liegt auf der VERDRAHTUNG, nicht auf dem Text: eine getestete Funktion, die
// niemand aufruft, ist grün und wirkungslos -- das ist in diesem Haus schon passiert und wurde von
// sechs Code-Reviews übersehen. Geprüft wird deshalb: steht die Kachel im Menüband, wird das Skript
// geladen, ruft das Fenster den Auffrischer, kennt die Vorschau die neue Art -- und sagt die Kachel
// die Wahrheit über einen gescheiterten Abruf.
//
// Lauf: node js/review/__tests__/lore-regeln-kachel.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

function machDokument(ids) {
	const knoten = {};
	Object.keys(ids).forEach((id) => { knoten[id] = { id, textContent: ids[id], title: "" }; });
	const zuhoerer = [];

	return {
		knoten,
		zuhoerer,
		dokument: {
			getElementById: (id) => knoten[id] || null,
			addEventListener: (typ, fn) => zuhoerer.push({ typ, fn }),
		},
	};
}

function ladeModul(dokument, fenster, extra = {}) {
	const kontext = Object.assign(
		{ window: fenster, document: dokument, console, Promise, Date, isNaN, String, Number, fetch: () => Promise.reject(new Error("kein Netz")) },
		extra
	);
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(fs.readFileSync("js/review/review-lore-regeln.js", "utf8"), kontext);

	return kontext;
}

// ---- 1. Die untere Zeile (rein) ---------------------------------------------------------------
const leer = machDokument({});
const k = ladeModul(leer.dokument, {});
const text = k.avesmapsLoreRegelnText;

assert.strictEqual(text(undefined, -1), "wird geprüft …", "noch nicht gefragt");
// 💣 `null` (Abruf gescheitert) und `undefined` (noch nicht gefragt) sind NICHT dasselbe. Eine
// Kachel, die nach einem 401 „noch nicht gerechnet" behauptet, schickt jemanden einen Lauf starten,
// dessen Ergebnis längst dasteht -- oder verschweigt, dass sie gar nichts weiß.
assert.strictEqual(text(null, -1), "", "gescheiterter Abruf behauptet nichts");
assert.strictEqual(text({ run: null }, -1), "noch nicht gerechnet");
assert.strictEqual(text({ run: { counts: { total: 0 } } }, -1), "keine Unterschiede");
assert.strictEqual(text({ run: { counts: { total: 1 } } }, -1), "1 Vorschlag offen");
assert.strictEqual(text({ run: { counts: { total: 417 } } }, -1), "417 Vorschläge offen");

// 🔴 `-1` heißt UNBEKANNT und darf nie als „alles gerechnet" gelesen werden -- aber auch nie als
// Warnung: eine erfundene Warnung ist so schlecht wie eine verschluckte.
assert.strictEqual(text({ run: null }, -1), "noch nicht gerechnet", "unbekannt warnt nicht");
assert.strictEqual(text({ run: null }, 0), "noch nicht gerechnet", "null offene Flächen warnen nicht");
assert.strictEqual(text({ run: null }, 3), "noch nicht gerechnet · 3 ungerechnet");
assert.strictEqual(text({ run: null }, 1), "noch nicht gerechnet · 1 ungerechnet", "Einzahl");
assert.strictEqual(
	text({ run: { counts: { total: 12 } } }, 2),
	"12 Vorschläge offen · 2 ungerechnet",
	"beides steht nebeneinander -- der Vorschlag zuerst, die Warnung dahinter"
);

// ⚠️ Der ungerechnete Bestand BLOCKIERT nicht, er wird gesagt. Der lange Satz steht im title, weil
// `.t2` in einer siebenspurigen Kachelreihe ellipsiert.
assert.ok(!k.avesmapsLoreRegelnTitel(-1).includes("noch nicht gerechnet"));
assert.ok(k.avesmapsLoreRegelnTitel(3).includes("3 Flächen ist noch nicht gerechnet".slice(2)),
	"der title nennt die Zahl");
assert.ok(k.avesmapsLoreRegelnTitel(0).includes("Schreibt NICHTS"),
	"und sagt immer, dass der Knopf von selbst nichts schreibt");

// ---- 2. Die Kachel liest den Zähler der NACHBARkachel ------------------------------------------
// ⭐ Eine zweite Abfrage derselben Frage wäre die Stelle, an der die zwei Anzeigen irgendwann
// Verschiedenes sagen. Gelesen wird über `window`, nicht direkt: die Ladereihenfolge ist ein Vertrag.
const dom = machDokument({ "lore-regeln-sub": "", "lore-regeln-ableiten": "" });
const fenster = { avesmapsLoreZugehoerigkeitOffeneFlaechen: () => 4 };
const k2 = ladeModul(dom.dokument, fenster);
k2.avesmapsLoreRegelnStand = undefined;
k2.avesmapsLoreRegelnPaint();
assert.strictEqual(dom.knoten["lore-regeln-sub"].textContent, "wird geprüft …");
assert.ok(dom.knoten["lore-regeln-ableiten"].title.includes("4 Fläche"),
	"die Zahl der Nachbarkachel steht im title");

// Fehlt die Nachbarkachel ganz, wird nicht geraten -- keine Warnung, kein Absturz.
const dom3 = machDokument({ "lore-regeln-sub": "", "lore-regeln-ableiten": "" });
const k3 = ladeModul(dom3.dokument, {});
k3.avesmapsLoreRegelnPaint();
assert.ok(!dom3.knoten["lore-regeln-ableiten"].title.includes("ungerechnet"));

// ---- 3. Ein gescheiterter Abruf setzt `null`, nie `{}` -----------------------------------------
// 💣 Dieselbe Regel wie beim Vertrag der Wiki-Zuweisung: ein leerer Zustand darf nie für eine
// Aussage gehalten werden. `{}` läse sich als „es gibt keinen Plan".
const dom4 = machDokument({ "lore-regeln-sub": "", "lore-regeln-ableiten": "" });
const k4 = ladeModul(dom4.dokument, {}, { fetch: () => Promise.reject(new Error("offline")) });
k4.avesmapsLoreRegelnRefresh().then((stand) => {
	assert.strictEqual(stand, null, "gescheiterter Abruf => null");
	assert.strictEqual(dom4.knoten["lore-regeln-sub"].textContent, "", "und die Kachel schweigt");

	// Auch eine Antwort ohne ok:true ist ein Fehlschlag, kein leerer Plan.
	const dom5 = machDokument({ "lore-regeln-sub": "", "lore-regeln-ableiten": "" });
	const k5 = ladeModul(dom5.dokument, {}, {
		fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false, error: { code: "unauthenticated" } }) }),
	});

	return k5.avesmapsLoreRegelnRefresh().then((s) => {
		assert.strictEqual(s, null, "ok:false => null, nicht „kein Plan\"");
	});
}).then(() => {
	console.log("lore-regeln-kachel ok");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});

// ---- 4. Die VERDRAHTUNG ------------------------------------------------------------------------
const seite = fs.readFileSync("index.html", "utf8");
assert.ok(seite.includes('<script src="js/review/review-lore-regeln.js"></script>'),
	"index.html lädt das Modul -- sonst ist die Kachel ein toter Knopf");
assert.ok(seite.includes('id="lore-regeln-ableiten"'), "die Kachel steht im Markup");
assert.ok(seite.includes('id="lore-regeln-sub"'), "und ihre Statuszeile");
// 🔴 Sie steht im Menüband der VORKOMMEN, neben „Zugehörigkeit rechnen" (Owner-Platzierung).
const bandStart = seite.indexOf('id="lore-ribbon"');
const bandEnde = seite.indexOf("</div>", bandStart);
const band = seite.slice(bandStart, bandEnde);
assert.ok(band.includes('id="lore-regeln-ableiten"'), "die Kachel steht IM Menüband");
assert.ok(band.includes('id="lore-zugehoerigkeit"'), "und zwar neben der Nachbarkachel");
// ⚠️ Weich/outline, nie gefüllt: die Haupthandlung dieses Fensters bleibt „Vorkommen syncen".
// Eine Zeilen- oder Nebenhandlung als Akzentknopf ist genau der Fehler aus AGENTS.md §12.
const kachel = band.slice(band.indexOf('id="lore-regeln-ableiten"') - 200, band.indexOf('id="lore-regeln-ableiten"') + 200);
assert.ok(!kachel.includes("lore-btn2--primary"), "weich/outline, nicht gefüllt");

const wikiSync = fs.readFileSync("js/review/review-wiki-sync.js", "utf8");
assert.ok(wikiSync.includes("window.avesmapsLoreRegelnRefresh()"),
	"das Fenster frischt die Kachel beim Öffnen auf -- sonst steht dort für immer „wird geprüft …\"");

// Die Vorschau kennt die neue Art -- sonst öffnet sich ein Blatt ohne Titel und mit der strengsten
// Löschwarnung, die es hat (syncPlanKindMeta rät bei Unbekanntem).
const blatt = fs.readFileSync("js/review/sync-plan-sheet.js", "utf8");
["SYNC_PLAN_KIND_NOUNS", "SYNC_PLAN_KIND_TITLES", "SYNC_PLAN_KIND_EMPTY_HINT"].forEach((liste) => {
	const ab = blatt.indexOf("const " + liste);
	assert.ok(ab > 0, liste + " existiert");
	assert.ok(blatt.slice(ab, blatt.indexOf("};", ab)).includes("lore_rule:"), liste + " kennt lore_rule");
});
assert.ok(blatt.includes('SYNC_PLAN_NOTE_FIELDS = ["boundary_note", "regel_hinweis"]'),
	"der Hinweis auf weggelassene Angaben ist ein NOTIZfeld -- „— → 3\" erklärt bei einem Verlust nichts");
assert.ok(blatt.includes('"regel_kern"'),
	"und der Vergleichskern ist STILL: er ist die Frist-Prüfung, keine zweite Fassung der Zeile");

// Der Endpunkt nimmt die Art an und hat einen Ausführ-Arm -- ohne beides ist der Knopf ein 400
// bzw. ein 500 nach dem ersten Häkchen.
const endpunkt = fs.readFileSync("api/edit/wiki/sync-plan.php", "utf8");
assert.ok(/AVESMAPS_SYNC_PLAN_KINDS = \[[^\]]*'lore_rule'/.test(endpunkt), "der Endpunkt kennt die Art");
assert.ok(endpunkt.includes("'lore_rule' => avesmapsLoreRuleApplyStep("), "und hat ihren Ausführ-Arm");

// Und der Rechen-Knopf spricht die Aktion an, die dump.php wirklich beantwortet.
const modul = fs.readFileSync("js/review/review-lore-regeln.js", "utf8");
assert.ok(modul.includes('submitWikiSyncDumpAction("derive_lore_rules"'), "die Kachel ruft die Aktion");
assert.ok(fs.readFileSync("api/edit/wiki/dump.php", "utf8").includes("case 'derive_lore_rules':"),
	"und dump.php hat sie");
