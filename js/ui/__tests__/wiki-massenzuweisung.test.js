// Der Massenlauf der Wiki-Zuweisung -- die Abfolge, nicht die Beschriftung.
//
// ⚠️ Geprueft wird VERHALTEN: welche Anfragen der Lauf stellt, in welcher Reihenfolge, und was er
// bei 0 Treffern, bei einem Nein und bei einem Fehlschlag NICHT tut. Eine Textprobe, die die FORM
// des Codes misst, waere hier wertlos -- der Schaden dieser Bauform ist ein Schreibvorgang, der
// stattfindet, obwohl niemand zugestimmt hat.

const assert = require("assert");
const {
	AVESMAPS_WIKI_MASSENLAUF,
	avesmapsWikiMassenlaufVorschauKoerper,
	avesmapsWikiMassenlaufSchreibKoerper,
	avesmapsWikiMassenlaufKurztext,
	avesmapsWikiMassenlaufFrage,
	avesmapsWikiMassenlauf,
} = require("../wiki-massenzuweisung.js");

// Ein Server, der jede Anfrage mitschreibt. `antworten` wird der Reihe nach abgearbeitet.
function server(antworten) {
	const rufe = [];
	return {
		rufe,
		post: function (url, koerper) {
			rufe.push({ url: url, koerper: koerper });
			const naechste = antworten[rufe.length - 1];
			if (naechste === undefined) {
				throw new Error("Unerwartete " + rufe.length + ". Anfrage: " + JSON.stringify(koerper));
			}
			return Promise.resolve(naechste);
		},
	};
}

const WEG_VORSCHAU = { ok: true, dry_run: true, segments_affected: 412, wiki_paths_linked: 97, applied: 0 };
const WEG_SCHARF = { ok: true, dry_run: false, segments_affected: 412, wiki_paths_linked: 97, applied: 412 };
const LAND_VORSCHAU = { ok: true, dry_run: true, art_filter: "", labels_affected: 63, regions_linked: 63, applied: 0 };
const LAND_SCHARF = { ok: true, dry_run: false, art_filter: "", labels_affected: 63, regions_linked: 63, applied: 63 };

