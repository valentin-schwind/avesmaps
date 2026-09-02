// DIE ZWEI LISTENFLAECHEN des Kanon-Etiketts: der Suchtreffer und die Konfliktpartei.
// Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md
//
// 🔴 IN EINER LISTE STEHT NUR DAS INOFFIZIELLE, und ohne Bezeichner. Die allermeisten Objekte
// sind offiziell; ein goldener Chip in fast jeder Zeile ist kein Etikett mehr, sondern
// Grundrauschen -- und er verdeckt genau das, was die Halbpille leisten soll.
//
// 💣 DREI VOKABULARE, UND SIE WIDERSPRECHEN SICH. „region" heisst im Suchtreffer das
// HERRSCHAFTSGEBIET, im Konfliktzentrum gibt es das Wort gar nicht, und die LANDSCHAFT heisst an
// beiden Stellen „label". Eine geteilte Wort-Tabelle waere fuer eine der beiden Flaechen falsch --
// deshalb uebersetzt jede Flaeche selbst, und geteilt sind nur Aufloeser und Renderer. Dieser Test
// haelt beide Uebersetzungen gegeneinander, damit die Absicht nicht als Schlamperei „aufgeraeumt"
// wird.
//
// ⚠️ Gefahren wird der ECHTE Code, aus den echten Dateien geschnitten (Hausmuster aus
// label-infobox-eigene-art.test.js) -- eine Abschrift hier waere die zweite Wahrheit.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/kanon-flaechen.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");

let pruefungen = 0;
function pruefe(bedingung, was) {
	assert.ok(bedingung, was);
	pruefungen++;
}

/** Ein Ausschnitt zwischen zwei Ankern -- wirft, statt still nichts auszufuehren. */
function ausschnitt(quelle, von, bis, wo) {
	const a = quelle.indexOf(von);
	const b = quelle.indexOf(bis, a + 1);
	assert.ok(a >= 0, `${wo}: Anfangsanker fehlt (${von})`);
	assert.ok(b > a, `${wo}: Endanker fehlt (${bis})`);
	return quelle.slice(a, b);
}

function baueKontext(kanonKarte, refsKarte) {
	const context = {
		console,
		window: { __featureKanon: kanonKarte, __featureSourceRefs: refsKarte },
		escapeHtml: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
		tr: (schluessel, rueckfall) => rueckfall,
	};
	context.globalThis = context;
	vm.createContext(context);

	// Der echte Renderer -- er bringt featureKanonBadgeMarkup mit.
	vm.runInContext(lies("js", "ui", "feature-source-markup.js"), context);

	// Die Kanon-Haelfte von popups.js. Der Rest der Datei braucht ein DOM.
	// ⚠️ ZEILENENDENNEUTRALE Anker (AGENTS.md §9): die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
	// Ein Anker mit `\n` darin ist auf diesem Rechner gruen und in der CI rot -- oder umgekehrt.
	// ⚠️ Der Endanker ist der ANFANG des Exportblocks, nicht eine Zeile darin: mittendrin
	// geschnitten fehlt die schliessende Klammer und der vm meldet „Unexpected end of input“ --
	// was wie ein kaputter Test aussieht und ein falscher Schnitt ist.
	const popups = lies("js", "ui", "popups.js");
	const exportIdx = popups.lastIndexOf("if (typeof window", popups.indexOf("window.resolveFeatureSourceList = "));
	assert.ok(exportIdx > 0, "der Exportblock von popups.js muss auffindbar sein");
	const kanonTeil = ausschnitt(popups, "function resolveFeatureKanon", popups.slice(exportIdx, exportIdx + 40), "popups.js");
	vm.runInContext(kanonTeil, context);

	// Die zwei Flaechen-Uebersetzer.
	const spotlight = lies("js", "ui", "spotlight-search.js");
	vm.runInContext(ausschnitt(spotlight, "function spotlightEntryKanonRef", "function spotlightResultMarkup", "spotlight-search.js"), context);
	const conflicts = lies("js", "review", "review-conflicts.js");
	vm.runInContext(ausschnitt(conflicts, "function conflictPartyKanonBadge", "function createConflictPartyElement", "review-conflicts.js"), context);

	return context;
}

