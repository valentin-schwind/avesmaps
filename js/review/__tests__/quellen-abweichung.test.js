const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die ABWEICHUNG: eine einzelne Quelle darf ein korpuseigenes Feld gegen ihren Korpus behaupten.
// Owner-Entscheid 02.09.2026: "Quelle soll optional noch haben: Abweichende Lizenz, Abweichende
// Namensnennung" -- auf Nachfrage auf alle VIER korpuseigenen Felder erweitert.
//
// 💣 WARUM ALLE VIER: live gemessen am 02.09.2026 stehen in den acht Korpora genau drei
// Widersprueche, und keiner davon ist Lizenz oder Nennung. "Der Preis der Macht" (horaswiki.de)
// ist ein Abenteuer und offiziell, waehrend sein Korpus "Briefspiel" und "nicht offiziell" sagt.
// Eine Liste mit Ausnahmen haette ausgerechnet den einzigen echten Fall nicht abgedeckt.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-abweichung.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
require(path.join(wurzel, "js/ui/feature-source-markup.js"));
const modul = require(path.join(wurzel, "js/review/review-feature-sources.js"));
const { renderFeatureSourceEditPanel, featureSourceOwnFieldsFromPanel, featureSourceChangedFields } = modul;

let pruefungen = 0;
const pruefe = (b, t) => { assert.ok(b, t); pruefungen++; };
const gleich = (a, b, t) => { assert.deepStrictEqual(a, b, t); pruefungen++; };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tr = (_k, f) => f;

// „Der Preis der Macht" -- der einzige echte Abweicher im Livebestand.
const bauQuelle = (eigen) => ({
  source_id: 7, url: "https://www.horaswiki.de/wiki/Der_Preis_der_Macht",
  label: "Der Preis der Macht", type: "abenteuer", official: true, origin: "manual",
  pages: "", reference_kind: "", license: "", attribution: "",
  usage_count: 1, wiki_owned: false, own_fields: eigen,
  created: { link: null, source: null },
  corpus: {
    corpus_key: "horaswiki.de", label: "LieblichesFeld-Wiki", known: true,
    source_type: "briefspiel", license: "cc-by-sa-4.0", attribution: "",
    is_official: false, sources: 3, objects: 3,
  },
});

