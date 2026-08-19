// Die Kachel „Zugehörigkeit rechnen" im Vorkommen-Fenster.
//
// 🔴 Der Schwerpunkt liegt auf der VERDRAHTUNG, nicht auf dem Text: eine getestete Funktion, die
// niemand aufruft, ist grün und wirkungslos -- das ist in diesem Haus schon passiert und wurde von
// sechs Code-Reviews übersehen. Geprüft wird deshalb: steht die Kachel im Menüband, wird das Skript
// geladen, ruft das Fenster den Auffrischer, öffnet der Klick wirklich den Landschaften-Editor --
// und zeigt die Kachel die GEHOLTE Zahl, nicht eine Konstante.
//
// Lauf: node js/review/__tests__/lore-zugehoerigkeit-kachel.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// ---- Ein winziges DOM: nur was das Modul anfasst ------------------------------------------------
function machDokument(ids) {
	const knoten = {};
	Object.keys(ids).forEach((id) => { knoten[id] = { id, textContent: ids[id] }; });
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

function ladeModul(dokument, fenster) {
	const kontext = { window: fenster, document: dokument, console, Promise, Date, isNaN, String, Number };
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(fs.readFileSync("js/review/review-lore-zugehoerigkeit.js", "utf8"), kontext);
	return kontext;
}

// ---- 1. Der Text der unteren Zeile (rein) ------------------------------------------------------
const leer = machDokument({});
const k = ladeModul(leer.dokument, {});
const text = k.avesmapsLoreZugehoerigkeitText;

assert.strictEqual(text(undefined), "wird geprüft …", "noch nicht gefragt");
// 💣 `null` (Abruf gescheitert) und `undefined` (noch nicht gefragt) sind NICHT dasselbe. Ein
// Fehlschlag schweigt -- eine Kachel, die nach einem 401 „noch nie gerechnet" behauptet, schickt
// jemanden einen Lauf über 929 Regionen starten, den es gar nicht braucht.
assert.strictEqual(text(null), "", "gescheiterter Abruf behauptet nichts");
assert.strictEqual(text({ stamp: null }), "noch nie gerechnet");
assert.strictEqual(text({ stamp: { completed: false } }), "wird gerade gerechnet …");
assert.strictEqual(
	text({ stamp: { completed: true, computed_at: "2026-08-19 04:12:33.123" } }),
	"zuletzt 19.08.2026, 04:12",
	"der Zeitpunkt beruhigt, solange nichts offen ist -- Wortlaut aus dem Brief"
);

// ---- 2. Verdrahtung: die Kachel steht im Menüband des Vorkommen-Fensters ------------------------
const seite = fs.readFileSync("index.html", "utf8");
const bandStart = seite.indexOf('<div class="lore-ribbon" id="lore-ribbon">');
assert.ok(bandStart > -1, "das Menüband #lore-ribbon steht nicht mehr in index.html");
const bandEnde = seite.indexOf("</div>", bandStart);
const band = seite.slice(bandStart, bandEnde);
assert.ok(band.includes('id="lore-zugehoerigkeit"'),
	"die Kachel steht nicht IM Menüband -- daneben findet sie niemand");
assert.ok(band.includes('id="lore-zugehoerigkeit-sub"'),
	"ohne .t2 hat die Kachel keinen Platz für ihren Zustand (Hausform: Status IN den Knopf)");
// ⚠️ §12: die Haupthandlung dieses Fensters ist „Vorkommen syncen". Diese Kachel ist weich.
const kachelMarkup = band.slice(band.indexOf('id="lore-zugehoerigkeit"') - 200, band.indexOf('id="lore-zugehoerigkeit-sub"'));
assert.ok(!kachelMarkup.includes("lore-btn2--primary"),
	"die Kachel darf nicht gefüllt sein -- sie ist nicht die Haupthandlung des Fensters");
assert.ok(seite.includes('<script src="js/review/review-lore-zugehoerigkeit.js"></script>'),
	"das Skript wird nicht geladen -- die Kachel wäre ein Knopf ohne Wirkung");

// ---- 3. Verdrahtung: das Fenster frischt die Kachel beim Öffnen auf ------------------------------
const zeilenTrenner = new RegExp(String.fromCharCode(13) + "?" + String.fromCharCode(10));
const wikiSync = fs.readFileSync("js/review/review-wiki-sync.js", "utf8");
// 🪤 Kommentare heraus, sonst genuegt der blosse NAME: eine Mutation, die nur die Aufrufzeile
// entfernt und den erklaerenden Kommentar stehen laesst, blieb damit gruen (gemessen 19.08.2026).
// Geprueft wird der AUFRUF.
const wikiSyncCode = wikiSync.split(zeilenTrenner)
	.filter((zeile) => !zeile.trim().startsWith("//"))
	.join(" ");
assert.ok(wikiSyncCode.includes("window.avesmapsLoreZugehoerigkeitRefresh()"),
	"setWikiSyncLoreDialogOpen ruft den Auffrischer nicht -- die Kachel bliebe auf ihrem Anfangstext.");

// ---- 4. 🔴 Die Kachel rechnet NICHTS ------------------------------------------------------------
// Der Lauf gehört dem Landschaften-Editor. Ein zweiter Erzeuger derselben Zeilen wäre die zweite
// Wahrheit aus AGENTS.md §5 -- und auf STRATO die Last des Vorfalls vom 17.07.2026.
const modulQuelle = fs.readFileSync("js/review/review-lore-zugehoerigkeit.js", "utf8");
// ⚠️ Kommentare heraus, bevor gesucht wird: die Datei NENNT computeRaycast (sie sagt, wem der Lauf
// gehört) und soll das auch. Verboten ist der AUFRUF, nicht der Verweis -- ein Test auf den blossen
// Namen verbietet ausgerechnet die Zeile, die den Leser an die richtige Stelle schickt.
const modulCode = modulQuelle.split(zeilenTrenner)
	.filter((zeile) => !zeile.trim().startsWith("//"))
	.join(" ");
["path_ecosystem_begin", "path_ecosystem_chunk", "path_ecosystem_commit", "computeRaycast", "ecosystemBooleanGeometry"]
	.forEach((verboten) => {
		assert.ok(!modulCode.includes(verboten),
			"Die Kachel ruft " + verboten + " -- sie soll den Lauf OEFFNEN, nicht fuehren.");
	});

// ---- 5. 🔴 DIE VERDRAHTUNGSZUSICHERUNG: zeigt sie die GEHOLTE Zahl? ------------------------------
// Ohne diesen Fall wäre eine Kachel grün, die ihre untere Zeile fest verdrahtet hat.
const zwei = machDokument({ "lore-zugehoerigkeit-sub": "" });
const fenster = {};
const k2 = ladeModul(zwei.dokument, fenster);

let geliefert = { stamp: { completed: true, computed_at: "2026-08-19 04:12:00.000" } };
let abrufe = 0;
fenster.avesmapsLoreRuleLoadAssignmentStamp = () => { abrufe++; return Promise.resolve(geliefert); };

k2.avesmapsLoreZugehoerigkeitRefresh().then(() => {
	assert.strictEqual(abrufe, 1, "der Auffrischer nutzt den vorhandenen Leser des Regeleditors");
	assert.strictEqual(zwei.knoten["lore-zugehoerigkeit-sub"].textContent, "zuletzt 19.08.2026, 04:12");

	// Ein ANDERER Stand muss eine ANDERE Zeile ergeben -- das ist der Unterschied zwischen
	// „zeigt die Antwort" und „zeigt einen festen Text, der zufällig passt".
	geliefert = { stamp: { completed: true, computed_at: "2026-07-01 09:05:00.000" } };
	return k2.avesmapsLoreZugehoerigkeitRefresh();
}).then(() => {
	assert.strictEqual(zwei.knoten["lore-zugehoerigkeit-sub"].textContent, "zuletzt 01.07.2026, 09:05",
		"die Kachel zeigt die GEHOLTE Zeit, keine Konstante");

	// ---- 6. Der Klick öffnet den Landschaften-Editor, und nichts sonst -------------------------
	let geoeffnet = 0;
	fenster.openAvesmapsEcosystemEditorOverlay = () => { geoeffnet++; };
	assert.strictEqual(k2.avesmapsLoreZugehoerigkeitOeffnen(), true);
	assert.strictEqual(geoeffnet, 1, "der Klick ruft den vorhandenen Öffner des Landschaften-Editors");

	// 💣 Fehlt der Öffner, sagt die Kachel es -- ein Knopf, der ohne Zeichen nichts tut, ist
	// schlimmer als keiner.
	delete fenster.openAvesmapsEcosystemEditorOverlay;
	let gemeldet = "";
	fenster.setLoreDialogStatus = (text) => { gemeldet = text; };
	assert.strictEqual(k2.avesmapsLoreZugehoerigkeitOeffnen(), false);
	assert.ok(gemeldet.includes("Landschaften-Editor"), "der Fehlschlag wird gemeldet, nicht verschluckt");

	// Und der Klick hängt wirklich an einem Zuhörer, nicht nur an einer exportierten Funktion.
	const klick = zwei.zuhoerer.find((z) => z.typ === "click");
	assert.ok(klick, "das Modul hängt keinen Klick-Zuhörer an -- die Kachel wäre tot");

	console.log("lore-zugehoerigkeit-kachel: OK");
}).catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});
