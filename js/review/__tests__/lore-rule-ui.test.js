// Die reinen Teile des Regeleditors. Sie bauen Text und Markup aus Daten -- genau das ist ohne
// Browser pruefbar, und genau daran ist im Haus schon Escaping danebengegangen.
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

// Die echten Globals installieren, keine Fakes: ein gestubbter Escaper wuerde die
// Escaping-Fehler verstecken, um die es hier geht.
const context = { window: {}, document: undefined, console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/app/utils.js", "utf8"), context);
vm.runInContext(fs.readFileSync("js/review/review-lore-rule.js", "utf8"), context);

const zoneLabels = {
	polar: "Polare Zone", subpolar: "Subpolare Zone", boreal: "Boreale Zone",
	gemaessigt: "Gemäßigte Zone", subtropen_winterfeucht: "Winterfeuchte Subtropen",
	trockene_subtropen: "Subtropische Steppenzone", subtropisch: "Subtropische Wüstenzone",
	tropisch: "Tropische Zone",
};
const term = (over) => Object.assign(
	{ join_op: "und", area_public_id: null, area_name: "", climate_from: null, climate_to: null, types: [] },
	over
);

// Der Landschaftsart-Katalog kommt seit Fix-Runde 1 vom Server (api/edit/map/ecosystem.php, Aktion
// "region_types" -> avesmapsListEcosystemRegionTypes()) und liegt im Modulzustand
// avesmapsLoreRuleTypeLabels, geschluesselt "<kind>|<type_key>". Hier direkt gesetzt, wie
// avesmapsLoreRuleLoadTypeLabels() ihn nach einem echten Abruf ablegen wuerde -- ohne echten Fetch
// im vm-Sandkasten. "auenlandschaft" bleibt absichtlich DRAUSSEN: der Fall dafuer steht weiter unten.
context.avesmapsLoreRuleTypeLabels = {
	"vegetation|wald": "Wald",
	"vegetation|suempfe_moore": "Sümpfe und Moore",
	"topographie|gebirge": "Gebirge",
};

// Eine Bedingung, zwei Felder: Art UND Klima.
const einfach = { id: 1, relation: "verbreitung", terms: [term({
	types: [{ kind: "vegetation", region_type: "wald" }],
	climate_from: "boreal", climate_to: "gemaessigt",
})] };
const satz = context.avesmapsLoreRuleSentence(einfach, zoneLabels);
assert.ok(satz.includes("Wald"), "die Art steht im Satz");
assert.ok(satz.includes("Boreale Zone") && satz.includes("Gemäßigte Zone"), "beide Enden der Spanne");
assert.ok(satz.includes("zwischen"), "eine Spanne liest sich als Spanne");

// EINE Zone ist keine Spanne -- „zwischen X und X" waere Kauderwelsch.
const eine = { id: 2, relation: "verbreitung", terms: [term({ climate_from: "boreal", climate_to: "boreal" })] };
const satzEine = context.avesmapsLoreRuleSentence(eine, zoneLabels);
assert.ok(!satzEine.includes("zwischen"), "eine einzelne Zone ohne 'zwischen'");
assert.ok(satzEine.includes("Boreale Zone"));
// 💣 Steht vor dem Klimateil nur "alles", braucht er einen Relativsatz. "alles im Klima X"
// behauptet erst Uneingeschraenktheit und nimmt sie im naechsten Wort zurueck -- Befund der
// Designpruefung vom 19.08.2026, und genau die Art Satz, die diese Umstellung beseitigen sollte.
assert.strictEqual(satzEine, "Die Regel liest sich: alles, was im Klima <b>Boreale Zone</b> liegt.",
	"eine Bedingung mit NUR Klima liest sich als Einschraenkung, nicht als Widerspruch");

// Mehrere Arten in EINER Bedingung sind ein ODER, zwei Bedingungen tragen ihr eigenes Wort.
const kette = { id: 3, relation: "verbreitung", terms: [
	term({ types: [{ kind: "vegetation", region_type: "wald" }, { kind: "vegetation", region_type: "suempfe_moore" }] }),
	term({ join_op: "oder", types: [{ kind: "topographie", region_type: "gebirge" }] }),
] };
const satzKette = context.avesmapsLoreRuleSentence(kette, zoneLabels);
assert.ok(satzKette.includes("Wald") && satzKette.includes("Sümpfe und Moore") && satzKette.includes("Gebirge"));
assert.ok(satzKette.includes("oder"), "die Verknuepfung der zweiten Bedingung steht da");

// 💣 Der Fund oben allein beisst nicht: mehrere Arten in EINER Bedingung schreiben ihr eigenes
// "oder" (types.join) -- das steht selbst dann noch da, wenn der join_op der ZWEITEN Bedingung
// ignoriert und immer "und" geschrieben wird. Erst eine Kette OHNE Mehrfach-Typen zeigt, ob
// join_op wirklich gelesen wird und nicht bloss zufaellig durchscheint.
const ketteOhneTypen = { id: 6, relation: "verbreitung", terms: [
	term({ area_public_id: "b1", area_name: "Erstgebiet" }),
	term({ join_op: "oder", area_public_id: "b2", area_name: "Zweitgebiet" }),
] };
const satzKetteOhneTypen = context.avesmapsLoreRuleSentence(ketteOhneTypen, zoneLabels);
assert.ok(satzKetteOhneTypen.includes('<b class="lore-rule-op">oder</b>'),
	"join_op der zweiten Bedingung wird gelesen, nicht uebergangen");
assert.ok(!satzKetteOhneTypen.includes('<b class="lore-rule-op">und</b>'),
	"kein festverdrahtetes 'und' zwischen den Bedingungen");
// 💣 Die Verknuepfung traegt eine EIGENE Klasse -- ohne sie stossen im neuen Satz drei fette
// Woerter aneinander („… Almada oder Gebirge") und lesen sich wie eine Aufzaehlung. Die Regel dazu
// steht in css/features/lore.css; hier haengt nur, dass das Markup sie ueberhaupt anbietet.
assert.ok(!satzKetteOhneTypen.includes("<b>oder</b>"),
	"der Operator darf nicht dieselbe Hervorhebung tragen wie ein Wert");

// 💣 Der Flaechenname kommt aus der Datenbank und wird ESCAPED. Ohne das traegt ein Name mit
// spitzer Klammer fremdes Markup in die Editorliste.
const boese = { id: 4, relation: "verbreitung", terms: [term({
	area_public_id: "a1", area_name: '<img src=x onerror="alert(1)">',
})] };
const markup = context.avesmapsLoreRuleCardMarkup(boese, zoneLabels);
assert.ok(!markup.includes("<img"), "der Name darf kein Markup einschleusen");
assert.ok(markup.includes("&lt;img"), "er steht escaped drin");

// Eine leere Regel gibt es nicht -- der Server laesst sie nicht zu. Der Satzbauer darf trotzdem
// nicht werfen, sonst reisst eine kaputte Datenzeile die ganze Liste ab.
assert.doesNotThrow(() => context.avesmapsLoreRuleSentence({ id: 5, relation: "", terms: [] }, zoneLabels));

// 💣 Befund 1 (Fix-Runde 1): eine Art im Katalog erscheint mit ihrer ECHTEN Beschriftung; eine, die
// der Katalog nicht kennt, erscheint als ROHER SCHLUESSEL -- nie als Vermutung. Bewusst
// "auenlandschaft": der verworfene erste Textumbau (ue -> ü, angewandt auf den ganzen Schluessel)
// traf mitten im Wort ("a-U-E-nlandschaft") und schrieb "Aünlandschaft" -- sichtbar falsches
// Deutsch, das aussah, als waere es richtig. Kein Textumbau mehr: ein unbekannter Schluessel bleibt
// unbekannt und sichtbar roh, statt geraten und falsch.
const bekannteUndUnbekannteArt = { id: 7, relation: "verbreitung", terms: [term({
	types: [
		{ kind: "vegetation", region_type: "wald" },
		{ kind: "vegetation", region_type: "auenlandschaft" },
	],
})] };
const satzArten = context.avesmapsLoreRuleSentence(bekannteUndUnbekannteArt, zoneLabels);
assert.ok(satzArten.includes("Wald"), "die bekannte Art zeigt ihre Katalog-Beschriftung");
assert.ok(satzArten.includes("auenlandschaft"), "die unbekannte Art zeigt den rohen Schluessel");
assert.ok(!satzArten.includes("Aünlandschaft") && !satzArten.includes("Auenlandschaft"),
	"kein geratener Textumbau -- weder das kaputte noch ein zufaellig richtig aussehendes Ergebnis");

// 💣 ZWEI Faltungen, nicht eine. NFD-Strippen macht aus „Wüste" ein „wuste", getippt wird aber
// „wueste" -- beide Seiten muessen zusaetzlich durch ue/oe/ae -> u/o/a, sonst findet „wueste"
// die Wueste NICHT. Im Mockup gemessen, nicht vermutet.
const key = context.avesmapsLoreRuleSearchKey;
assert.strictEqual(key("Wüste"), key("wueste"), "beide Schreibweisen treffen sich");
assert.strictEqual(key("Sümpfe und Moore"), key("suempfe und moore"));
assert.strictEqual(key("Große Fluss"), key("grosse fluss"), "das scharfe S faellt auf ss");
assert.notStrictEqual(key("Wald"), key("Steppe"), "verschiedene Arten bleiben verschieden");

// Arten an- und abwaehlen, ohne die uebrige Bedingung anzufassen.
let t = term({ climate_from: "boreal", climate_to: "gemaessigt" });
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1);
assert.strictEqual(t.types[0].kind, "vegetation");
assert.strictEqual(t.types[0].region_type, "wald");
assert.strictEqual(t.climate_from, "boreal", "das Klima bleibt unberuehrt");

