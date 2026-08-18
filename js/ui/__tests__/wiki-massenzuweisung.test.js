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

// ── 9b) DIE KARTE: DIE DRITTE ART, UND SIE VERSPRICHT DAS GEGENTEIL DER ZWEI ANDEREN ─────────
//
// 🔴 Sie ERGAENZT nur. Die zwei Nachbarn ueberschreiben (der Weg sogar bereits Verknuepftes), und
// genau deshalb darf ihre Rueckfrage nicht abgeschrieben werden: derselbe Satz an einem Knopf, der
// etwas anderes tut, ist schlimmer als gar keiner.
{
	const KARTE_VORSCHAU = {
		ok: true, dry_run: true, total: 529, citymaps_affected: 363, articles_linked: 140,
		applied: 0, skipped: { already_assigned: 0, no_article_flag: 0, no_publication: 166 },
		key_mismatch: { total: 22, unexplained: 0 },
	};

	// Die Zahlen kommen aus den Feldern, die avesmapsCitymapAssignPublicationArticles wirklich liefert.
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.karte.zahl(KARTE_VORSCHAU), 363);
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.karte.wikiZahl(KARTE_VORSCHAU), 140);
	// ⚠️ Und ein leerer Lauf faellt auf 0, nicht auf NaN -- der Kasten sagt dann „nichts offen".
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.karte.zahl({ ok: true }), 0);
	assert.strictEqual(avesmapsWikiMassenlaufKurztext("karte", { ok: true }), "nichts offen");

	// 🔴 DIE ADRESSE IST DER KARTEN-SCHREIBENDPUNKT, nicht der NUR-GET-Registryleser.
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.karte.url, "/api/edit/map/citymaps.php");
	assert.notStrictEqual(AVESMAPS_WIKI_MASSENLAUF.karte.url, "/api/edit/wiki/citymaps.php");

	// Die Vorschau schickt WEDER `dry_run` NOCH `confirm` -- die Vorgabe des Servers ist der
	// Trockenlauf, und ein `dry_run:true` hier waere eine zweite Wahrheit.
	const vorschauKoerper = avesmapsWikiMassenlaufVorschauKoerper("karte");
	assert.strictEqual(vorschauKoerper.action, "assign_publication_articles");
	assert.ok(!("dry_run" in vorschauKoerper), "die Karten-Vorschau schickt dry_run mit");
	assert.ok(!("confirm" in vorschauKoerper), "die Karten-Vorschau schickt confirm mit");
	// Der scharfe Lauf braucht BEIDE Haelften -- eine allein bleibt stillschweigend eine Vorschau.
	const schreibKoerper = avesmapsWikiMassenlaufSchreibKoerper("karte");
	assert.strictEqual(schreibKoerper.dry_run, false);
	assert.strictEqual(schreibKoerper.confirm, "apply");

	const karteFrage = avesmapsWikiMassenlaufFrage("karte", KARTE_VORSCHAU);
	// 💣 SIE MUSS SAGEN, DASS DIE PUBLIKATION ZUGEWIESEN WIRD, nicht ein eigener Artikel der Karte.
	// Genau diese Verwechslung hat den ganzen Strang gekostet (Owner 17.08.2026).
	assert.ok(/PUBLIKATION/.test(karteFrage), "die Karten-Rueckfrage sagt nicht, dass es die Publikation ist: " + karteFrage);
	assert.ok(/nicht ein eigener Artikel/.test(karteFrage), "die Karten-Rueckfrage grenzt den eigenen Artikel nicht ab: " + karteFrage);
	// 🔴 UND SIE MUSS DAS GEGENTEIL DER NACHBARN VERSPRECHEN: ergaenzen, nicht ersetzen.
	assert.ok(/ERGÄNZT/.test(karteFrage), "die Karten-Rueckfrage sagt nicht, dass sie nur ergaenzt: " + karteFrage);
	assert.ok(/unberührt/.test(karteFrage), "die Karten-Rueckfrage verschweigt, was unberuehrt bleibt: " + karteFrage);
	// 💣 Und sie muss das Ueberschreiben AUSSCHLIESSEN, statt es wie die Nachbarn anzukuendigen.
	// ⚠️ Ein blosses `!/überschrieben/` waere hier falsch gewesen und ist beim Bau prompt umgefallen:
	// der richtige Satz „Es wird nichts überschrieben" enthaelt das Wort ja. Geprueft wird deshalb
	// das VERSPRECHEN der Nachbarn („eine abweichende Zuordnung wird überschrieben"), nicht das Wort.
	assert.ok(!/abweichende Zuordnung wird überschrieben/.test(karteFrage),
		"die Karten-Rueckfrage hat den Ueberschreib-Satz der Nachbarn geerbt: " + karteFrage);
	assert.ok(/nichts überschrieben/.test(karteFrage),
		"die Karten-Rueckfrage schliesst das Ueberschreiben nicht aus: " + karteFrage);
	// ⚠️ Der Merker bleibt eine ENTSCHEIDUNG: anders als bei Weg und Landschaft raeumt dieser Lauf
	// ihn nicht ab, und die Rueckfrage sagt genau das.
	assert.ok(/Kein Wiki-Artikel vorhanden/.test(karteFrage), "die Karten-Rueckfrage nennt den Merker nicht: " + karteFrage);
	// 💣 UND SIE NENNT DIE ZAHLEN GETRENNT. Ein Knopf, der nur „363 werden geschrieben" sagt,
	// verschweigt, wie viele unberuehrt bleiben -- und genau das ist bei einem Lauf, der ERGAENZT,
	// die eigentliche Auskunft: heute 0, nach dem ersten Lauf alle. Dafuer reist die ganze Antwort
	// als drittes Argument in `frage` mit; die zwei aelteren Rezepturen ignorieren sie.
	const KARTE_SPAETER = {
		ok: true, dry_run: true, total: 529, citymaps_affected: 12, articles_linked: 9, applied: 0,
		skipped: { already_assigned: 349, no_article_flag: 2, no_publication: 166 },
		key_mismatch: { total: 22, unexplained: 0 },
	};
	const spaeterFrage = avesmapsWikiMassenlaufFrage("karte", KARTE_SPAETER);
	assert.ok(/351 Karten tragen bereits/.test(spaeterFrage),
		"die Rueckfrage rechnet die unberuehrten Karten nicht zusammen (349 + 2): " + spaeterFrage);
	assert.ok(/Weitere 166 Karten/.test(spaeterFrage),
		"die Rueckfrage verschweigt die Karten ohne Publikation: " + spaeterFrage);
	// ⚠️ Und bei der ersten Vorschau steht dort eine ehrliche 0, keine ausgelassene Zeile.
	assert.ok(/ERGÄNZT nur: 0 Karten/.test(karteFrage),
		"die erste Vorschau verschweigt, dass noch nichts zugewiesen ist: " + karteFrage);
	assert.ok(!/verliert ihn/.test(karteFrage), "die Karten-Rueckfrage behauptet, den Merker zu loeschen: " + karteFrage);
}

