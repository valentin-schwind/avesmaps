const assert = require("assert");

// place-extras renders through the app globals. In the browser all of these are plain globals loaded
// earlier by index.html, so install the REAL implementations rather than fakes -- a stubbed escaper would
// hide exactly the escaping bugs this markup can have.
const { escapeHtml } = require("../../app/utils.js");
const { avesmapsLinkStatusMarkup, avesmapsLinkStatusLinkClass } = require("../../app/link-status.js");
const { avesmapsFilterBarMarkup } = require("../../ui/filter-bar.js");
const { avesmapsCitymapTypeLabel, avesmapsCitymapArtLabel } = require("../map-features-citymaps.js");

global.escapeHtml = escapeHtml;
global.avesmapsLinkStatusMarkup = avesmapsLinkStatusMarkup;
global.avesmapsLinkStatusLinkClass = avesmapsLinkStatusLinkClass;
global.avesmapsFilterBarMarkup = avesmapsFilterBarMarkup;
global.avesmapsCitymapTypeLabel = avesmapsCitymapTypeLabel;
global.avesmapsCitymapArtLabel = avesmapsCitymapArtLabel;
global.tr = function (key, germanDefault, params) {
  let out = String(germanDefault == null ? "" : germanDefault);
  Object.keys(params || {}).forEach((name) => {
    out = out.split("{" + name + "}").join(String(params[name]));
  });
  return out;
};

const {
  cityMapSafeUrl, cityMapBestLink, cityMapIsSpoiler, cityMapValidityLabel,
  cityMapCardMarkup, buildCityMapsSectionMarkup, buildCityMapRowMarkup, citymapFiltersMarkup,
  avesmapsCitymapCreditMarkup,
  cityMapBandLabel, cityMapRowSuffix, cityMapRowFacts, advRowLinkMarkup,
} = require("../map-features-place-extras.js");

// ---- URL safety -------------------------------------------------------------------------------------
// escapeHtml leaves "javascript:alert(1)" completely alone -- it has no HTML metacharacters -- so it would
// sail straight into an href and fire on click. Escaping is NOT a URL check; this is.
assert.strictEqual(cityMapSafeUrl("javascript:alert(1)"), "");
assert.strictEqual(cityMapSafeUrl("JaVaScRiPt:alert(1)"), "");
assert.strictEqual(cityMapSafeUrl("data:text/html,<script>alert(1)</script>"), "");
assert.strictEqual(cityMapSafeUrl("vbscript:x"), "");
// Protocol-relative would silently inherit the page scheme and leave our origin.
assert.strictEqual(cityMapSafeUrl("//evil.example/x"), "");
assert.strictEqual(cityMapSafeUrl(""), "");
assert.strictEqual(cityMapSafeUrl(null), "");
assert.strictEqual(cityMapSafeUrl("https://example.org/a"), "https://example.org/a");
assert.strictEqual(cityMapSafeUrl("HTTP://example.org/a"), "HTTP://example.org/a");
assert.strictEqual(cityMapSafeUrl("  https://example.org/a  "), "https://example.org/a");
assert.strictEqual(cityMapSafeUrl("/uploads/kartensammlungen/x/map-1.png"), "/uploads/kartensammlungen/x/map-1.png");

// Our own copy outranks the external link -- a present map_local_url IS the licence permission (§3.3,
// the server already gated it).
assert.strictEqual(cityMapBestLink({ map_local_url: "/uploads/a.png", map_url: "https://e.org/x" }), "/uploads/a.png");
assert.strictEqual(cityMapBestLink({ map_url: "https://e.org/x" }), "https://e.org/x");
assert.strictEqual(cityMapBestLink({}), "", "a map with no link at all is a valid row");
assert.strictEqual(cityMapBestLink({ map_url: "javascript:alert(1)" }), "", "hostile url never becomes an href");

