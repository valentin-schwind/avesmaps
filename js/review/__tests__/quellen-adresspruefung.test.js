"use strict";

/**
 * Die Eingabezeile prüft ihre Adresse: Knopf, drei Zustände, gesperrte Katalogfelder.
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

// ══ 3 · Die bekannte Seite sperrt die Katalogfelder ═════════════════════════════════════════════

// 🔴 Was der Editor dort hineinschriebe, würde entweder verworfen (der Titel füllt im Katalog nur
// eine Lücke) oder wirkte katalogweit (`is_official` überschreibt der Upsert UNBEDINGT). Sperren
// ist die Antwort DAVOR; eine Meldung danach erklärt nur, warum die Eingabe nichts bewirkt hat.
assert.strictEqual(bekannt.sperren, true, "eine bekannte Seite sperrt die Katalogfelder");
zaehl();
assert.strictEqual(gelesen.sperren, false, "eine neue Seite sperrt nichts");
zaehl();
assert.strictEqual(erreichbar.sperren, false, "und eine titellose auch nicht");
zaehl();
assert.strictEqual(tot.sperren, false, "eine tote erst recht nicht");
zaehl();

// Die Reichweite wird BENANNT -- die Zahl ist die Warnung vor einer Änderung am geteilten Katalog.
assert.ok(bekannt.meldung.includes("4"), "die Zahl der zitierenden Objekte steht in der Meldung");
zaehl();

// ⚠️ Ohne Nutzungszahl bleibt der Satz weg, statt „an 0 Objekten" zu behaupten.
const bekanntOhne = featureSourceInspectView({ state: "bekannt", existing: { label: "X", usage_count: 0 } });
assert.ok(!/\b0\b/.test(bekanntOhne.meldung), "ohne Zitate wird keine Null behauptet");
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

// ⚠️ Ändert sich die Adresse wieder, gilt die Auskunft nicht mehr -- sonst bliebe die Zeile für
// eine ANDERE Adresse halb gesperrt.
assert.ok(/addEventListener\("input"[\s\S]{0,220}setzeKatalogfelderGesperrt\(false\)/.test(ohneKommentare),
  "eine geänderte Adresse hebt die Sperre wieder auf");
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

console.log("OK — " + anzahl + " Zusicherungen (Adressprüfung der Eingabezeile)");