// ── 9c) DIE VERDRAHTUNG — EIN REZEPT OHNE AUSLÖSER IST GENAU DER FEHLER, DEN ES BEHEBEN SOLL ──
//
// 🪤 Der Anlass dieses ganzen Bauteils war, dass `assign_all` serverseitig seit Monaten existierte
// und NICHTS es anklicken konnte (js/review/review-path-sync.js hatte null Aufrufer). Ein Rezept,
// das kein Knopf ruft, wiederholt genau das — und alle Zusicherungen darüber blieben grün dabei.
// Deshalb wird hier am DOKUMENT nachgezählt, statt es anzunehmen.
{
	const fs = require("fs");
	const path = require("path");
	const editor = fs.readFileSync(
		path.resolve(__dirname, "..", "..", "..", "html", "citymap-editor.html"), "utf8"
	);
	assert.ok(/<script src="\/js\/ui\/wiki-massenzuweisung\.js"/.test(editor),
		"der Karten-Editor lädt js/ui/wiki-massenzuweisung.js nicht — das Rezept ist unerreichbar");
	assert.ok(/id="ceAssignAllBtn"/.test(editor), "die Kachel „Wiki zuweisen“ fehlt im Menüband");
	assert.ok(/id="ceAssignAllSub"/.test(editor), "der Kachel fehlt die Zeile für ihre Zahl");
	assert.ok(/getElementById\("ceAssignAllBtn"\)\.addEventListener\("click", handleAssignAllClick\)/.test(editor),
		"die Kachel hat keinen Zuhörer — sie sähe aus wie ein Knopf und täte nichts");
	assert.ok(/avesmapsWikiMassenlauf\("karte",/.test(editor),
		"der Karten-Editor ruft den Massenlauf nicht mit der Art „karte“");
	// ⚠️ Und er liest die Kurzzeile über DIESELBE Art -- ein „weg“ hier zeigte die falschen Wörter.
	assert.ok(/avesmapsWikiMassenlaufKurztext\("karte",/.test(editor),
		"die Kachel beschriftet sich über eine andere Art als die, die sie ausführt");
}

// ── 9d) DIE KRAFTLINIE: DIE VIERTE ART, UND SIE SCHREIBT AUF EINE NAMENSGRUPPE ───────────────
//
// 🔴 Eine Kraftlinie ist keine Zeile, sondern viele Segmente unter einem gemeinsamen Namen.
// Gezaehlt wird in LINIEN (die Einheit, in der ein Editor denkt), geschrieben wird auf SEGMENTE --
// und beide Zahlen muessen dastehen, sonst liest sich „16" wie 16 Datensaetze.
//
// 💣 Und sie ueberspringt jeden Artikel, den schon eine Linie haelt. Live gemessen 18.08.2026:
// „Hexenband" traegt bereits /wiki/Hexenband, daneben steht „Hexenband(-schleife)". Ohne den
// Riegel legte der Lauf zwei Kartenobjekte auf EINEN Artikel -- also genau den Fall, den das
// Konfliktzentrum meldet.
{
	// Die Antwortform von avesmapsWikiPowerlineAssignAll, mit der gemessenen Lage.
	const KRAFT_VORSCHAU = {
		ok: true, dry_run: true, staged: 19, total_lines: 62,
		lines_affected: 16, segments_affected: 69, articles_linked: 16,
		applied: 0, applied_segments: 0,
		skipped: { no_match: 43, no_article_flag: 0, already_assigned: 2, article_taken: 1 },
		taken: [{ line: "Hexenband(-schleife)", article: "Hexenband(-schleife)", held_by: "Hexenband" }],
	};

	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.kraftlinie.zahl(KRAFT_VORSCHAU), 16);
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.kraftlinie.wikiZahl(KRAFT_VORSCHAU), 16);
	// ⚠️ Ein leerer Lauf faellt auf 0, nicht auf NaN.
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.kraftlinie.zahl({ ok: true }), 0);
	assert.strictEqual(avesmapsWikiMassenlaufKurztext("kraftlinie", { ok: true }), "nichts offen");
	assert.strictEqual(avesmapsWikiMassenlaufKurztext("kraftlinie", KRAFT_VORSCHAU), "16 Kraftlinien · 16 Artikel");

	// 🔴 DIE ADRESSE IST DER KRAFTLINIEN-ENDPUNKT, nicht der allgemeine Karten-Schreibendpunkt:
	// jener verpackt jedes Ergebnis in `feature: {…}`, und der Rueckleser des scharfen Laufs
	// (`dry_run === false`) griffe dort ins Leere und meldete Erfolg, ohne dass etwas steht.
	assert.strictEqual(AVESMAPS_WIKI_MASSENLAUF.kraftlinie.url, "/api/edit/map/powerlines.php");
	assert.notStrictEqual(AVESMAPS_WIKI_MASSENLAUF.kraftlinie.url, "/api/edit/map/features.php");

	const kraftVorschauKoerper = avesmapsWikiMassenlaufVorschauKoerper("kraftlinie");
	assert.strictEqual(kraftVorschauKoerper.action, "assign_all");
	assert.ok(!("dry_run" in kraftVorschauKoerper), "die Kraftlinien-Vorschau schickt dry_run mit");
	assert.ok(!("confirm" in kraftVorschauKoerper), "die Kraftlinien-Vorschau schickt confirm mit");
	const kraftSchreibKoerper = avesmapsWikiMassenlaufSchreibKoerper("kraftlinie");
	assert.strictEqual(kraftSchreibKoerper.dry_run, false);
	assert.strictEqual(kraftSchreibKoerper.confirm, "apply");

	const kraftFrage = avesmapsWikiMassenlaufFrage("kraftlinie", KRAFT_VORSCHAU);
	// 💣 BEIDE ZAHLEN. „16 Kraftlinien" allein verschweigt, dass 69 Zeilen geschrieben werden.
	assert.ok(/69 Segmente/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage verschweigt, auf wie viele Segmente geschrieben wird: " + kraftFrage);
	assert.ok(/Namensgruppe/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage erklaert nicht, warum es mehr Segmente als Linien sind: " + kraftFrage);
	// 🔴 Sie ERGAENZT nur -- wie die Karte, anders als Weg und Landschaft.
	assert.ok(/ERGÄNZT/.test(kraftFrage), "die Kraftlinien-Rueckfrage sagt nicht, dass sie nur ergaenzt: " + kraftFrage);
	assert.ok(!/abweichende Zuordnung wird überschrieben/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage hat den Ueberschreib-Satz der Wege geerbt: " + kraftFrage);
	assert.ok(/nichts überschrieben/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage schliesst das Ueberschreiben nicht aus: " + kraftFrage);
	assert.ok(/Kein Wiki-Artikel vorhanden/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage nennt den Merker nicht: " + kraftFrage);
	assert.ok(!/verliert ihn/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage behauptet, den Merker zu loeschen: " + kraftFrage);
	// 💣 DER ABNAHMEFALL DER RUECKFRAGE: der uebersprungene Fall steht NAMENTLICH da. Eine blosse
	// Zahl („1 übersprungen") liesse den Editor raten, welche Linie gemeint ist und warum.
	assert.ok(/Übersprungen, weil der Artikel schon vergeben ist \(1\)/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage nennt die uebersprungenen Faelle nicht als eigenen Grund: " + kraftFrage);
	assert.ok(/Hexenband\(-schleife\)/.test(kraftFrage) && /hängt an „Hexenband“/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage nennt weder die uebersprungene Linie noch ihren Halter: " + kraftFrage);
	// 🔴 NUR WORTGLEICH -- ein aehnlicher Treffer wird hier nie zugewiesen, und das muss dastehen.
	assert.ok(/wortgleich/.test(kraftFrage), "die Kraftlinien-Rueckfrage sagt nicht, dass nur wortgleich zaehlt: " + kraftFrage);
	assert.ok(/ÄHNLICHER/.test(kraftFrage),
		"die Kraftlinien-Rueckfrage grenzt den aehnlichen Treffer nicht ab: " + kraftFrage);

	// ⚠️ Ohne uebersprungenen Fall faellt der Block ersatzlos weg -- keine „(0)"-Zeile, die wie ein
	// Befund aussieht.
	const ohneKollision = avesmapsWikiMassenlaufFrage("kraftlinie", Object.assign({}, KRAFT_VORSCHAU, { taken: [] }));
	assert.ok(!/Übersprungen, weil der Artikel schon vergeben/.test(ohneKollision),
		"ohne vergebenen Artikel bleibt die Zeile trotzdem stehen: " + ohneKollision);
}

// ── 9e) DIE VERDRAHTUNG DER KRAFTLINIE — DIESELBE PROBE WIE BEI DER KARTE ────────────────────
{
	const fs = require("fs");
	const path = require("path");
	const editor = fs.readFileSync(
		path.resolve(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html"), "utf8"
	);
	assert.ok(/<script src="\/js\/ui\/wiki-massenzuweisung\.js"/.test(editor),
		"der Kraftlinien-Editor lädt js/ui/wiki-massenzuweisung.js nicht — das Rezept ist unerreichbar");
	assert.ok(/id="plAssignAll"/.test(editor), "die Kachel „Wiki zuweisen“ fehlt im Menüband");
	assert.ok(/id="plAssignAllInfo"/.test(editor), "der Kachel fehlt die Zeile für ihre Zahl");
	assert.ok(/\$\("plAssignAll"\)\.addEventListener\("click", runAssignAll\)/.test(editor),
		"die Kachel hat keinen Zuhörer — sie sähe aus wie ein Knopf und täte nichts");
	assert.ok(/avesmapsWikiMassenlauf\("kraftlinie",/.test(editor),
		"der Kraftlinien-Editor ruft den Massenlauf nicht mit der Art „kraftlinie“");
	assert.ok(/avesmapsWikiMassenlaufKurztext\("kraftlinie",/.test(editor),
		"die Kachel beschriftet sich über eine andere Art als die, die sie ausführt");
	// 💣 UND SIE DARF NICHT AM ÖFFNEN HÄNGEN. Der Kraftlinien-Zeichner läuft für JEDEN Besucher;
	// eine Vorschau, die beim Aufbau der Liste losläuft, liest die ganze Dump-Staging-Tabelle je
	// Fensteröffnung (AGENTS.md §9, STRATO). Deshalb steht in der Kachel bis zum Klick ein Wort,
	// keine Zahl.
	// 🪤 Geprüft wird die ZELLE, nicht das Wort irgendwo im Dokument: dieselbe Wendung steht in der
	// Begründung über `runAssignAll`, und ein bloßes /noch nicht geprüft/ blieb deshalb grün, als
	// die Kachel probehalber eine Zahl trug (Mutation M22 beim Bau).
	assert.ok(/id="plAssignAllInfo">noch nicht geprüft</.test(editor),
		"die Kachel zeigt ohne Klick eine Zahl — dann wird die Vorschau beim Öffnen gefahren");
	assert.ok(!/runAssignAll\(\);/.test(editor.replace(/\$\("plAssignAll"\)\.addEventListener[^\n]*\n/, "")),
		"runAssignAll wird irgendwo direkt aufgerufen — der Lauf gehört an den Klick, nicht ans Öffnen");
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