// ---- spoiler ----------------------------------------------------------------------------------------
// ONLY an explicit true. Unknown (null) is not a spoiler -- treating it as one would hide maps nobody
// ever classified.
assert.strictEqual(cityMapIsSpoiler({ is_spoiler: true }), true);
assert.strictEqual(cityMapIsSpoiler({ is_spoiler: null }), false);
assert.strictEqual(cityMapIsSpoiler({ is_spoiler: false }), false);
assert.strictEqual(cityMapIsSpoiler({}), false);

// ---- validity label ---------------------------------------------------------------------------------
assert.strictEqual(cityMapValidityLabel({ valid_from_bf: 1027, valid_to_bf: 1045 }), "1027–1045 BF");
// 9999 is the open-ended sentinel (AGENTS.md §5) and must read as "seit", never print as a year.
assert.strictEqual(cityMapValidityLabel({ valid_from_bf: 1027, valid_to_bf: 9999 }), "seit 1027 BF");
assert.strictEqual(cityMapValidityLabel({ valid_from_bf: 1027 }), "seit 1027 BF");
assert.strictEqual(cityMapValidityLabel({ valid_to_bf: 1045 }), "bis 1045 BF");
// Unknown -> "" -> the line is omitted entirely, NOT printed as "unbekannt" (§3.1).
assert.strictEqual(cityMapValidityLabel({}), "");
assert.strictEqual(cityMapValidityLabel({ valid_from_bf: null, valid_to_bf: null }), "");
console.log("citymap helpers ok");

// ---- card -------------------------------------------------------------------------------------------
const plain = cityMapCardMarkup({
  public_id: "m1", title: "Gareth Gesamtplan", map_url: "https://example.org/plan",
  thumb: "/uploads/kartensammlungen/m1/thumb-1.png", types: ["stadtplan"], art: "politisch",
  is_color: true, is_spoiler: null, valid_from_bf: 1027, valid_to_bf: 9999,
});
assert.ok(plain.includes('href="https://example.org/plan"') && plain.includes('target="_blank"'), "card links out");
assert.ok(plain.includes('src="/uploads/kartensammlungen/m1/thumb-1.png"'), "card shows the thumb");
assert.ok(!plain.includes("is-spoiler") && !plain.includes("data-citymap-reveal"), "non-spoiler has no cover");
// The tri-state data contract: "1" | "0" | "" -- and "" for unknown, NOT "0". A data-color="0" would
// claim we know the map is not coloured.
assert.ok(plain.includes('data-color="1"'), "known true -> 1");
assert.ok(plain.includes('data-spoiler=""'), "unknown -> empty, never 0");
assert.ok(plain.includes('data-multilevel=""'), "absent -> empty");
assert.ok(plain.includes('data-from="1027"') && plain.includes('data-to="9999"'));

const noLink = cityMapCardMarkup({ public_id: "m0", title: "Ohne Link" });
assert.ok(noLink.includes('aria-disabled="true"'), "a map with no link renders disabled, not broken");
assert.ok(noLink.includes("<svg"), "no thumb -> placeholder icon");

// A spoiler card carries the cover; the reveal target is inside the anchor.
const spoiler = cityMapCardMarkup({ public_id: "m2", title: "Die Krypta", map_url: "https://example.org/k", is_spoiler: true });
assert.ok(spoiler.includes("is-spoiler") && spoiler.includes("data-citymap-reveal"), "spoiler card is covered");
assert.ok(spoiler.includes("Spoiler — aufdecken"));

// Escaping: a hostile title must not break out of the attribute OR the text node.
const hostile = cityMapCardMarkup({ public_id: "x", title: '"><script>alert(1)</script>', map_url: "https://e.org/a" });
assert.ok(!hostile.includes("<script>"), "hostile title is escaped in the text node");
assert.ok(!hostile.includes('""><'), "hostile title cannot break out of an attribute");
// A hostile URL is dropped, not escaped-and-kept.
const hostileUrl = cityMapCardMarkup({ public_id: "x", title: "T", map_url: "javascript:alert(1)" });
assert.ok(!hostileUrl.includes("javascript:"), "hostile url never reaches the markup");
console.log("citymap card ok");

