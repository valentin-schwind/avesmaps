// The WikiSync panel's subjects, as DATA. Everything else -- the selection grid, the verb row,
// the list's tab strip, the filter menu -- reads from here, so a new feature costs one entry
// instead of a new nesting level. Spec: docs/superpowers/specs/2026-07-22-editor-navigation-design.md
//
// Loaded before review-wiki-sync.js in index.html; plain globals, no build.

// Shared view-tab sets. "Alle | Platziert | Fehlt" is what the four map-object lists already
// render (review-settlement-list.js:200, review-wiki-sync.js:309, review-region-sync.js:208).
const WIKI_SYNC_MAP_VIEWS = [
	{ key: "all", label: "Alle" },
	{ key: "placed", label: "Platziert" },
	{ key: "missing", label: "Fehlt" },
];

// Wege carry two more (review-path-sync.js:249). The "Konflikte" here are the Verlauf legacy
// cases, which DO belong to one path -- not the conflict centre's computed rules, which belong
// to no single object (api/_internal/conflicts/store.php:12). Both may coexist.
const WIKI_SYNC_PATH_VIEWS = WIKI_SYNC_MAP_VIEWS.concat([
	{ key: "cases", label: "Konflikte" },
	{ key: "flow", label: "Flussrichtung unbekannt" },
]);

// Vorkommen divides by lore_entry.kind. This is a tab strip and not a filter facet because the
// kinds do NOT share a field set: "Gegenstandstyp" is rendered only for kind==='ware'
// (review-wiki-sync.js:2168), so that facet cannot exist in a mixed list. Spec §5.2.
const WIKI_SYNC_LORE_VIEWS = [
	{ key: "all", label: "Alle" },
	{ key: "fauna", label: "Fauna" },
	{ key: "flora", label: "Flora" },
	{ key: "ware", label: "Waren" },
	{
		key: "spezies",
		label: "Spezies",
		// Public display is off (owner 2026-07-21) but the data is complete and stays editable,
		// so the tab is greyed -- never removed. Reason verbatim from index.html:819: a greyed
		// surface without a reason gets flipped back by someone "tidying up".
		off: true,
		reason: "Das Wiki-Feld „Regionen“ der Infobox Spezies ist zu schlecht gepflegt. "
			+ "Die Daten liegen vollständig vor und kommen beim Einschalten sofort zurück.",
	},
];

