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

// ---- row --------------------------------------------------------------------------------------------
const row = buildCityMapRowMarkup({
  public_id: "m1", title: "Gareth Gesamtplan", map_url: "https://example.org/plan",
  thumb: "/uploads/kartensammlungen/m1/thumb-1.png",
  types: ["stadtplan", "uebersicht"], art: "politisch",
  is_color: true, is_multilevel: null, is_labeled: false, is_official: true, is_spoiler: null,
  width_px: 2000, height_px: 1500, valid_from_bf: 1027, valid_to_bf: 9999, author: "Ulisses",
  note: "Beilage",
  sources: [{ label: "Herz des Reiches" }],
  links: [{ key: "map", label: "Karte", url: "https://example.org/plan", state: "dead" }],
});
// The row shares .avesmaps-citymaps__card so the filter + reveal handlers reach it.
assert.ok(row.includes("avesmaps-citymaps__card") && row.includes("avesmaps-citymap-row"), "row carries both classes");
assert.ok(row.includes("Politisch · Stadtplan, Übersicht"), "meta: Art then the German type labels");
assert.ok(row.includes("seit 1027 BF · 2000 × 1500 px · Ulisses"), "facts line");
assert.ok(row.includes("Quelle: Herz des Reiches"));
assert.ok(row.includes("Beilage"));
// TRAITS: only the explicitly TRUE ones. is_labeled is false and is_multilevel unknown -- neither may
// appear. "beschriftet: nein" would read as a defect, and for is_multilevel we simply do not know.
assert.ok(row.includes("farbig · offiziell"), "only affirmed traits are listed");
assert.ok(!row.includes("mehrstöckig"), "unknown trait is omitted");
assert.ok(!row.includes("beschriftet"), "an explicit false trait is omitted too");
// is_paid is NOT among them, in any of its three states (owner 2026-07-17: "die kostenpflichtigkeit gilt
// nur für den link"). It briefly WAS a trait of the map -- defensible while a map had one link, wrong as
// soon as it has several: the same volume is paid in the shop and free on its wiki page. The condition now
// sits on the link line that carries it, and printing it here as well was a visible double.
const paidRow = buildCityMapRowMarkup({ public_id: "p1", title: "T", is_paid: true });
const freeRow = buildCityMapRowMarkup({ public_id: "p2", title: "T", is_paid: false });
[row, paidRow, freeRow].forEach((markup) => {
  assert.ok(!markup.includes("citymap-row__traits") || !markup.includes("kostenpflichtig"),
    "die Karte traegt die Kostenpflichtigkeit nicht mehr als Merkmal");
  assert.ok(!markup.includes("kostenlos"), "…und 'kostenlos' erst recht nicht");
});
// A dead link stays clickable but reads as dead (link-status.js), and every off-site link gets its ↗.
assert.ok(row.includes("link-status-dead-target"), "dead link is struck through");
assert.ok(row.includes("nicht mehr erreichbar"), "dead marker rendered");
assert.ok(row.includes("↗"), "off-site link marker");

// A row that knows almost nothing renders no empty meta lines at all.
const bare = buildCityMapRowMarkup({ public_id: "m9", title: "Nur ein Titel" });
assert.ok(!bare.includes("citymap-row__meta") && !bare.includes("citymap-row__facts"), "unknown -> no empty lines");
assert.ok(!bare.includes("citymap-row__traits") && !bare.includes("citymap-row__source"));
assert.ok(bare.includes("Nur ein Titel"));
console.log("citymap row ok");

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
// Der Linktext nennt die FUNDSTELLE, nicht eine Nummer: "#1 Link zur Karte" sagt dem Leser nichts.
assert.ok(multi.includes("Al&#039;Anfa und der tiefe Süden") && multi.includes("Wiki-Aventurica") && multi.includes("Fanprojekt"),
  "jede Fundstelle steht mit ihrem Namen da");
assert.ok(!multi.includes("#1") && !multi.includes("#2"), "keine Nummerierung");
// „(kostenpflichtig)" haengt am LINK und NUR am bezahlten. Genau EIN Vorkommen: nicht am freien, und
// nicht am unbekannten -- „unbekannt" ist eine gueltige Antwort, nie ein erfundenes „frei" (§3.1).
assert.strictEqual(multi.split("(kostenpflichtig)").length - 1, 1, "genau der bezahlte Link traegt den Zusatz");
assert.ok(multi.indexOf("(kostenpflichtig)") > multi.indexOf("Al&#039;Anfa und der tiefe Süden"),
  "…und zwar HINTER seinem eigenen Link");