t = context.avesmapsLoreRuleTermToggleType(t, "topographie/gebirge");
assert.strictEqual(t.types.length, 2);
t = context.avesmapsLoreRuleTermToggleType(t, "vegetation/wald");
assert.strictEqual(t.types.length, 1, "dieselbe Art nochmal waehlt sie ab");
assert.strictEqual(t.types[0].region_type, "gebirge", "und zwar die richtige");

// 💣 Die vorigen Asserts biessen NICHT gegen `splice(0, 1)` statt `splice(at, 1)`: die abgewaehlte
// Art (Wald) stand zufaellig an Index 0, ein falscher, fest auf 0 verdrahteter Index traf also
// dieselbe. Erst eine Kette, in der die abgewaehlte Art NICHT die erste ist, zeigt, ob wirklich der
// gefundene Index geloescht wird -- hier: Wald UND Gebirge stehen, ab-gewaehlt wird Gebirge (Index 1).
let t2 = term({});
t2 = context.avesmapsLoreRuleTermToggleType(t2, "vegetation/wald");
t2 = context.avesmapsLoreRuleTermToggleType(t2, "topographie/gebirge");
t2 = context.avesmapsLoreRuleTermToggleType(t2, "topographie/gebirge");
assert.strictEqual(t2.types.length, 1, "die abgewaehlte Art (nicht die erste) ist weg");
assert.strictEqual(t2.types[0].region_type, "wald", "die STEHENGEBLIEBENE Art ist die richtige");