// ── 1 · Drei Abweichungsfelder, eines je überschreibbarem Korpusfeld ─────────────────────────
// 🪤 UMGEBAUT am 03.09.2026 (Owner: „eigentlich braucht es die häkchen nicht NUR felder … ich
// will nur änderungen vornehmen können für diese eine quelle"). Bis dahin trug jedes Korpusfeld
// ein `data-fs-own`-Häkchen NEBEN seinem Wert, und der Korpuswert stand durchgestrichen daneben.
// Jetzt zeigt der Korpusrahmen den Korpuswert, und die Abweichung ist ein eigenes Feld im Rahmen
// darunter — ein gefüllter Wert IST die Abweichung.
// 💣 Damit gibt es keinen zweiten Zustand neben dem Wert, der auseinanderlaufen könnte
// (angehakt, aber leer). Dieselbe Regel wie beim Hintergrundklick, wo `hidden` der ganze
// Zustand ist.
const ohne = renderFeatureSourceEditPanel(bauQuelle([]), esc, tr);
pruefe(!/data-fs-own=/.test(ohne), "die Häkchen sind gefallen");
pruefe(!/fs-field--eigen|dt-old/.test(ohne), "und mit ihnen die durchgestrichene Doppelanzeige");
gleich((ohne.match(/data-fs-abw-wert="/g) || []).length, 3,
  "drei Abweichungsfelder -- die drei Felder, von denen eine Quelle abweichen darf");
["source_type", "license", "attribution"].forEach((n) => {
  pruefe(ohne.indexOf('data-fs-abw-wert="' + n + '"') !== -1, "Abweichungsfeld fuer " + n);
});
pruefungen++;
// 🔴 `offiziell` hat KEINES (Owner 02.09.2026: „offiziell braucht nicht überschrieben werden") --
// es gehoert allein dem Korpus. Das ist eine Aussage, keine Luecke.
pruefe(ohne.indexOf('data-fs-abw-wert="is_official"') === -1,
  "offiziell ist nicht ueberschreibbar");
// 💣 Seiten und Abdeckung gehoeren der VERKNUEPFUNG, nie dem Katalog -- sie duerfen keins tragen,
// sonst behauptet die Oberflaeche eine Reichweite, die es nicht gibt.
pruefe(ohne.indexOf('data-fs-abw-wert="pages"') === -1
  && ohne.indexOf('data-fs-abw-wert="reference_kind"') === -1,
  "Seiten und Abdeckung tragen keins");
// ⚠️ Und `url`/`label` auch nicht: die gehoeren der Zeile ohnehin schon, es gibt nichts abzuweichen.
pruefe(ohne.indexOf('data-fs-abw-wert="url"') === -1
  && ohne.indexOf('data-fs-abw-wert="label"') === -1,
  "Adresse und Titel ebenso wenig -- sie gehoeren der Zeile bereits");
// 🔴 OHNE BESITZ STARTEN SIE LEER. Leer heisst „wie der Korpus"; ein vorbelegter Wert waere eine
// Abweichung, sobald jemand den Kasten nur aufmacht.
pruefe(!/data-fs-abw-wert="source_type"[^>]*data-fs-abw-orig="[^"]+"/.test(ohne),
  "ohne Besitz startet das Abweichungsfeld leer");

// ── 2 · Der Korpusrahmen zeigt den KORPUSWERT, und er heisst `corpus_*` ──────────────────────
// 💣 DIE ZWEI NAMEN SIND DER GANZE PUNKT. Bis zum 03.09.2026 trugen Korpuswert und Abweichung
// denselben Namen (`license`), und welche Tabelle getroffen wurde, entschied `own_fields`. Das
// reichte, solange ein Formular immer nur eines von beiden zeigte -- der ✎ zeigt jetzt BEIDES
// nebeneinander, und mit einem Namen liessen sie sich nicht in EINEM Speichern aendern.
pruefe(/data-fs-field="corpus_source_type"/.test(ohne), "der Korpusrahmen nennt corpus_source_type");
pruefe(/data-fs-field="corpus_license"/.test(ohne), "und corpus_license");
pruefe(/data-fs-field="corpus_attribution"/.test(ohne), "und corpus_attribution");
pruefe(/data-fs-field="corpus_is_official"/.test(ohne), "und corpus_is_official");
pruefe(/data-fs-field="corpus_form"/.test(ohne), "und die Form ebenso -- sie gibt es nur im Korpus");
// Der ANGEZEIGTE Wert ist der des Korpus, nicht der der Zeile.
pruefe(/data-fs-field="corpus_source_type" data-fs-orig="briefspiel"/.test(ohne),
  "und zeigt den Korpuswert");

const mit = renderFeatureSourceEditPanel(bauQuelle(["source_type"]), esc, tr);
// 🔴 EINE BESESSENE ART STEHT IM ABWEICHUNGSFELD, nicht im Korpusrahmen. Der Korpusrahmen zeigt
// weiter, was der Wirt sagt -- sonst waere nicht zu sehen, WOVON abgewichen wird.
pruefe(/data-fs-abw-wert="source_type"[^>]*data-fs-abw-orig="abenteuer"/.test(mit),
  "die besessene Art steht im Abweichungsfeld");
pruefe(/data-fs-field="corpus_source_type" data-fs-orig="briefspiel"/.test(mit),
  "und der Korpusrahmen zeigt unveraendert den Korpuswert");
// ⚠️ Was die Quelle NICHT besitzt, bleibt im Abweichungsfeld leer.
pruefe(!/data-fs-abw-wert="license"[^>]*data-fs-abw-orig="[^"]+"/.test(mit),
  "was sie nicht besitzt, erbt weiter");

// ── 2b · „Kein Korpus verwenden" ─────────────────────────────────────────────────────────────
// 🔴 Owner 02.09.2026. Angehakt verschwindet der Korpusrahmen -- Art, Lizenz und Nennung bleiben
// aber stehen: verschwaenden sie mit, haette eine korpuslose Quelle GAR KEINE Lizenz, und die ist
// das rechtlich Tragende.
pruefe(/data-fs-field="no_corpus"/.test(ohne), "der Kasten traegt „Kein Korpus verwenden“");
pruefe(!/data-fs-field="no_corpus"[^>]*checked/.test(ohne), "und er ist per Vorgabe AUS");
const frei = renderFeatureSourceEditPanel(
  Object.assign(bauQuelle([]), { no_corpus: 1 }), esc, tr);
