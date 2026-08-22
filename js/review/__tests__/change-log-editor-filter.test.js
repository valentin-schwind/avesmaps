// Der Filter nach Editor im Fenster „Änderungen" (Owner-Auftrag 22.08.2026).
//
// 🔴 DIE EINE REGEL: ohne Auswahl die jüngsten 200 von ALLEN, mit Auswahl die jüngsten 200 VON DEN
// AUSGEWÄHLTEN. Der Server filtert (api/_internal/audit-filter.php), und jedes Protokoll behält
// seine Zeilen je Person (api/_internal/audit-prune.php) -- erst dadurch ist überhaupt etwas zu
// holen: vorher waren die Zeilen der Leiseren nicht ausgeblendet, sondern gelöscht.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox, nicht eine abgeschriebene Kopie der Regel.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/change-log-editor-filter.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-panels-change-log.js");
const source = fs.readFileSync(QUELLE, "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "review-panels-change-log.js" });

const changeLogEditorOptions = sandbox.changeLogEditorOptions;
const changeLogFilterEntries = sandbox.changeLogFilterEntries;
const changeLogRequestUrl = sandbox.changeLogRequestUrl;
assert.strictEqual(typeof changeLogEditorOptions, "function", "die echte Funktion ist geladen");
assert.strictEqual(typeof changeLogFilterEntries, "function", "die echte Funktion ist geladen");
assert.strictEqual(typeof changeLogRequestUrl, "function", "die echte Funktion ist geladen");

// Die geladenen Zeilen -- alle von „Valentin", plus eine der Import-Tür.
const zeilen = [
	{ username: "Valentin" },
	{ username: "Valentin" },
	{ username: "", actor_source: "import" },
];
// Was der Server über die GANZE Tabelle gezählt hat. „Alrike" kommt in den geladenen Zeilen NICHT vor.
const roster = new Map([["Valentin", 137], ["Alrike", 42]]);

// ---- Die Namen im Trichter ------------------------------------------------------------------------
// ⚠️ Verglichen wird über JSON, nicht mit deepStrictEqual: die Objekte entstehen IM vm-Kontext und
// tragen dessen Object.prototype -- deepStrictEqual prüft den Prototyp mit und schlägt fehl, obwohl
// jeder Wert stimmt.

assert.strictEqual(
	JSON.stringify(changeLogEditorOptions(zeilen, new Set(), roster)),
	JSON.stringify([
		{ value: "Valentin", label: "Valentin", count: 137 },
		{ value: "Alrike", label: "Alrike", count: 42 },
		{ value: "Import", label: "Import", count: null },
	]),
	"Konten mit ihrer Anzahl (der aktivste zuerst), maschinelle Schreiber ohne Anzahl",
);

// 💣 DER FALL, DER DEN TRICHTER SONST BEIM ERSTEN HAKEN ZUSPERRT. Ist „Valentin" angehakt, liefert
// der Server NUR NOCH dessen Zeilen -- eine aus der Antwort abgeleitete Namensliste enthielte dann
// nur ihn, und niemand käme je wieder zu „Alrike" zurück. Die Liste kommt deshalb vom Server.
const nurValentin = [{ username: "Valentin" }, { username: "Valentin" }];
const beiFilter = changeLogEditorOptions(nurValentin, new Set(["Valentin"]), roster);
assert.ok(
	beiFilter.some((option) => option.value === "Alrike"),
	"auch unter aktivem Filter bleiben die anderen Namen erreichbar",
);

// 💣 Und ein angehakter Name, den weder Server noch Zeilen kennen, bleibt trotzdem stehen -- sein
// Haken wäre sonst weiter WIRKSAM, ohne dass ihn jemand lösen könnte.
const mitFremdem = changeLogEditorOptions(zeilen, new Set(["Gestern-Weg"]), roster);
assert.ok(
	mitFremdem.some((option) => option.value === "Gestern-Weg" && option.count === null),
	"ein angehakter, unbekannter Name bleibt im Menü -- ohne erfundene Anzahl",
);
// 🔴 `null`, nicht 0: eine 0 stünde als Aussage („der hat nichts gemacht") und wäre falsch.
assert.ok(
	!mitFremdem.some((option) => option.count === 0),
	"keine erfundene Null -- unbekannt heisst null und wird gar nicht angezeigt",
);

assert.strictEqual(changeLogEditorOptions([], new Set(), new Map()).length, 0, "ohne alles ist der Trichter leer");
assert.strictEqual(changeLogEditorOptions(null, null, null).length, 0, "und null wirft nicht");

// ---- Das Sieben im Browser -------------------------------------------------------------------------
// ⚠️ Es bleibt als VERFEINERUNG bestehen, obwohl der Server schon filtert: der Server kennt nur
// Konten, „Import" & Co. leben im after_json. Zwei Ebenen, jede macht, was sie kann.

assert.strictEqual(changeLogFilterEntries(zeilen, new Set()).length, 3, "ohne Haken bleiben alle Zeilen");
assert.strictEqual(changeLogFilterEntries(zeilen, new Set(["Valentin"])).length, 2, "ein Haken siebt auf einen Editor");
assert.strictEqual(changeLogFilterEntries(zeilen, new Set(["Import"])).length, 1, "auch die Import-Tuer laesst sich sieben");
assert.strictEqual(
	changeLogFilterEntries(zeilen, new Set(["Valentin", "Import"])).length,
	3,
	"zwei Haken sind ein ODER, kein UND",
);
assert.strictEqual(changeLogFilterEntries(null, new Set(["Valentin"])).length, 0, "und null wirft nicht");

// ---- Die Adresse, die zum Server geht ---------------------------------------------------------------
// 🔴 Leere Auswahl schickt GAR KEIN Feld mit. Der Server unterscheidet „nichts ausgewählt" (alles
// zeigen) von „eine Auswahl, die niemanden trifft" (nichts zeigen) -- ein leeres `editors=` wäre
// die zweite Lesart und liesse den Filter aussehen, als hätte er sich abgeschaltet.
assert.strictEqual(changeLogRequestUrl("api/x.php", []), "api/x.php", "ohne Auswahl bleibt die Adresse nackt");
assert.strictEqual(changeLogRequestUrl("api/x.php", ["", "  "]), "api/x.php", "leere Namen zählen nicht als Auswahl");
assert.strictEqual(
	changeLogRequestUrl("api/x.php", ["Valentin", "Alrike"]),
	"api/x.php?editors=Valentin%2CAlrike",
	"die Namen reisen als eine Liste mit",
);
assert.strictEqual(
	changeLogRequestUrl("api/x.php?a=1", ["Valentin"]),
	"api/x.php?a=1&editors=Valentin",
	"eine vorhandene Abfrage wird nicht zerschossen",
);
// 💣 Ein Name mit Sonderzeichen muss kodiert werden, sonst zerlegt ein „&" im Namen die Anfrage.
assert.strictEqual(
	changeLogRequestUrl("api/x.php", ["A&B"]),
	"api/x.php?editors=A%26B",
	"Sonderzeichen werden kodiert",
);

// ---- Verdrahtung: eine geprüfte Funktion, die niemand aufruft, beweist nichts -----------------------

assert.ok(
	/changeLogFilterEntries\(changeLogEntries, changeLogEditorFilter\)/.test(source),
	"der Zeichner siebt wirklich, statt changeLogEntries direkt zu zeichnen",
);
assert.ok(
	/avmFilterMenuAttach\(\s*"change-log-filter-toggle",\s*"change-log-filter-menu"/.test(source),
	"der geteilte Trichter ist an die Huelle gehaengt -- kein zweiter Nachbau",
);
// 🔴 Ein Haken LÄDT NACH. Ohne das siebte er weiter nur in den 200 Zeilen, die schon da sind -- und
// die ganze Ablage-Umstellung auf „200 je Person" wäre wirkungslos.
assert.ok(
	/\(\) => changeLogFilterChanged\(\)/.test(source),
	"der Trichter löst ein Nachladen aus, statt nur neu zu zeichnen",
);
assert.ok(
	/changeLogRequestUrl\(MAP_AUDIT_LOG_API_URL, gewaehlt\)/.test(source),
	"die Auswahl reist zur Karte mit",
);
assert.ok(
	/fetchPoliticalChangeLog\(gewaehlt\)/.test(source),
	"die Auswahl reist zu den Herrschaftsgebieten mit",
);
assert.ok(
	/gewaehlt\.length > 0 \? \{ editors: gewaehlt \} : \{\}/.test(source),
	"die Auswahl reist zu den Landschaften mit -- und leer heisst dort ebenfalls „kein Feld\"",
);
assert.ok(
	/changeLogMergeActors\(data\.actors, politicalActors, ecosystemActors\)/.test(source),
	"die Namensliste kommt aus allen drei Antworten",
);

// 💣 DER TRICHTER MUSS AM RECHTEN ENDE SEINER ZEILE STEHEN, sonst ist er zwar da, aber unsichtbar.
// Sein Menü hängt an `right: 0` und klappt nach LINKS auf; steht der Knopf links und ist das Menü
// breiter als er, läuft es aus dem Panel heraus -- und `.review-panel` hat `overflow: hidden`.
// Live gemessen am 22.08.2026: Menü 170px breit bei x = -79, sichtbar blieb allein die Anzahl ganz
// rechts in der Zeile. Überall sonst schiebt das Suchfeld daneben den Trichter nach rechts; im
// Reiter „Änderungen" steht er allein.
//
// ⚠️ Das fängt kein DOM-Test: die Ankreuzfelder EXISTIEREN, tragen Text und die richtige Farbe --
// sie liegen nur außerhalb. Genau deshalb steht die Regel hier als Zusicherung an der CSS-Datei.
const panelCss = fs.readFileSync(path.join(ROOT, "css", "features", "review-panel.css"), "utf8");
assert.ok(
	/\[data-editor-panel-section="changes"\]\s+\.wiki-sync-panel__filter\s*\{[^}]*justify-content:\s*flex-end/.test(panelCss),
	"die Filterzeile des Reiters schiebt den Trichter nach rechts -- sonst klappt sein Menue aus dem Panel",
);
// ⚠️ Seit das Suchfeld in derselben Zeile steht, trägt NICHT MEHR `justify-content` allein die
// rechte Lage: das Feld wächst (`flex: 1 1 auto`) und schiebt den Trichter ohnehin nach rechts. Die
// Regel oben bleibt als zweiter Gurt, aber die tragende Zusicherung ist ab hier die REIHENFOLGE --
// sonst prüfte sie eine Regel, die nichts mehr bewirkt.

// 💣 Die Hülle steht statisch in index.html. Fehlt eine der drei Kennungen, findet avmFilterMenuAttach
// nichts und gibt still eine leere Funktion zurück -- kein Fehler, kein Knopf, kein Hinweis.
const markup = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
for (const id of ["change-log-filter-toggle", "change-log-filter-menu", "change-log-editor-menu"]) {
	assert.ok(markup.includes(`id="${id}"`), `die Huelle traegt #${id}`);
}
const abschnitt = markup.slice(markup.indexOf('data-editor-panel-section="changes"'));
assert.ok(
	abschnitt.indexOf('id="change-log-filter-toggle"') < abschnitt.indexOf('id="change-log-list"'),
	"der Trichter steht im Reiter „Änderungen\", ueber der Liste",
);
assert.ok(
	abschnitt.indexOf('id="change-log-search"') < abschnitt.indexOf('id="change-log-filter-toggle"'),
	"das Suchfeld steht VOR dem Trichter -- der muss das letzte Element der Zeile bleiben",
);
assert.ok(
	abschnitt.indexOf('id="change-log-scope"') < abschnitt.indexOf('id="change-log-search"'),
	"und der Umschalter vor beiden",
);

// ---- Die Suche -------------------------------------------------------------------------------------
const changeLogSearchEntries = sandbox.changeLogSearchEntries;
assert.strictEqual(typeof changeLogSearchEntries, "function", "die echte Funktion ist geladen");

const suchzeilen = [
	{ name: "Pergelbach", username: "nics", action: "update_path_geometry", detail: "14 → 17 Stützpunkte" },
	{ name: "Pergelsee", username: "nics", action: "move_label", detail: "um 2,2 Meilen verschoben" },
	{ name: "Ferdok", username: "nottel", action: "delete_feature", detail: "" },
];
assert.strictEqual(changeLogSearchEntries(suchzeilen, "").length, 3, "ohne Text bleibt alles -- „nichts eingegeben\" ist keine Einschränkung");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "   ").length, 3, "Leerraum ebenso");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "pergel").length, 2, "der Objektname wird durchsucht");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "PERGEL").length, 2, "Gross- und Kleinschreibung ist egal");
// ⚠️ Gesucht wird in dem, was in der Zeile STEHT -- auch in der Aktion und der Erklärzeile. Ein
// Suchfeld, das anderes durchsucht als das Sichtbare, liefert Treffer, die niemand nachvollziehen kann.
assert.strictEqual(changeLogSearchEntries(suchzeilen, "gelöscht").length, 1, "die Aktion wird mitdurchsucht");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "stützpunkte").length, 1, "die Erklärzeile auch");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "nottel").length, 1, "und der Urheber");
assert.strictEqual(changeLogSearchEntries(suchzeilen, "gibtsnicht").length, 0, "ohne Treffer bleibt nichts");
assert.strictEqual(changeLogSearchEntries(null, "x").length, 0, "und null wirft nicht");