// 💣 Toggle gibt eine NEUE Bedingung zurueck und aendert das Original NICHT -- sonst haette eine
// Karte, die dieselbe Bedingung noch zeigt, waehrend der Editor sie schon bearbeitet, den falschen
// Stand. Das Original bleibt bei EINEM Eintrag (Wald), obwohl `t` inzwischen bei „Gebirge" steht.
const original = term({ types: [{ kind: "vegetation", region_type: "wald" }] });
const toggled = context.avesmapsLoreRuleTermToggleType(original, "topographie/gebirge");
assert.strictEqual(original.types.length, 1, "das Original behaelt seine eine Art");
assert.strictEqual(original.types[0].region_type, "wald", "und zwar die urspruengliche");
assert.strictEqual(toggled.types.length, 2, "die Kopie traegt beide");

// ---- Task 7: Vorschau, Speichern, Löschen, Rechenstand ------------------------------------------

// avesmapsLoreRuleFormatStamp: von Hand statt toLocaleString (ICU-unabhaengig), also mit
// gepolsterten Werten geprueft -- ein vertauschtes Tag/Monat oder ein fehlendes Padding wuerde bei
// zweistelligen Werten allein nicht auffallen.
const fmt = context.avesmapsLoreRuleFormatStamp;
assert.strictEqual(fmt("2026-08-03 07:05:12.345"), "03.08.2026 07:05", "Tag/Monat/Stunde/Minute gepolstert");
assert.strictEqual(fmt("2026-12-31 23:59:00"), "31.12.2026 23:59", "zweistellige Werte bleiben richtig");
assert.strictEqual(fmt(""), "", "ein leerer Wert wirft nicht, sondern bleibt leer");

