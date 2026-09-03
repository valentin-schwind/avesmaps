const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Schritt 1 des Quellen-Umbaus (Owner-GO 02.09.2026): der Korpusrahmen bleibt stehen und nennt
// seine Reichweite, eine bekannte Seite wird VERKNÜPFT statt angelegt, und jede Reichweite sagt,
// wer sie eingetragen hat.
//
// 💣 WARUM ES DAS GIBT: der Rahmen war einen Tag lang `hidden` und hat dabei Art, Lizenz und
// Namensnennung mitversteckt — Felder, die dem Korpus gar nicht gehören. Die leere Maske konnte
// danach WENIGER als vor dem ganzen Umbau, und der Owner meldete „wieso habe ich jetzt wieder das
// alte Eingabeformular".
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-herkunft-und-reichweite.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
// 🔴 feature-source-markup.js MUSS vorher im globalen Raum stehen -- der Editor holt sich von dort
// die Lizenztafel und die Seitenkürzung. Unter Node gibt es kein `window`, das beide teilt.
require(path.join(wurzel, "js/ui/feature-source-markup.js"));
const modul = require(path.join(wurzel, "js/review/review-feature-sources.js"));
const { renderFeatureSourceEditPanel, featureSourceDatum, featureSourceHerkunftZeile } = modul;

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen++; };
const gleich = (a, b, text) => { assert.strictEqual(a, b, text); pruefungen++; };

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tr = (_schluessel, rueckfall) => rueckfall;

// ── 1 · Das Datum ────────────────────────────────────────────────────────────────────────────
// 💣 KEIN `new Date(...)`. Der Server schickt einen MySQL-Zeitstempel OHNE Zonenangabe; `Date`
// liest ihn je nach Browser als UTC oder als Ortszeit und verschiebt ihn um Stunden -- was um
// Mitternacht den TAG ändert. Ein Test, der nur „irgendein Datum" prüft, sähe das nie.
gleich(featureSourceDatum("2026-09-02 17:04:00.000"), "02.09.2026", "Zeitstempel wird zerlegt");
gleich(featureSourceDatum("2026-01-01 00:00:00"), "01.01.2026",
  "Mitternacht bleibt derselbe Tag -- hier bricht jede Umrechnung über `Date`");
gleich(featureSourceDatum("2026-12-31 23:59:59"), "31.12.2026", "und die letzte Sekunde des Jahres auch");
gleich(featureSourceDatum(""), "", "leer bleibt leer");
gleich(featureSourceDatum(null), "", "null bleibt leer");
gleich(featureSourceDatum("irgendwas"), "irgendwas",
  "was nicht wie ein Datum aussieht, kommt unverändert zurück -- nie „NaN.NaN.NaN“");

// ── 2 · Die Herkunftszeile ───────────────────────────────────────────────────────────────────
const WORTLAUT = {
  mitName: "x.mit", mitNameText: "Eingetragen von {wer} am {wann}",
  ohneName: "x.ohne", ohneNameText: "Eingetragen am {wann}",
};
// 🪤 03.09.2026: die Zeile heisst `.fs-scope__by`. `.fs-edit__by` band sie an den ✎, obwohl
// die Eingabezeile dieselbe Zeile bekommen soll -- der Vertrag im Mockup nennt sie so.
gleich(
  featureSourceHerkunftZeile({ at: "2026-09-02 17:04:00", by: "Vali" }, WORTLAUT, esc, tr),
  '<p class="fs-scope__by">Eingetragen von Vali am 02.09.2026</p>',
  "mit Namen: wer und wann"
);
// ⚠️ OHNE NAMEN NUR DAS DATUM. Der Bestand von vor der Anmeldepflicht trägt `created_by = NULL`,
// und „von unbekannt" ist keine Auskunft, sondern ein Platzhalter, der wie ein Fehler aussieht.
gleich(
  featureSourceHerkunftZeile({ at: "2026-09-02 17:04:00", by: "" }, WORTLAUT, esc, tr),
  '<p class="fs-scope__by">Eingetragen am 02.09.2026</p>',
  "ohne Namen: nur das Datum, kein „unbekannt“"
);
gleich(featureSourceHerkunftZeile({ at: "", by: "Vali" }, WORTLAUT, esc, tr), "",
  "ohne Datum gar keine Zeile");