// ---- section ----------------------------------------------------------------------------------------
assert.strictEqual(buildCityMapsSectionMarkup("Gareth", [], {}), "", "no maps -> no section at all");
assert.strictEqual(buildCityMapsSectionMarkup("Gareth", null, {}), "");
const section = buildCityMapsSectionMarkup("Gareth", [
  { public_id: "m1", title: "A", map_url: "https://e.org/1" },
  { public_id: "m2", title: "B", map_url: "https://e.org/2" },
], {});
assert.ok(section.includes('class="avesmaps-citymaps"'), "section carries the divider class from place-extras.css");
assert.ok(section.includes("Kartensammlung von Gareth"), "heading names the place");
assert.ok(section.includes(">(2)<"), "heading counts the maps");
assert.ok(section.includes("avesmaps-citymaps__all"), "section offers 'Alle anzeigen'");
// A territory block is tagged so the dialog can rebuild the same set.
assert.ok(buildCityMapsSectionMarkup("Garetien", [{ public_id: "m", title: "T" }], { territoryKey: "wiki:Garetien" })
  .includes('data-citymap-territory-key="wiki:Garetien"'));
// No place ref given -> no place attributes at all. "Karte vorschlagen" then has nothing to hang a
// suggestion on, which is the honest state -- better than an empty target_kind that resolves to nothing.
assert.ok(!section.includes("data-citymap-place-kind"), "no opts.place -> no place attributes");
console.log("citymap section ok");

// ---- place ref for "Karte vorschlagen" (§3.8) -------------------------------------------------------
// The suggestion hangs on the place whose Kartensammlung the reader had open, so the section has to carry
// that identity down to the dialog's footer button. Until §3.8 only the territory block was tagged at all.
const placed = buildCityMapsSectionMarkup("Gareth", [{ public_id: "m", title: "T" }], {
  place: { kind: "settlement", name: "Gareth", publicId: "abc-123" },
});
assert.ok(placed.includes('data-citymap-place-kind="settlement"'));
assert.ok(placed.includes('data-citymap-place-name="Gareth"'));
assert.ok(placed.includes('data-citymap-place-id="abc-123"'));
assert.ok(placed.includes('data-citymap-place-key=""'), "no wiki key is a valid state, not a missing one");
// "Karte vorschlagen" sits right next to "Alle anzeigen" (owner 2026-07-17) rather than only in the
// dialog nobody would open to contribute. It carries the place ref ITSELF -- one handler serves this and
// the dialog footer, and neither needs to know where it sits.
assert.ok(placed.includes("avesmaps-citymaps__suggest"), "section offers 'Karte vorschlagen'");
assert.ok(placed.includes("Karte vorschlagen"));
const actions = placed.slice(placed.indexOf("avesmaps-citymaps__actions"));
assert.ok(actions.indexOf("__all") < actions.indexOf("__suggest"), "'Alle anzeigen' comes first -- looking beats contributing");
assert.ok((actions.match(/data-citymap-place-kind="settlement"/g) || []).length === 1, "the ref is on the button, not repeated per action");
// No place ref -> no button. The dialog asks "Karte vorschlagen – <Ort>" and pins the suggestion there;
// without a place it would be a form into nothing. A broken-looking button is worse than none.
assert.ok(!section.includes("avesmaps-citymaps__suggest"), "no place -> no suggest button");
assert.ok(section.includes("avesmaps-citymaps__all"), "…but 'Alle anzeigen' still stands");
// The territory case is the only one sending a key -- and it is the SERVER key (§3.9: the client
// normaliser turns ö into o where the server slug turns it into oe, so a client-made key would miss).
const placedTerritory = buildCityMapsSectionMarkup("Garetien", [{ public_id: "m", title: "T" }], {
  territoryKey: "Garetien", place: { kind: "territory", name: "Garetien", wikiKey: "Garetien" },
});
assert.ok(placedTerritory.includes('data-citymap-place-kind="territory"'));
assert.ok(placedTerritory.includes('data-citymap-place-key="Garetien"'));
assert.ok(placedTerritory.includes('data-citymap-territory-key="Garetien"'), "the set-rebuild tag survives alongside");
// A place name is reader-visible foreign text and lands in an ATTRIBUTE -- an unescaped quote would break
// out of it and the following attributes would become markup.
const placedNasty = buildCityMapsSectionMarkup("X", [{ public_id: "m", title: "T" }], {
  place: { kind: "settlement", name: '"><img src=x onerror=alert(1)>', publicId: "id" },
});
assert.ok(!placedNasty.includes("onerror=alert(1)>"), "place name is escaped inside the attribute");
assert.ok(placedNasty.includes("&quot;&gt;&lt;img"), "…and escaped rather than stripped");
console.log("citymap place ref ok");

