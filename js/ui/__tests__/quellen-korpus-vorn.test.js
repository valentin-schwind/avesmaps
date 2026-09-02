const assert = require("assert");
const fs = require("fs");
const path = require("path");

// WELCHER NAME STEHT DEM BESUCHER VORN? Entwurf §3.1 (Variante A, Owner-Entscheid 02.09.2026):
// bei einer BELEGSTELLE der Korpusname, bei einem WERK der Titel.
//
// 💣 WARUM. Live gemessen am 02.09.2026 (Kartennutzlast, `os:` ausgeschlossen): von 133
// Belegstellen-Zeilen heissen 33 schlicht „Briefspiel", 24 „AlmadaWiki", 32 tragen als Titel den
// Dateinamen „Datei : Ponterra detailliert.jpg" -- und 15 gar keinen. Der Titel sagt dem Besucher
// dort nichts; der Wirt sagt ihm, WOHER es kommt.
//
// 🔴 UND DIE GEGENRICHTUNG IST GENAUSO WICHTIG: 879 der 1384 Katalogzeilen sind Werke (f-shop,
// ulisses). Dort waere „f-shop.de" die schlechtere Auskunft -- sie behalten ihren Titel.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/quellen-korpus-vorn.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(wurzel, "js/ui/feature-source-markup.js"));

let pruefungen = 0;
const pruefe = (b, t) => { assert.ok(b, t); pruefungen++; };
const gleich = (a, b, t) => { assert.strictEqual(a, b, t); pruefungen++; };

const KORPORA = {
  "westlande.de": { label: "AlberniaWiki", form: "belegstelle" },
  "herzogtum-weiden.net": { label: "Herzogtum Weiden", form: "belegstelle" },
  "wiki-aventurica.de": { label: "Wiki Aventurica", form: "werk" },
  "punin.de": { label: "Almada Wiki", form: "" },
};
const quelle = (o) => Object.assign({
  url: "https://westlande.de/albernia/index.php?title=Apfeldorn", label: "Apfeldorn",
  type: "briefspiel", official: false, reference_kind: "", license: "", attribution: "",
}, o);
const vorn = (html) => (html.match(/class="fs-src-a"[^>]*>([^<]*)/) || ["", ""])[1].trim();
const bau = (q) => markup.buildSourceListMarkup("", [q], { corpora: KORPORA });

// ── 1 · Belegstelle: der Korpusname ──────────────────────────────────────────────────────────
gleich(vorn(bau(quelle({ corpus: "westlande.de" }))), "AlberniaWiki",
  "eine Belegstelle zeigt den Namen ihres Wirts");
// 💣 Genau der gemeldete Fall: aus „Briefspiel" (33-mal im Katalog) wird „Herzogtum Weiden".
gleich(vorn(bau(quelle({ corpus: "herzogtum-weiden.net", label: "Briefspiel" }))), "Herzogtum Weiden",
  "aus „Briefspiel“ wird der Wirt");
// ... und aus dem Dateinamen, der an 32 Objekten steht.
gleich(vorn(bau(quelle({ corpus: "herzogtum-weiden.net", label: "Datei : Ponterra detailliert.jpg" }))),
  "Herzogtum Weiden", "und aus einem Dateinamen ebenso");
// 🔴 Und der TITEL geht nicht verloren -- er wandert ins ⓘ. Ohne das waere dieser Umbau
// Datenverlust in der Anzeige.
pruefe(/<dt>Titel<\/dt><dd>Apfeldorn<\/dd>/.test(bau(quelle({ corpus: "westlande.de" }))),
  "der Titel steht in der Rechtetafel");
// ⚠️ Der LINK zeigt weiter auf die genaue Seite, nicht auf die Startseite des Wirts.
pruefe(/href="https:\/\/westlande\.de\/albernia\/index\.php\?title=Apfeldorn"/.test(
  bau(quelle({ corpus: "westlande.de" }))), "der Link bleibt die genaue Seite");

// ── 2 · Werk: der Titel bleibt ───────────────────────────────────────────────────────────────
gleich(vorn(bau(quelle({ corpus: "wiki-aventurica.de", label: "Mutterglück" }))), "Mutterglück",
  "ein WERK-Korpus behält seinen Titel");
pruefe(!/<dt>Titel<\/dt>/.test(bau(quelle({ corpus: "wiki-aventurica.de", label: "Mutterglück" }))),
  "und der Titel steht dann nicht doppelt in der Tafel");
// 🔴 UNENTSCHIEDEN verhält sich wie WERK -- also wie vor dem Umbau. Bei einem frischen Korpus mit
// einer Zeile sagt das Verhältnis Titel/Zeilen nichts, und ein geratener Wert drehte die Anzeige
// eines ganzen Wirts um.
gleich(vorn(bau(quelle({ corpus: "punin.de", label: "Baronie Taubental" }))), "Baronie Taubental",
  "ein Korpus ohne entschiedene Form verhält sich wie ein Werk");