// 💣 EIN Knopf je Subjekt, und zwar der, den es schon gibt (Owner 2026-07-22, korrigiert eine
// frühere Fassung dieser Datei). Die Regel steht in wikiSyncSubjectButtonId: Editor-Knopf, sonst
// Sync-Knopf. Kein Paar „Syncen | Bearbeiten" bauen — das hatte zwei Folgen, beide falsch:
// jedes Subjekt zeigte seinen Knopf DOPPELT (einmal neu, einmal als alte Kachel darunter), und
// für Siedlungen/Abenteuer/Karten/Vorkommen holte es ein „Syncen" ins Panel zurück, das dort
// bewusst entfernt worden war (Owner 2026-07-07 „Ersetzen"; der Lore-Kommentar sagt wörtlich
// „Im Reiter darf er nicht auftauchen"). Deren Sync lebt in ihrem Editor-Fenster.
//
// syncButtonId: null heißt „kein Sync-Knopf im PANEL" -- bei Karten läuft der Sync
// ausschließlich über „Karten syncen" im Karteneditor (startWikiSyncCitymapsSync).
// editorButtonId: null heißt „kein Listen-Editor" (Regionen, Wege). Kraftlinien haben seit dem
// sechsten Editor einen (powerline-editor-open, js/review/review-powerline-list.js).
//
// syncKind is the key the SERVER answers "last synced" under
// (avesmapsWikiDumpSyncKindLastSynced, api/_internal/wiki/dump-sync-kind.php): singular and
// spelled differently from the subject key, so the rail must translate rather than guess. null
// means the server has no kind for this subject -- powerlines and lore genuinely have none, and
// inventing one would make the rail claim a date it never received.
const WIKI_SYNC_SUBJECTS = [
	{ key: "locations",   label: "Siedlungen",  syncButtonId: "wiki-sync-sync-settlement",  editorButtonId: "settlement-editor-open", syncKind: "settlement", views: WIKI_SYNC_MAP_VIEWS },
	{ key: "territories", label: "Territorien", syncButtonId: "wiki-sync-territories",      editorButtonId: null,                     syncKind: "territory",  views: WIKI_SYNC_MAP_VIEWS },
	{ key: "regions",     label: "Regionen",    syncButtonId: "wiki-sync-sync-region",      editorButtonId: null,                     syncKind: "region",     views: WIKI_SYNC_MAP_VIEWS },
	{ key: "paths",       label: "Wege",        syncButtonId: "wiki-sync-sync-path",        editorButtonId: null,                     syncKind: "path",       views: WIKI_SYNC_PATH_VIEWS },
	{ key: "powerlines",  label: "Kraftlinien", syncButtonId: "wiki-sync-powerlines-sync",  editorButtonId: "powerline-editor-open", syncKind: null,         views: [] },
	{ key: "adventures",  label: "Abenteuer",   syncButtonId: "wiki-sync-sync-adventure",   editorButtonId: "adventure-editor-open",  syncKind: "adventure",  views: [] },
	{ key: "citymaps",    label: "Karten",      syncButtonId: null,                         editorButtonId: "citymaps-editor-open",   syncKind: "citymap",    views: [] },
	// Label "Vorkommen", key stays `lore`: renaming the key buys nothing but a chance to miss
	// one place (same reasoning as index.html:383). Here label and key even agree.
	// syncKind "lore" beantwortet NICHT der Dump-Endpunkt, sondern der Lore-Katalog selbst
	// (api/app/lore.php liefert last_synced aus app_setting). loadLoreList hängt den Wert in
	// dieselbe Map ein, aus der die Auswahlzeile alle Daten liest.
	{ key: "lore",        label: "Vorkommen",   syncButtonId: "wiki-sync-sync-lore",        editorButtonId: "wiki-sync-lore-open",    syncKind: "lore",       views: WIKI_SYNC_LORE_VIEWS },
];

