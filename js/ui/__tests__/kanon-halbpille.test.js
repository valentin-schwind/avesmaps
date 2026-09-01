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

// ---- C2. DIE QUELLENZEILE traegt dieselbe Halbpille, nicht zwei Kapseln ----------------------
// 🔴 Entwurf §3: „Halbpille … Objektkopf UND Quellenzeile". Gebaut waren es zwei Elemente
// nebeneinander -- Stempel plus eine eigene Typmarke ("[INOFFIZIELL] [Briefspiel]"). Owner
// 01.09.2026 an Trallop: „hier sind ‚Inoffiziell' und ‚Briefspiel' zwei separate kapseln, das
// soll so aussehn wie die anderen". Zwei Chips lesen sich als zwei Aussagen; es ist eine.
// ⚠️ Der Bezeichner ist hier die ART der Quelle, nicht ihr Name -- der steht in derselben Zeile
// schon links davor. Im Objektkopf ist es umgekehrt.
const quellenKasten = markup.buildSourceListMarkup("", [
  { label: "Briefspiel (Weiden)", url: "https://garetien.de/x", type: "briefspiel", official: 0 },
], { escape: esc, typeLabels: TYPEN, kanonLabels: L });
pruefe(quellenKasten.includes("fs-kanon--split"), "die Quellenzeile traegt die Halbpille");
pruefe(quellenKasten.includes('<span class="fs-kanon__by">Briefspiel</span>'),
  "und im zweiten Feld die ART der Quelle");
pruefe(!quellenKasten.includes("fs-src-type"),
  "die alte separate Typmarke gibt es nicht mehr");