(async function () {

// ── 1) ERST ZEIGEN, DANN SCHREIBEN -- und der Trockenlauf ist die ERSTE Anfrage ───────────────
// 💣 Der Server schreibt NUR bei `dry_run:false` UND `confirm:"apply"`. Traegt schon die erste
// Anfrage eines von beidem, ist die "Vorschau" in Wahrheit der scharfe Lauf gewesen.
{
	const s = server([WEG_VORSCHAU, WEG_SCHARF]);
	const gefragt = [];
	const schritte = [];
	const beiFrage = [];
	const lauf = await avesmapsWikiMassenlauf("weg", {
		post: s.post,
		frage: function (text) { gefragt.push(text); beiFrage.push(schritte.slice()); return true; },
		melde: function (schritt) { schritte.push(schritt); },
	});

	// 💣 „vorschau" MUSS vor der Rueckfrage gemeldet sein: `window.confirm` blockiert, und die
	// gemessene Zahl gehoert in die Kachel, BEVOR der Dialog davorsteht -- wer ihn wegklickt, soll
	// den Stand sehen und nicht „wird geprüft …".
	assert.deepStrictEqual(schritte, ["pruefen", "vorschau", "schreiben", "geschrieben"]);
	assert.deepStrictEqual(beiFrage[0], ["pruefen", "vorschau"], "beim Fragen war die Vorschau noch nicht gemeldet");

	assert.strictEqual(s.rufe.length, 2, "ein Massenlauf stellt GENAU zwei Anfragen");
	assert.strictEqual(s.rufe[0].koerper.dry_run, undefined, "die Vorschau darf kein dry_run mitschicken");
	assert.strictEqual(s.rufe[0].koerper.confirm, undefined, "die Vorschau darf kein confirm mitschicken");
	assert.strictEqual(s.rufe[1].koerper.dry_run, false);
	assert.strictEqual(s.rufe[1].koerper.confirm, "apply");
	assert.strictEqual(gefragt.length, 1, "genau einmal gefragt");
	assert.strictEqual(lauf.zustand, "geschrieben");
	assert.strictEqual(lauf.geschrieben, 412);
	// Die Reihenfolge selbst: gefragt wird NACH der Vorschau und VOR dem Schreiben.
	assert.ok(gefragt[0].indexOf("412") !== -1, "die Rueckfrage nennt die gemessene Zahl: " + gefragt[0]);
	assert.ok(gefragt[0].indexOf("97") !== -1, "die Rueckfrage nennt die Zahl der Wiki-Wege: " + gefragt[0]);
}

// ── 2) EIN NEIN SCHREIBT NICHT ────────────────────────────────────────────────────────────────
{
	const s = server([WEG_VORSCHAU]);
	const lauf = await avesmapsWikiMassenlauf("weg", { post: s.post, frage: function () { return false; } });
	assert.strictEqual(s.rufe.length, 1, "nach einem Nein darf keine zweite Anfrage folgen");
	assert.strictEqual(lauf.zustand, "abgebrochen");
	assert.strictEqual(lauf.geschrieben, 0);
	// Die gemessene Zahl bleibt trotzdem erhalten -- die Kachel soll sie anzeigen duerfen.
	assert.strictEqual(lauf.zahl, 412);
}

// ── 3) NULL TREFFER FRAGT GAR NICHT ERST ──────────────────────────────────────────────────────
// ⚠️ Sonst stuende eine Rueckfrage „0 Abschnitte verknuepfen?" im Bild, die nichts entscheidet.
{
	const s = server([{ ok: true, dry_run: true, segments_affected: 0, wiki_paths_linked: 0, applied: 0 }]);
	let gefragt = false;
	const lauf = await avesmapsWikiMassenlauf("weg", { post: s.post, frage: function () { gefragt = true; return true; } });
	assert.strictEqual(s.rufe.length, 1);
	assert.strictEqual(gefragt, false, "bei 0 Treffern wird nicht gefragt");
	assert.strictEqual(lauf.zustand, "leer");
}

// ── 4) EIN FEHLSCHLAG DER VORSCHAU SCHREIBT NICHT ─────────────────────────────────────────────
// 🔴 Ein stilles Auflösen hiesse fuer die Kachel „hat geklappt".
{
	const s = server([{ ok: false, error: { code: "forbidden", message: "Keine Berechtigung." } }]);
	let gefragt = false;
	await assert.rejects(
		avesmapsWikiMassenlauf("weg", { post: s.post, frage: function () { gefragt = true; return true; } }),
		/Keine Berechtigung\./
	);
	assert.strictEqual(s.rufe.length, 1);
	assert.strictEqual(gefragt, false, "nach einem Fehlschlag der Vorschau wird nicht gefragt");
}

// ── 5) DER SCHARFE LAUF WIRD ZURUECKGELESEN ───────────────────────────────────────────────────
// 💣 Kommt er als Trockenlauf zurueck, wurde NICHTS geschrieben -- und ohne diese Probe meldete der
// Knopf trotzdem Erfolg. Genau die Fehlerklasse aus AGENTS.md §10 („ein Schreiber, dessen Wert
// zaehlt, liest ihn zurueck").
{
	const s = server([WEG_VORSCHAU, { ok: true, dry_run: true, segments_affected: 412, applied: 0 }]);
	await assert.rejects(
		avesmapsWikiMassenlauf("weg", { post: s.post, frage: function () { return true; } }),
		/nur eine Vorschau/
	);
	assert.strictEqual(s.rufe.length, 2);
}

// ── 6) DIE LANDSCHAFTEN LAUFEN OHNE ART-EINSCHRAENKUNG ────────────────────────────────────────
// 🔴 Der einzige Aufrufer, den es je gab, stand fest auf `art:"Berggipfel"` -- Heide, Huegelland,
// Wald und Insel wurden damit nie zugewiesen. Gemessen am Ursprungs-Commit war das der Umfang jener
// einen Wanderung, kein Schutz: gegen falsche Paarungen steht `avesmapsWikiRegionTypeConflict` auf
// dem Server, und die laeuft unabhaengig vom Art-Filter. Wer die Einschraenkung zurueckholt,
// braucht einen neuen Entscheid.
{
	const s = server([LAND_VORSCHAU, LAND_SCHARF]);
	const lauf = await avesmapsWikiMassenlauf("landschaft", { post: s.post, frage: function () { return true; } });
	assert.ok(!("art" in s.rufe[0].koerper), "die Vorschau darf sich nicht auf eine Art verengen");
	assert.ok(!("art" in s.rufe[1].koerper), "der scharfe Lauf darf sich nicht auf eine Art verengen");
	assert.strictEqual(lauf.geschrieben, 63);
}

// ── 7) BEIDE OBERFLAECHEN FRAGEN DENSELBEN ENDPUNKT WIE IHRE EINZELZUWEISUNG ──────────────────
assert.strictEqual(avesmapsWikiMassenlaufVorschauKoerper("weg").action, "assign_all");
assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.weg.url, "/api/edit/wiki/paths.php");
assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.landschaft.url, "/api/edit/wiki/regions.php");
// Der Kontinent ist bei beiden gesetzt und derselbe -- die Karte IST Aventurien.
assert.strictEqual(avesmapsWikiMassenlaufVorschauKoerper("weg").continent, "Aventurien");
assert.strictEqual(avesmapsWikiMassenlaufVorschauKoerper("landschaft").continent, "Aventurien");