// ── 3 · Der Rückfall ist der BISHERIGE Zustand, nie ein leerer Name ──────────────────────────
// ⚠️ Ohne Korpora (alter Client, Modul aus, Lesefehler) zeigt die Zeile ihren Titel wie immer.
gleich((markup.buildSourceListMarkup("", [quelle({ corpus: "westlande.de" })], {})
  .match(/class="fs-src-a"[^>]*>([^<]*)/) || ["", ""])[1].trim(), "Apfeldorn",
  "ohne Wörterbuch bleibt alles wie vorher");
// Ein Schlüssel, den das Wörterbuch nicht kennt, ebenso.
gleich(vorn(bau(quelle({ corpus: "unbekannt.de" }))), "Apfeldorn",
  "und ein unbekannter Schlüssel ebenso");
// 💣 Ein Korpus OHNE Namen darf die Zeile nicht leeren -- sonst stünde dort gar nichts.
gleich(vorn(markup.buildSourceListMarkup("", [quelle({ corpus: "leer.de" })],
  { corpora: { "leer.de": { label: "", form: "belegstelle" } } })), "Apfeldorn",
  "ein Korpus ohne Namen leert die Zeile nicht");
// Und eine Quelle OHNE Titel zeigt den Wirt -- das ist der Fall der 15 titellosen Zeilen.
gleich(vorn(bau(quelle({ corpus: "westlande.de", label: "" }))), "AlberniaWiki",
  "eine titellose Belegstelle bekommt endlich einen Namen");

// ── 4 · Der Kanon-Text (Owner-Wortlaut) ──────────────────────────────────────────────────────
const inoff = bau(quelle({ corpus: "westlande.de" }));
pruefe(inoff.indexOf("Inoffiziell — Fanmaterial (Briefspiel). In offiziellen Nachschlagwerken steht es so nicht.") !== -1,
  "der Kanon-Satz steht wörtlich da");
const off = bau(quelle({ official: true, type: "quellenband", label: "Geographia Aventurica" }));
pruefe(off.indexOf("Offiziell — bei Ulisses erschienen. In offiziellen Nachschlagwerken nachzulesen.") !== -1,
  "und der offizielle ebenso");
// ⚠️ Die Art in Klammern entfällt bei `sonstiges` und ohne Art: `sonstiges` IST die Nicht-Aussage,
// und „Fanmaterial (Sonstiges)" wäre eine Aussage über nichts.
pruefe(bau(quelle({ type: "sonstiges" })).indexOf("Fanmaterial. In offiziellen") !== -1,
  "bei „sonstiges“ steht keine Klammer");
pruefe(bau(quelle({ type: "" })).indexOf("Fanmaterial. In offiziellen") !== -1,
  "und ohne Art ebenso");

// ── 5 · Die Naht: der Server schickt den Schlüssel, der Browser rechnet ihn NICHT ────────────
// 💣 Die registrierbare Domain im Browser nachzurechnen wäre eine zweite Wahrheit über
// `avesmapsSourceCorpusKey` (AGENTS.md §5) -- sie liefe beim ersten Sonderfall auseinander
// (`wiki.punin.de` → `punin.de`, `horaswiki.de` gegen `wiki.horaswiki.de`).
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8").replace(/\r\n/g, "\n");
const popups = lies("js/ui/popups.js");
pruefe(/corpus: source\.corpus \|\| "",/.test(popups),
  "der Schlüssel kommt aus dem Katalog, er wird nicht abgeleitet");
pruefe(!/hostname|split\("\."\)/.test(lies("js/ui/feature-source-markup.js")),
  "und der Renderer zerlegt keine Adressen");
pruefe(/corpora: \(typeof window !== "undefined" && window\.__sourceCorpora\) \|\| \{\}/.test(popups),
  "das Wörterbuch wird durchgereicht, mit `{}` als Rückfall");
pruefe(/window\.__sourceCorpora = \(data && data\.source_corpora\) \|\| \{\};/.test(
  lies("js/routing/routing.js")), "und aus der Kartennutzlast abgelegt");

// ── 6 · Der Kartenstempel — sonst behält jeder warme Browser den alten Namen ─────────────────
// 💣 Der Bump sass bis zum 02.09.2026 im DURCHSCHREIB-Zweig. `label` und `form` stehen
// ausdrücklich NICHT in AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS -- eine reine Umbenennung schrieb auf
// keine einzige Quelle durch und stiess den Stempel damit NIE an. Solange der Name den Editor nie
// verliess, war das folgenlos; mit diesem Umbau ist es ein echter Fehler.
const korpusPhp = lies("api/_internal/app/source-corpus.php");
pruefe(/if \(\$spalten !== \[\] && function_exists\('avesmapsNextMapRevision'\)\) \{/.test(korpusPhp),
  "jede Korpusänderung stösst den Kartenstempel an, nicht nur der Durchschrieb");
// Gegenprobe: er steht NICHT mehr im inneren Zweig -- sonst wäre er zweimal da und die Regel
// unklar, welcher gilt.
const durchschrieb = korpusPhp.slice(korpusPhp.indexOf("$durchschreiben !== []"),
  korpusPhp.indexOf("$betroffen = count($ids);"));
pruefe(!/avesmapsNextMapRevision/.test(durchschrieb),
  "und nicht mehr im Durchschreib-Zweig -- eine Stelle, nicht zwei");

console.log("OK — " + pruefungen + " Zusicherungen (welcher Name steht vorn)");