// ---- mehrere Fundstellen (Mehrfachlink-Spec §3) -----------------------------------------------------
// Der Owner-Fall: dieselbe Karte im Shop gekauft UND frei auf ihrer Wiki-Seite. Der Leser soll BEIDE
// Wege sehen und selbst wählen.
const multi = buildCityMapRowMarkup({
  public_id: "m10",
  title: "Al'Anfa",
  links: [
    { key: "link:7", label: "Al'Anfa und der tiefe Süden", url: "https://ulisses-ebooks.de/product/1", is_paid: true, state: "alive" },
    { key: "link:9", label: "Wiki-Aventurica", url: "https://de.wiki-aventurica.de/wiki/Al'Anfa", is_paid: false, state: "alive" },
    { key: "link:11", label: "Fanprojekt", url: "https://example.org/fan", is_paid: null, state: "alive" },
  ],
});
// "ja" (Owner 2026-07-18): a known source is named by its SOURCE (the Ulisses-shop link shows as
// "Ulisses eBook", not the band name the editor typed); an unknown host keeps its own name (Fanprojekt).
assert.ok(multi.includes("Ulisses eBook") && multi.includes("Wiki Aventurica") && multi.includes("Fanprojekt"),
  "known sources named by source, unknown host keeps its name");
assert.ok(!multi.includes("Al&#039;Anfa und der tiefe Süden"), "the editor's band name gave way to the Ulisses source label");
assert.ok(!multi.includes("#1") && !multi.includes("#2"), "keine Nummerierung");
// "kostenpflichtig" hangs on the paid shop link only. Exactly one: the Ulisses e-book (a shop by host),
// not the free wiki, not the unknown host (is_paid null is not a claimed "free", §3.1).
assert.strictEqual(multi.split("kostenpflichtig").length - 1, 1, "genau der bezahlte Shop-Link traegt den Zusatz");
assert.ok(multi.indexOf("kostenpflichtig") > multi.indexOf("Ulisses eBook"),
  "…und zwar HINTER seinem eigenen Link");
assert.ok(multi.indexOf("kostenpflichtig") < multi.indexOf("Wiki Aventurica"),
  "…vor dem naechsten, also nicht am freien Link");
// The combined "(status, kostenpflichtig)" note lives in the shared linkmeta span: a neutral bracket +
// comma, only the status WORD coloured. (Two separate spans before 2026-07-18.)
assert.ok(multi.includes("avesmaps-adv-row__linkmeta"));

// EIN Link ohne is_paid rendert exakt wie vorher -- keine Liste, kein Zusatz fuer ein Element.
const single = buildCityMapRowMarkup({
  public_id: "m11", title: "Einzeln",
  links: [{ key: "map", label: "Karte", url: "https://example.org/k", is_paid: null, state: "alive" }],
});
assert.ok(single.includes("Karte ↗") && !single.includes("kostenpflichtig"), "einzelner Link unveraendert");

console.log("citymap multi-links ok");

// ---- aufklappbare Zeile (Spec 2026-07-17-kartensammlung-zeile-aufklappen) ---------------------------
// KEIN eigener „Karte oeffnen"-Knopf (Owner 2026-07-17): map_url steht als „Karte ↗" ohnehin in der Liste
// rechts -- ein Knopf daneben war derselbe Link zweimal. Geoeffnet wird ueber das grosse Vorschaubild.
const openRow = buildCityMapRowMarkup({
  public_id: "m12", title: "Al'Anfa",
  links: [{ key: "map", label: "Karte", url: "https://example.org/k", state: "alive" }],
});
assert.ok(!openRow.includes("citymap-row__open"), "kein doppelter Oeffnen-Knopf");
assert.ok(openRow.includes("Karte ↗"), "…die Liste fuehrt den Karten-Link");