gleich(featureSourceHerkunftZeile(null, WORTLAUT, esc, tr), "", "und ohne Herkunft erst recht nicht");
// 💣 Ein Editorname ist Fremdtext und wird MASKIERT -- er kommt aus `users.username`.
pruefe(
  featureSourceHerkunftZeile({ at: "2026-09-02 10:00:00", by: '<script>x</script>' }, WORTLAUT, esc, tr)
    .indexOf("<script>") === -1,
  "der Name wird maskiert"
);

// ── 3 · Die zwei Zeilen stehen an IHRER Reichweite ───────────────────────────────────────────
// 🔴 Nicht gesammelt am Fuss: „wer hat das hier angehängt" und „wer hat die Quelle angelegt" sind
// zwei verschiedene Menschen und zwei verschiedene Zeitpunkte. Unter einer gemeinsamen Überschrift
// wäre nicht zu sehen, welche Angabe zu welcher Hälfte gehört.
const QUELLE = {
  source_id: 7, url: "https://westlande.de/albernia/index.php?title=Apfeldorn",
  label: "Apfeldorn", type: "briefspiel", official: false, origin: "manual",
  pages: "", reference_kind: "", license: "cc-by-sa-4.0", attribution: "",
  usage_count: 3, wiki_owned: false,
  created: {
    link: { at: "2026-09-01 08:30:00", by: "Nottel" },
    source: { at: "2026-06-14 21:15:00", by: "Vali" },
  },
  corpus: {
    corpus_key: "westlande.de", label: "AlberniaWiki", known: true,
    source_type: "briefspiel", license: "cc-by-sa-4.0", attribution: "",
    is_official: false, sources: 39, objects: 50,
  },
};
const panel = renderFeatureSourceEditPanel(QUELLE, esc, tr);
pruefe(panel.indexOf("Hier angehängt von Nottel am 01.09.2026") !== -1, "die Verknüpfung nennt ihren Editor");
pruefe(panel.indexOf("In den Katalog gelegt von Vali am 14.06.2026") !== -1, "der Katalogeintrag seinen");

const iObjekt = panel.indexOf("Nur an diesem Objekt");
const iBeleg = panel.indexOf("Hier angehängt von");
const iKatalog = panel.indexOf("Gilt für alle Objekte");
const iQuelle = panel.indexOf("In den Katalog gelegt von");
const iKorpus = panel.indexOf("Gilt für den ganzen Korpus");
// 🪤 UMGEDREHT am 02./03.09.2026 (Owner: „Damit man den Korpus sieht würde ich ‚Nur an
// diesem Objekt‘ unter ‚Gilt für den ganzen Korpus‘ setzen"). Die Ordnung geht von WEIT nach
// ENG: Quelle — Korpus — dieses Objekt, in BEIDEN Formularen gleich.
pruefe(iKatalog < iKorpus && iKorpus < iObjekt,
  "von weit nach eng: Quelle, Korpus, dieses Objekt");
// 🔴 UNVERÄNDERT TRAGEND: jede Herkunft steht AN IHRER Reichweite, nicht gesammelt am Fuss.
// „Wer hat das hier angehängt" und „wer hat die Quelle angelegt" sind zwei verschiedene Menschen
// und zwei verschiedene Zeitpunkte.
pruefe(iKatalog < iQuelle && iQuelle < iKorpus,
  "die Katalog-Herkunft steht IN der Quellen-Gruppe");
pruefe(iObjekt < iBeleg,
  "die Verknüpfungs-Herkunft steht IN der Objekt-Gruppe, nicht dahinter");
pruefe(iKatalog < iQuelle && iQuelle < iKorpus,
  "und die Katalog-Herkunft in der Katalog-Gruppe");

// 🔴 NUR LESBAR (Owner 02.09.2026: „die felder können nur eingesehen, nicht verändert werden").
// Ein `data-fs-field` daran machte sie zu einem Wert, den `featureSourceChangedFields` mitschickt.
const beiZeilen = panel.match(/<p class="fs-scope__by">/g) || [];
gleich(beiZeilen.length, 2, "zwei Herkunftszeilen");
pruefe(!/fs-scope__by[^>]*data-fs-field/.test(panel), "und keine davon ist ein Eingabefeld");