// Verdrahtung: die Suche greift VOR dem Bündeln und NACH dem Trichter.
assert.ok(
	/changeLogSearchEntries\(sichtbar, changeLogSearchText\)/.test(source),
	"gesucht wird in dem, was der Trichter übrig lässt -- „Meine\" plus Suchtext ist ein UND",
);
assert.ok(
	/changeLogGroupEntries\(gefunden\)/.test(source),
	"gebündelt wird das Suchergebnis, nicht der Gesamtbestand",
);
assert.ok(
	/Keine Treffer für/.test(source),
	"eine erfolglose Suche sagt das, statt eine leere Fläche zu zeigen",
);
// 🔴 Kein Serverweg. Drei Anfragen je Tastendruck wären auf STRATO genau die Last, die AGENTS.md §10
// verbietet -- und die Frage „was ist gerade passiert" beantwortet die geladene Liste ohnehin.
const suchBlock = source.slice(source.indexOf('getElementById("change-log-search")'), source.indexOf("// Ein Bündel auf- und zuklappen"));
assert.ok(!/loadChangeLog/.test(suchBlock), "das Suchfeld zeichnet neu, es lädt nicht nach");

// 💣 Solange nachgeladen wird, darf NICHT „Keine Änderungen von dieser Auswahl" dastehen: das Sieben
// im Browser findet die Zeilen der Angehakten nicht, weil sie noch gar nicht geladen sind -- der
// richtige Satz zum falschen Zeitpunkt liest sich wie ein Ergebnis. Im Ablauf gemessen, nicht im Test.
assert.ok(
	source.includes('changeLogFilterWartet ? "Änderungen werden geladen ..." : "Keine Änderungen von dieser Auswahl."'),
	"waehrend des Nachladens steht der Ladehinweis da, nicht das leere Ergebnis",
);