pruefe((quellenKasten.match(/class="fs-kanon /g) || []).length === 1,
  "genau EIN Chip in der Zeile, nicht zwei");
// Ohne Art bleibt es eine ganze Pille -- seit 30.08.2026 darf eine Quelle typlos sein.
const ohneArt = markup.buildSourceListMarkup("", [
  { label: "Namenlose Quelle", url: "https://x.example/y", type: "", official: 1 },
], { escape: esc, typeLabels: TYPEN, kanonLabels: L });
pruefe(ohneArt.includes("fs-kanon--off") && !ohneArt.includes("fs-kanon--split"),
  "eine Quelle ohne Art bekommt die ganze Pille");
// ⚠️ Der WIKI-Artikel ist keine Katalogquelle und hat nie eine Art -- ganze Pille, wie bisher.
const mitWiki = markup.buildSourceListMarkup("https://de.wiki-aventurica.de/wiki/Trallop", [],
  { escape: esc, typeLabels: TYPEN, kanonLabels: L, wikiOfficial: true, wikiLabel: "Wiki Aventurica" });
pruefe(mitWiki.includes("fs-kanon--off") && !mitWiki.includes("fs-kanon--split"),
  "die Wiki-Zeile bleibt eine ganze Pille");

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

// 🪤 EIN `indexOf(".fs-kanon {")` TRIFFT AUCH `.fs-src-row .fs-kanon {` -- der Selektor
// enthaelt den anderen als Teilzeichenkette, und die Zeilenregel steht in der Datei frueher.
// Die Polsterpruefung darunter bestand dadurch kurzzeitig aus dem falschen Grund. Gesucht wird
// deshalb am ZEILENANFANG.
const regelAb = (quelle, selektor) => {
  const muster = new RegExp("^" + selektor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "m");
  const t = muster.exec(quelle);
  assert.ok(t, `Regel ${selektor} muss es geben`);
  return quelle.slice(t.index);
};
// ---- G. Die Farbe traegt GENAU EINE Bedeutung --------------------------------------------------
// 🔴 Gold = im Kanon, Blaugruen = nicht. Nirgends sonst. Das rechte Feld ist deshalb NEUTRAL: neben
// einem blaugruenen INOFFIZIELL stiessen sonst zwei Blaugruen aneinander.
// 🔴 KEIN ROT. Die Briefspiele sind der Grund, warum wir die Inhalte haben -- ein Warnrot machte
// aus einer Herkunftsangabe eine Qualitaetsaussage.
// 🪤 CSS-QUELLTEXT WIRD OHNE KOMMENTARE GEPRUEFT -- sonst prueft der Test die Dokumentation.
// Zweimal an einem Tag passiert: eine Zusicherung ueberlebte das Entfernen einer Deklaration,
// weil der Kommentar darueber sie im Klartext nannte; und ein `indexOf(".fs-kanon--split")` fand
// zuerst einen Kommentar, der die Klasse ERWAEHNT. In diesen Dateien steht die Begruendung
// absichtlich im Klartext neben der Regel -- also muss der Test sie wegschneiden, nicht die
// Kommentare verstuemmeln.
const ohneKommentare = (quelle) => quelle.replace(/\/\*[\s\S]*?\*\//g, "");
const css = ohneKommentare(fs.readFileSync(path.join(wurzel, "css", "features", "feature-sources.css"), "utf8"));
const halbpilleCss = regelAb(css, ".fs-kanon--split").slice(0, css.indexOf(".feature-kanon-head") - css.indexOf(".fs-kanon--split"));
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
const tokens = ohneKommentare(fs.readFileSync(path.join(wurzel, "css", "base", "tokens.css"), "utf8"));
for (const t of ["--color-kanon-official", "--color-kanon-official-text", "--color-kanon-unofficial", "--color-kanon-unofficial-text"]) {
  const treffer = tokens.match(new RegExp("^\\s*" + t + ":", "gm")) || [];
  pruefe(treffer.length === 2, `${t} muss in hellem UND dunklem Thema definiert sein (gefunden: ${treffer.length})`);
}

// ---- H1b. Das Polster ist 3px oben / 2px unten -- der Mittelweg aus ZWEI Kriterien -----------
// 💣 Ich habe es am 01.09.2026 auf 2/3 gedreht, weil die Schrift IN der Pille damit mittiger
// sitzt. Der Owner meldete sofort „wird immer schlimmer mit der vertikalen ausrichtung" -- das
// war das falsche Kriterium.
// 🔴 Die Zeile richtet an der GRUNDLINIE aus; die Chipschrift steht damit fest, und das Polster
// verschiebt die PILLE um sie herum. Zwei Optima, 0,97px auseinander (Chip 11px versal gegen
// Nachbar 12px gemischtschriftlich auf derselben Grundlinie): Text mittig in der Pille bei
// Grundlinie −3,905, Pille mittig auf der Zeile bei −4,875. Mittelweg −4,39; 3/2 trifft −4,335.
// Zeilenunwucht gemessen: 3/2 -> 1,08px | 2/2 -> 2,08 | 3/3 -> 2,08 | 2/3 -> 3,08.
// ⚠️ Wer nur die INNERE Zentrierung misst, landet bei 2/3 und macht es sichtbar schlechter.
const chipRegel = regelAb(css, ".fs-kanon").slice(0, 260);
pruefe(/padding:\s*3px\s+8px\s+2px\s*;/.test(chipRegel),
  "der Chip polstert 3px oben / 2px unten -- der gemessene Mittelweg, nicht die innere Mitte");
pruefe(!/padding:\s*2px\s+8px\s+3px\s*;/.test(css),
  "die auf die innere Mitte optimierte Fassung darf nirgends mehr stehen");

// ---- H1c. Der Zeilen-Versatz der Pille -----------------------------------------------------
// 🔴 In der Quellenzeile wird an der GRUNDLINIE ausgerichtet. Chip (11px versal, Versalhoehe
// 8,63) und Nachbartext (12px fett, 9,5) teilen sie sich -- aber nicht die optische Mitte: die
// Pillenmitte liegt dadurch 0,75px zu tief. Am Livesystem gemessen, beide Zeilen identisch:
//     ohne Versatz +0,75 | −0,75px -> 0,00 | −1px -> −0,25
// ⭐ Ein VERSATZ statt Polster, weil er Pille UND Schrift gemeinsam verschiebt: die Zeilenlage
// geht auf 0, die Lage der Schrift IN der Pille bleibt unangetastet. Ueber das Polster ging
// beides nur gegeneinander (Versuch vom 01.09.2026, vom Owner sofort beanstandet).
// ⚠️ NUR in der Quellenzeile -- Objektkopf, Suchtreffer und Konfliktpartei richten nicht an der
// Grundlinie aus; dort waere er ein Fehler.
const zeilenRegel = regelAb(css, ".fs-src-row .fs-kanon");
pruefe(zeilenRegel.length > 0, "die Quellenzeile hebt ihre Pille an");
pruefe(/top:\s*-0\.75px\s*;/.test(zeilenRegel.slice(0, 140)), "und zwar um genau 0,75px");
pruefe(/position:\s*relative\s*;/.test(zeilenRegel.slice(0, 140)),
  "ohne `position: relative` wirkt `top` gar nicht -- der Fehler waere still");
// ⚠️ Der Versatz darf NICHT am Chip selbst haengen: dann traefe er auch Kopf, Suchtreffer und
// Konfliktpartei, die mittig ausrichten.
const chipGrund = regelAb(css, ".fs-kanon").slice(0, 260);
pruefe(!/position:\s*relative/.test(chipGrund), "die Grundregel des Chips bleibt unversetzt");

// ---- H2. Alle drei Titelgruppen duerfen SCHRUMPFEN ----------------------------------------------
// 💣 Ein Flex-/Grid-Kind weigert sich per Vorgabe zu schrumpfen (`min-width: auto`), und der Chip
// bricht NICHT um. Ein langer Bezeichner zog damit die ganze Gruppe auf seine Textbreite -- live
// gemessen an „Sellach", dessen Quelle als Namen ihre eigene Adresse traegt (1 von 604 im Bestand):
// Gruppe 439px statt 322, Chip ueber dem Popup-Rand, das Popup SCROLLTE WAAGERECHT, und die
// Ellipse am Bezeichnerfeld griff gar nicht -- sie kann erst greifen, wenn der Kasten schmaler ist
// als sein Inhalt. Zwei der drei Gruppen trugen den Riegel schon; die dritte nicht, und genau die
// war betroffen.
// ⚠️ Ein Layoutfehler laesst sich in Node nicht nachstellen (kein Layout) -- geprueft wird deshalb
// die Deklaration; die Messung dazu steht am Code.
for (const [datei, regel] of [
  ["css/features/location-popups-markers.css", ".location-popup__title-group {"],
  ["css/features/location-popups-markers.css", ".info-header__titles {"],
  ["css/features/map-labels.css", ".region-info-box__title-group {"],
]) {
  const quelle = fs.readFileSync(path.join(wurzel, ...datei.split("/")), "utf8");
  const von = quelle.indexOf(regel);
  pruefe(von >= 0, `${regel} muss es geben`);
  // 🪤 KOMMENTARE RAUS, SONST PRUEFT DER TEST SEINE EIGENE DOKUMENTATION. Der Block traegt die
  // Begruendung im Klartext („Mit `min-width: 0` faellt beides weg"), und eine blosse Textsuche
  // fand die -- die Zusicherung ueberlebte das Entfernen der echten Deklaration. Nachgemessen.
  const block = ohneKommentare(quelle.slice(von, quelle.indexOf("}", von)));
  pruefe(/^[ \t]*min-width:\s*0\s*;/m.test(block),
    `${regel} braucht min-width: 0, sonst zieht ein langer Bezeichner den Kopf auf`);
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

// ---- K2. Der BILD-Kopf setzt es in seinen eigenen Titelblock ------------------------------------
// 💣 DER ZWEITE ANLAUF DERSELBEN MELDUNG. Nach dem Icon-Kopf lag es im BILD-Kopf immer noch falsch,
// und die Messung hatte es uebersehen: geprueft wurde an Burg Trutzfels, die dort GAR KEIN Wappen
// traegt -- also lag das Etikett zufaellig richtig. Owner 01.09.2026 an Gareth: "das offiziell ist
// unter das wappen gerutscht". Von acht Aufrufern geben nur zwei ein Wappen mit; genau die zwei
// waren betroffen. Deshalb prueft dieser Abschnitt MIT Wappen.
vm.runInContext(popups.slice(popups.indexOf("function infoHeaderImageMarkup"), popups.indexOf("function getLocationDescriptionText")),
  Object.assign(vmKontext, { withAssetVersion: (s) => s }));
const mitWappen = vmKontext.infoHeaderImageMarkup("metropole", "Gareth", "Metropole", "<img>", [], "", ETIKETT);
const titelblock = mitWappen.slice(mitWappen.indexOf('class="info-header__titles"'));
pruefe(titelblock.slice(0, titelblock.indexOf("</div></div>")).includes("feature-kanon-head"),
  "der Bild-Kopf setzt das Etikett IN den Titelblock, nicht hinter das Wappen");
pruefe(mitWappen.indexOf("info-header__coat") < mitWappen.indexOf("feature-kanon-head"),
  "und damit hinter dem Wappen im Markup, aber innerhalb der Titel");
pruefe(mitWappen.indexOf("info-header__subtitle") < mitWappen.indexOf("feature-kanon-head"),
  "unter Art und Herrschaft, nicht darueber");
// Ohne Etikett bleibt der Kopf unveraendert -- kein leeres Element, kein Platzhalter.
pruefe(!vmKontext.infoHeaderImageMarkup("metropole", "Gareth", "Metropole", "<img>").includes("feature-kanon-head"),
  "ohne Etikett zeichnet der Bild-Kopf keine leere Huelle");

// 🔴 UND ES DARF NICHT ZWEIMAL DASTEHEN. locationPopupMarkup zeichnet es nur noch, wenn der
// uebergebene Kopf es NICHT schon traegt -- der Riegel faellt dabei OFFEN aus: ein Aufrufer, der
// es dem Bild-Kopf vergisst, bekommt es sichtbar an der alten Stelle statt gar nicht.
const doppelt = vmKontext.locationPopupMarkup({
  name: "Gareth", headerImageMarkup: mitWappen, showDescription: false, showWikiLink: false,
  kanonMarkup: ETIKETT,
});
pruefe((doppelt.match(/feature-kanon-head/g) || []).length === 1,
  "traegt der Bild-Kopf es schon, zeichnet das Popup es NICHT noch einmal");
const vergessen = vmKontext.locationPopupMarkup({
  name: "Gareth", headerImageMarkup: '<div class="info-header"></div>', showDescription: false,
  showWikiLink: false, kanonMarkup: ETIKETT,
});
pruefe((vergessen.match(/feature-kanon-head/g) || []).length === 1,
  "vergisst ein Aufrufer es am Kopf, faellt der Riegel OFFEN und es steht trotzdem da");

// ---- K3. Die fuenf Flaechen reichen es an BEIDE Stellen ------------------------------------------
// 💣 Einmal gebaut, zweimal gereicht: zweimal AUFGELOEST koennten die zwei Antworten auseinander
// laufen (der Bildkopf zeigte dann etwas anderes als die schwebende Box desselben Objekts).
for (const [datei, variable] of [
  ["js/map-features/map-features-location-marker-entry.js", "settlementKanon"],
  ["js/map-features/map-features-labels.js", "labelKanon"],
  ["js/map-features/map-features-path-rendering.js", "pathKanon"],
  ["js/map-features/map-features-powerlines.js", "powerlineKanon"],
]) {
  const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8");
  pruefe((quelle.match(new RegExp(`const ${variable} =`, "g")) || []).length === 1,
    `${datei}: das Etikett wird genau EINMAL gebaut`);
  // ⚠️ KEINE Regex mit `[^)]*` hier: der Aufruf traegt verschachtelte Klammern
  // (`infoHeaderImageMarkup(settlementHeaderImageBasename(...), …)`), und die Zeichenklasse
  // bricht an der ERSTEN zu. Gesucht wird stattdessen im Fenster hinter dem Aufrufbeginn.
  const flach = quelle.replace(/\r?\n/g, " ");
  const aufruf = flach.indexOf("infoHeaderImageMarkup(");
  pruefe(aufruf >= 0 && flach.slice(aufruf, aufruf + 400).includes(`${variable})`),
    `${datei}: und dem Bild-Kopf gereicht`);
  pruefe(new RegExp(`kanonMarkup: ${variable}`).test(quelle),
    `${datei}: und dem Popup gereicht`);
}
// Das Territorium hat keinen Popup-Kopf, nur den Bild-Kopf und seinen Rueckfall -- beide tragen es.
const territorium = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-region-info-markup.js"), "utf8").replace(/\r?\n/g, " ");
const territoriumAufruf = territorium.indexOf("infoHeaderImageMarkup(");
pruefe(territoriumAufruf >= 0 && territorium.slice(territoriumAufruf, territoriumAufruf + 400).includes("kanonMarkup)"),
  "Territorium: Bild-Kopf traegt es");
pruefe(/region-info-box__title-group[^`]*\$\{kanonMarkup\}/.test(territorium),
  "Territorium: auch der Rueckfall-Kopf traegt es in seiner Titelgruppe");
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