// Eine Quelle ohne Herkunft (Altbestand) zeigt gar keine Zeile -- nicht „unbekannt".
const ohne = renderFeatureSourceEditPanel(
  Object.assign({}, QUELLE, { created: { link: null, source: null } }), esc, tr);
gleich((ohne.match(/fs-scope__by/g) || []).length, 0, "ohne Herkunft: keine Zeile");

// ── 4 · Der dritte Zustand: die Felder werden hervorgehoben, der Knopf nicht ──────────────────────────────────
// 🔴 AUSGEFÜHRT, nicht im Quelltext gelesen. Ein `includes("Verknüpfen")` wäre auch dann grün,
// wenn der Umschalter nie gerufen wird -- genau die Vakuum-Zusicherung, die dieses Haus schon
// bezahlt hat.
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF.
const quelltext = fs.readFileSync(
  path.join(wurzel, "js/review/review-feature-sources.js"), "utf8").replace(/\r\n/g, "\n");
const anfang = quelltext.indexOf("function zeigeBekannteSeite(an) {");
pruefe(anfang !== -1, "der Umschalter ist auffindbar");
const ende = quelltext.indexOf("\n  }", anfang);
pruefe(ende !== -1, "und sein Rumpf abgrenzbar");
const rumpf = quelltext.slice(anfang, ende + 4);

const macheElement = (klassen) => ({
  klassen: new Set(klassen || []),
  textContent: "",
  classList: {
    toggle(name, an) { if (an) { this._e.klassen.add(name); } else { this._e.klassen.delete(name); } },
  },
});
const bindeClassList = (el) => { el.classList._e = el; return el; };

const knopf = bindeClassList(macheElement());
// ⚠️ Startwert wie im Markup: der Umschalter darf ihn nicht mehr anfassen, und ein anderer
// Startwert liesse die Zusicherung darunter zufaellig gruen werden.
knopf.textContent = "Speichern";
const meins = [bindeClassList(macheElement()), bindeClassList(macheElement())];
const containerEl = {
  querySelector: (sel) => (sel === "[data-fs-add-submit]" ? knopf : null),
  querySelectorAll: (sel) => (sel === "[data-fs-meins]" ? meins : []),
};
const zeigeBekannteSeite = new Function(
  "containerEl", "tr", rumpf + "\nreturn zeigeBekannteSeite;")(containerEl, tr);

zeigeBekannteSeite(true);
// 🪤 UMGEDREHT am 03.09.2026 (Owner: „Der button soll auch nicht verknüpfen sondern
// Speichern heißen"). Hier stand: bei bekannter Seite heißt der Knopf „Verknüpfen".
// 🔴 Der Knopf trägt jetzt in BEIDEN Formularen dasselbe Wort; was gerade passiert —
// anlegen oder verknüpfen — steht in der grünen Meldung darunter, und die sagt es in einem
// ganzen Satz statt in einem Wort auf einem Knopf.
// ⚠️ Der Umschalter selbst BLEIBT — er hebt weiter hervor, was an einer bekannten Seite noch
// einzutragen ist. Genau das wird hier gemessen: dass er den Knopf NICHT mehr anfasst.
gleich(knopf.textContent, "Speichern", "der Knopf heißt auch bei bekannter Seite „Speichern“");
pruefe(meins.every((el) => el.klassen.has("fs-af--meins")),
  "und die zwei Felder, die nur hier gelten, sind hervorgehoben");
zeigeBekannteSeite(false);
gleich(knopf.textContent, "Speichern", "und zurück — die Aufschrift bewegt sich überhaupt nicht");
pruefe(meins.every((el) => !el.klassen.has("fs-af--meins")),
  "die Hervorhebung geht mit; sonst bliebe die Zeile für eine ANDERE Adresse markiert");