pruefe(/data-fs-field="no_corpus"[^>]*checked/.test(frei), "angehakt, wenn die Quelle es sagt");
pruefe(/data-fs-korpus-gruppe hidden|hidden data-fs-korpus-gruppe/.test(frei),
  "und der Korpusrahmen ist weg");
pruefe(/data-fs-abw-wert="license"/.test(frei),
  "die Angaben bleiben -- eine korpuslose Quelle braucht ihre Lizenz erst recht");

// ── 3 · Der Sammler: volle Menge, und „geaendert" ist eine EIGENE Frage ──────────────────────
// 🪤 UMGEDREHT am 03.09.2026 (Owner: „eigentlich braucht es die häkchen nicht NUR felder").
// Bis dahin las der Sammler ein `data-fs-own`-HAEKCHEN; jetzt liest er den WERT des
// Abweichungsfeldes. Ein gefuelltes Feld IST die Abweichung -- damit gibt es keinen zweiten
// Zustand daneben, der auseinanderlaufen koennte (angehakt, aber leer).
const machePanel = (zustaende) => ({
  querySelectorAll: () => zustaende.map((z) => ({
    disabled: z.disabled === true,
    value: z.wert,
    getAttribute: (a) => (a === "data-fs-abw-wert" ? z.name : (z.orig || "")),
  })),
});
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", wert: "cc-by-sa-3.0", orig: "" },
  { name: "attribution", wert: "", orig: "" },
])), { liste: ["license"], geaendert: true }, "neu gesetzt: Liste und Aenderung");
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", wert: "cc-by-sa-3.0", orig: "cc-by-sa-3.0" },
])), { liste: ["license"], geaendert: false },
  "unveraendert gesetzt: die Liste steht, aber es hat sich NICHTS geaendert");
// 💣 DAS IST DIE TRAGENDE UNTERSCHEIDUNG. Ohne sie schickte jedes Speichern `own_fields` mit --
// und ein alter, zwischengespeicherter Client ohne diese Haekchen schickte eine LEERE Liste und
// loeschte damit still jede Abweichung. Dieselbe Regel wie bei `source_type_chosen` (29.08.2026):
// „da steht ein Wert" heisst nie „ein Mensch hat ihn gewaehlt".
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", wert: "", orig: "cc-by-sa-3.0" },
])), { liste: [], geaendert: true }, "auf „wie Korpus“ zurueckgestellt: leere Liste, aber geaendert");
gleich(featureSourceOwnFieldsFromPanel(machePanel([])), { liste: [], geaendert: false },
  "ein Panel ohne Abweichungsfelder aendert nichts -- der alte Client loescht nichts");
gleich(featureSourceOwnFieldsFromPanel(null), { liste: [], geaendert: false }, "und ohne Panel auch nicht");
// ⚠️ Ein LEERZEICHEN ist keine Abweichung -- sonst legte ein versehentlicher Tastendruck im
// Nennungsfeld die Quelle vom Korpus ab, und niemand saehe es.
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "attribution", wert: "   ", orig: "" },
])), { liste: [], geaendert: false }, "Leerraum zaehlt nicht als Abweichung");
// ⚠️ Gesperrte Felder tragen den Bestand, nicht eine Wahl.
gleich(featureSourceOwnFieldsFromPanel(machePanel([
  { name: "license", wert: "cc-by-sa-3.0", orig: "", disabled: true },
])), { liste: [], geaendert: false }, "gesperrte zaehlen nicht mit");

// ── 4 · Die zwei Haekchen duerfen sich nicht ins Gehege kommen ───────────────────────────────
// 💣 `data-fs-own` und `data-fs-field` sind ZWEI Sammler auf demselben Panel. Truege das
// Abweichungs-Haekchen versehentlich auch ein `data-fs-field`, landete es als Katalogfeld in der
// Anfrage -- und der Server kennt kein Feld dieses Namens.
pruefe(!/data-fs-own="[a-z_]+"[^>]*data-fs-field/.test(mit) && !/data-fs-field="[a-z_]+"[^>]*data-fs-own/.test(mit),
  "kein Element traegt beide Merkmale");