// avesmapsLoreRuleAssignmentStampText: „veraltet" ist ein VERGLEICH -- fresh und stale unterscheiden
// sich hier NUR in einer einzelnen Revisionszahl, nicht im ganzen Objekt, damit ein Test, der die
// beiden Zweige verwechselt, auch wirklich beisst (Memory „Test muss beißen").
const stampText = context.avesmapsLoreRuleAssignmentStampText;
const freshRun = {
	stamp: { completed: true, ecosystem_revision: 5, map_revision: 9, computed_at: "2026-08-13 19:04:12.345" },
	current: { ecosystem_revision: 5, map_revision: 9 },
};
assert.strictEqual(stampText(freshRun), "Stand: 13.08.2026 19:04 · aktuell");

const staleRun = {
	stamp: { completed: true, ecosystem_revision: 5, map_revision: 9, computed_at: "2026-08-09 22:31:00" },
	current: { ecosystem_revision: 6, map_revision: 9 }, // nur ecosystem_revision weicht ab
};
assert.strictEqual(stampText(staleRun), "Stand: 09.08.2026 22:31 · veraltet, bitte neu rechnen");

// avesmapsLoreRuleAssignmentIsStale: dieselbe Frage wie oben, aber als eigene Auskunft -- die
// Stempelzeile SAGT "veraltet", der Link darunter BIETET die Abhilfe. Beide muessen aus DERSELBEN
// Bedingung kommen, sonst steht irgendwann "aktuell" ueber einem Knopf zum Neurechnen.
const isStale = context.avesmapsLoreRuleAssignmentIsStale;
assert.strictEqual(isStale(freshRun), false, "gleiche Revisionen: nicht veraltet");
assert.strictEqual(isStale(staleRun), true, "abweichende ecosystem_revision: veraltet");
// 💣 Ein LAUFENDER Lauf ist nicht veraltet, sondern unfertig -- dort waere ein Link zum
// Neustarten die falsche Einladung.
assert.strictEqual(isStale({ stamp: { completed: false, ecosystem_revision: 5, map_revision: 9 }, current: { ecosystem_revision: 6, map_revision: 9 } }), false,
	"waehrend eines Laufs: nicht veraltet, sondern unfertig");
assert.strictEqual(isStale(null), false, "kein Abruf: keine Behauptung");
assert.strictEqual(isStale({ current: { ecosystem_revision: 1, map_revision: 1 } }), false, "kein Stempel: keine Behauptung");

const staleRunMapOnly = {
	stamp: { completed: true, ecosystem_revision: 5, map_revision: 9, computed_at: "2026-08-09 22:31:00" },
	current: { ecosystem_revision: 5, map_revision: 10 }, // nur map_revision weicht ab
};
assert.ok(stampText(staleRunMapOnly).indexOf("veraltet") >= 0, "map_revision allein macht schon veraltet");

assert.strictEqual(stampText({ stamp: { completed: false }, current: {} }), "Wird gerade gerechnet …",
	"ein unvollstaendiger Lauf ist NIE aktuell/veraltet, sondern eigens benannt");
assert.strictEqual(stampText({ stamp: null, current: {} }), "noch nicht gerechnet");
assert.strictEqual(stampText(null), "", "ein gescheiterter Abruf behauptet nichts");
assert.strictEqual(stampText(undefined), "", "noch nicht abgefragt behauptet ebenfalls nichts");

// avesmapsLoreRuleResponseErrorMessage: Objekt-Fehler vor String-Fehler vor Fallback, und ein
// gescheiterter Abruf (data === null) bekommt seinen EIGENEN Text statt des Ablehnungs-Fallbacks.
const errText = context.avesmapsLoreRuleResponseErrorMessage;
assert.strictEqual(errText(null, "abgelehnt", "keine Verbindung"), "keine Verbindung");
assert.strictEqual(
	errText({ ok: false, error: { code: "rule_matches_everything", message: "Ohne eine Einschraenkung träfe die Regel alles." } }, "abgelehnt", "keine Verbindung"),
	"Ohne eine Einschraenkung träfe die Regel alles.",
	"die Meldung des Servers geht vor dem Fallback"
);
assert.strictEqual(errText({ ok: false, error: "legacy_string_error" }, "abgelehnt", "keine Verbindung"), "legacy_string_error");
assert.strictEqual(errText({ ok: false }, "abgelehnt", "keine Verbindung"), "abgelehnt",
	"ohne jede Fehlerangabe (delete_rule: {ok:false} ohne error) greift der Ablehnungs-Fallback");