// Die Facetten je Subjekt -- FELD und BESCHRIFTUNG, niemals Werte. Die Werte leitet der
// Optionsbauer aus den geladenen Zeilen ab, samt Zähler, so wie pathTypeOptions() es seit jeher
// tut (js/review/review-path-sync.js:78). Owner 2026-07-22, und damit ersetzt: die frühere
// Fassung der Anweisung schrieb Wertelisten fest ins Programm. Eine feste Liste bietet Werte an,
// die es nicht gibt, und verschluckt echte -- und ein leeres Ergebnis sieht dann genauso aus wie
// „gibt es nicht".
//
// kind:
//   "multi"  verschiedene Werte von `field`, Ankreuzfelder (Typ, Kontinent, DSA-Version, …)
//   "flag"   ist `field` gefüllt? -> ja/nein (Wappen, Bilder, Cover, F-Shop, Vorschaubild)
//   "tri"    `field` ist ja / nein / unbekannt -- die dreiwertigen Karten-Spalten, wo NULL
//            „weiß niemand" heißt und nicht „nein" (api/_internal/app/citymaps.php:280)
//   "source" die geteilte Wiki/Andere/Keine-Lesart, die über MEHRERE Felder geht
//            (getItemSourceCategory, js/app/utils.js) -- deshalb hier ohne `field`
//
// Wo ein Editor den Filter schon hat, steht hier SEIN Satz: die Panel-Liste und das Fenster
// desselben Subjekts sollen nicht zwei verschiedene Fragen stellen können.
//
// Kraftlinien fehlen absichtlich: 61 Namen sind zu wenig, als dass ein Filter sich lohnte
// (Owner 2026-07-22). Vorkommen fehlt ebenfalls, aber aus einem anderen Grund -- seine Liste
// kommt serverseitig seitenweise (api/app/lore.php, limit=200 über ~35.000 Zeilen), also könnte
// eine Facette hier nur das gerade geladene Fenster sehen und filtern. Seine Facetten müssen in
// die Abfrage, nicht in den Browser; das ist ein eigener Schritt.
const WIKI_SYNC_SUBJECT_FACETS = {
	locations: [
		{ key: "type", label: "Typ", kind: "multi", field: "settlement_label" },
		{ key: "continent", label: "Kontinent", kind: "multi", field: "continent" },
		{ key: "source", label: "Quelle", kind: "source", field: "" },
		{ key: "coat", label: "Wappen", kind: "flag", field: "has_coat" },
		{ key: "image", label: "Bilder", kind: "flag", field: "image_count" },
	],
	adventures: [
		{ key: "type", label: "Typ", kind: "multi", field: "product_type" },
		{ key: "edition", label: "DSA-Version", kind: "multi", field: "edition" },
		// Liest die Ortsliste, nicht ein Feld der Zeile -- der Optionsbauer dafür steht am
		// Aufrufer (avesmapsAdvRegionOptions). „Jahr von/bis" und „Ort" bleiben im Fenster:
		// beide passen in keine der vier Arten oben, und die Panel-Liste ist die Fläche, von
		// der man wegspringt, nicht die, auf der man recherchiert.
		{ key: "region", label: "Region", kind: "multi", field: "places" },
		{ key: "cover", label: "Cover", kind: "flag", field: "has_cover" },
		{ key: "fshop", label: "F-Shop", kind: "flag", field: "has_fshop" },
	],
	citymaps: [
		// Beschriftungen wörtlich wie im Karteneditor (html/citymap-editor.html:995) -- dieselbe
		// Spalte darf im Panel nicht anders heißen als im Fenster.
		{ key: "paid", label: "kostenpflichtig", kind: "tri", field: "is_paid" },
		{ key: "scale", label: "mit Maßstab", kind: "tri", field: "has_scale" },
		{ key: "preview", label: "Vorschaubild", kind: "flag", field: "thumb" },
		{ key: "thumbOrigin", label: "Vorschaubild von", kind: "multi", field: "thumb_origin" },
	],
};

function wikiSyncSubjectByKey(key) {
	return WIKI_SYNC_SUBJECTS.find((subject) => subject.key === key) || null;
}

// Die Facetten eines Subjekts, oder eine leere Liste. EIN Argument, nicht zwei: die Anweisung
// nannte hier ein zweites (viewKey), mit dem Vorkommen seine Facette „Art" hätte ausblenden
// sollen, sobald der Reiterstreifen schon eine Art wählt. Vorkommen ist vertagt (siehe oben),
// also hätte jeder Aufrufer heute `undefined` übergeben und der Parameter nichts getan. Wenn
// Vorkommen kommt, ist das ein zweizeiliger Nachtrag samt Test -- ein Parameter ohne Wirkung
// wäre bis dahin nur Maschinerie, die vorgibt, etwas zu können.
function wikiSyncSubjectFacets(key) {
	return WIKI_SYNC_SUBJECT_FACETS[key] || [];
}

function wikiSyncIsKnownSubject(key) {
	return wikiSyncSubjectByKey(key) !== null;
}

// Der EINE Knopf des Subjekts: der Editor-Knopf, wo es einen gibt, sonst der Sync-Knopf. Er wird
// nicht nachgebaut, sondern an eine feste Stelle unter die Auswahl VERSCHOBEN (renderWikiSyncVerbs)
// -- id, Bindung, Fortschrittsanzeige im Knopf und das „Zuletzt gesynct" darin ziehen mit um, und
// es bleibt kein zweiter Knopf übrig, der auseinanderlaufen könnte.
function wikiSyncSubjectButtonId(key) {
	const subject = wikiSyncSubjectByKey(key);
	if (!subject) return null;
	return subject.editorButtonId || subject.syncButtonId || null;
}

function wikiSyncSubjectViewTabs(key) {
	const subject = wikiSyncSubjectByKey(key);
	return subject ? subject.views : [];
}

function wikiSyncSubjectSyncKind(key) {
	const subject = wikiSyncSubjectByKey(key);
	return subject ? subject.syncKind : null;
}