// ---- Der Umschalter „Meine · Alle" ----------------------------------------------------------------
// 🔴 Er führt KEINEN eigenen Zustand: „Alle" ist die leere Auswahl, „Meine" der eigene Name allein --
// dieselbe Auswahl, die der Trichter füllt. Zwei getrennte Zustände wären der sichere Weg in einen
// Widerspruch (Umschalter sagt „Alle", Trichter zeigt einen Haken).
const changeLogScopeState = sandbox.changeLogScopeState;
assert.strictEqual(typeof changeLogScopeState, "function", "die echte Funktion ist geladen");

assert.strictEqual(changeLogScopeState(new Set(), "nics"), "all", "keine Auswahl heisst „Alle\"");
assert.strictEqual(changeLogScopeState(new Set(["nics"]), "nics"), "mine", "der eigene Name allein heisst „Meine\"");
// 🔴 DER DRITTE ZUSTAND: steht im Trichter jemand anderes, trifft KEINER der beiden Reiter zu -- dann
// ist auch keiner hervorgehoben. Einen davon trotzdem zu markieren wäre eine Behauptung, die nicht stimmt.
assert.strictEqual(changeLogScopeState(new Set(["Alrike"]), "nics"), "", "ein fremder Name ist keiner von beiden");
assert.strictEqual(changeLogScopeState(new Set(["nics", "Alrike"]), "nics"), "", "ich UND jemand anderes ebenso");
assert.strictEqual(changeLogScopeState(new Set(["nics"]), null), "", "ohne bekannten Namen gibt es kein „Meine\"");
assert.strictEqual(changeLogScopeState(null, "nics"), "all", "und null wirft nicht");