// Das grosse Vorschaubild ist DASSELBE <img>, nur per CSS anders dimensioniert. Ein zweites, verstecktes
// wuerde jede Karte im Dialog doppelt laden -- bei 20 Karten 20 unnoetige Requests.
const thumbRow = buildCityMapRowMarkup({ public_id: "m13", title: "T", thumb: "https://example.org/t.png", map_url: "https://example.org/k" });
assert.strictEqual(thumbRow.split("example.org/t.png").length - 1, 1, "das Vorschaubild steht GENAU einmal im Markup");

// Der Zustand steckt in der Klasse am Container, nicht im Markup -- die Zeile rendert offen wie zu
// identisch, und nur der Klick-Handler entscheidet.
assert.ok(!openRow.includes("is-expanded"), "der Zustand steckt in der Klasse, nicht im Markup");
console.log("citymap row expand ok");

// ---- „+ Neuer Fundort" (Spec 2026-07-17-community-fundorte) ----------------------------------------
// Der Knopf traegt seine Karte SELBST: der Melde-Dialog ist eine wiederverwendete Huelle, eine gemerkte
// Referenz waere beim zweiten Melden falsch -- dieselbe Regel wie beim Vorschlag-Knopf der Sektion.
assert.ok(openRow.includes('class="avesmaps-citymap-row__addlink"'), "die Zeile bietet das Melden an");
assert.ok(openRow.includes('data-citymap-id="m12"'), "…und traegt die Karte, an der der Fundort haengt");
assert.ok(openRow.includes('data-citymap-title="Al&#039;Anfa"'), "…samt Titel fuer die Melde-Ueberschrift");
assert.ok(openRow.includes("+ Neuer Fundort"));

// Ohne public_id kein Knopf: der Vorschlag haengt an genau dieser Karte und haette sonst kein Ziel --
// er wuerde beim Absenden am Server scheitern, was der Leser als kaputten Knopf erlebt.
assert.ok(!buildCityMapRowMarkup({ title: "Ohne id" }).includes("citymap-row__addlink"), "keine id -> kein Melde-Knopf");
console.log("citymap add-fundort ok");

// ---- „Karte bearbeiten" (Owner 2026-07-18) ---------------------------------------------------------
// Redakteursflaeche: nur bei ?edit=1, und sie traegt die public_id, weil der Knopf DIREKT zu dieser Karte
// im Editor springt (openAvesmapsCitymapEditorOverlay(id)) -- er ersetzt das fruehere "Sammlung
// bearbeiten", das nur die Sammlung oeffnete.
assert.ok(!openRow.includes("citymap-row__editmap"), "ohne ?edit=1 kein Redakteurs-Knopf");

global.IS_EDIT_MODE = true;
const editRow = buildCityMapRowMarkup({ public_id: "m12", title: "Al'Anfa" });
// EIGENE Klasse, nicht addlink mitbenutzt: an .avesmaps-citymap-row__addlink haengt der Melde-Handler
// (citymaps-suggest.js) -- eine geteilte Klasse haette diesen Knopf den Fundort-Dialog oeffnen lassen.
assert.ok(editRow.includes('class="avesmaps-citymap-row__editmap"'), "im Edit-Modus bietet die Zeile das Bearbeiten an");
assert.ok(!editRow.includes('class="avesmaps-citymap-row__addlink avesmaps-citymap-row__editmap"'), "teilt die Melde-Klasse NICHT");
assert.ok(editRow.includes('data-citymap-edit-id="m12"'), "…und traegt die Karte, zu der gesprungen wird");
assert.ok(editRow.includes("Karte bearbeiten"));
// Ohne public_id kein Sprungziel -> kein Knopf (gleiche Regel wie beim Melden).
assert.ok(!buildCityMapRowMarkup({ title: "Ohne id" }).includes("citymap-row__editmap"), "keine id -> kein Knopf");
global.IS_EDIT_MODE = false;
console.log("citymap edit-map ok");