const KANON = {
	vorgabe: "offiziell",
	abweichungen: {
		"settlement:p-brief": { kanon: "inoffiziell", bezeichner_label: "Briefspiel (Garetien)" },
		"settlement:p-ns222": { kanon: "inoffiziell", bezeichner_label: "Wiki Aventurica" },
		"region:l-moor": { kanon: "inoffiziell", bezeichner_type: "briefspiel", bezeichner_count: 2 },
		"territory:t-mark": { kanon: "inoffiziell", bezeichner_label: "Briefspiel (Garetien)" },
		"path:w-1": { kanon: "inoffiziell", bezeichner_label: "Briefspiel (Garetien)" },
	},
};
// Objekte MIT Quellen -- die Vorgabe „offiziell" gilt nur fuer sie.
const REFS = {
	"settlement:p-brief": [{ source_id: 2 }],
	"settlement:p-ns222": [],
	"settlement:p-gareth": [{ source_id: 1 }],
	"region:l-moor": [{ source_id: 2 }],
	"territory:t-mark": [{ source_id: 2 }],
	"path:w-1": [{ source_id: 2 }],
	"settlement:p-unbelegt": [],
};

const ctx = baueKontext(KANON, REFS);

// ---- A. Das Listen-Etikett: nur das Inoffizielle, ohne Bezeichner ----------------------------
const brief = ctx.featureKanonListBadge("settlement", "p-brief");
pruefe(brief.includes("fs-kanon--inoff"), "ein inoffizielles Objekt bekommt sein Etikett");
pruefe(brief.includes(">Inoffiziell<"), "der Wortlaut steht im Element");
// 💣 OHNE Bezeichner: neben einem Namen ist kein Platz fuer „Briefspiel (Garetien)", und ein Chip,
// der die halbe Zeile nimmt, verdraengt genau die Angabe, wegen der jemand liest.
pruefe(!brief.includes("Briefspiel"), "in der Liste ohne Bezeichner");
pruefe(!brief.includes("fs-kanon--split"), "und damit als ganze Pille, nicht als Halbpille");
// 🔴 „Offiziell" wird in einer Liste NICHT gezeigt -- sonst traegt fast jede Zeile einen goldenen
// Chip, und die Ausnahme faellt nicht mehr auf.
pruefe(ctx.featureKanonListBadge("settlement", "p-gareth") === "", "offiziell bleibt in der Liste stumm");
pruefe(ctx.featureKanonListBadge("settlement", "p-unbelegt") === "", "unbelegt ebenso");
pruefe(ctx.featureKanonListBadge("settlement", "gibt-es-nicht") === "", "ein unbekanntes Objekt ebenso");

// ---- B. Der Kopf zeigt weiterhin BEIDES samt Bezeichner ---------------------------------------
// ⚠️ Die Liste kuerzt, der Kopf nicht -- sonst waere die Kuerzung eine stille Regel fuer alle.
const kopf = ctx.renderFeatureKanonBadge("settlement", "p-brief");
pruefe(kopf.includes("fs-kanon--split") && kopf.includes("Briefspiel (Garetien)"),
	"im Objektkopf steht der Bezeichner weiterhin");
pruefe(ctx.renderFeatureKanonBadge("settlement", "p-gareth").includes("fs-kanon--off"),
	"und dort wird „offiziell“ auch gezeigt");

// ---- C. Der Suchtreffer: seine drei Objektarten, jede mit IHRER Kennung -----------------------
pruefe(JSON.stringify(ctx.spotlightEntryKanonRef({ kind: "location", publicIds: ["p-brief"] }))
	=== JSON.stringify(["settlement", "p-brief"]), "location -> settlement");
pruefe(JSON.stringify(ctx.spotlightEntryKanonRef({ kind: "label", publicIds: ["l-moor"] }))
	=== JSON.stringify(["region", "l-moor"]), "label -> region");