// Gegenprobe zur Laufzeit: der Feld-Sammler sieht die Abweichungs-Haekchen NICHT.
const echtesPanel = {
  querySelectorAll: (sel) => (sel === "[data-fs-field]" ? [] : [
    { disabled: false, checked: true, getAttribute: (a) => (a === "data-fs-own" ? "license" : "0") },
  ]),
};
gleich(featureSourceChangedFields(echtesPanel), {},
  "der Feld-Sammler liest nur `data-fs-field` und nicht die Abweichung");

// ── 5 · Und der Speichern-Weg schickt sie NUR bei Aenderung ──────────────────────────────────
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF.
const quelltext = fs.readFileSync(
  path.join(wurzel, "js/review/review-feature-sources.js"), "utf8").replace(/\r\n/g, "\n");
pruefe(/if \(besitz\.geaendert\) \{\n\s*felder\.own_fields = besitz\.liste;/.test(quelltext),
  "`own_fields` reist nur mit, wenn die Haekchen wirklich bewegt wurden");



// ── 6 · Die Adresse: Rahmen, Formprüfung, grüner Haken (Owner 02.09.2026) ────────────────────
const { featureSourceUrlLooksValid, renderFeatureSourceEditorHtml } = modul;
[["https://westlande.de/albernia/index.php?title=Apfeldorn", true],
 ["http://www.kahet-ni-kemi.de/sssrah.html", true],
 ["https://", false], ["ftp://x.de", false],
 // 💣 `javascript:` MUSS durchfallen: der Wert wird in der Infobox als Link ausgegeben.
 ["javascript:alert(1)", false],
 ["westlande.de/a", false], ["", false],
 // ⚠️ Ein Wirt ohne Punkt ist keine Quelle im Netz -- `new URL()` allein liesse ihn durch.
 ["https://localhost", false]].forEach(([u, soll]) => {
  gleich(featureSourceUrlLooksValid(u), soll, "Formprüfung: " + (u || "(leer)"));
});

const zeile = renderFeatureSourceEditorHtml({ wiki_url: "", sources: [] }, {});
// 🪤 UMGEBAUT am 03.09.2026: `.fs-adresse` war eine von VIER Rezepturen fuer denselben
// Rahmen und ist im geteilten Bauteil `.fs-scope` aufgegangen (Owner: „warum machen wir das
// mockup?"). Der Vertrag dazu steht in docs/quellen-formular-einheitlich-mockup.html.
// 🔴 Und die ANLEITUNG ist von der Aufschrift in den Rahmen gewandert: als Rahmenname belegte
// sie den Platz der Reichweite, und die beiden Formulare hiessen dann an derselben Stelle
// verschieden -- genau das, was der Umbau beseitigt.
pruefe(/class="fs-scope avm-rahmen"/.test(zeile) && /class="fs-scope__title avm-rahmen__titel"/.test(zeile),
  "die Adresse steht in einem Rahmen mit Aufschrift");
pruefe(/Gilt für alle Objekte, die diese Quelle zitieren/.test(zeile),
  "und die Aufschrift nennt die REICHWEITE, in beiden Formularen gleich");
// 🪤 Owner 03.09.2026: „ist zu lang und bricht leider um" — die Zeile steht in einem 400px
// breiten Panel. Der Wortlaut ist seiner; die automatische Korpuserkennung nennt der Rahmen
// darunter mit Namen und Reichweite ohnehin.
pruefe(/class="fs-scope__hint">Hier Adresse \(URL\) zur Quelle einfügen/.test(zeile),
  "die Anleitung steht IM Rahmen -- dort, wo sie gilt");
// ⚠️ Adresse UND Titel stehen darin: der Titel entsteht aus dem Einfügen, er gehört zur selben
// Handlung. Seite(n) und Abdeckung NICHT -- die tippt der Editor selbst, und sie gelten nur an
// dieser einen Fundstelle.
// 💣 Geschnitten wird bis zum ZWEITEN Rahmen, nicht bis `fs-af--pages`: die Seitenangabe
// steht seit dem 03.09.2026 im DRITTEN Rahmen, ein Schnitt dorthin umfasste also auch den
// Korpusrahmen und die Zusicherung darunter waere ein Vakuum.
const ersterRahmen = zeile.indexOf('class="fs-scope avm-rahmen"');
const zweiterRahmen = zeile.indexOf('class="fs-scope avm-rahmen"', ersterRahmen + 1);
pruefe(zweiterRahmen > ersterRahmen, "es gibt mehr als einen Rahmen");
const rahmenInhalt = zeile.slice(ersterRahmen, zweiterRahmen);
pruefe(/fs-add-url/.test(rahmenInhalt) && /fs-add-label/.test(rahmenInhalt),
  "Adresse und Titel liegen im Rahmen");
pruefe(!/fs-add-pages|fs-add-kind/.test(rahmenInhalt), "Seiten und Abdeckung nicht");
// 🔴 Der grüne Haken startet VERBORGEN -- er sagt „es wurde etwas gelesen", und vor dem ersten
// Abruf ist das eine Behauptung.
pruefe(/data-fs-ok hidden/.test(zeile), "der grüne Haken startet verborgen");
pruefe(/haken\.hidden = !\(zustand === "gelesen" \|\| zustand === "bekannt"\);/.test(quelltext),
  "und erscheint nur, wenn wirklich etwas gelesen wurde -- `erreichbar` allein genügt nicht");
pruefe(/zeigeAdressForm\(\);/.test(quelltext), "die Formprüfung ist beim Tippen verdrahtet");



// ── 7 · Die Eingabezeile: Abweichungsfelder, drei Rahmen, Form raus ──────────────────
// 🪤 UMGEBAUT am 03.09.2026 (Owner: „eigentlich braucht es die häkchen nicht NUR felder").
// Hier standen vier `data-fs-own`-Häkchen; jetzt sind es DREI Felder — `offiziell` ist nicht
// mehr überschreibbar („offiziell braucht nicht überschrieben werden").
const zeile2 = renderFeatureSourceEditorHtml({ wiki_url: "", sources: [] }, {});
pruefe(!/data-fs-own="/.test(zeile2), "die Häkchen sind gefallen");
gleich((zeile2.match(/data-fs-abw-wert="/g) || []).length, 3,
  "die Eingabezeile trägt drei Abweichungsfelder");
["source_type", "license", "attribution"].forEach((n) => {
  pruefe(zeile2.indexOf('data-fs-abw-wert="' + n + '"') !== -1, "Zeile: Abweichungsfeld für " + n);
});
pruefungen++;
// 🔴 `offiziell` hat KEINES — und das ist eine Aussage, keine Lücke.
pruefe(!/data-fs-abw-wert="is_official"/.test(zeile2),
  "offiziell ist nicht überschreibbar");
// 🔴 Sie starten LEER: leer heißt „wie der Korpus". Ein vorbelegter Wert wäre eine
// Abweichung, sobald jemand das Formular nur ansieht — dieselbe Regel wie bei
// `source_type_chosen`: „da steht ein Wert" heißt nie „ein Mensch hat ihn gewählt".
// ⚠️ „leer" heisst LEERER WERT, nicht „kein value-Attribut": das Textfeld traegt immer eins.
pruefe(!/data-fs-abw-wert="[a-z_]+"[^>]*value="[^"]+"/.test(zeile2), "und alle drei starten leer");
// 💣 Der erste Eintrag der Auswahl trägt `value=""` — DAS ist der Zustand „erbt".
// Stünde dort der Korpuswert, wäre jede Quelle beim nächsten Korpuswechsel stillschweigend
// eine Abweichung.
pruefe(/data-fs-abw-wert="source_type"[^>]*>\s*<option value="">/.test(zeile2),
  "und der erste Eintrag ist der leere — er bedeutet „wie Korpus“");

// 💣 DIESELBEN Klassen wie im ✎ — damit liest `featureSourceOwnFieldsFromPanel` beide
// Oberflächen. Zwei Fassungen liefen beim nächsten Feld auseinander.
pruefe(/class="abw"/.test(zeile2), "beide Oberflächen benutzen dasselbe Bauteil");

// 🔴 DREI RAHMEN, und alle drei aus DEMSELBEN Bauteil (`.fs-scope`). Bis zum 03.09.2026
// waren es vier eigene Rezepturen (`.fs-adresse`, `.fs-eintrag`, `.fs-korpus`,
// `.fs-edit__group`), im Browser gemessen 10px/normal gegen 11px/fett, 8px gegen 10px Polster,
// solid gegen dashed — der Anlass des ganzen Umbaus.
gleich((zeile2.match(/class="fs-scope avm-rahmen"/g) || []).length, 3, "drei Rahmen, ein Bauteil");
pruefe(!/fs-adresse|fs-eintrag|class="fs-korpus"|fs-edit__group/.test(zeile2),
  "und keine der vier alten Rezepturen ist übrig");
pruefe(/Nur an diesem Objekt/.test(zeile2),
  "Seiten, Abdeckung und die Abweichungen stehen im dritten Rahmen");
// ⚠️ Der dritte Rahmen steht am ENDE (Owner 02.09.2026: „damit man den Korpus sieht würde ich
// ‚Nur an diesem Objekt‘ unter ‚Gilt für den ganzen Korpus‘ setzen").
pruefe(zeile2.indexOf("data-fs-korpus-gruppe") < zeile2.indexOf("Nur an diesem Objekt"),
  "und zwar UNTER dem Korpus");
const objektInhalt = zeile2.slice(zeile2.indexOf("Nur an diesem Objekt"));
pruefe(/fs-add-pages/.test(objektInhalt) && /fs-add-kind/.test(objektInhalt),
  "Seiten und Abdeckung liegen darin");
pruefe(!/fs-add-url|fs-add-corpus/.test(objektInhalt),
  "die Adresse und der Korpusname nicht — der Rahmen sagt „nur dieses Objekt“, und das muss stimmen");

// 🔴 DIE FORM IST RAUS -- restlos, nicht nur unsichtbar.
pruefe(!/fs-add-form|data-fs-form/.test(zeile2), "die Form steht nicht mehr in der Eingabezeile");
// ... und im ✎ angekommen, samt eigener Reichweite auf dem Server.
// 🪤 Sie heisst seit dem 03.09.2026 `corpus_form` -- ausdruecklich, statt ueber ihre
// Stellung im Markup erkannt zu werden.
pruefe(/data-fs-field="corpus_form"/.test(mit), "sie steht jetzt im Bearbeiten-Kasten");
const php = fs.readFileSync(path.join(wurzel, "api/_internal/app/feature-sources.php"), "utf8");
pruefe(/AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS = \['form'\]/.test(php),
  "und der Server führt sie als eigene Reichweite -- sie hat in `sources` keine Spalte");
// 💣 Sie darf NICHT in die Katalogliste geraten: dort landete sie in einem UPDATE auf eine Spalte,
// die es nicht gibt.
const katalog = php.match(/AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS = \[([^\]]+)\]/)[1];
pruefe(!/'form'/.test(katalog), "und nicht in der Katalogliste");
// ⚠️ Wer nur die Form ändert, muss trotzdem im Korpus-Block ankommen -- sonst bewegt „Speichern“
// den Knopf und tut nichts.
pruefe(/\$formGeschickt = array_key_exists\('form', \$fields\);/.test(php)
  && /\$katalogAenderungen !== \[\] \|\| \$formGeschickt \|\| \$ausdruecklich !== \[\]/.test(php),
  "eine reine Formänderung öffnet den Korpus-Block mit");
// 03.09.2026: und ein ausdrücklich benanntes Korpusfeld (`corpus_license`) ebenso. Ohne diese
// Hälfte bewegte „Speichern" den Knopf und täte nichts, sobald jemand NUR den Korpus ändert.
pruefe(/foreach \(\$ausdruecklich as \$name => \$wert\)/.test(php),
  "und die ausdrücklichen Korpusfelder kommen im Block an");
// Und zwar NACH dem own_fields-Abzug -- davor nähme `array_diff_key` sie gleich wieder heraus.
pruefe(php.indexOf("array_diff_key($korpusFelder") < php.indexOf("foreach ($ausdruecklich as"),
  "nach dem Abzug, nicht davor -- sonst wären sie wirkungslos");

console.log("OK — " + pruefungen + " Zusicherungen gesamt (Abweichung, Adresse, Eintragsrahmen, Form)");
