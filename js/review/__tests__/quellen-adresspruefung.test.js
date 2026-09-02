"use strict";

/**
 * Die Eingabezeile prüft ihre Adresse: Knopf, drei Zustände, Korrektur des Katalogeintrags.
 *
 * Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4
 * Owner 02.09.2026: „du kannst das link pasten und enter an sich nehmen und einen refresh button
 * rechts der aktualisiert und grün wird wenn der link exisitiert und ausgelesen werden konnte."
 *
 * Fahren: node js/review/__tests__/quellen-adresspruefung.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const modul = require("../review-feature-sources.js");
const { featureSourceInspectView, renderFeatureSourceEditorHtml } = modul;

let anzahl = 0;
const zaehl = () => { anzahl += 1; };

// ══ 1 · Der Knopf steht in der Zeile, neben der Adresse ═════════════════════════════════════════

const html = renderFeatureSourceEditorHtml({ ok: true, sources: [] }, {});

assert.ok(/data-fs-check/.test(html), "die Eingabezeile trägt den Prüfknopf");
zaehl();

// 💣 NEBEN der Adresse, nicht irgendwo: der Knopf gehört zu dem Feld, das er prüft. Stünde er
// hinter dem Quellennamen, hielte man ihn für dessen Knopf.
const posUrl = html.indexOf("fs-add-url");
const posCheck = html.indexOf("data-fs-check");
const posLabel = html.indexOf("fs-add-label");
assert.ok(posUrl > -1 && posCheck > posUrl && posCheck < posLabel,
  "er steht zwischen Adressfeld und Quellenname");
zaehl();

// ⚠️ Ein Knopf ohne Namen ist für einen Screenreader ein „⟳". Beschriftung UND Titel.
assert.ok(/aria-label="[^"]+"/.test(html.slice(posCheck - 200, posCheck + 260)),
  "der Knopf trägt eine Beschriftung für Hilfsmittel");
zaehl();

// ══ 2 · Vier Zustände hinein, drei Farben heraus ════════════════════════════════════════════════

const bekannt = featureSourceInspectView({
  state: "bekannt",
  existing: { label: "Herzogenstadt Trallop", usage_count: 4 },
});
const gelesen = featureSourceInspectView({
  state: "gelesen", title: "Apfeldorn", corpus: { label_suggestion: "AlberniaWiki" },
});
const erreichbar = featureSourceInspectView({ state: "erreichbar" });
const tot = featureSourceInspectView({ state: "unerreichbar", http_status: 404 });

// 💣 DIE KORREKTUR AM ENTWURF DES KNOPFES: „erreichbar, aber nichts zu lesen" ist ein EIGENER
// Zustand. Wäre er grün, hiesse Grün zwei Dinge; wäre er rot, suchte der Editor einen Fehler am
// Link, den es nicht gibt.
assert.strictEqual(erreichbar.zustand, "erreichbar", "erreichbar ist weder gelesen noch tot");
zaehl();
assert.ok(erreichbar.zustand !== gelesen.zustand && erreichbar.zustand !== tot.zustand,
  "und trägt damit eine eigene Farbe");
zaehl();

// ⚠️ „bekannt" und „gelesen" tragen bewusst DASSELBE Grün -- für den Editor ist beides derselbe
// Befund: die Zeile ist fertig. Der Unterschied steht in der Meldung.
assert.ok(bekannt.meldung !== gelesen.meldung, "der Unterschied steht in der Meldung, nicht in der Farbe");
zaehl();

// ══ 3 · Die bekannte Seite wird KORRIGIERT, nicht gesperrt ══════════════════════════════════════

// 🪤 HIER STAND BIS ZUM 02.09.2026 DAS GEGENTEIL: „eine bekannte Seite sperrt die Katalogfelder".
// Die Begründung war für sich richtig -- der Upsert des Anlegens fasst eine bekannte Zeile nicht
// an, ein editierbares Feld täte dort also nichts -- und sie hat den entscheidenden Fall
// übersehen. Owner-Bild 02.09.2026: an einer bekannten Seite stand „Briefspiel" als Titel, also
// genau die kaputte Angabe, die dieser Umbau beseitigen soll, und sie war gesperrt. Ein Feld, das
// den Fehler ZEIGT und ihn nicht ändern lässt, ist schlimmer als eines, das ihn verschweigt.
// 🔴 Die Felder bleiben editierbar; eine Änderung geht über `update` an den Katalogeintrag --
// denselben Weg, den auch das ✎ benutzt, samt seiner Rückfrage ab der Schwelle.
assert.ok(!("sperren" in bekannt), "es gibt keine Sperre mehr -- auch nicht als Rest im Rückgabewert");
zaehl();
const quelltextKorr = fs.readFileSync(path.join(__dirname, "..", "review-feature-sources.js"), "utf8");
assert.ok(/function korrekturAusZeile\(values\)/.test(quelltextKorr)
  && /async function wendeKorrekturAn\(korrektur\)/.test(quelltextKorr),
  "stattdessen gibt es einen Korrekturweg -- gerechnet und angewandt");
zaehl();

// 💣 GERECHNET VOR, ANGEWANDT NACH dem Verknüpfen -- und die Reihenfolge ist tragend.
// 🪤 Sie stand am 02.09.2026 zuerst andersherum, und der Server hat es sofort gesagt: „Diese
// Quelle haengt nicht an diesem Objekt." `update` verlangt die Verknüpfung, und vor dem
// Hinzufügen gibt es sie nicht. Gerechnet werden MUSS die Korrektur aber vorher: danach hat
// `renderFromServer` die Zeile neu gezeichnet und die Eingaben sind weg.
const posRechnen = quelltextKorr.indexOf("const korrektur = korrekturAusZeile(values);");
const posAdd = quelltextKorr.indexOf('await renderFromServer("add", values)');
const posAnwenden = quelltextKorr.indexOf("await wendeKorrekturAn(korrektur)");
assert.ok(posRechnen > -1 && posAdd > posRechnen && posAnwenden > posAdd,
  "gerechnet vor dem Verknüpfen, angewandt danach");
zaehl();
// ⚠️ `is_official` bleibt aussen vor -- den überschreibt der Upsert ohnehin unbedingt, eine
// zweite Korrektur dafür wäre ein zweiter Schreibweg für denselben Wert.
assert.ok(!/vergleiche\("is_official"/.test(quelltextKorr), "der Kanon-Haken läuft nicht über die Korrektur");
zaehl();

// Die Reichweite wird BENANNT -- die Zahl ist die Warnung vor einer Änderung am geteilten Katalog.
assert.ok(bekannt.meldung.includes("4"), "die Zahl der zitierenden Objekte steht in der Meldung");
zaehl();

// ⚠️ Ohne Nutzungszahl bleibt der Satz weg, statt „an 0 Objekten" zu behaupten.
const bekanntOhne = featureSourceInspectView({ state: "bekannt", existing: { label: "X", usage_count: 0 } });
assert.ok(!/\b0\b/.test(bekanntOhne.meldung), "ohne Zitate wird keine Null behauptet");
zaehl();

// 💣 Einzahl. Live stand „Zitiert an 1 Objekten" im Kasten (Owner-Bild 02.09.2026) -- das liest
// sich wie ein Programmierfehler, weil es einer ist.
const bekanntEins = featureSourceInspectView({ state: "bekannt", existing: { label: "X", usage_count: 1 } });
assert.ok(/an 1 Objekt\b/.test(bekanntEins.meldung) && !/1 Objekten/.test(bekanntEins.meldung),
  "eine einzelne Zitierung steht in der Einzahl");
zaehl();

// ══ 3b · Die Felder zeigen, was gespeichert ist ═══════════════════════════════════════════════════════════════

// 💣 Die Zeile muss zeigen, was der Katalog trägt -- sonst behauptet ein leeres „Art …" das
// Gegenteil, und der Editor sucht eine Angabe, die längst da ist.
// Owner-Meldung 02.09.2026: „der rest fehlt irgendwie".
const bekanntVoll = featureSourceInspectView({
  state: "bekannt",
  existing: {
    label: "Briefspiel (Weiden)", source_type: "briefspiel", license: "cc-by-nc-sa-3.0",
    attribution: "VolkoV", is_official: false, usage_count: 118,
  },
});
assert.ok(bekanntVoll.felder, "eine bekannte Seite bringt ihre Katalogwerte mit");
zaehl();
assert.strictEqual(bekanntVoll.felder.source_type, "briefspiel", "die Art steht im Feld");
zaehl();
assert.strictEqual(bekanntVoll.felder.license, "cc-by-nc-sa-3.0", "die Lizenz ebenso");
zaehl();
assert.strictEqual(bekanntVoll.felder.attribution, "VolkoV", "die Namensnennung ebenso");
zaehl();
assert.strictEqual(bekanntVoll.felder.is_official, false, "und der Kanon-Haken");
zaehl();

// ⚠️ Nur im bekannten Fall. Bei einer NEUEN Seite gibt es nichts vorzugeben -- dort wäre ein
// gefülltes Feld eine Behauptung.
assert.ok(!gelesen.felder && !erreichbar.felder && !tot.felder,
  "eine neue Seite bringt keine Katalogwerte mit");
zaehl();

// 🔴 Der Client muss sie auch WIRKLICH einsetzen -- ein Rückgabewert, den niemand liest, ist
// dieselbe Lücke wie vorher, nur eine Ebene tiefer.
const quelltextFelder = fs.readFileSync(path.join(__dirname, "..", "review-feature-sources.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
["source_type", "license", "attribution"].forEach((feld) => {
  assert.ok(new RegExp("sicht\\.felder\\." + feld).test(quelltextFelder),
    "die Zeile setzt " + feld + " wirklich ein");
});
assert.ok(/sicht\.felder\.is_official/.test(quelltextFelder), "und den Haken");
zaehl();

// ══ 4 · Der Titel ══════════════════════════════════════════════════════════════════════════════

// 🔴 Der gespeicherte Titel einer BEKANNTEN Zeile gewinnt immer -- genau wie im Katalog. Sonst
// stünde im Feld etwas anderes als in der Liste darüber, und das Speichern änderte daran nichts.
assert.strictEqual(bekannt.titel, "Herzogenstadt Trallop", "der gespeicherte Titel kommt mit");
zaehl();
assert.strictEqual(bekannt.titelGewinnt, true, "und überschreibt Getipptes");
zaehl();

// ⚠️ Ein GELESENER Titel überschreibt dagegen nichts: wer schon getippt hat, meinte das.
assert.strictEqual(gelesen.titel, "Apfeldorn", "der gelesene Titel wird angeboten");
zaehl();
assert.strictEqual(gelesen.titelGewinnt, false, "aber er überschreibt keine Eingabe");
zaehl();

// ⭐ Der Korpusvorschlag aus dem `<title>`-Zusatz wird GENANNT, nicht gesetzt.
assert.ok(gelesen.meldung.includes("AlberniaWiki"), "der Wirtsname aus der Seite wird genannt");
zaehl();
const ohneWirt = featureSourceInspectView({ state: "gelesen", title: "Herzogenstadt Trallop", corpus: {} });
assert.ok(!ohneWirt.meldung.includes("Korpus"),
  "ohne Zusatz wird über den Korpus nichts behauptet — die 33 Weiden-Seiten sind genau dieser Fall");
zaehl();

// ══ 5 · Was schiefgehen darf ═══════════════════════════════════════════════════════════════════

// 💣 Ein unbekannter oder fehlender Zustand fällt auf „unerreichbar", nie auf einen grünen: ein
// grüner Knopf für eine ungeprüfte Adresse wäre die eine Lüge, die dieser Umbau nicht machen darf.
assert.strictEqual(featureSourceInspectView({}).zustand, "unerreichbar", "leere Auskunft ist nicht grün");
zaehl();
assert.strictEqual(featureSourceInspectView(null).zustand, "unerreichbar", "und null auch nicht");
zaehl();
assert.strictEqual(featureSourceInspectView({ state: "quatsch" }).zustand, "unerreichbar",
  "ein unbekannter Zustand ebenso");
zaehl();

// Ohne Statuscode wird keiner erfunden.
assert.ok(!/\b0\b/.test(featureSourceInspectView({ state: "unerreichbar", http_status: 0 }).meldung),
  "ohne Statuscode steht keine 0 in der Meldung");
zaehl();
assert.ok(tot.meldung.includes("404"), "mit Statuscode steht er drin");
zaehl();

// ══ 6 · Die Verdrahtung ════════════════════════════════════════════════════════════════════════

const quelle = fs.readFileSync(path.join(__dirname, "..", "review-feature-sources.js"), "utf8");
const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// 💣 Einfügen, Enter UND Knopf -- alle drei. Owner hat ausdrücklich alle drei benannt, und eine
// Regel, die einen von drei Erzeugern bindet, ist keine Regel.
assert.ok(/addEventListener\("paste"/.test(ohneKommentare), "das Einfügen löst die Prüfung aus");
zaehl();
assert.ok(/event\.key === "Enter"/.test(ohneKommentare), "Enter ebenso");
zaehl();
assert.ok(/data-fs-check/.test(ohneKommentare) && /pruefeAdresse\(\)/.test(ohneKommentare),
  "und der Knopf");
zaehl();

// 💣 Beim Einfügen steht der Wert erst NACH dem Ereignis im Feld -- ohne Aufschub prüfte die Zeile
// den Stand von davor (meist leer).
assert.ok(/addEventListener\("paste"[\s\S]{0,200}setTimeout/.test(ohneKommentare),
  "das Einfügen prüft aufgeschoben, nicht im Ereignis selbst");
zaehl();

// 🔴 Nach jedem Neuzeichnen neu verdrahten: `innerHTML` ersetzt das Adressfeld, direkte Listener
// sind dann weg. ⚠️ Und NICHT innerhalb von `wireAutocomplete` -- die steigt aus, wenn die
// Vorschlagsliste auf dieser Oberfläche fehlt, und die Adressprüfung fiele still mit aus.
assert.ok(/wireAutocomplete\(\);\s*wireAdressPruefung\(\);/.test(ohneKommentare),
  "die Prüfung wird nach jedem Neuzeichnen eigenständig verdrahtet");
zaehl();
const posWireAuto = ohneKommentare.indexOf("function wireAutocomplete()");
const posWirePruef = ohneKommentare.indexOf("function wireAdressPruefung()");
assert.ok(posWireAuto > -1 && posWirePruef > posWireAuto,
  "und steht als eigene Funktion daneben, nicht darin");
zaehl();

// 💣 Ändert sich die Adresse wieder, gilt die Auskunft nicht mehr -- und vor allem darf die
// bekannte Katalogzeile nicht stehenbleiben: eine Korrektur landete sonst an der ALTEN Quelle,
// während der Editor längst eine andere Adresse im Feld hat. Das wäre eine katalogweite Änderung
// am falschen Eintrag, und niemand sähe es.
assert.ok(/addEventListener\("input"[\s\S]{0,260}letzteBekannteQuelle = null/.test(ohneKommentare),
  "eine geänderte Adresse vergisst die bekannte Katalogzeile");
zaehl();

// 🔴 Die Prüfung geht IMMER über die Leitung, nie über den Anlege-Puffer: der beantwortet Fragen
// zum OBJEKT, diese hier gilt einer ADRESSE.
assert.ok(/featureSourceFetch\(\{\s*action: "inspect_url"/.test(ohneKommentare),
  "die Prüfung ruft den Endpunkt direkt, nicht den Anlege-Puffer");
zaehl();

// ⚠️ Ein Fehlschlag der PRÜFUNG darf das Eintragen nicht blockieren -- sonst hinge das Speichern
// an einem fremden Server.
assert.ok(/setzeAdressZustand\(null,[\s\S]{0,120}checkFailed/.test(ohneKommentare),
  "eine gescheiterte Prüfung färbt nichts und sagt, dass Eintragen weiter geht");
zaehl();

// ══ 7 · Die beschriftete Zeile aus dem Mockup ══════════════════════════════════════════════════

// 🔴 Owner am Mockup (02.09.2026): „das war das mockup". Ein Platzhalter verschwindet, sobald
// jemand tippt -- danach weiss niemand mehr, welches der acht Felder er gerade füllt.
const beschriftungen = (html.match(/class="fs-af__l"/g) || []).length;
assert.ok(beschriftungen >= 8, "jedes Feld trägt eine sichtbare Beschriftung (gefunden: " + beschriftungen + ")");
zaehl();

// 🔴 DAS KORPUS-FELD -- das Herzstück des Entwurfs, und es fehlte bis zum 02.09.2026 ganz.
assert.ok(/class="fs-add-corpus"/.test(html), "die Zeile hat ein Feld für den Korpusnamen");
zaehl();
assert.ok(/data-fs-corpus-meta/.test(html), "und daneben Platz für Schlüssel und Reichweite");
zaehl();

// ⚠️ VIER Marker „· vom Korpus", und alle starten VERBORGEN: ein dauerhaft sichtbarer Marker
// behauptete, der Korpus gebe den Wert vor, auch wenn er gar keinen trägt.
const marker = html.match(/data-fs-from="(\w+)" hidden/g) || [];
assert.strictEqual(marker.length, 4, "vier Marker, alle verborgen");
zaehl();
["type", "license", "attribution", "official"].forEach((feld) => {
  assert.ok(new RegExp('data-fs-from="' + feld + '" hidden').test(html), "Marker für " + feld);
});
zaehl();

// 💣 Der Prüfknopf steht NEBEN dem Adress-Label, nicht darin: ein `<button>` in einem `<label>`
// erbt dessen Aktivierungsverhalten, und der Klick gälte dann auch dem Eingabefeld.
assert.ok(/<\/label><button type="button" class="fs-add-check"/.test(html),
  "der Prüfknopf steht außerhalb des Labels");
zaehl();

// 🔴 Der Schreibweg für den Korpus muss verdrahtet sein -- ohne ihn wäre das Feld eine Attrappe,
// und ein Feld, das man beschriften kann und das nichts speichert, ist schlimmer als keines.
assert.ok(/action: "save_corpus"/.test(quelltextFelder), "die Umbenennung ruft save_corpus");
zaehl();
assert.ok(/addEventListener\("blur", speichereKorpus\)/.test(quelltextFelder),
  "gespeichert wird beim Verlassen des Feldes, nicht bei jedem Tastendruck");
zaehl();

// ⚠️ Und sie fragt zurück, sobald der Korpus weit reicht -- dieselbe Schwelle wie beim Bearbeiten
// einer Katalogzeile.
assert.ok(/FEATURE_SOURCE_CONFIRM_THRESHOLD[\s\S]{0,400}confirm/.test(quelltextFelder),
  "ab der Schwelle wird vor der Umbenennung gefragt");
zaehl();

// 💣 Vorbelegt wird NUR bei einem BEKANNTEN Korpus. Ein frisch aus der Adresse abgeleiteter trägt
// nichts, was er vorgeben könnte -- dort wäre jeder Marker eine Behauptung.
assert.ok(/const bekannt = korpus\.known === true;/.test(quelltextFelder),
  "die Vorbelegung hängt an `known`, nicht am blossen Vorhandensein eines Korpus");
zaehl();

// ══ 8 · Der erste Eintrag einer Domain legt ihren Korpus an ════════════════════════════════════

// 🔴 Owner-Bild 02.09.2026 (IST gegen SOLL): im Korpusfeld stand „westlande.de", während die
// Meldung darunter schon sagte „Die Seite nennt sich „AlberniaWiki“". Wir kannten den Namen,
// erzählten ihn in Prosa und trugen ihn nicht ein.
assert.ok(/korpus\.known === true \? "" : korpus\.label_suggestion/.test(quelltextFelder),
  "der Vorschlag aus der Seite füllt das Korpusfeld -- aber nur, wenn der Korpus unbekannt ist");
zaehl();

// 💣 UND OHNE DAS ANLEGEN BLIEBE ES DABEI. Eine Korpuszeile entstand bis dahin NUR beim
// Umbenennen; wer den vorgeschlagenen Namen stehen liess -- der Normalfall, er stimmt ja --
// speicherte nichts. Die nächste Seite desselben Wirts sähe wieder die nackte Domain, und
// Schritt 2 des Entwurfs („alles andere steht schon da") träte nie ein.
assert.ok(/function korpusAnlageAusZeile\(values\)/.test(quelltextKorr)
  && /async function legeKorpusAn\(anlage\)/.test(quelltextKorr),
  "der erste Eintrag einer Domain legt ihren Korpus an");
zaehl();

// ⚠️ NUR beim ersten Mal: ein bekannter Korpus wird hier nie angefasst. Seine Werte gehören ihm,
// und eine einzelne Quelle darf sie nicht im Vorbeigehen umschreiben -- umbenannt wird über das
// Korpusfeld, mit Rückfrage.
assert.ok(/korpus\.known === true \|\| !korpus\.corpus_key/.test(quelltextKorr),
  "ein bekannter Korpus wird beim Eintragen nicht überschrieben");
zaehl();

// ⚠️ Und die FORM bleibt offen: bei einer Zeile sagt das Verhältnis Titel/Zeilen nichts.
assert.ok(!/felder\.form =/.test(quelltextKorr),
  "Werk oder Belegstelle wird beim ersten Eintrag NICHT geraten");
zaehl();

// 💣 Die Farbe der Meldung wird bei JEDER Meldung neu gesetzt. Ohne das Zurücksetzen erbte sie
// die vorige -- am 02.09.2026 stand „Diese Quelle haengt nicht an diesem Objekt." in GRÜN, weil
// davor eine Erfolgsmeldung dort gestanden hatte. Eine Fehlermeldung in Grün liest sich wie eine
// Bestätigung.
assert.ok(/function showAddRowNote\(message, art\)[\s\S]{0,700}classList\.remove\("fs-add-note--ok", "fs-add-note--bad"\)/
  .test(quelltextKorr), "jede Meldung setzt ihre Farbe neu");
zaehl();
// ⚠️ Und der TEXT überlebt einen Knoten ohne `classList`: die Meldung ist die Hauptsache, die
// Farbe die Zugabe. Ohne diesen Riegel starb `zeigeUmtypung` an der Dokument-Attrappe eines
// FREMDEN Tests -- gefunden hat das der Lauf über das ganze Feld, nicht meine eigenen Tests.
assert.ok(/if \(note\.classList\) \{/.test(quelltextKorr),
  "eine fehlende classList reisst den Meldungstext nicht mit");
zaehl();

console.log("OK — " + anzahl + " Zusicherungen (Adressprüfung der Eingabezeile)");