// avesmapsLoreRuleHitsListMarkup: leer bleibt LESBAR, und ein Flaechen-/Ortsname aus der Datenbank
// wird escaped -- dieselbe Falle wie beim Flaechennamen der Karte weiter oben.
const hitsMarkup = context.avesmapsLoreRuleHitsListMarkup;
assert.ok(hitsMarkup([]).includes("Keine."), "eine leere Trefferliste sagt das auch");
const hitsBoese = hitsMarkup([{ public_id: "a1", name: '<img src=x onerror="alert(1)">' }]);
assert.ok(!hitsBoese.includes("<img"), "der Name darf kein Markup einschleusen");
assert.ok(hitsBoese.includes("&lt;img"), "er steht escaped drin");

// ── Der Flaechen-Vorrat darf nicht ueberaltern ─────────────────────────────────────────────────
// Owner 18.08.2026: „ich habe bei bergwolf mittelaventurien als neue derographische region
// hinzugefuegt aber sie war unter ‚regel' nicht gelistet - erst nachdem ich die seite neugeladen
// hatte". Ursache: der Vorrat wurde einmal je Seitenleben geholt und nie erneuert.
//
// 🔴 ZWEI HAELFTEN, und nur die erste ist hier wirklich pruefbar.
// (a) VERHALTEN: die Zusage wird gecacht (kein Abruf je Tastendruck), und ein Verwerfen des
//     Modulzustands fuehrt zu genau EINEM neuen Abruf. Das ist der Mechanismus, auf dem die
//     Reparatur steht -- gemessen an einem Abrufzaehler, nicht behauptet.
// (b) VERDRAHTUNG: dass avesmapsLoreRuleOpenEditor ihn beim Oeffnen verwirft. Das ist eine Aussage
//     ueber den QUELLTEXT, weil die Funktion ohne echtes DOM sofort zurueckkehrt -- sie ist als
//     solche gekennzeichnet und ersetzt den Handgriff im Browser nicht.
let abrufe = 0;
context.fetch = function (url, options) {
	const rumpf = String((options && options.body) || "");
	if (rumpf.indexOf("list_regions") >= 0) {
		abrufe += 1;
	}
	return Promise.resolve({
		ok: true,
		json: function () {
			return Promise.resolve({
				ok: true,
				regions: [{ public_id: "r-neu", name: "Mittelaventurien", kind: "derographisch", region_type: "region" }],
			});
		},
	});
};