// ---- the credit line (2026-07-17) -------------------------------------------------------------------
// The obligation that makes the covers permissible (NOTICE.md / Ulisses fan guidelines), so it is not
// decoration and may not be quietly dropped.
global.avesmapsCitymapPreviewsEnabled = () => true;
const credit = avesmapsCitymapCreditMarkup();
assert.ok(credit.includes("Ulisses Spiele"), "the credit names the rights holder");
assert.ok(credit.includes("f-shop.de"), "the F-Shop link is generic -- there is none per map");
assert.ok(credit.includes("↗"), "external links carry the arrow (AGENTS.md §12)");
assert.ok(credit.includes('target="_blank"') && credit.includes('rel="noopener"'));
// No covers on screen means no credit needed -- the same rule the adventure covers follow.
global.avesmapsCitymapPreviewsEnabled = () => false;
assert.strictEqual(avesmapsCitymapCreditMarkup(), "");
// Missing switch (older payload / test harness) must not hide the obligation: default is ON.
delete global.avesmapsCitymapPreviewsEnabled;
assert.ok(avesmapsCitymapCreditMarkup().includes("Ulisses Spiele"), "without the switch the credit still shows -- failing open on an obligation is the wrong direction");
global.avesmapsCitymapPreviewsEnabled = () => true;

// The section carries it, because that is where the covers are.
const sectionWithCredit = buildCityMapsSectionMarkup("Gareth", [
  { public_id: "m1", title: "Stadtplan von Gareth", map_url: "https://example.org/k", thumb: "/uploads/kartensammlungen/a/t.webp" },
]);
assert.ok(sectionWithCredit.includes("Ulisses Spiele"), "a section showing covers must show the credit");
// No cover on screen -> no obligation. 419 maps show 1 preview today, so this is the common case, and a
// credit under a section with no pictures would be a claim about nothing.
const sectionNoCover = buildCityMapsSectionMarkup("Gareth", [
  { public_id: "m1", title: "Stadtplan von Gareth", map_url: "https://example.org/k" },
]);
assert.ok(!sectionNoCover.includes("Ulisses Spiele"), "no covers, no credit");
// Switch off -> the payload has already blanked the thumbs, so the section cannot claim otherwise.
global.avesmapsCitymapPreviewsEnabled = () => false;
assert.ok(!buildCityMapsSectionMarkup("Gareth", [
  { public_id: "m1", title: "T", map_url: "https://example.org/k", thumb: "/uploads/kartensammlungen/a/t.webp" },
]).includes("Ulisses Spiele"), "switch off drops the credit with the covers");
global.avesmapsCitymapPreviewsEnabled = () => true;
console.log("citymap credit ok");

// ---- Band-Ableitung ---------------------------------------------------------------------------------
// sources[0].label ist ein echtes Datenfeld (87% Abdeckung) und schlaegt die geratene Klammer.
assert.strictEqual(
  cityMapBandLabel({ title: "Stadtplan von Gareth (Herz des Reiches)", sources: [{ label: "Herz des Reiches" }] }),
  "Herz des Reiches");
// Ohne sources traegt die Klammer -- 86% der Titel sind "{Typ} von {Ort} ({Quelle})".
assert.strictEqual(cityMapBandLabel({ title: "Stadtplan von Gareth (Herz des Reiches)" }), "Herz des Reiches");
// VERSCHACHTELTE Klammern: eine naive /\(([^)]*)\)$/ liefert hier "DSA3" statt des Bandes.
assert.strictEqual(
  cityMapBandLabel({ title: "Umgebungskarte von Gareth (Abenteuer Basis-Spiel (DSA3))" }),
  "Abenteuer Basis-Spiel (DSA3)");