// Der Rumpf ist eine KOPIE, kein geteiltes Objekt: der scharfe Lauf darf die Rezeptur nicht
// dauerhaft auf `dry_run:false` stellen, sonst waere die naechste "Vorschau" ein Schreibvorgang.
avesmapsWikiMassenlaufSchreibKoerper("weg");
assert.strictEqual(avesmapsWikiMassenlaufVorschauKoerper("weg").dry_run, undefined,
	"der Schreib-Rumpf hat die Rezeptur veraendert");

// ── 8) DIE ZEILE IM KNOPF NENNT BEIDE ZAHLEN -- UND PASST IN DIE KACHEL ───────────────────────
assert.strictEqual(avesmapsWikiMassenlaufKurztext("weg", WEG_VORSCHAU), "412 Abschnitte · 97 Wege");
assert.strictEqual(avesmapsWikiMassenlaufKurztext("weg", { ok: true, segments_affected: 1, wiki_paths_linked: 1 }),
	"1 Abschnitt · 1 Weg");
assert.strictEqual(avesmapsWikiMassenlaufKurztext("landschaft", LAND_VORSCHAU), "63 Label · 63 Landschaften");
assert.strictEqual(avesmapsWikiMassenlaufKurztext("weg", { ok: true, segments_affected: 0 }), "nichts offen");

// 💣 DIE LAENGE IST EINE ZUSICHERUNG, KEIN GESCHMACK. Die Zeile steht in einer Menuebandkachel; mit
// der sechsten Kachel bleiben bei voller Fensterbreite (--avm-editor-w = min(1400px, …), Polsterung
// --avm-ribbon-pad = 10/14, Luecke --avm-ribbon-gap = 6, Kachelpolsterung 10 + 1px Rahmen je Seite)
// rund 202 px Text -- bei --font-size-caption (11px) etwa 34 Zeichen. Darueber kuerzt `.t2` mit
// Ellipse, und weg ist ausgerechnet die ZWEITE Zahl. Vierstellige Zahlen sind der reale Fall:
// der Wege-Lauf zaehlt jedes namensgleiche Wegstueck mit.
const KACHEL_ZEICHEN = 34;
[
	avesmapsWikiMassenlaufKurztext("weg", { ok: true, segments_affected: 4127, wiki_paths_linked: 1038 }),
	avesmapsWikiMassenlaufKurztext("landschaft", { ok: true, labels_affected: 1616, regions_linked: 1584 }),
].forEach((zeile) => {
	assert.ok(zeile.length <= KACHEL_ZEICHEN,
		"die Kachelzeile ist zu lang und wird in der Ellipse enden (" + zeile.length + " > " + KACHEL_ZEICHEN + "): " + zeile);
});