// 💣 UND DIE ZWEI FELDER MÜSSEN IM MARKUP MARKIERT SEIN. Ohne diese Zusicherung ist der Lauf
// oben ein Vakuum: das gefälschte DOM liefert die Elemente ja selbst, auch wenn die Zeile gar
// keine trägt. Gemessen wird deshalb BEIDES -- die Markierung und ihre Wirkung.
const leerZeile = modul.renderFeatureSourceEditorHtml({ wiki_url: "", sources: [] }, {});
gleich((leerZeile.match(/data-fs-meins/g) || []).length, 2,
  "genau Seite(n) und Abdeckung tragen den Marker -- sie allein gelten nur an dieser Fundstelle");
pruefe(/fs-af--pages" data-fs-meins/.test(leerZeile) && /fs-af--kind" data-fs-meins/.test(leerZeile),
  "und zwar diese zwei, nicht irgendwelche");

// 💣 Der Umschalter hängt an `setzeAdressZustand` und NICHT an einer einzelnen Aufrufstelle --
// sonst ist er beim nächsten Zustandswechsel vergessen. Das ist derselbe Trichter-Gedanke wie
// beim Statuskreis der Vorkommen.
pruefe(/zeigeBekannteSeite\(zustand === "bekannt"\);/.test(quelltext),
  "er hängt am EINEN Trichter für Adresszustände");

// ── 5 · Die Reichweite in der Aufschrift ─────────────────────────────────────────────────────
// ⚠️ Gemessen an `objects`, nicht an `known`: ein angelegter Korpus ohne Belege trüge sonst
// „0 Objekte" und läse sich wie ein Fehler.
pruefe(/objekte === 0[\s\S]{0,200}corpusScopeNew/.test(quelltext),
  "ohne Belege sagt die Aufschrift „neu“, nicht „0 Objekte“");
// 🔴 Die Reichweite ist von der Meta-Zeile in die AUFSCHRIFT gewandert: sie gilt allen fünf
// Feldern des Rahmens, nicht nur dem Namen daneben.
pruefe(!/corpusMany/.test(quelltext),
  "die alte Reichweite an der Meta-Zeile ist ersetzt, nicht danebengestellt");

// ── 6 · Die Hervorhebung muss die Spezifität GEWINNEN ────────────────────────────────────────
// 💣 `.fs-row--add input[type="text"]` ist (0,2,1) und setzt die KURZFORM `border`, die
// `border-color` mit zurücksetzt. Ein blankes `.fs-af--meins input` (0,1,1) verliert dagegen --
// die Seitenangabe bliebe ungefärbt, während das <select> daneben brav braun wird. Eine HALBE
// Hervorhebung liest sich als Fehler, und genau so ist es beim Bau dieses Mockups passiert.
// ⚠️ Ein Test, der nur „die Regel steht da" prüft, sähe das nie -- geprüft wird der VORFAHRE.
const css = fs.readFileSync(
  path.join(wurzel, "css/features/feature-sources.css"), "utf8").replace(/\r\n/g, "\n");
const meinsRegel = /\.fs-row--add \.fs-af--meins input\[type="text"\],\s*\n\.fs-row--add \.fs-af--meins select \{/;
pruefe(meinsRegel.test(css),
  "die Randfarbe der zwei Felder steht mit `.fs-row--add` davor -- sonst schlägt sie die Kurzform `border` nicht");
// Und die Gegenprobe: der Gegner existiert wirklich und setzt wirklich die Kurzform.
// 🪤 03.09.2026: er heisst jetzt `.fs-scope input[type="text"]` -- die Rezeptur der
// Eingabezeile (`.fs-row--add input…`) ist in der geteilten aufgegangen. Die SPEZIFITÄT bleibt
// dieselbe Frage: der Gegner ist (0,2,1) und setzt die Kurzform `border`, die Hervorhebung
// braucht also weiter ihren Vorfahren, um (0,3,1) zu erreichen.
pruefe(/\.fs-scope input\[type="text"\][\s\S]{0,300}\n\tborder: 1px solid/.test(css),
  "der Gegner ist noch da -- fällt er weg, darf diese Regel wieder schlanker werden");

console.log("OK — " + pruefungen + " Zusicherungen (Herkunft, Reichweite, dritter Zustand)");