// Kein Formel-Titel -> der Titel selbst. Er ist der Name der Karte, nicht ihr Band.
assert.strictEqual(cityMapBandLabel({ title: "Gareth-Karte aus der Gareth-Box" }), "Gareth-Karte aus der Gareth-Box");
assert.strictEqual(cityMapBandLabel({ title: "Leere Klammer ()" }), "Leere Klammer ()", "leere Klammer faellt auf den Titel zurueck");
assert.strictEqual(cityMapBandLabel({}), "");

// ---- Suffix: Typ + Ausfuehrung ----------------------------------------------------------------------
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: true }), "Stadtplan · farbig");
// DAS ist der Grund fuer die ganze Uebung: 238 von 419 Karten haben is_color === false, und die Zeile
// druckte es nicht -- 21 Titelpaare sahen dadurch aus wie Dubletten.
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: false }), "Stadtplan · schwarzweiß");
// null bleibt unbekannt und faellt weg (Spec §3.1) -- false tut das NICHT.
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: null }), "Stadtplan");
assert.strictEqual(cityMapRowSuffix({ types: ["ortsplan", "stadtplan"], is_color: true }), "Ortsplan & Stadtplan · farbig");
assert.strictEqual(cityMapRowSuffix({}), "");

// ---- Fakten der aufgeklappten Zeile -----------------------------------------------------------------
assert.deepStrictEqual(
  cityMapRowFacts({ art: "derographisch", is_official: true, valid_to_bf: 1038, author: "Hannah Möllmann", width_px: 4635, height_px: 3278 }),
  ["Derographisch", "offiziell", "bis 1038 BF", "Hannah Möllmann", "4635 × 3278 px"]);
// Format, Verlag und has_scale (auf master ergaenzt) reisen mit: Format NEBEN der Aufloesung, Verlag NEBEN
// dem Urheber, "mit Maßstab" nur bei bekanntem Ja. So bleibt jedes der drei Felder eine eigene Aussage.
assert.deepStrictEqual(
  cityMapRowFacts({ is_official: true, has_scale: true, valid_to_bf: 1038, format: "A2", author: "Ina Kramer", publisher: "Fanpro", width_px: 2000, height_px: 1500 }),
  ["offiziell", "mit Maßstab", "bis 1038 BF", "A2", "Ina Kramer", "Fanpro", "2000 × 1500 px"]);
// has_scale folgt derselben Tri-State-Regel: ein bekanntes Nein und Unbekanntes fallen beide weg.
assert.deepStrictEqual(cityMapRowFacts({ has_scale: false }), [], "ein bekanntes Nein zu Maßstab ist keine Aussage");
assert.deepStrictEqual(cityMapRowFacts({ has_scale: null }), [], "Unbekanntes zu Maßstab faellt weg");
assert.deepStrictEqual(cityMapRowFacts({ is_official: false }), [], "ein bekanntes Nein ist hier keine Aussage, die der Leser braucht");
assert.deepStrictEqual(cityMapRowFacts({ note: "Format: A4 · Maßstab: 1:12.750.000" }), ["Format: A4 · Maßstab: 1:12.750.000"]);

// ---- die Zeile --------------------------------------------------------------------------------------
const newRow = buildCityMapRowMarkup({
  public_id: "m1", title: "Stadtplan von Gareth (Herz des Reiches)", types: ["stadtplan"], is_color: false,
  sources: [{ label: "Herz des Reiches" }], map_url: "https://example.org/k",
  links: [{ key: "map", label: "Karte", url: "https://example.org/k", state: "online", is_paid: null }],
});
assert.ok(newRow.includes("Herz des Reiches"), "der Band ist die Ueberschrift");
assert.ok(newRow.includes("schwarzweiß"), "die Ausfuehrung steht in der Titelzeile");
assert.ok(!newRow.includes(">Stadtplan von Gareth (Herz des Reiches)<"), "der Formel-Titel wird nicht mehr als Text gedruckt");
assert.ok(!newRow.includes("citymap-row__linkshead"), "die Zeilen-Ueberschrift 'Zu finden bei' ist weg");
assert.ok(newRow.includes("online") && newRow.includes("link-status--online"), "der Erreichbarkeits-Status wird jetzt AUCH bei Karten gezeigt (Owner 2026-07-18)");
assert.ok(newRow.includes('data-public-id="m1"'), "das data-Attribut-Set bleibt -- der Filter liest es");
assert.ok(newRow.includes("avesmaps-citymaps__card"), "die geteilten Filter-/Spoiler-Handler zielen auf diese Klasse");