// ── 9) DIE RUECKFRAGE SAGT, WAS MIT DEM SCHON ZUGEWIESENEN GESCHIEHT ──────────────────────────
// 🔴 Gemessen am Server, nicht vermutet -- und die beiden Antworten sind VERSCHIEDEN:
//   · avesmapsWikiPathAssignAll setzt `properties.wiki_path` unbesehen und zaehlt JEDES
//     namensgleiche Wegstueck mit, auch ein bereits verknuepftes.
//   · avesmapsWikiRegionAssignAll ueberspringt ein Label, das schon am SELBEN wiki_key haengt, und
//     zaehlt es nicht mit; ein abweichendes ueberschreibt es.
// Zwei Knoepfe mit derselben Beschriftung duerfen dieselbe Zahl nicht verschieden meinen, ohne dass
// es dasteht -- also steht es da, und diese Probe haelt es fest.
{
	const wegFrage = avesmapsWikiMassenlaufFrage("weg", WEG_VORSCHAU);
	assert.ok(/mitgezählt/.test(wegFrage), "die Wege-Rueckfrage verschweigt die bereits verknuepften: " + wegFrage);
	assert.ok(/überschrieben/.test(wegFrage), "die Wege-Rueckfrage verschweigt das Ueberschreiben: " + wegFrage);

	const landFrage = avesmapsWikiMassenlaufFrage("landschaft", LAND_VORSCHAU);
	assert.ok(/NICHT\s+mitgezählt/.test(landFrage), "die Landschafts-Rueckfrage verschweigt, dass Verbundene aussen vor bleiben: " + landFrage);
	assert.ok(/überschrieben/.test(landFrage), "die Landschafts-Rueckfrage verschweigt das Ueberschreiben: " + landFrage);

	// 🔴 UND BEIDE NENNEN DEN MERKER. Gemessen: weder `avesmapsWikiPathAssignAll` noch
	// `avesmapsWikiRegionAssignAll` ueberspringt ein Objekt mit `properties.wiki_no_article` -- beide
	// loeschen den Merker beim Schreiben (erzwungen von label-wiki-no-article-test.php und
	// weg-wiki-no-article-test.php). Seit dem 16.08.2026 setzt ihn nur noch das Konfliktzentrum,
	// also ist er eine ENTSCHEIDUNG eines Editors, und ein Massenlauf raeumt sie ab. Solange das so
	// ist, muss es wenigstens DASTEHEN.
	assert.ok(/kein Wiki-Artikel/.test(wegFrage), "die Wege-Rueckfrage verschweigt den Merker: " + wegFrage);
	assert.ok(/kein Wiki-Artikel/.test(landFrage), "die Landschafts-Rueckfrage verschweigt den Merker: " + landFrage);
}

// ── 10) EINE UNBEKANNTE ART SCHEITERT GESCHLOSSEN ─────────────────────────────────────────────
assert.throws(() => avesmapsWikiMassenlaufVorschauKoerper("ort"), /Unbekannte Massenlauf-Art/);
await assert.rejects(
	avesmapsWikiMassenlauf("weg", { post: null, frage: null }),
	/ohne Umgebung/
);

console.log("wiki-massenzuweisung.test.js: alle Zusicherungen gruen");

})().catch((error) => {
	console.error(error);
	process.exit(1);
});
