// DIE HALBPILLE -- das Kanon-Etikett im Objektkopf.
// Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md §3, §4.1
//
// ⭐ SIE IST GEWAEHLT, WEIL SIE DIE UNVOLLSTAENDIGKEIT DES EINTRAGS UNTERSTREICHT (Owner
// 27.08.2026). Ein Chip, dessen zweites Feld sagt, dass hier noch etwas offen ist: wer
// geschrieben hat, was nicht im Kanon steht.
//
// 🔴 EIN EINTRAG KANN NIE OFFIZIELL UND INOFFIZIELL SEIN (Owner 27.08.2026, woertlich). Das
// entscheidet die Ableitung serverseitig; hier wird geprueft, dass das Etikett diese eine Aussage
// auch als EINEN Chip zeigt und nicht als zwei nebeneinander.
//
// 💣 DER TEXT ENTSTEHT HIER, DIE DATEN KOMMEN VOM SERVER. `bezeichner_type` + `bezeichner_count`
// werden erst im Browser zu „Briefspiel (2)". Wer den fertigen Satz speicherte, koennte ihn nie
// uebersetzen und nie umformulieren, ohne den Bestand anzufassen -- dieselbe Trennung wie beim
// `source_type`, dessen Whitelist in PHP steht und dessen Beschriftung hier.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/kanon-halbpille.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(wurzel, "js", "ui", "feature-source-markup.js"));
const etikett = markup.featureKanonBadgeMarkup;
const bezeichner = markup.featureKanonBezeichnerText;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const L = { official: "Offiziell", unofficial: "Inoffiziell" };
const TYPEN = { briefspiel: "Briefspiel", abenteuer: "Abenteuer" };

let pruefungen = 0;
function pruefe(bedingung, was) {
  assert.ok(bedingung, was);
  pruefungen++;
}

// ---- A. Kein Etikett, wo keins hingehoert ----------------------------------------------------
// ⚠️ „Ohne Quelle" erscheint NUR im Editor. Ein unbelegtes Objekt bekommt beim Besucher gar kein
// Etikett -- der Kopf bleibt, wie er heute ist. resolveFeatureKanon gibt dafuer `null`.
for (const leer of [null, undefined, {}, { bezeichner_label: "Briefspiel (Garetien)" }]) {
  pruefe(etikett(leer, esc, L, TYPEN) === "", "ohne Kanon-Aussage rendert nichts");
}

// ---- B. Die ganze Pille: offiziell, ohne zweites Feld -----------------------------------------
// ⚠️ OHNE BEZEICHNER BLEIBT ES EINE GANZE PILLE. Ein leeres zweites Feld waere eine Naht ohne
// Inhalt -- und „offiziell" trennt nichts auf: es gibt dort nichts nachzutragen.
const off = etikett({ kanon: "offiziell" }, esc, L, TYPEN);
pruefe(off.includes('class="fs-kanon fs-kanon--off"'), "offiziell traegt die Gold-Klasse");
pruefe(!off.includes("fs-kanon--split"), "ohne Bezeichner keine Halbpille");
pruefe(off.includes(">Offiziell<"), "der Wortlaut steht IM Element, nicht nur in einem title");