// 💣 Das Herrschaftsgebiet traegt ZWEI public_id, und die Quellen haengen an der ZWEITEN.
// `publicIds[0]` ist die der gezeichneten Flaeche und faende nichts.
pruefe(JSON.stringify(ctx.spotlightEntryKanonRef({
	kind: "region", publicIds: ["r-flaeche"], regionEntry: { territoryPublicId: "t-mark" },
})) === JSON.stringify(["territory", "t-mark"]), "region -> territory, ueber territoryPublicId");
pruefe(ctx.spotlightEntryKanonRef({ kind: "region", publicIds: ["r-flaeche"], regionEntry: {} }) === null,
	"ohne Territoriums-Kennung lieber gar kein Etikett als eines am falschen Schluessel");
// ⚠️ Wege und Kraftlinien fehlen mit Absicht: ein Treffer buendelt ihre SEGMENTE, der Kanon
// haengt je Segment. Ein Etikett aus dem erstbesten waere eine ungeprueftе Aussage ueber alle.
pruefe(ctx.spotlightEntryKanonRef({ kind: "path", publicIds: ["w-1"] }) === null, "Wege bleiben aussen vor");
pruefe(ctx.spotlightEntryKanonRef({ kind: "powerline", publicIds: ["k-1"] }) === null, "Kraftlinien ebenso");
for (const kind of ["citymap", "adventure", "lore", "offmap", "in_settlement"]) {
	pruefe(ctx.spotlightEntryKanonRef({ kind, publicIds: ["x"] }) === null, `${kind} traegt kein Kanon-Etikett`);
}
pruefe(ctx.spotlightEntryKanonRef({ kind: "location", publicIds: [] }) === null, "ohne public_id kein Schluessel");

// ---- D. Die Konfliktpartei: ihr EIGENES Vokabular ---------------------------------------------
pruefe(ctx.conflictPartyKanonBadge({ type: "location", id: "p-brief" }).includes("fs-kanon--inoff"),
	"eine Ortspartei bekommt ihr Etikett");
pruefe(ctx.conflictPartyKanonBadge({ type: "label", id: "l-moor" }).includes("fs-kanon--inoff"),
	"label -> region, wie im Suchtreffer");
pruefe(ctx.conflictPartyKanonBadge({ type: "territory", id: "t-mark" }).includes("fs-kanon--inoff"),
	"territory -> territory");
// 🔴 Hier IST der Weg dabei: eine Partei ist EIN Objekt, kein gebuendelter Name.
pruefe(ctx.conflictPartyKanonBadge({ type: "path", id: "w-1" }).includes("fs-kanon--inoff"),
	"path -> path, anders als im Suchtreffer");
// ⚠️ Bewusst draussen -- die Begruendung steht am Code.
for (const typ of ["powerline", "adventure", "citymap"]) {
	pruefe(ctx.conflictPartyKanonBadge({ type: typ, id: "x" }) === "", `${typ} traegt hier kein Etikett`);
}
pruefe(ctx.conflictPartyKanonBadge({ type: "location", id: "" }) === "", "ohne Kennung kein Etikett");
pruefe(ctx.conflictPartyKanonBadge({}) === "", "und eine formlose Partei faellt still durch");

// ---- E. DIE WIDERSPRUECHLICHEN VOKABULARE, festgenagelt ---------------------------------------
// 💣 Wer die zwei Tabellen je zusammenlegen will, muss hier vorbei: „region" heisst im Suchtreffer
// das Herrschaftsgebiet und im Konfliktzentrum NICHTS. Eine gemeinsame Tabelle waere fuer genau
// eine der beiden Flaechen falsch -- und der Fehler waere still, weil ein fehlendes Etikett kein
// Fehlerbild hat.
pruefe(ctx.spotlightEntryKanonRef({ kind: "region", publicIds: ["x"], regionEntry: { territoryPublicId: "t-mark" } })[0]
	=== "territory", "Suchtreffer: „region“ IST das Herrschaftsgebiet");