// Ohne Fundstelle sagt die Zeile das, statt zu schweigen.
assert.ok(buildCityMapRowMarkup({ public_id: "m2", title: "T" }).includes("keine Fundstelle"));
// Ohne jede Angabe traegt die aufgeklappte Zeile trotzdem eine Aussage.
assert.ok(buildCityMapRowMarkup({ public_id: "m3", title: "T" }).includes("Keine weiteren Angaben erfasst"));

// ---- advRowLinkMarkup: default shows the reachability status; showStatus:false suppresses it ---------
const advLink = { url: "https://example.org/a", label: "F-Shop", state: "online", is_paid: null };
assert.ok(advRowLinkMarkup(advLink).includes("online") && advRowLinkMarkup(advLink).includes("link-status--online"), "default shows the coloured status word");
assert.ok(!advRowLinkMarkup(advLink, { showStatus: false }).includes("link-status--online"), "showStatus:false drops the status word");

console.log("citymap row ok");

// ---- Filterleiste -----------------------------------------------------------------------------------
const barAll = citymapFiltersMarkup({ color: true, official: true, free: true, years: true, yearRange: { min: 1027, max: 1038 } });
assert.ok(barAll.includes('data-adv-filter="color"') && barAll.includes('data-adv-filter="official"'));
assert.ok(barAll.includes('data-adv-filter="free"') && barAll.includes('data-adv-filter="yearFrom"'));
// Die gestrichenen duerfen nirgends mehr auftauchen.
["type", "art", "source", "multilevel", "labeled", "paid"].forEach((kind) => {
  assert.ok(!barAll.includes('data-adv-filter="' + kind + '"'), kind + " ist gestrichen");
});
// "Spoiler zeigen" als LISTUNGS-Filter bleibt gestrichen (Spec §4.1, Umkehrung 2): ohne verdeckte Karte
// steht hier nichts -- barAll traegt jede andere Facette und trotzdem keinen Spoiler-Schalter.
assert.ok(!barAll.includes('data-adv-filter="spoiler"'), "ohne Spoilerkarte kein Schalter");
// Mit verdeckten Karten erscheint der SAMMELSCHALTER (Owner 2026-07-18). Das ist nicht der zurueckgebaute
// Chip: der regelte die Listung, dieser regelt den Deckel, den Umkehrung 2 ausdruecklich behaelt.
const barSpoiler = citymapFiltersMarkup({ color: true, spoiler: true });
assert.ok(barSpoiler.includes('data-adv-filter="spoiler"') && barSpoiler.includes("Spoiler zeigen"));
// Er traegt die Leiste ALLEIN -- eine einzige verdeckte Karte ist genau der Fall, in dem man ihn braucht,
// und dort trennt keine andere Facette etwas.
assert.ok(citymapFiltersMarkup({ spoiler: true }).includes('data-adv-filter="spoiler"'), "Schalter allein traegt die Leiste");
// Nur was traegt: eine Facette -> ein Chip.
const barOne = citymapFiltersMarkup({ color: true, official: false, free: false, years: false });
assert.ok(barOne.includes('data-adv-filter="color"') && !barOne.includes('data-adv-filter="official"'));
// Nichts trennt -> GAR KEINE Leiste. Das ist der Normalfall (69% der Orte haben eine Karte).
assert.strictEqual(citymapFiltersMarkup({ color: false, official: false, free: false, years: false }), "");
assert.strictEqual(citymapFiltersMarkup({}), "");
console.log("citymap filter bar adaptive ok");

console.log("citymaps-render ok");