assert.ok(multi.indexOf("(kostenpflichtig)") < multi.indexOf("Wiki-Aventurica"),
  "…vor dem naechsten, also nicht am freien Link");
// Der Zusatz ist ein <span>, kein <a>: features/links.css faerbt jeden a[target=_blank] per !important,
// eine eigene Farbregel auf einem Anchor waere wirkungslos gewesen.
assert.ok(multi.includes('<span class="avesmaps-adv-row__linkpaid">(kostenpflichtig)</span>'));

// EIN Link ohne is_paid rendert exakt wie vorher -- keine Liste, kein Zusatz fuer ein Element.
const single = buildCityMapRowMarkup({
  public_id: "m11", title: "Einzeln",
  links: [{ key: "map", label: "Karte", url: "https://example.org/k", is_paid: null, state: "alive" }],
});
assert.ok(single.includes("Karte ↗") && !single.includes("kostenpflichtig"), "einzelner Link unveraendert");

// Abenteuer-Links tragen kein is_paid und bleiben davon voellig unberuehrt (advRowLinkMarkup ist geteilt).
assert.ok(!row.includes("linkpaid"), "die Abenteuer-/Karten-Linkzeile bleibt ohne is_paid unveraendert");
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

// Die Fundorte bekommen eine Ueberschrift: sie sind der Grund, warum die Zeile aufgeklappt wird, und
// tragen seit den Mehrfach-Links mehr als einen Eintrag.
assert.ok(openRow.includes('class="avesmaps-citymap-row__linkshead">Zu finden bei'), "die Fundorte sind ueberschrieben");
// Keine Liste -> keine Ueberschrift ueber dem Nichts.
assert.ok(!buildCityMapRowMarkup({ public_id: "m15", title: "T" }).includes("citymap-row__linkshead"));

// Das grosse Vorschaubild ist DASSELBE <img>, nur per CSS anders dimensioniert. Ein zweites, verstecktes
// wuerde jede Karte im Dialog doppelt laden -- bei 20 Karten 20 unnoetige Requests.
const thumbRow = buildCityMapRowMarkup({ public_id: "m13", title: "T", thumb: "https://example.org/t.png", map_url: "https://example.org/k" });
assert.strictEqual(thumbRow.split("example.org/t.png").length - 1, 1, "das Vorschaubild steht GENAU einmal im Markup");

// Der Zustand steckt in der Klasse am Container, nicht im Markup -- die Zeile rendert offen wie zu
// identisch, und nur der Klick-Handler entscheidet.
assert.ok(!openRow.includes("is-expanded"), "der Zustand steckt in der Klasse, nicht im Markup");
console.log("citymap row expand ok");

// ---- filter bar ------------------------------------------------------------------------------------
const bar = citymapFiltersMarkup({
  types: [{ value: "stadtplan", label: "Stadtplan", count: 2 }],
  arts: [{ value: "politisch", label: "Politisch" }],
  sources: ["Herz des Reiches"],
  yearRange: { min: 1027, max: 1045 },
});
["type", "art", "source", "color", "multilevel", "labeled", "official", "free", "paid", "spoiler", "yearFrom", "yearTo"].forEach((kind) => {
  assert.ok(bar.includes('data-adv-filter="' + kind + '"'), "citymap bar offers the " + kind + " dimension (§3.7)");
});
// BOTH directions since 2026-07-17 (owner: "kostenpflichtige und nicht kostenpflichtige maps sollen danach
// gefiltert werden können"). The bar used to carry only "nur kostenlose", on the reasoning that nobody asks
// the other way round -- the owner does.
//
// The keys must stay `free` and `paid`: map-features-citymaps-dialog.js's TOGGLES maps them to freeOnly /
// paidOnly, and a rename on one side alone leaves a chip that highlights and filters nothing.
assert.ok(bar.includes("nur kostenlose") && bar.includes("nur kostenpflichtige"));
assert.ok(bar.includes("(2)"), "type chip shows its count");
assert.ok(bar.includes('<option value="politisch">Politisch</option>'), "art select maps slug -> label");
// The adventure dimensions must NOT leak into the map bar.
assert.ok(!bar.includes('data-adv-filter="edition"') && !bar.includes('data-adv-filter="genre"'), "no adventure dimensions");
console.log("citymap filter bar ok");

console.log("citymaps-render ok");