pruefe(ctx.conflictPartyKanonBadge({ type: "region", id: "t-mark" }) === "",
	"Konfliktzentrum: „region“ gibt es nicht — dort heisst dasselbe „territory“");

// ---- F. Die Verdrahtung beider Flaechen --------------------------------------------------------
const spotlightQuelle = lies("js", "ui", "spotlight-search.js");
pruefe(/featureKanonListBadge\(kanonRef\[0\], kanonRef\[1\]\)/.test(spotlightQuelle),
	"der Suchtreffer ruft das Listen-Etikett");
// 🔴 Das Etikett schliesst die Zeile ab -- dieselbe Stelle wie im Quellenkasten.
const namenIdx = spotlightQuelle.indexOf("spotlight-search__result-name");
const typIdx = spotlightQuelle.indexOf("spotlight-search__result-type\">");
const kanonIdx = spotlightQuelle.indexOf("${kanon}");
pruefe(namenIdx < typIdx && typIdx < kanonIdx, "es steht hinter Name und Typangabe");
const conflictsQuelle = lies("js", "review", "review-conflicts.js");
pruefe(/conflictPartyKanonBadge\(party\)/.test(conflictsQuelle), "die Konfliktpartei ruft es ebenfalls");

// ---- G. Die dritte Rasterspalte des Suchtreffers ------------------------------------------------
// 💣 Ohne sie landet der Chip in der Typspalte und schiebt deren Ellipse -- die Zeile verliert
// dann genau das Wort, das sie tragen soll.
const spotCss = lies("css", "components", "spotlight-search.css");
const zeilenRegel = spotCss.slice(spotCss.indexOf(".spotlight-search__result {"));
pruefe(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;/.test(zeilenRegel.slice(0, 400)),
	"die Trefferzeile hat drei Spalten");

// ---- H. EINE Rezeptur fuer den Chip --------------------------------------------------------------
// 💣 Die zwei neuen Flaechen setzen ihre Huelle, nie den Chip selbst neu. Eine zweite `.fs-kanon`
// woanders waere die Divergenz, die dieses Repo bei den Listenzeilen siebenfach bezahlt hat.
for (const datei of ["css/components/spotlight-search.css", "css/features/review-panel.css"]) {
	const quelle = lies(...datei.split("/"));
	pruefe(!/^\.fs-kanon\b/m.test(quelle), `${datei} darf den Chip nicht zweitfassen`);
}
// ⚠️ Und die 11px-Untergrenze des Hauses gilt auch fuer ihn (AGENTS.md §12): hier standen 9,5px,
// vom Nachbarn abgeschrieben — derselbe Weg, auf dem der Fehler schon einmal von einer Liste in
// die naechste gewandert ist.
const fsCss = lies("css", "features", "feature-sources.css");
const chip = fsCss.slice(fsCss.indexOf(".fs-kanon {"), fsCss.indexOf(".fs-kanon--off"));
pruefe(/font-size:\s*var\(--font-size-caption\)/.test(chip), "der Chip nimmt die Untergrenze als Token");