const ersteRunde = context.avesmapsLoreRuleLoadAreaCatalog();
context.avesmapsLoreRuleLoadAreaCatalog();
context.avesmapsLoreRuleLoadAreaCatalog();
ersteRunde.then((katalog) => {
	assert.strictEqual(abrufe, 1,
		`Drei Aufrufe duerfen EINEN Abruf ausloesen (die Vervollstaendigung ruft ihn bei jedem `
		+ `Zeichen). Waren: ${abrufe}. Ohne den Cache waere das eine Vollabfrage je Tastendruck.`);
	assert.deepStrictEqual(katalog.map((a) => a.name), ["Mittelaventurien"],
		"Der Vorrat traegt, was der Server geliefert hat.");

	// Das Verwerfen -- genau das, was avesmapsLoreRuleOpenEditor beim Oeffnen tut.
	context.avesmapsLoreRuleAreaCatalogPromise = null;
	return context.avesmapsLoreRuleLoadAreaCatalog();
}).then(() => {
	assert.strictEqual(abrufe, 2,
		`Nach dem Verwerfen muss GENAU EIN weiterer Abruf kommen -- sonst bliebe eine neu `
		+ `angelegte Flaeche bis zum Neuladen unsichtbar. Waren: ${abrufe}.`);

	// (b) Die Verdrahtung, ausdruecklich am Quelltext: der Riegel steht IM Oeffner und VOR dem
	// Warten auf die beiden Kataloge -- danach waere er wirkungslos, weil die alte Zusage dann
	// schon abgewartet ist.
	const quelle = fs.readFileSync("js/review/review-lore-rule.js", "utf8");
	const oeffner = quelle.slice(quelle.indexOf("function avesmapsLoreRuleOpenEditor("));
	const verwerfen = oeffner.indexOf("avesmapsLoreRuleAreaCatalogPromise = null");
	const warten = oeffner.indexOf("Promise.all([avesmapsLoreRuleLoadTypeLabels()");
	assert.ok(verwerfen > -1,
		"avesmapsLoreRuleOpenEditor verwirft den Flaechen-Vorrat nicht mehr. Dann ist eine neu "
		+ "angelegte Landschaftsflaeche im Regel-Kasten wieder erst nach einem Neuladen da.");
	assert.ok(warten > -1 && verwerfen < warten,
		"Das Verwerfen muss VOR dem Warten auf die Kataloge stehen -- danach wuerde bereits die "
		+ "alte Zusage abgewartet und der Riegel liefe ins Leere.");
	// 🪤 Und der ART-Katalog bleibt ausdruecklich stehen: er ist ein fester Seed, keine Sammlung,
	// die ein Editor nebenan waechst. Wer ihn mitverwirft, holt bei jedem Oeffnen zwei Listen.
	assert.ok(!/avesmapsLoreRuleTypeLabelsPromise = null/.test(oeffner.slice(0, warten)),
		"Der Landschaftsart-Katalog wird mitverworfen. Er ist ein fester Seed "
		+ "(AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED) -- das waere ein zweiter Abruf ohne Anlass.");

	// ---- Die Regelsprache „innerhalb" (19.08.2026) --------------------------------------------
	// 🔴 Der Owner nannte „bessere kommunikation" als Anlass der Umstellung. Der Satz ist damit die
	// halbe Aufgabe, nicht ihre Kuer -- diese Zusicherungen pruefen ihn, nicht die Auswertung
	// (die steht in api/_internal/app/__tests__/lore-regel-innerhalb-test.php).
	const satzInnerhalb = context.avesmapsLoreRuleSentence({ id: 10, relation: "verbreitung", terms: [term({
		types: [{ kind: "topographie", region_type: "gebirge" }],
		area_public_id: "mav", area_name: "Mittelaventurien",
	})] }, zoneLabels);
	// 🔴 WOERTLICH, nicht per includes: das ist der Satz des Owners, und er ist die Abnahme dieser
	// Umstellung. Eine lose Pruefung („enthaelt innerhalb von") laesst ein zurueckgekehrtes „ist"
	// oder „heisst" daneben stehen -- gemessen: genau diese Mutation blieb gruen.
	assert.strictEqual(satzInnerhalb,
		"Die Regel liest sich: <b>Gebirge</b> innerhalb von <b>Mittelaventurien</b>.",
		"Art plus Flaeche liest sich als Enthaltensein, nicht als zwei Eigenschaften desselben Dings");
	assert.ok(satzInnerhalb.indexOf("Gebirge") < satzInnerhalb.indexOf("Mittelaventurien"),
		"die Art steht VOR der Flaeche: Gebirge innerhalb von Mittelaventurien, nicht umgekehrt");
	assert.ok(!satzInnerhalb.includes("heißt"),
		'„X heisst und Y ist“ war die Fehldiagnose in Textform und darf nicht zurueckkommen');

	// 💣 Der Fall, den der Satz UNTERSCHEIDEN muss: ohne Landschaftsart nennt die Bedingung einen
	// ORT, keine Auswahl. Sagte der Satz auch hier „innerhalb von", laese sich „Almada" wie „alles
	// in Almada" -- live der Unterschied zwischen 1 und bis zu 647 Treffern.
	const satzNurFlaeche = context.avesmapsLoreRuleSentence({ id: 11, relation: "verbreitung", terms: [term({
		area_public_id: "almada", area_name: "Almada",
	})] }, zoneLabels);
	assert.ok(satzNurFlaeche.includes("selbst"),
		"ohne Art sagt der Satz, dass die Flaeche SELBST gemeint ist");
	assert.ok(!satzNurFlaeche.includes("innerhalb von"),
		"ohne Art darf der Satz kein Enthaltensein behaupten");

	// Die Kartenzeilen tragen dieselbe Unterscheidung, mit denselben zwei Woertern.
	const zeilenMitArt = context.avesmapsLoreRuleTermLines(term({
		types: [{ kind: "topographie", region_type: "gebirge" }],
		area_public_id: "mav", area_name: "Mittelaventurien",
	}), zoneLabels).map((zeile) => zeile[0]);
	// ⚠️ Ueber den TEXT verglichen, nicht per deepStrictEqual: die Zeilen kommen aus dem
	// vm-Sandkasten und tragen dessen Array-Prototyp -- ein strikter Vergleich scheitert daran,
	// obwohl der Inhalt stimmt.
	assert.strictEqual(zeilenMitArt.join(" | "), "Landschaft | innerhalb von",
		"Reihenfolge und Beschriftung der Kartenzeilen folgen dem Satz");
	const zeilenOhneArt = context.avesmapsLoreRuleTermLines(term({
		area_public_id: "almada", area_name: "Almada",
	}), zoneLabels).map((zeile) => zeile[0]);
	assert.strictEqual(zeilenOhneArt.join(" | "), "Fläche selbst",
		"ohne Art heisst die Zeile anders -- sonst verschweigt die Karte, was der Satz ausschreibt");

	// ---- Doppelte Flaechennamen im Vorschlag ---------------------------------------------------
	// 💣 Live gemessen 19.08.2026: 13 Namen kommen mehrfach vor. Seit „innerhalb" bestimmt die Wahl
	// einen BEHAELTER -- „Finsterkamm" gibt es als derographische Region (11 Regionen darin) und als
	// Gebirge, und wer den falschen erwischt, bekommt eine Regel, die etwas anderes trifft.
	const vorschlaege = context.avesmapsLoreRuleBenenneVorschlaege([
		{ public_id: "aaaa1111", name: "Finsterkamm", kind: "derographisch", region_type: "", kindLabel: "Derographisch" },
		{ public_id: "bbbb2222", name: "Finsterkamm", kind: "topographie", region_type: "gebirge", kindLabel: "Topographie" },
		{ public_id: "cccc3333", name: "Grauer Wald", kind: "vegetation", region_type: "wald", kindLabel: "Vegetation" },
		{ public_id: "dddd4444", name: "Grauer Wald", kind: "vegetation", region_type: "wald", kindLabel: "Vegetation" },
		{ public_id: "eeee5555", name: "Farindelwald", kind: "vegetation", region_type: "wald", kindLabel: "Vegetation" },
	]);
	const beschriftet = vorschlaege.map((row) => row.pickerLabel);
	assert.notStrictEqual(beschriftet[0], beschriftet[1],
		"zwei Flaechen gleichen Namens auf verschiedenen Ebenen sind unterscheidbar");
	// 🪤 Und die zwei, die auch mit Ebene UND Art gleich bleiben: gleicher Name, gleiche Ebene,
	// gleiche Art. Dann tritt der Anfang der public_id dazu -- haesslich, und genau deshalb richtig.
	assert.notStrictEqual(beschriftet[2], beschriftet[3],
		"auch bei gleicher Ebene UND Art bleiben zwei Vorschlaege unterscheidbar");
	assert.ok(beschriftet[2].includes("cccc") && beschriftet[3].includes("dddd"));
	assert.ok(!beschriftet[4].includes("eeee"),
		"ein eindeutiger Name traegt den Zusatz NICHT -- er waere Laerm in 900 Zeilen");
	// Die Liste zeigt IMMER die Ebene (Entwurf §6.2), auch bei eindeutigem Namen ...
	assert.ok(beschriftet[4].includes("Vegetation"), "jeder Vorschlag zeigt seine Ebene");
	// ... der ZUSATZ dagegen ist der kleinste noetige Unterschied und bei einem eindeutigen Namen leer.
	assert.strictEqual(vorschlaege[4].zusatz, "");
	assert.strictEqual(vorschlaege[1].zusatz, "Topographie",
		"beim Finsterkamm trennt die Ebene schon -- die Art waere ueberfluessiger Ballast");

	// 🔴 DER BEFUND DER KONSISTENZPRUEFUNG (19.08.2026): der Zusatz lebte zuerst NUR im Vorschlag.
	// Eine GESPEICHERTE Regel war damit wieder genauso mehrdeutig wie vor der Umstellung -- Satz,
	// Kartenzeile und Marke lasen alle den nackten `area_name`. Alle drei kommen jetzt aus
	// avesmapsLoreRuleTermFields, und die kennt den Katalog.
	context.avesmapsLoreRuleAreaCatalog = vorschlaege;
	const gewaehlt = term({ area_public_id: "cccc3333", area_name: "Grauer Wald",
		types: [{ kind: "vegetation", region_type: "wald" }] });
	assert.ok(context.avesmapsLoreRuleSentence({ terms: [gewaehlt] }, zoneLabels).includes("cccc"),
		"der Satz nennt, WELCHER der zwei gleichnamigen Waelder gemeint ist");
	assert.ok(context.avesmapsLoreRuleAreaTokenMarkup(gewaehlt, 0).includes("cccc"),
		"die Marke unter dem Feld ebenso -- dort prueft ein Editor seine Wahl");
	assert.ok(context.avesmapsLoreRuleTermLines(gewaehlt, zoneLabels)[1][1].includes("cccc"),
		"und die Kartenzeile der zugeklappten Regel");
	// Ein eindeutiger Name bleibt nackt -- der Zusatz ist eine Notloesung, keine Verzierung.
	const eindeutig = term({ area_public_id: "eeee5555", area_name: "Farindelwald",
		types: [{ kind: "vegetation", region_type: "wald" }] });
	assert.ok(!context.avesmapsLoreRuleSentence({ terms: [eindeutig] }, zoneLabels).includes("("),
		"ein eindeutiger Flaechenname steht ohne Klammerzusatz im Satz");
	context.avesmapsLoreRuleAreaCatalog = [];

	// Die Felder stehen in der Reihenfolge des Satzes: erst die Art, dann der Behaelter.
	const feldMarkup = context.avesmapsLoreRuleTermMarkup(term({}), 0, 1);
	assert.ok(feldMarkup.indexOf("Landschaftsart") < feldMarkup.indexOf("innerhalb von"),
		"das Formular liest sich von oben nach unten wie der Satz darunter");
	assert.ok(!feldMarkup.includes("Flächenname"),
		'„Flaechenname“ sagt nur, WAS im Feld steht, nicht was es bedeutet');

	// ---- Der Hinweis AN DER BEDINGUNG (19.08.2026) --------------------------------------------
	// 🔴 Waehlt jemand eine Flaeche, fuer die es noch keine Ueberlappungszeilen gibt, trifft die
	// Bedingung WORTLOS nichts -- und der Rechenweg daneben zeigt eine 0, die wie ein Befund
	// aussieht. Genau daran hat der Owner am 18.08.2026 eine halbe Stunde gesucht.
	const stand = { stamp: { completed: true }, uncomputed: { count: 1, public_ids: ["neu-1"], truncated: false } };
	assert.strictEqual(
		context.avesmapsLoreRuleTermAreaUngerechnet(term({ area_public_id: "neu-1" }), stand), true,
		"eine Bedingung auf einer ungerechneten Flaeche wird erkannt");
	assert.strictEqual(
		context.avesmapsLoreRuleTermAreaUngerechnet(term({ area_public_id: "alt-1" }), stand), false,
		"GEGENPROBE: eine gerechnete Flaeche bekommt keinen Hinweis");
	// ⚠️ Ohne Flaechenbedingung gibt es keine einzelne Flaeche, an der etwas haengen koennte --
	// die Gesamtzahl traegt die Kachel im Menueband.
	assert.strictEqual(
		context.avesmapsLoreRuleTermAreaUngerechnet(term({ types: [{ kind: "vegetation", region_type: "wald" }] }), stand),
		false, "eine Bedingung ohne Flaeche traegt den Hinweis nicht");
	// Solange nichts bekannt ist, wird nichts behauptet.
	assert.strictEqual(context.avesmapsLoreRuleTermAreaUngerechnet(term({ area_public_id: "neu-1" }), null), false);
	assert.strictEqual(context.avesmapsLoreRuleTermAreaUngerechnet(term({ area_public_id: "neu-1" }), { stamp: null }), false);

	// Und der Platz dafuer steht im Markup -- ohne ihn faende das Neuzeichnen nichts zu fuellen.
	// 🪤 Auf die ATTRIBUTGRENZE geprueft, nicht auf die Zeichenfolge: eine Umbenennung nach
	// „…-warn-XX" enthaelt den alten Namen als Teilstring und blieb damit gruen (gemessen 19.08.2026)
	// -- das Neuzeichnen haette den Knoten trotzdem nie gefunden.
	assert.ok(new RegExp("data-lore-rule-area-warn[ >]").test(context.avesmapsLoreRuleTermMarkup(term({}), 0, 1)),
		"die Bedingung hat keinen Platz fuer den Hinweis");

	console.log("lore-rule-ui: OK");
}).catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});