// ---- C. Die Halbpille: ein Chip, zwei Felder --------------------------------------------------
const halb = etikett({ kanon: "inoffiziell", bezeichner_label: "Briefspiel (Garetien)" }, esc, L, TYPEN);
pruefe(halb.includes("fs-kanon--split"), "mit Bezeichner wird es die Halbpille");
pruefe(halb.includes('<span class="fs-kanon__state">Inoffiziell</span>'), "linkes Feld: der Kanon");
pruefe(halb.includes('<span class="fs-kanon__by">Briefspiel (Garetien)</span>'), "rechtes Feld: die Herkunft");
// 🔴 EIN Chip, nicht zwei. Genau EIN aeusseres fs-kanon-Element -- der Einwand des Owners gegen
// „Stempel + Pille" war, dass zwei Elemente nebeneinander uneinheitlich aussehen.
pruefe((halb.match(/class="fs-kanon /g) || []).length === 1, "genau EIN aeusserer Chip");
// ⚠️ Ein Vorleser hoert die Naht nicht -- deshalb steht die Trennung im aria-label.
pruefe(halb.includes('aria-label="Inoffiziell · Briefspiel (Garetien)"'), "beide Felder im aria-label");

// ---- D. Typ + Anzahl werden hier zum Text -----------------------------------------------------
pruefe(bezeichner({ bezeichner_type: "briefspiel", bezeichner_count: 2 }, TYPEN) === "Briefspiel (2)",
  "aus Typ und Anzahl wird „Briefspiel (2)“");
// Ein einzelner Treffer bekommt keine „(1)“ -- die Zahl saegte nur Rauschen an einen Namen.
pruefe(bezeichner({ bezeichner_type: "briefspiel", bezeichner_count: 1 }, TYPEN) === "Briefspiel",
  "eine einzelne Quelle traegt keine Anzahl");
// ⚠️ Die ANZAHL ALLEIN ist kein Bezeichner: „(2)“ sagt nichts darueber, von wem etwas stammt.
pruefe(bezeichner({ bezeichner_count: 2 }, TYPEN) === "", "Anzahl ohne Typ ergibt keinen Bezeichner");
pruefe(!etikett({ kanon: "inoffiziell", bezeichner_count: 2 }, esc, L, TYPEN).includes("split"),
  "und damit auch keine Halbpille");
// Der Name schlaegt den Typ, wenn beide da sind -- er ist die genauere Angabe.
pruefe(bezeichner({ bezeichner_label: "Nordwacht", bezeichner_type: "briefspiel", bezeichner_count: 3 }, TYPEN)
  === "Nordwacht", "der Name schlaegt Typ und Anzahl");
// Ein unbekannter Typ faellt nicht weg, er geht roh durch -- besser roh als verschwunden.
pruefe(bezeichner({ bezeichner_type: "podcast", bezeichner_count: 2 }, TYPEN) === "podcast (2)",
  "ein unbekannter Typ wird roh durchgereicht");

// ---- E. Auch offizielle Objekte koennen einen Bezeichner tragen -------------------------------
// 🔴 „Offiziell schlaegt inoffiziell": hat ein offizieller Ort zusaetzlich eine Briefspielquelle,
// bleibt er OFFIZIELL. Die Ableitung schickt dann keinen Bezeichner mit -- kaeme aber je einer,
// darf die Form ihn tragen, ohne die Kanonlage zu wechseln.
const offMitName = etikett({ kanon: "offiziell", bezeichner_label: "Goldene Fluegel" }, esc, L, TYPEN);
pruefe(offMitName.includes("fs-kanon--off") && offMitName.includes("fs-kanon--split"),
  "die Farbe folgt dem Kanon, nicht dem Bezeichner");
pruefe(!offMitName.includes("fs-kanon--inoff"), "und kippt dabei nicht");

// ---- F. Text aus der Datenbank wird maskiert ---------------------------------------------------
// Der Bezeichner ist ein von Redakteuren gepflegter Quellenname, kein Literal.
const boese = etikett({ kanon: "inoffiziell", bezeichner_label: '<img src=x onerror="alert(1)">' }, esc, L, TYPEN);
pruefe(!boese.includes("<img"), "der Bezeichner wird maskiert");
pruefe(boese.includes("&lt;img"), "und zwar sichtbar, nicht verschluckt");

// ---- G. Die Farbe traegt GENAU EINE Bedeutung --------------------------------------------------
// 🔴 Gold = im Kanon, Blaugruen = nicht. Nirgends sonst. Das rechte Feld ist deshalb NEUTRAL: neben
// einem blaugruenen INOFFIZIELL stiessen sonst zwei Blaugruen aneinander.
// 🔴 KEIN ROT. Die Briefspiele sind der Grund, warum wir die Inhalte haben -- ein Warnrot machte
// aus einer Herkunftsangabe eine Qualitaetsaussage.
const css = fs.readFileSync(path.join(wurzel, "css", "features", "feature-sources.css"), "utf8");
const halbpilleCss = css.slice(css.indexOf(".fs-kanon--split"), css.indexOf(".feature-kanon-head"));
pruefe(halbpilleCss.includes(".fs-kanon--split .fs-kanon__by"), "das Bezeichnerfeld hat eine eigene Regel");
const byRegel = halbpilleCss.slice(halbpilleCss.indexOf(".fs-kanon--split .fs-kanon__by"));
pruefe(!/--color-kanon-/.test(byRegel), "das rechte Feld nimmt KEINEN der vier Kanon-Token");
pruefe(byRegel.includes("--color-text-muted"), "es ist neutral gehalten (Entwurf §3.1)");
pruefe(!/#[0-9a-f]{3,6}|\bred\b|crimson/i.test(halbpilleCss),
  "kein Rot und keine festen Farben -- alles laeuft ueber Token, sonst gibt es kein dunkles Thema");

// ---- H. Die vier Token stehen in BEIDEN Themen -------------------------------------------------
// 💣 Ein Token, das nur im hellen Block steht, ist im dunklen Thema leer -- der Chip waere dort
// transparent mit unsichtbarer Schrift. Gezaehlt wird je Token zweimal DEFINIERT, nicht nur
// erwaehnt: die Zeichenkette steht auch in Kommentaren.
const tokens = fs.readFileSync(path.join(wurzel, "css", "base", "tokens.css"), "utf8");
for (const t of ["--color-kanon-official", "--color-kanon-official-text", "--color-kanon-unofficial", "--color-kanon-unofficial-text"]) {
  const treffer = tokens.match(new RegExp("^\\s*" + t + ":", "gm")) || [];
  pruefe(treffer.length === 2, `${t} muss in hellem UND dunklem Thema definiert sein (gefunden: ${treffer.length})`);
}

// ---- I. Der Kopf polstert nicht doppelt ---------------------------------------------------------
// ⚠️ Die seitliche Einrueckung kommt vom Behaelter (.location-popup traegt padding: 10px). Eine
// zweite hier haette das Etikett als EINZIGES Element im Kopf nach innen versetzt.
const kopfRegel = css.slice(css.indexOf(".feature-kanon-head"));
const kopfBlock = kopfRegel.slice(0, kopfRegel.indexOf("}"));
pruefe(/padding-top:/.test(kopfBlock) && !/padding:/.test(kopfBlock),
  "nur oben polstern, nie ringsum");
// 🔴 EINE Klasse fuer alle fuenf Koepfe. Zwei Rezepturen fuer dieselbe Zeile sind in diesem Repo
// teuer bezahlt worden (AGENTS.md, Listenzeile: aus einer Abschrift wurden sieben).
pruefe(!/location-popup__kanon|region-info-box__kanon/.test(css),
  "keine wirtsspezifische Zweitfassung der Kopfregel");

// ---- J. Die Verdrahtung: vier Objektarten, und jede mit IHREM Schluessel -------------------------
// 💣 DER SCHLUESSEL MUSS DERSELBE SEIN WIE BEI DER QUELLENZEILE. Laege das Etikett unter einem
// anderen, faende es nichts -- und „kein Etikett" ist ein gueltiger Zustand, also faellt es nicht
// auf. Bei der Kraftlinie ist das nicht selbstverstaendlich: ihre Quellen haengen am ANKER-Segment
// (kleinste public_id der Namensgruppe), nicht am angeklickten.
const flaechen = [
  ["js/map-features/map-features-location-marker-entry.js", /renderFeatureKanonBadge\("settlement", markerEntry\.publicId\)/g, 2],
  ["js/map-features/map-features-path-rendering.js", /renderFeatureKanonBadge\("path", getPathPublicId\(path\)\)/g, 1],
  ["js/map-features/map-features-powerlines.js", /renderFeatureKanonBadge\("powerline", getPowerlineSourceAnchorId\(powerline\)\)/g, 1],
  ["js/map-features/map-features-labels.js", /renderFeatureKanonBadge\("region", label\.publicId\)/g, 1],
  ["js/map-features/map-features-region-info-markup.js", /renderFeatureKanonBadge\("territory", regionEntry\.territoryPublicId \|\| ""\)/g, 1],
];
for (const [datei, muster, anzahl] of flaechen) {
  const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8");
  const treffer = quelle.match(muster) || [];
  pruefe(treffer.length === anzahl, `${datei}: ${anzahl} Etikett(en) erwartet, ${treffer.length} gefunden`);
}
// 💣 Und der Anker steht als EINE benannte Funktion da, nicht zweimal abgeschrieben: sonst
// schluegen Quellenzeile und Etikett dieselbe Linie unter verschiedenen Schluesseln nach.
const kraft = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-powerlines.js"), "utf8");
pruefe((kraft.match(/function getPowerlineSourceAnchorId/g) || []).length === 1, "der Anker ist EINE Funktion");
// ⚠️ Die Definition selbst traegt denselben Wortlaut -- sie wird ausgeschlossen, sonst zaehlte
// der Test sich seinen dritten „Leser" selbst herbei.
pruefe((kraft.match(/(?<!function )getPowerlineSourceAnchorId\(powerline\)/g) || []).length === 2,
  "und ihre zwei Leser sind Quellenzeile und Etikett");

// ---- K. Der Kopf setzt es an die richtige Stelle -------------------------------------------------
// 💣 HIER STAND EINE QUELLTEXT-PRUEFUNG ("kommt ${kanonMarkup} zwischen Titelgruppe und
// Knopfreihe vor?"), und sie war GRUEN, waehrend das Etikett live unter dem WAPPEN klebte
// (Owner 01.09.2026: „das offiziell ist unter das wappen gerutscht"). Die Reihenfolge im
// Quelltext sagt nichts darueber, in welchem ELEMENT etwas landet -- geprueft wird deshalb das
// gerenderte Markup.
const popups = fs.readFileSync(path.join(wurzel, "js", "ui", "popups.js"), "utf8");
pruefe(/kanonMarkup = ""/.test(popups), "locationPopupMarkup nimmt kanonMarkup entgegen");
const vmKontext = {
  escapeHtml: (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
  tr: (schluessel, rueckfall) => rueckfall,
  locationIconMarkup: () => '<div class="location-popup__icon">W</div>',
  locationDescriptionMarkup: () => "",
  wikiLocationLinkMarkup: () => "",
};
vmKontext.globalThis = vmKontext;
vm.createContext(vmKontext);
vm.runInContext(popups.slice(popups.indexOf("function locationPopupMarkup"), popups.indexOf("function labelPopupMarkup")), vmKontext);
const ETIKETT = '<div class="feature-kanon-head">ETIKETT</div>';

// 🔴 ICON-KOPF: das Wappen liegt LINKS, der Text daneben -- also gehoert das Etikett IN die
// Titelgruppe. Als Geschwister des Kopfes begann es 58 px weiter links als der Text.
const mitIcon = vmKontext.locationPopupMarkup({
  name: "Burg Trutzfels", locationTypeLabel: "Festung", showType: true,
  showDescription: false, showWikiLink: false, kanonMarkup: ETIKETT,
});
const gruppe = mitIcon.slice(mitIcon.indexOf('class="location-popup__title-group"'));
const gruppeEnde = gruppe.indexOf("</div>\n\t\t\t</div>") >= 0 ? gruppe.indexOf("</div>\n\t\t\t</div>") : gruppe.length;
pruefe(gruppe.slice(0, gruppeEnde).includes("feature-kanon-head"),
  "beim Icon-Kopf steht das Etikett IN der Titelgruppe, nicht unter dem Wappen");
pruefe(mitIcon.indexOf("feature-kanon-head") > mitIcon.indexOf("location-popup__type"),
  "und darin unter Art und Herrschaft, nicht ueber ihnen");
pruefe(mitIcon.indexOf("feature-kanon-head") < mitIcon.indexOf("location-popup__divider")
  || !mitIcon.includes("location-popup__divider"), "und vor dem Kopf-Trenner");

// 🔴 BILD-KOPF: dort gibt es kein Wappen daneben, das Etikett steht unter dem Bild.
const mitBild = vmKontext.locationPopupMarkup({
  name: "Burg Trutzfels", headerImageMarkup: '<div class="info-header-image"></div>',
  showDescription: false, showWikiLink: false, actionsMarkup: '<div class="actions"></div>',
  kanonMarkup: ETIKETT,
});
pruefe(mitBild.indexOf("info-header-image") < mitBild.indexOf("feature-kanon-head"),
  "beim Bild-Kopf steht es hinter dem Bild");
pruefe(mitBild.indexOf("feature-kanon-head") < mitBild.indexOf('class="actions"'),
  "und vor der Knopfreihe (Entwurf §4.1)");
// ⚠️ Genau EINMAL -- die zwei Zweige duerfen es nicht beide zeichnen.
for (const [was, markup] of [["Icon-Kopf", mitIcon], ["Bild-Kopf", mitBild]]) {
  pruefe((markup.match(/feature-kanon-head/g) || []).length === 1, `${was}: das Etikett genau einmal`);
}
// Ohne Etikett bleibt der Kopf, wie er war.
pruefe(!vmKontext.locationPopupMarkup({
  name: "Namenlos", showType: true, showDescription: false, showWikiLink: false,
}).includes("feature-kanon-head"), "ohne Etikett zeichnet der Kopf keine leere Huelle");
// ⚠️ EINE Fassung der Typbeschriftungen, zwei Leser -- als Abschrift liefen sie beim ersten neuen
// Quellentyp still auseinander (ein unbekannter Schluessel faellt nicht, er geht roh durch).
pruefe((popups.match(/regionalspielhilfe: tr\(/g) || []).length === 1,
  "die Typbeschriftungen stehen genau einmal");
pruefe((popups.match(/featureSourceTypeLabels\(\)/g) || []).length === 3,
  "eine Fassung, zwei Leser (plus ihre Definition)");

console.log(`kanon-halbpille.test.js: ${pruefungen} Pruefungen erfuellt`);