// ---- H1. Die Fettung -- und warum sie ZWEI Zeilen braucht ------------------------------------
// 💣 EIN `font-weight: 700` IST IN DIESEM REPO EIN LEERLAUF. Die Hausschrift Faculty Glyphic
// liefert nur Regular, und css/base/base.css schaltet die Kunstfettung appweit ab
// (`* { font-synthesis-weight: none }`, dort begruendet: bei Fliesschrift blutet sie aus).
// Der computed value steht dann auf 700, gezeichnet wird aber Zeichen fuer Zeichen dasselbe Bild
// -- live gemessen 02.09.2026: Pillenbreite 82,47px vor wie nach dem Gewicht, und im 4x-Vergleich
// sind „400" und „700 ohne Synthese" nicht zu unterscheiden.
// 🔴 Owner 02.09.2026 ausdruecklich als Ausnahme: das Etikett bleibt auf der 11px-Untergrenze
// (AGENTS.md §12) und wird stattdessen GEFETTET. Die Ausnahme haelt nur, solange BEIDE Zeilen
// dastehen; wer die zweite fuer ueberfluessig haelt, nimmt die Fettung mit, und nichts wird rot.
// Genau davor steht diese Zusicherung.
// 🪤 `indexOf(".fs-kanon {")` traefe `.fs-src-row .fs-kanon {` MIT -- der Selektor enthaelt den
// anderen als Teilzeichenkette und steht in der Datei frueher. Gesucht wird am ZEILENANFANG und
// geschnitten an der schliessenden Klammer, nicht nach einer Zeichenzahl.
const regelGenau = (selektor) => {
	const t = new RegExp("^" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "m").exec(fsCss);
	pruefe(!!t, `die Regel ${selektor} muss es geben`);
	const ab = fsCss.slice(t.index);
	return ab.slice(0, ab.indexOf("}") + 1);
};
const chipRegel = regelGenau(".fs-kanon");
pruefe(/font-weight:\s*700\s*;/.test(chipRegel), "das Kanonwort steht fett");
pruefe(/font-synthesis-weight:\s*auto\s*;/.test(chipRegel),
	"und hebt die appweite Abschaltung auf -- ohne diese Zeile ist die Fettung unsichtbar");
pruefe(/font-synthesis-weight:\s*none\s*;/.test(lies("css", "base", "base.css")),
	"die appweite Abschaltung steht weiterhin in base.css -- sie ist der Grund fuer die Zeile darueber");

// ⚠️ UND DAS BEZEICHNERFELD BLEIBT UNGEFETTET. Es erbt sonst die Fettung vom Chip, und der Name
// („Briefspiel (Garetien)") traegt dieselbe Auszeichnung wie das Kanonwort -- dieselbe zweite
// Auszeichnung, die dort schon fuer VERSAL+gesperrt verworfen wurde.
pruefe(/font-weight:\s*400\s*;/.test(regelGenau(".fs-kanon--split .fs-kanon__by")),
	"der Bezeichner bleibt ungefettet, waehrend der Chip es ist");

// ---- I. Die Suchkachel ist in BEIDEN Themen dunkel ----------------------------------------------
// 💣 Also traegt das Etikett dort die Fassung fuer dunkle Flaechen, unabhaengig vom Thema der
// Seite. Ohne die Umbelegung hob es sich im HELLEN Thema kaum von der Kachel ab -- im Browser
// gemessen 2,33:1 statt 7,37:1, unter den 3:1 einer Nicht-Text-Grenze. Die Schrift im Chip war
// dabei lesbar; auffallen konnte er nur nicht, und das ist seine einzige Aufgabe.
const kachel = spotCss.slice(spotCss.indexOf(".spotlight-search {"), spotCss.indexOf(".spotlight-search__title"));
for (const token of ["official", "official-text", "unofficial", "unofficial-text"]) {
	pruefe(kachel.includes(`--color-kanon-${token}: var(--color-kanon-${token}-on-dark);`),
		`die Suchkachel muss --color-kanon-${token} auf die Dunkelfassung legen`);
}
// ⚠️ Und die Dunkelfassung existiert GENAU EINMAL: das dunkle Thema verweist darauf, statt die
// vier Werte ein zweites Mal zu tippen -- sonst laufen sie beim naechsten Farbdreh auseinander.
const tokensCss = lies("css", "base", "tokens.css");
for (const token of ["official", "official-text", "unofficial", "unofficial-text"]) {
	const definiert = tokensCss.match(new RegExp(`^\\s*--color-kanon-${token}-on-dark:`, "gm")) || [];
	pruefe(definiert.length === 1, `--color-kanon-${token}-on-dark darf nur einmal definiert sein`);
	pruefe(tokensCss.includes(`--color-kanon-${token}: var(--color-kanon-${token}-on-dark);`),
		`das dunkle Thema muss --color-kanon-${token} daraus beziehen, nicht abschreiben`);
}

console.log(`kanon-flaechen.test.js: ${pruefungen} Pruefungen erfuellt`);