assert.ok(/changeLogSyncScopeButtons\(\)/.test(source), "die Reiter werden mit der Auswahl abgeglichen");
assert.ok(
	/knopf\.dataset\.changeLogScope === "mine" && meinName !== null/.test(source),
	"„Meine\" setzt den eigenen Namen als Auswahl",
);
assert.ok(
	/huelle\.hidden = meinName === null/.test(source),
	"ohne Sitzung gibt es den Umschalter gar nicht -- ein Knopf, der nichts tun kann, gehoert weg",
);
for (const marke of ['id="change-log-scope"', 'data-change-log-scope="mine"', 'data-change-log-scope="all"']) {
	assert.ok(markup.includes(marke), `die Huelle traegt ${marke}`);
}
// ⚠️ Er benutzt die Reiter-Form, die im selben Panel schon dreimal steht -- kein zweites Aussehen.
assert.ok(
	/data-change-log-scope="mine"[^>]*>|class="status-subtab"[^>]*data-change-log-scope/.test(markup)
		&& markup.includes('class="status-subtab" type="button" data-change-log-scope="mine"'),
	"der Umschalter benutzt .status-subtab, nicht eine eigene Knopfform",
);

// 🔴 KEIN STATUSFELD ÜBER DER LISTE (Owner 22.08.2026: „kannst du das ‚200 Änderungen‘ bzw. das
// komische Statusfeld zum Laden raus? braucht niemand") -- dieselbe Entscheidung wie am 19.07.2026
// im WikiSync-Panel („es braucht kein statusfeld -- nirgends").
//
// 💣 Was dabei NICHT verschwinden darf: ein leerer Zustand und ein Ladefehler. Eine leere Fläche ohne
// jedes Wort liest sich wie ein Fehler, und ein Fehler, der nur in der Konsole steht, ist für einen
// Editor keine Meldung, sondern eine leere Liste. Beides hat deshalb eine neue Heimat -- die Liste
// selbst und die Einblendung.
assert.ok(!markup.includes('id="change-panel-status"'), "das Statusfeld ist aus dem Markup verschwunden");
assert.ok(!/setChangePanelStatus/.test(source), "und sein Schreiber wird nicht mehr gerufen");
assert.ok(/changeLogRenderNotice\("Noch keine Änderungen\."\)/.test(source), "der leere Zustand steht in der Liste");
assert.ok(
	/showFeedbackToast\(error\.message \|\| "Änderungsverlauf konnte nicht geladen werden\."/.test(source),
	"ein Ladefehler geht in die Einblendung, nicht nur in die Konsole",
);

console.log("change-log-editor-filter ok");
