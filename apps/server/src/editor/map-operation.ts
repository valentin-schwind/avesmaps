import { EDITOR_TERRITORY_DETAIL_FIELDS, MAP_EDITING_ERROR_STATUS, type OperationReceipt } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import { runOperation, type OperationStore, type StoredOperation } from "../auth/operations.ts";
import type { Sql } from "../auth/session-store.ts";
import { anfrageHerkunft, pruefeHerkunft } from "../community/herkunft.ts";
import { isDeadlock, isLockTimeout, type Database } from "../database.ts";
import { DERIVE_LOCK_CLASS } from "../derive/derive-lock.ts";
import { ApiError } from "../http/api-error.ts";
import {
    GEBIETSABLEITUNG_HOECHSTENS_S,
    GEBIETSABLEITUNG_RUHE_S,
    TERRITORY_DERIVE_JOB_KIND,
} from "../jobs/gebiets-arten.ts";
import { LABEL_RUNS_JOB_KIND, LAND_SMOOTH_JOB_KIND, PATH_LABEL_RUNS_JOB_KIND } from "../jobs/landschaft-arten.ts";
import { sprachTrefferNachOperation } from "../sprachen/treffer-auftrag.ts";
import { gelaendeNachOperation } from "./gelaende-folgen.ts";

/**
 * Die Speicherstelle der Operationen an der Karte (WI-0128 E8; EDIT-0001 §6.1 Nr. 2 und 3, §4.7 G8; ADR-0019 Nr. 3): `map_operation`
 * (Kennung, Hash, Quittung, Akteur, Reihenfolge `seq`) und je betroffenem Gegenstand eine Zeile im Fachprotokoll `map_audit_event`
 * (Migration 0091), in derselben Transaktion wie die Änderung. Die Regeln von `runOperation` sind dieselben wie bei Verwaltung und
 * Medien (`media-editor/operation-store.ts`).
 *
 * Eine Rücknahme (Quelle `restore`) hält fest, WELCHE Operationen sie zurücknimmt: je Kennung eine Zeile in `map_operation_revert_link`
 * (Migration 0262, WI-0265 B1), in derselben Transaktion; die Kennungen kommen aus `reverts` (ausdrücklich) oder dem Feld `reverts` des
 * Anfragekörpers (`ruecknahmeZiele`). Eine unbekannte Kennung weist `mapOperation` vor jeder Änderung mit 400 ab.
 *
 * 🔴 POSITIVLISTE je Art des Gegenstands (`MAP_AUDIT_FIELDS`): In `changes` steht nur, was hier steht, als Feld → `{ before, after }`.
 * In Tests scheitert ein unbekanntes Feld laut. Neue Arten (Kraftlinie, Gebiet …) kommen additiv mit ihrem Editor.
 *
 * 🔴 Map Mutation Guard: Handelt ein Agent, braucht die Operation den Verweis auf die persönliche, scope-genaue Freigabe des Betreibers
 * (`approvalRef`); ohne ihn läuft sie nicht an, und die Datenbank verweigert die Zeile ebenfalls.
 */
/** Die Detailfelder des Herrschaftsgebiets im Fachprotokoll: je Feld der Wert und seine Herkunft (`<feld>Origin`, wie am Ort). */
const TERRITORY_DETAIL_AUDIT = EDITOR_TERRITORY_DETAIL_FIELDS.flatMap((feld) => [feld, `${feld}Origin`] as const);

/**
 * Die Wiki-Werte hinter ↺, die nur die Übernahme des WikiSync schreibt (WI-0253 D-2): `wiki<Feld>` je Feld des Wiki-Stands (`wiki/abgleich/uebernahme/schreiber.ts`, `auditSchluessel`) und, wo ein Wiki-Wert
 * als unbekannt geführt werden kann, `wiki<Feld>Unbekannt` (die Marke fällt mit dem Schreiben). Ein Test hält diese Listen gleich den Feldern der Schreiber.
 */
const wikiFelder = (felder: readonly string[], unbekannt: readonly string[] = []): string[] =>
    felder.flatMap((feld) => {
        const name = `wiki${feld
            .split("_")
            .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1))
            .join("")}`;
        return unbekannt.includes(feld) ? [name, `${name}Unbekannt`] : [name];
    });
const WIKI_ORT = wikiFelder(
    [
        "name",
        "einwohner",
        "oberhaupt",
        "region_text",
        "staat_text",
        "handelszone",
        "verkehrswege",
        "bevoelkerung",
        "tempel",
        "description",
        "settlement_class",
        "building_type",
    ],
    ["settlement_class"],
);
const WIKI_WEG = wikiFelder(["name", "kind", "art", "lage", "laenge", "verlauf", "description"]);
/** Der Wiki-Stand einer Landschafts-Infobox (`wiki_region_snapshot`) ohne den Kontinent: Landschaft und Gipfel teilen ihn. */
const WIKI_LANDSCHAFTS_STAND = [
    "name",
    "art",
    "region_parent",
    "affiliation_staat",
    "einwohner",
    "sprache",
    "vegetation",
    "verkehrswege",
    "description",
    "nachbar_n",
    "nachbar_no",
    "nachbar_o",
    "nachbar_so",
    "nachbar_s",
    "nachbar_sw",
    "nachbar_w",
    "nachbar_nw",
] as const;
const WIKI_LANDSCHAFT = wikiFelder([...WIKI_LANDSCHAFTS_STAND, "continent"]);
const WIKI_GIPFEL = wikiFelder([...WIKI_LANDSCHAFTS_STAND, "height"]);
/**
 * Der Wiki-Stand eines Vorkommens (`wiki_lore_snapshot`, WI-0253 §23): die Felder des Eintrags (die sechs der Infobox und die Kurzbeschreibung, WI-0260), die vier Rohtexte der Infobox und die Unterseite „Liste“ (WI-0299); jeder Wert kann als unbekannt geführt werden, bis der
 * WikiSync ihn liest.
 */
const WIKI_VORKOMMEN_FELDER = [
    "name",
    "gruppe",
    "typ",
    "lebensraum",
    "synonyme",
    "continent",
    "kurzbeschreibung",
    "roh_verbreitung",
    "roh_herkunft",
    "roh_regionen",
    "roh_vorkommen",
    "liste",
] as const;
const WIKI_VORKOMMEN = wikiFelder(WIKI_VORKOMMEN_FELDER, WIKI_VORKOMMEN_FELDER);
const WIKI_GEBIET_FELDER = [...EDITOR_TERRITORY_DETAIL_FIELDS];
const WIKI_GEBIET = wikiFelder(WIKI_GEBIET_FELDER, WIKI_GEBIET_FELDER);

export const MAP_AUDIT_FIELDS = {
    place: [
        // Die Umwandlung in eine Landmarke (`landmarke.umwandeln`, WI-0271 L8): der Verweis und die Bezüge, die mitgingen.
        "landmarke",
        "vorkommen",
        "abenteuer",
        "name",
        "subtype",
        "kind",
        "position",
        "active",
        "hidden",
        "ruined",
        "nodix",
        "seaport",
        "underground",
        "withdrawn",
        "approximate",
        "description",
        "einwohner",
        "lage",
        "oberhaupt",
        "einwohnerOrigin",
        "lageOrigin",
        "oberhauptOrigin",
        // Herkunft von Name und Ortsgröße (WI-0225, `field_origin`).
        "nameOrigin",
        "subtypeOrigin",
        "wiki",
        // Die Herkunft der Wiki-Zuordnung (Zustand, Herkunft, System) vor und nach dem Schreiben der Wiki-Box (WI-0265 B8d), damit die Rücknahme sie zurückgibt.
        "zuordnung",
        ...WIKI_ORT,
        // Die Innerorts-Beziehungen, die mit dem Ort stillgelegt oder zurückgeholt wurden (E22 G2): die Kennungen der Zeilen in
        // `site_settlement`. 🔴 `place.restore` liest genau diese Liste - ohne sie wüsste die Rücknahme nicht, welche Beziehungen
        // zu diesem Löschen gehörten und welche vorher schon still lagen.
        "staetten",
        // Die Quellen des Orts (`traeger.sources`, WI-0254 §12): vorher und nachher je geänderter Quelle `{ sourceId, title, state, referenceKind, pages, note }`; ohne Revision des Orts.
        "quellen",
        // Der Grund einer Rücknahme (`place.restore_series`, WI-0265 B4, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
        "restoreReason",
    ],
    // Der Weg (WI-0177): die Linie, an- und abgemeldet, von der Karte genommen (`offMap`, Stufe 3b); die Art steht beim Anlegen darin
    // (`path.created`); Name, Art und „Name auf der Karte“ der Straße (`path.updated`, W5b); Tunnel je Abschnitt (Migration 0172); das
    // Kennzeichen über dem Wegtyp (`mark`, Karawanenroute, Migration 0174). Die Reisemittel je Abschnitt mit Fenstern und dem Merkmal
    // „vollständig geschrieben“ (`reisen`, Migration 0208, F16 „A“).
    // Die Herkunft von Name, Wegtyp und Kennzeichen je Abschnitt (WI-0225 §7, `field_origin`), wenn sie wechselt.
    path: [
        "geometry",
        "name",
        "subtype",
        "labelVisible",
        "tunnel",
        "mark",
        "reisen",
        "active",
        "offMap",
        // Fluss und Bach (Plan Fluss/Bach 2026-10-19): ein Bach, die Fließrichtung.
        "isBach",
        "flowDirection",
        // Die eigenen Höhen an den Stützpunkten eines Flusswegs, die mit einer verschobenen Kurve umzogen (WI-0259 „Höhe wandert mit“,
        // `terrain/fluss-hoehen.ts`): vorher und nachher als Listen `{ area, h, x, y }`, parallel; ohne Revision und ohne eigene Zeile.
        "wasserHoehen",
        "nameOrigin",
        "subtypeOrigin",
        "markOrigin",
        // Die Wiki-Zuordnung, die „Auswahl zu neuem Weg“ aufhob (WI-0252, `path.regroup`): Artikel und die Kennungen der stillgelegten
        // Zeilen, damit ↺ genau sie zurückholt.
        "wiki",
        "zuordnung",
        // Der Stand des Abschnitts vor und nach einem Schritt der Wiki-Box (OPS-000112, `AbschnittsStand`): Hauptzuordnung samt Herkunft und die still gelegten weiteren Zeilen; ↺ gibt jedem Abschnitt genau ihn zurück.
        // Beim Straßen-Assistenten (WI-0310, `path.street_assigned`) die Zeilen in `path_wiki_assignment` und `wiki_key_assignment` vorher und nachher, dazu `quellenOrigin` die Zeilen in
        // `path_source`; `wiki` und `quellen` nennen Titel und Adresse. ↺ setzt genau diese Zeilen zurück.
        "wikiOrigin",
        "quellenOrigin",
        // Ein weiterer Wiki-Artikel der Straße (WI-0300, Wiki-Box): sein Schlüssel vorher und nachher, daneben die Zeile des Abschnitts samt Herkunft für die Rücknahme.
        "wikiWeitere",
        "wikiWeitereOrigin",
        // Die weiteren Straßennamen je Abschnitt (WI-0302, `path.update`): vorher und nachher als Liste `{ key, name }`, nach Namen; ↺ schreibt die Schlüssel von vorher.
        "weitere",
        // Die Quellen der Straße (`traeger.sources`, WI-0254 §12), wie am Ort; ohne Revision. Das Ziel ist der Anker der Straße (die kleinste Kennung ihrer Abschnitte), der Verlauf der Straße liest alle Abschnitte.
        "quellen",
        // Der Grund einer Rücknahme (`path.restore_series`, WI-0265 B6a, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
        "restoreReason",
        ...WIKI_WEG,
    ],
    // Die Landschaft (WI-0178 B1, Migration 0137): die Region, ihre Teilflächen und ihre Beschriftungen je für sich. Eine Operation,
    // die nur eine Beschriftung ändert, schreibt eine Zeile `label.*` und berührt die Region (Revision), ohne Felder der Region.
    // `curve`: Punkt oder entlang der Fläche samt Höchstzahl der Läufe (F7, WI-0178).
    // `offMap`: von der Karte genommen (D2, Migration 0163).
    // `hidden`: für Besucher verborgen (T41, Migration 0166).
    region: [
        "name",
        "layer",
        "type",
        "wiki",
        "order",
        "locked",
        "curve",
        "curveDegree",
        "active",
        "offMap",
        "hidden",
        // Die Gefahrenlage (WI-0308, `region.hazards`): die Gefahrenarten vorher und nachher, je in der Folge des Katalogs.
        "hazards",
        // Die Quellen der Landschaft (`traeger.sources`, WI-0254 §12), wie am Ort; ohne Revision der Landschaft.
        "quellen",
        // Der Grund einer Rücknahme (`landscape.restore_series`, WI-0265 B6c, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
        "restoreReason",
        ...WIKI_LANDSCHAFT,
    ],
    // `gebirge`: die Gebirgswerte der Teilfläche (`terrain_control`, WI-0178 P4), je geänderter Spalte vorher und nachher.
    // `restoreReason`: der Grund einer Rücknahme (`landscape.restore_series`, WI-0265 B3, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
    area: ["geometry", "affectsPaths", "active", "gebirge", "restoreReason"],
    label: [
        "text",
        // Die Namensart (`map_label.subtype`): folgt der Art der Landschaft (WI-0178, landscape.update).
        "type",
        "textFollowsName",
        "position",
        "placement",
        "curveCount",
        "size",
        "priority",
        "zoom",
        "showName",
        "order",
        "active",
        // Der Grund einer Rücknahme (`landscape.restore_series`, WI-0265 B6c), nur `after`.
        "restoreReason",
    ],
    // Die Kraftlinie (WI-0205 K4, Migration 0143): je Abschnitt eine Zeile; eine Operation an der Linie trägt alle ihre Abschnitte. Der
    // Kraftlinienpunkt (`nodix`) für sich. `drawn_geom` steht nicht darin: abgeleitet aus Knoten und Kurve.
    // Mit der Herkunft der Wiki-Felder wie am Ort (`nameOrigin`, WI-0225 Nachtrag 2; der Verlauf blendet sie aus).
    // Dazu die Wiki-Werte hinter ↺ (`wiki<Feld>`, der Schnappschuss `wiki_powerline_snapshot`), die nur die Übernahme des WikiSync schreibt (WI-0253 D-1,
    // `wiki/abgleich/uebernahme/`): Name und Beschreibung, dazu Stärke, Affinität, Länge, Regionen und Verlauf, die kein Abschnitt selbst führt.
    powerline: [
        "name",
        "nameOrigin",
        "labelVisible",
        "description",
        "descriptionOrigin",
        "from",
        "to",
        "curve",
        "wiki",
        "zuordnung",
        "active",
        "offMap",
        "wikiName",
        "wikiStaerke",
        "wikiAffinitaet",
        "wikiLaenge",
        "wikiRegionen",
        "wikiVerlauf",
        "wikiDescription",
        // Der Grund einer Rücknahme (`powerline.restore_series`, WI-0265 B6b, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
        "restoreReason",
    ],
    // Der Kraftlinienpunkt (`nodix.create`, `.move`, `.retire`, K5/K9/K10); `restoreReason`: der Grund einer Rücknahme (`nodix.restore_series`, WI-0265 B8b), nur `after`.
    nodix: ["position", "kind", "active", "restoreReason"],
    // Das Herrschaftsgebiet (WI-0209, Migration 0145): das Gebiet und je Fläche eine Zeile. Zoomspanne und Farbe (D2, D4,
    // `territory.display`), die Felder und das Obergebiet (B2, D1, `territory.update`), Entfernen und Zurückholen (D3,
    // `territory.retire`, `territory.restore`); die Wiki-Felder kommen mit G6.
    territory: [
        "minZoom",
        "maxZoom",
        "color",
        "name",
        "shortName",
        "type",
        "status",
        "capital",
        "parent",
        "parentOrigin",
        "active",
        // Die Wiki-Zuordnung, die die Wiki-Box zuweist oder löst (WI-0253): der Schlüssel des Artikels vorher und nachher.
        "wiki",
        // Die Quellen des Gebiets (`traeger.sources`, WI-0254 §12), wie am Ort; ohne Revision des Gebiets.
        "quellen",
        // Der Grund einer Rücknahme (`territory.restore_series`, WI-0265 B6b, Gate 2: bei einer fremden Person Pflicht), nur `after`; er bleibt im Eintrag sichtbar.
        "restoreReason",
        // Die 17 Detailfelder mit Wiki-Wert (G6, WI-0225; `territory-details-write.ts`): Wert und Herkunft `<feld>Origin` (wiki, manual).
        ...TERRITORY_DETAIL_AUDIT,
        ...WIKI_GEBIET,
    ],
    territory_area: ["geometry", "minZoom", "maxZoom", "active", "restoreReason"],
    // Der Gipfel (WI-0178 P1, Migration 0205): Name, Höhe, „Auf der Karte anzeigen“ und Lage (`peak.update`).
    // Dazu der Wiki-Stand seines Artikels (`wiki<Feld>`, `wiki_region_snapshot`), den nur die Übernahme des WikiSync schreibt (WI-0253, Scheibe Gipfel); am Gipfel selbst schreibt sie nichts.
    // `heightOrigin`: der Vermerk der Höhe (`field_origin`, `manual`), wenn eine Hand sie setzt; die Übernahme des WikiSync schreibt die Höhe (`height`) und ihren Wiki-Wert (`wikiHeight`) ohne Vermerk.
    // `restoreReason`: der Grund einer Rücknahme (`peak.restore_series`, `landscape.restore_series`, WI-0265 B6c), nur `after`.
    // `subtype` und `merkmale`: Art und Merkmale einer Landmarke (WI-0271 L3, `terrain_peak.merkmale` in der Folge des Katalogs).
    peak: [
        "name",
        "subtype",
        "merkmale",
        "height",
        "heightOrigin",
        "showName",
        "position",
        "active",
        "restoreReason",
        // Aus welchem Ort die Landmarke entstand (`landmarke.umwandeln`, WI-0271 L8).
        "ausOrt",
        // Der Wiki-Artikel, zugewiesen oder entfernt (Wiki-Box, WI-0271 L4): der Schlüssel vorher und nachher.
        "wiki",
        "zuordnung",
        // Die Quellen des Gipfels (`traeger.sources`, WI-0254 §12; WI-0271 L4), wie am Ort; ohne Revision des Gipfels.
        "quellen",
        ...WIKI_GIPFEL,
    ],
    // Die Katalogquelle (WI-0254, Migration 0232): ihre Stammdaten (`source.update`) und ihre Verwendungen. `links` trägt vorher und nachher je
    // Verwendung einen Eintrag `{ kind, carrierId, state, referenceKind, pages, note }` (nur die geänderten); `url` steht beim Anlegen darin.
    // `created` steht, wo der WikiSync die Quelle anlegte (WI-0253 §21): { key, title, sourceType, isOfficial, url }; daran erkennt die Rücknahme, was sie still legen darf.
    source: [
        "url",
        "title",
        "sourceType",
        "isOfficial",
        "licenseStatement",
        "licenseKey",
        "attribution",
        "editorNote",
        "active",
        "links",
        "created",
        // Der Grund einer Rücknahme (`source.restore_series`, WI-0265 B6g1, Gate 2: bei einer fremden Person Pflicht), nur `after`.
        "restoreReason",
    ],
    // Das Werk der Spielliteratur (WI-0254, Migration 0233): seine Stammdaten (`work.update`) und die Ortsliste. `places` trägt vorher und nachher
    // die aktiven Zeilen in ihrer Reihenfolge, je Zeile `{ rowId, name, role, kind, state }`; `created` steht beim Anlegen darin.
    // Dazu die Felder, die nur die Übernahme des WikiSync aus dem Wiki schreibt (WI-0253, Scheibe Literatur): Komplexität, Autoren, F-Shop-Nummer.
    work: [
        "title",
        "productType",
        "edition",
        "series",
        "bfYear",
        "bfLabel",
        "genre",
        "isOfficial",
        "editorNote",
        "active",
        "places",
        "complexityGm",
        "complexityPl",
        "authors",
        "fshopCode",
        // Der Grund einer Rücknahme (`work.restore_series`, WI-0265 B6g1), nur `after`.
        "restoreReason",
    ],
    // Der Lore-Eintrag (Vorkommen; WI-0254, Migration 0234): seine Stammdaten (`lore.update`), die Ortszeilen (`places`) und die Quellenverknüpfungen
    // (`sources`); beide tragen vorher und nachher je Zeile einen Eintrag der geänderten.
    // Dazu, was nur die Übernahme des WikiSync aus dem Wiki schreibt (WI-0253 §23): Typ und Kontinent des Eintrags, die Rolle in den Ortszeilen (`places`: `role`) und der Wiki-Stand
    // (`wiki<Feld>`, `wiki_lore_snapshot`) samt der Marke `wiki<Feld>Unbekannt`.
    lore: [
        "name",
        "art",
        "gruppe",
        "typ",
        "lebensraum",
        "synonyme",
        "continent",
        // Die Kurzbeschreibung aus dem Wiki-Artikel (WI-0260, Migration 0252): schreibt nur die Übernahme des WikiSync.
        "kurzbeschreibung",
        "editorNote",
        "active",
        "places",
        "sources",
        // Die Regeln des Eintrags (`lore_rule`), wie die Übernahme der Regelvorschläge sie anlegt und still legt (WI-0253 §24): vorher und nachher je berührter Regel.
        "rules",
        ...WIKI_VORKOMMEN,
        // Der Grund einer Rücknahme (`lore.restore_series`, WI-0265 B6g2, Gate 2: bei einer fremden Person Pflicht), nur `after`.
        "restoreReason",
    ],
    // Der Korpus (WI-0254, Migration 0236): seine Angaben (`corpus.update`), die Vorgabe für die Quellen und, was auf die Quellen durchgeschrieben wurde
    // (`quellen`: vorher und nachher je geänderter Quelle `{ id, sourceType, isOfficial, lizenzAussage, lizenzKey, attribution }`, höchstens 500, sonst
    // nur die Zahl; so ist die Wirkung rücknehmbar). `key` steht beim Anlegen darin.
    corpus: [
        "key",
        "label",
        "form",
        "sourceType",
        "isOfficial",
        "licenseStatement",
        "licenseKey",
        "attribution",
        "editorNote",
        "quellen",
        // Stillgelegt oder belebt (WI-0265 B8d): die Rücknahme eines Anlegens und die Rücknahme davon; `corpus.update` schreibt es nie.
        "active",
        // Der Grund einer Rücknahme (`corpus.restore_series`, WI-0265 B6g1), nur `after`.
        "restoreReason",
    ],
    // Der Wiki-Stand eines Sprachartikels (WI-0261 S3, Migration 0255, `wiki_sprache_artikel`): schreibt nur die Übernahme des WikiSync. `artikel` ist der Lebenslauf (der Titel, leer heißt still
    // gelegt), die übrigen sind die Felder der Infobox, die Kurzbeschreibung, die Navigationsleisten und die vier Rohtexte. Ein neuer Artikel trägt sie mit `before: null`.
    sprache_artikel: [
        "artikel",
        "name",
        "sprachfamilie",
        "vorstufen",
        "schrift",
        "sprecheranzahl",
        "offizielleSprache",
        "weitereVerbreitung",
        "kurzbeschreibung",
        "navigation",
        "rohVorstufen",
        "rohSchrift",
        "rohOffizielleSprache",
        "rohWeitereVerbreitung",
    ],
    // Ein Wiki-Eintrag ohne Fläche (WI-0284, Migration 0319, Zeile in `wiki_region_snapshot`): `artikel` ist der Lebenslauf, die übrigen die Felder der Infobox Region, die die Übernahme schreibt.
    region_artikel: [
        "artikel",
        "name",
        "art",
        "region_parent",
        "affiliation_staat",
        "einwohner",
        "sprache",
        "vegetation",
        "verkehrswege",
        "nachbar_n",
        "nachbar_no",
        "nachbar_o",
        "nachbar_so",
        "nachbar_s",
        "nachbar_sw",
        "nachbar_w",
        "nachbar_nw",
        "description",
        "restoreReason",
    ],
    // Ein Orts- oder Bauwerk-Artikel ohne Ort (WI-0295, Migration 0330, Zeile in `wiki_settlement_registry` mit ihrem Wiki-Stand): `artikel` ist der Lebenslauf, die übrigen die Felder, die die Übernahme schreibt.
    ort_artikel: [
        "artikel",
        "name",
        "settlement_class",
        "building_type",
        "lage",
        "standort",
        "standort_orte",
        "ruine",
        "einwohner",
        "oberhaupt",
        "region_text",
        "staat_text",
        "handelszone",
        "verkehrswege",
        "bevoelkerung",
        "tempel",
        "description",
        "restoreReason",
    ],
    // Der Wiki-Stand eines Landmarken-Artikels ohne Landmarke auf der Karte (WI-0271 L7, Migration 0290, `wiki_landmarke_artikel`): `artikel` ist der Lebenslauf, die übrigen die Felder
    // der Infobox Region, die die Übernahme schreibt. `unterdrueckt` („nicht auf die Karte“) schreibt allein die Redaktion (`wikisync.landmarke_unterdruecken`); `restoreReason` der Grund einer Rücknahme.
    landmarke_artikel: [
        "artikel",
        "name",
        "art",
        "wikiArt",
        "region",
        "height",
        "kurzbeschreibung",
        "unterdrueckt",
        "restoreReason",
    ],
    // Die Sprache im Spracheditor (WI-0261 S5d, Migration 0258): ihre Felder (`sprache.update`; `schluessel` und `herkunft` nur beim Anlegen), Stilllegen und Zurückholen
    // (`active`) und die Wiki-Artikel (`wiki`: vorher und nachher die Pillen in ihrer Reihenfolge, je `{ id, titel }`; auch an der Sprache, der ein Artikel weggenommen wurde).
    // `restoreReason`: der Grund einer Rücknahme (`sprache.restore_series`, WI-0265 B6e, Gate 2: bei einer fremden Person Pflicht), nur `after`; auch an den Teilflächen.
    sprache: ["schluessel", "name", "legende", "farbe", "reihenfolge", "herkunft", "active", "wiki", "restoreReason"],
    // Eine Teilfläche einer Sprache: die Form (Ringe), Stilllegen und Zurückholen, und die Herkunft samt Revision der Quelle, wenn Umformen sie zu einer der Redaktion macht (T-1).
    // `kopiertAus`: die Fläche der Derographie, aus der sie kopiert wurde (`{ regionId, areaId, name }`, WI-0261); als Feld, nicht als Ziel der Zeile, damit die
    // Landschaft dadurch keine spätere Operation bekommt (die Rücknahme dort zählte sie sonst als Konflikt).
    sprache_flaeche: ["geometry", "herkunft", "quelleRevision", "active", "kopiertAus", "restoreReason"],
} as const satisfies Record<string, readonly string[]>;

export type MapAuditKind = keyof typeof MAP_AUDIT_FIELDS;

/** Ein geändertes Feld: der Wert vorher und nachher (fehlt vorher bei einem neuen Gegenstand). */
export interface MapChange {
    before?: unknown;
    after?: unknown;
}

/** Eine Zeile des Fachprotokolls: ein Gegenstand, seine Revision vorher und nachher, die geänderten Felder. */
export interface MapAuditEntry {
    /**
     * Was dem Gegenstand geschah, etwa `place.moved`; das erste Glied ist die Art (`place`, `path`, `region`, `area`, `label`,
     * `powerline`, `nodix`).
     */
    action: `${MapAuditKind}.${string}`;
    placeId?: string;
    pathId?: string;
    /** Die Landschaft (`region.public_id`), eine ihrer Teilflächen (`region_area`), eine ihrer Beschriftungen (`map_label`). */
    regionId?: string;
    areaId?: string;
    labelId?: string;
    /** Ein Abschnitt einer Kraftlinie (`powerline.public_id`), ein Kraftlinienpunkt (`nodix.public_id`). */
    powerlineId?: string;
    nodixId?: string;
    /** Ein Herrschaftsgebiet (`territory.public_id`) und eine seiner Flächen (`territory_area.public_id`). */
    territoryId?: string;
    territoryAreaId?: string;
    /** Ein Gipfel oder Vulkan (`terrain_peak.public_id`, WI-0178 P1). */
    peakId?: string;
    /** Eine Katalogquelle (`feature_source.public_id`, WI-0254, Migration 0232). */
    sourceId?: string;
    /** Ein Werk der Spielliteratur (`adventure.public_id`, WI-0254, Migration 0233). */
    workId?: string;
    /** Ein Lore-Eintrag, das Vorkommen (`lore_entry.public_id`, WI-0254, Migration 0234). */
    loreId?: string;
    /** Ein Korpus (`source_corpus.public_id`, WI-0254, Migration 0236). */
    corpusId?: string;
    /** Ein Sprachartikel des WikiSync (`wiki_sprache_artikel.public_id`, WI-0261 S3, Migration 0255). */
    spracheArtikelId?: string;
    /** Ein Landmarken-Artikel des WikiSync (`wiki_landmarke_artikel.public_id`, WI-0271 L7, Migration 0290). */
    landmarkeArtikelId?: string;
    /** Ein Wiki-Eintrag ohne Fläche (`wiki_region_snapshot.public_id`, WI-0284, Migration 0319). */
    regionArtikelId?: string;
    /** Ein Orts- oder Bauwerk-Artikel ohne Ort (`wiki_settlement_registry.public_id`, WI-0295, Migration 0330). */
    ortArtikelId?: string;
    /** Eine Sprache (`sprache.public_id`) und eine ihrer Teilflächen (`sprache_flaeche.public_id`; ihre Zeile trägt die Sprache mit), WI-0261 S5d, Migration 0258. */
    spracheId?: string;
    spracheFlaecheId?: string;
    revisionBefore?: number | null;
    revisionAfter?: number | null;
    changes?: Record<string, MapChange>;
}

/**
 * Wer an der Karte handelt: eine Person der Sitzung, nur mit Freigabe des Betreibers ein Agent, oder das System selbst (`system`: ein Auftrag der Warteschlange ohne
 * Person, etwa eine Übernahme des WikiSync, die niemand angestoßen hat; `label` nennt, wer es war). Ein Auftrag, den eine Person ausgelöst hat, handelt als diese Person.
 */
export type MapActor =
    | { kind: "person"; personId: string; environment: AuthEnvironment }
    | { kind: "agent"; label: "claudia" | "claudio"; approvalRef: string; environment: AuthEnvironment }
    | { kind: "system"; label: string; environment: AuthEnvironment };

/** Was eine Operation an der Karte festhält. */
export interface MapOperationEvent {
    /** Die Operation, etwa `place.move` (Format wie `map_operation_action_format`). */
    operation: string;
    mapDomainId: string;
    source: "editor" | "restore" | "wikisync";
    summary?: string | undefined;
    actor: MapActor;
    entries: MapAuditEntry[];
    /**
     * Die Operationen, die diese zurücknimmt, in der Reihenfolge der Anfrage, ohne Doppelte (`ruecknahmeZiele`). `record` legt dazu je eine Zeile in
     * `map_operation_revert_link` an (WI-0265 B1, Migration 0262), in derselben Transaktion wie die Operation.
     */
    reverts?: readonly string[];
    /**
     * Der Community-Vorgang, aus dem der Editor geöffnet wurde (WI-0268 C7, Migration 0272): `map_operation.community_vorgang`. Nur bei einer Person und nur, wenn
     * es den Vorgang gibt (`community/herkunft.ts`); „Änderungen“ zeigt daran „aus COM-…“.
     */
    communityVorgang?: number | undefined;
}

const AUDIT_STRICT = process.env["VITEST"] !== undefined;

/** Die geänderten Felder nach Positivliste; ein unbekanntes Feld oder eine unbekannte Art ist ein Fehler im Code. */
export function filterMapChanges(
    action: MapAuditEntry["action"],
    changes: Record<string, MapChange> = {},
): Record<string, MapChange> {
    const kind = action.split(".")[0] ?? "";
    const allowed: ReadonlySet<string> = new Set(
        kind in MAP_AUDIT_FIELDS ? MAP_AUDIT_FIELDS[kind as MapAuditKind] : [],
    );
    if (AUDIT_STRICT && allowed.size === 0) throw new Error(`Fachprotokoll ${action}: unbekannte Art ${kind}`);
    const kept: Record<string, MapChange> = {};
    for (const [field, change] of Object.entries(changes)) {
        if (allowed.has(field)) kept[field] = change;
        else if (AUDIT_STRICT)
            throw new Error(`Fachprotokoll ${action}: Feld ${field} steht nicht in der Positivliste`);
    }
    return kept;
}

const actorColumns = (
    actor: MapActor,
): { kind: string; personId: string | null; label: string | null; approvalRef: string | null } =>
    actor.kind === "person"
        ? { kind: "person", personId: actor.personId, label: null, approvalRef: null }
        : actor.kind === "agent"
          ? { kind: "agent", personId: null, label: actor.label, approvalRef: actor.approvalRef }
          : { kind: "system", personId: null, label: actor.label, approvalRef: null };

export const MAP_OPERATION_STORE: OperationStore<MapOperationEvent> = {
    async find(sql, operationId) {
        const [row] = await sql<StoredOperation[]>`
            SELECT request_hash, receipt FROM map_operation WHERE operation_id = ${operationId}::uuid
        `;
        return row;
    },
    async record(tx, { operationId, requestHash, receipt, event }) {
        const actor = actorColumns(event.actor);
        await tx`
            INSERT INTO map_operation (operation_id, map_domain_id, request_hash, receipt, action, source, summary, environment,
                                       actor_kind, actor_person_id, actor_label, approval_ref, community_vorgang)
            VALUES (${operationId}::uuid, ${event.mapDomainId}, ${requestHash}, ${tx.json(receipt as never)}, ${event.operation},
                    ${event.source}, ${event.summary ?? null}, ${event.actor.environment}, ${actor.kind},
                    ${actor.personId}::uuid, ${actor.label}, ${actor.approvalRef}, ${event.communityVorgang ?? null})
        `;
        // Die Verknüpfung zu den zurückgenommenen Operationen (Position von 0 an). Ein Replay derselben Kennung kommt nie bis hierher:
        // `runOperation` gibt vorher die gespeicherte Quittung zurück.
        const reverts = event.reverts ?? [];
        if (reverts.length > 0) {
            await tx`
                INSERT INTO map_operation_revert_link (restore_operation_id, reverted_operation_id, position)
                SELECT ${operationId}::uuid, r.id, (r.n - 1)::int
                  FROM unnest(${reverts as string[]}::uuid[]) WITH ORDINALITY AS r(id, n)
            `;
        }
        for (const entry of event.entries) {
            await tx`
                INSERT INTO map_audit_event (operation_id, action, place_public_id, path_public_id, region_public_id,
                                             region_area_public_id, map_label_public_id, powerline_public_id, nodix_public_id,
                                             territory_public_id, territory_area_public_id, peak_public_id, source_public_id, work_public_id,
                                             lore_public_id, corpus_public_id, sprache_artikel_public_id, sprache_public_id,
                                             sprache_flaeche_public_id, landmarke_artikel_public_id, region_artikel_public_id, ort_artikel_public_id, revision_before, revision_after, changes)
                VALUES (${operationId}::uuid, ${entry.action}, ${entry.placeId ?? null}::uuid, ${entry.pathId ?? null}::uuid,
                        ${entry.regionId ?? null}::uuid, ${entry.areaId ?? null}::uuid, ${entry.labelId ?? null}::uuid,
                        ${entry.powerlineId ?? null}::uuid, ${entry.nodixId ?? null}::uuid,
                        ${entry.territoryId ?? null}::uuid, ${entry.territoryAreaId ?? null}::uuid,
                        ${entry.peakId ?? null}::uuid, ${entry.sourceId ?? null}::uuid, ${entry.workId ?? null}::uuid,
                        ${entry.loreId ?? null}::uuid, ${entry.corpusId ?? null}::uuid, ${entry.spracheArtikelId ?? null}::uuid,
                        ${entry.spracheId ?? null}::uuid, ${entry.spracheFlaecheId ?? null}::uuid,
                        ${entry.landmarkeArtikelId ?? null}::uuid, ${entry.regionArtikelId ?? null}::uuid, ${entry.ortArtikelId ?? null}::uuid,
                        ${entry.revisionBefore ?? null}, ${entry.revisionAfter ?? null},
                        ${tx.json(filterMapChanges(entry.action, entry.changes) as never)})
            `;
        }
    },
};

/** Die Jobart der Wegprofile (`jobs/path-profile-job.ts`). */
export const PATH_PROFILE_JOB_KIND = "path_profile";
/**
 * So lange wartet ein neuer Job der Wegprofile, bevor ihn der Worker nimmt (EDIT-0001 §6.3 „entprellt und zusammengefasst“): Wer
 * kurz nacheinander mehrere Orte verschiebt, bekommt EINEN Job; ein wartender nimmt jede weitere Operation mit.
 */
export const PATH_PROFILE_DELAY_S = 10;

const actorRef = (actor: MapActor): string =>
    actor.kind === "person" ? actor.personId : `${actor.kind === "agent" ? "agent" : "system"}:${actor.label}`;

/**
 * Der Bereich eines Folgeauftrags in der Warteschlange (Hauptorchestrierung 2026-10-19, A): `domain` sperrt gegen jeden Auftrag derselben
 * Domäne; `keiner` (Bereich `tiles` ohne Kacheln, wie `map_series_tile`) schneidet keinen Auftrag mit Kachelbereich, etwa das Gelände im
 * Umkreis. `keiner` nur für Arten ohne Bezug zum Gelände: die Ableitung der Herrschaftsgebiete, die Wegnamen und (WI-0283) Glättung und
 * Schriftläufe der Landschaften, die nur `region_area_smooth` und `landscape_label_run` schreiben, was das Gelände nicht liest. Gegen Zug und
 * Import hält weiter die Domänensperre, gegen sich selbst `maxConcurrent` 1; Wegprofile (lesen Höhen) bleiben `domain`.
 */
type Bereich = "domain" | "keiner";
const bereichArt = (bereich: Bereich): string => (bereich === "domain" ? "domain" : "tiles");

/** So heißt eine Landschaft (`region.public_id`) und eine ihrer Teilflächen (`region_area.public_id`) unter `affected` (WI-0178 B3). */
export const LANDSCHAFT_ART = "landscape";
export const TEILFLAECHE_ART = "area";
/**
 * So lange wartet ein Auftrag der Landschaften, bevor ihn die Warteschlange nimmt (WI-0178 B3): wie bei den Wegprofilen, jede
 * Speicherung in dieser Zeit fährt mit dem wartenden Auftrag mit (nie ein Auftrag je Klick). Die 2 bis 5 Minuten aus Claudios
 * Einschätzung gelten nur für schwere Folgen wie das Gelände, und das bekommt keinen Auftrag (Editor-Orchestrierung 2026-10-16:
 * „Für Glättung und Schriftläufe nimmst du 10 s wie bei path_profile“). Bis die Fläche gerundet ist, zeigt die Karte sie eckig
 * (`region_area_render`, 0067).
 */
export const LANDSCHAFT_FOLGEN_DELAY_S = 10;

/** So heißt ein Herrschaftsgebiet (`territory.public_id`) und eine seiner Flächen (`territory_area.public_id`) unter `affected` (WI-0209 B3). */
export const GEBIET_ART = "territory";
export const GEBIETSFLAECHE_ART = "territory_area";

/**
 * Der wartende Auftrag dieser Art in der Domäne, oder ein neuer mit `delayS` Wartezeit (EDIT-0001 §6.3 „entprellt und
 * zusammengefasst“). Mit `eingabe` zählt nur ein wartender Auftrag mit genau dieser Eingabe; ein laufender nimmt nichts mehr auf.
 */
async function wartendOderNeu(
    tx: Sql,
    actor: MapActor,
    mapDomainId: string,
    kind: string,
    delayS: number,
    eingabe: Record<string, string> = {},
    bereich: Bereich = "domain",
): Promise<string> {
    const [wartend] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM job
         WHERE kind = ${kind} AND map_domain_id = ${mapDomainId} AND state = 'QUEUED'
           AND input_ref @> ${tx.json(eingabe)}::jsonb AND ${tx.json(eingabe)}::jsonb @> input_ref
         ORDER BY id LIMIT 1
    `;
    if (wartend) return wartend.public_id;
    const [neu] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue(${kind}, 1::smallint, ${mapDomainId}, ${actorRef(actor)}, ${tx.json(eingabe)}::jsonb,
                           50::smallint, now() + make_interval(secs => ${delayS}), ${bereichArt(bereich)}, '{}'::smallint[])
    `;
    return neu!.public_id;
}

/**
 * Wie `wartendOderNeu`, aber gleitend (WI-0229, Migration 0203 `job_sammeln`): Jede Speicherung schiebt den Start des wartenden Auftrags
 * auf jetzt + `ruheS`, höchstens auf `hoechstensS` nach der ersten Speicherung.
 */
async function gesammelt(
    tx: Sql,
    actor: MapActor,
    mapDomainId: string,
    kind: string,
    ruheS: number,
    hoechstensS: number,
    bereich: Bereich = "domain",
): Promise<string> {
    const [auftrag] = await tx<{ public_id: string }[]>`
        SELECT job_sammeln(${kind}, 1::smallint, ${mapDomainId}, ${actorRef(actor)}, '{}'::jsonb, 50::smallint,
                           ${ruheS}::int, ${hoechstensS}::int, ${bereichArt(bereich)}, '{}'::smallint[])::text AS public_id
    `;
    return auftrag!.public_id;
}

/**
 * Die Ketten (Name und Art), deren Wegnamen eine Operation berührt: die der geänderten Wege, wie sie jetzt heißen, und - wenn Name oder
 * Art sich änderten (`path.update`) - wie sie vorher hießen. Je Kette ein Auftrag `path_label_runs`.
 */
async function wegKetten(
    tx: Sql,
    affected: OperationReceipt["affected"],
    entries: readonly MapAuditEntry[],
): Promise<{ name: string; subtype: string }[]> {
    const ids = [...new Set(affected.filter((entity) => entity.kind === "path").map((entity) => entity.id))];
    const jetzt = await tx<{ id: string; name: string; subtype: string }[]>`
        SELECT public_id::text AS id, name, subtype FROM path WHERE public_id = ANY(${ids}::uuid[])
    `;
    const ketten = new Map<string, { name: string; subtype: string }>();
    const merke = (name: string, subtype: string): void =>
        void ketten.set(`${name}\u0000${subtype}`, { name, subtype });
    const zeile = new Map(jetzt.map((z) => [z.id, z]));
    for (const z of jetzt) merke(z.name, z.subtype);
    for (const eintrag of entries) {
        const weg = eintrag.pathId === undefined ? undefined : zeile.get(eintrag.pathId);
        const name = eintrag.changes?.["name"]?.before;
        const subtype = eintrag.changes?.["subtype"]?.before;
        if (weg === undefined || (name === undefined && subtype === undefined)) continue;
        merke(typeof name === "string" ? name : weg.name, typeof subtype === "string" ? subtype : weg.subtype);
    }
    return [...ketten.values()];
}

/**
 * Die Ableitungen einer Operation, in ihrer Transaktion (WI-0128 E13, EDIT-0001 §6.3; WI-0178 B3, EDIT-0004 §6):
 * - hat sie einen Weg geändert, ein Job `path_profile`, oder der wartende derselben Domäne; dazu je berührter Kette (Name und Art,
 *   vorher und nachher) ein Job `path_label_runs`, oder der wartende derselben Kette (WI-0177, Entscheid der Orchestrierung
 *   2026-10-17: Die Wegnamen auf der Karte folgen jeder Wege-Operation);
 * - hat sie eine Teilfläche geändert, ein Job `land_smooth` (die veralteten Flächen und ihre Nachbarn), oder der wartende der Domäne;
 * - je berührter Landschaft ein Job `label_runs`, oder der wartende derselben Landschaft (Claudio 2026-10-16: „ein Auftrag je Region“);
 * - hat sie ein Herrschaftsgebiet oder eine seiner Flächen berührt, ein Job `territory_derive` mit zwei Minuten Sammelzeit, oder der
 *   wartende der Domäne (WI-0209 B3; die App-Rolle leitet nie selbst ab);
 * - hat sie einen Ort, einen Weg, ein Herrschaftsgebiet oder eine Landschaft (oder eine ihrer Flächen) berührt und gibt es aktive
 *   Sprachflächen, einen Job `sprache_treffer` für diese Objekte, oder der wartende der Domäne nimmt sie mit (WI-0261 S4,
 *   `sprachen/treffer-auftrag.ts`); ebenso für eine Sprache, deren Fläche oder Bestand sich änderte (Spracheditor, S5d);
 * - hat sie etwas geändert, das ins Gelände eingeht, unter regionaler Rückverteilung das Gelände im Umkreis (`gelaende-folgen.ts`,
 *   WI-0223; Betreiber 2026-10-18 „Geländerechnung: A“);
 * - keinen dieser Aufträge, wenn die Arbeit `ableitung: false` meldet: nur für Werte, die in kein abgeleitetes Ergebnis eingehen (etwa
 *   die Farbe eines Herrschaftsgebiets, WI-0209 D4, EDIT-0003 T51);
 * - immer das Ereignis `map.changed` (`map_event_add`, Migration 0103): seine Nummer ist die Kachelrevision der Quittung.
 * Das Ereignis kommt zuletzt: Es nimmt die Sperre der Ereignisnummern, und die soll nur kurz gehalten werden. Unter einer Fassung
 * ohne regionale Rückverteilung bekommt das Gelände keinen Auftrag: Eine Fläche, die es speist, meldet dann „Gelände veraltet“
 * (EDIT-0004 §6).
 */
async function deriveAfter(
    tx: Sql,
    actor: MapActor,
    mapDomainId: string,
    operation: string,
    affected: OperationReceipt["affected"],
    entries: readonly MapAuditEntry[] = [],
    ableitung = true,
): Promise<{ derivedWork: OperationReceipt["derivedWork"]; mapRevision: number }> {
    const derivedWork: OperationReceipt["derivedWork"] = [];
    // Was die Aufträge auslöst; ohne Ableitung nichts, das Ereignis nennt trotzdem alles.
    const ausloeser = ableitung ? affected : [];
    if (ausloeser.some((entity) => entity.kind === "path")) {
        const jobId = await wartendOderNeu(tx, actor, mapDomainId, PATH_PROFILE_JOB_KIND, PATH_PROFILE_DELAY_S);
        derivedWork.push({ kind: PATH_PROFILE_JOB_KIND, jobId, state: "queued" });
        for (const kette of await wegKetten(tx, affected, entries)) {
            const wegJob = await wartendOderNeu(
                tx,
                actor,
                mapDomainId,
                PATH_LABEL_RUNS_JOB_KIND,
                LANDSCHAFT_FOLGEN_DELAY_S,
                kette,
                "keiner",
            );
            derivedWork.push({ kind: PATH_LABEL_RUNS_JOB_KIND, jobId: wegJob, state: "queued" });
        }
    }
    if (ausloeser.some((entity) => entity.kind === TEILFLAECHE_ART)) {
        const jobId = await wartendOderNeu(
            tx,
            actor,
            mapDomainId,
            LAND_SMOOTH_JOB_KIND,
            LANDSCHAFT_FOLGEN_DELAY_S,
            {},
            "keiner",
        );
        derivedWork.push({ kind: LAND_SMOOTH_JOB_KIND, jobId, state: "queued" });
    }
    const landschaften = [
        ...new Set(ausloeser.filter((entity) => entity.kind === LANDSCHAFT_ART).map((entity) => entity.id)),
    ];
    for (const landscape of landschaften) {
        const jobId = await wartendOderNeu(
            tx,
            actor,
            mapDomainId,
            LABEL_RUNS_JOB_KIND,
            LANDSCHAFT_FOLGEN_DELAY_S,
            { landscape },
            "keiner",
        );
        derivedWork.push({ kind: LABEL_RUNS_JOB_KIND, jobId, state: "queued" });
    }
    if (ausloeser.some((entity) => entity.kind === GEBIET_ART || entity.kind === GEBIETSFLAECHE_ART)) {
        const jobId = await gesammelt(
            tx,
            actor,
            mapDomainId,
            TERRITORY_DERIVE_JOB_KIND,
            GEBIETSABLEITUNG_RUHE_S,
            GEBIETSABLEITUNG_HOECHSTENS_S,
            "keiner",
        );
        derivedWork.push({ kind: TERRITORY_DERIVE_JOB_KIND, jobId, state: "queued" });
    }
    derivedWork.push(...(await sprachTrefferNachOperation(tx, actorRef(actor), mapDomainId, ausloeser)));
    derivedWork.push(...(await gelaendeNachOperation(tx, actorRef(actor), mapDomainId, ausloeser)));
    derivedWork.push({ kind: "tiles", state: "done" });
    const [event] = await tx<{ seq: string }[]>`
        SELECT map_event_add(${mapDomainId}, ${tx.json({ operation, affected } as never)})::text AS seq
    `;
    return { derivedWork, mapRevision: Number(event!.seq) };
}

/** 503 `map_import_running`: Der tägliche Zug importiert die Karte; `Retry-After` setzt der Fehlerhandler für jedes 503. */
export function mapImportRunning(): ApiError {
    return new ApiError(
        MAP_EDITING_ERROR_STATUS.map_import_running,
        "map_import_running",
        "Ein Import schreibt gerade die Karte. Speichern geht gleich wieder.",
    );
}

/**
 * Die eindeutigen Schlüssel, an denen wirklich „jemand war schneller“ steht (Qualitätsreview 2026-10-12, Befund Q-03): Zwei
 * Operationen mit verschiedenen Kennungen legen denselben Gegenstand an oder setzen ihn auf die Karte. Die doppelte `operationId`
 * selbst fängt `runOperation` ab und gibt die erste Quittung zurück (`auth/operations.ts`), sie gehört nicht hierher.
 *
 * 🪤 Vorher stand hier jede Verletzung eines eindeutigen Schlüssels als 409 `edit_conflict`. Ein Programmierfehler (eine doppelte
 * Zeile, die kein Wettlauf ist) kam damit als „Neu laden zeigt den aktuellen Stand“ beim Editor an, was nicht hilft, und blieb in
 * den Logs unauffällig. Was hier nicht steht, fliegt jetzt weiter und wird ein 500 mit Eintrag.
 */
const KONKURRENZ_SCHLUESSEL: ReadonlySet<string> = new Set([
    "place_public_id_unique",
    "place_unplaced_public_id_unique",
    // Die Landschaft (WI-0178 B1): eine Landschaft, Teilfläche oder Beschriftung mit derselben Kennung zweimal angelegt.
    "region_public_id_unique",
    "region_area_public_id_unique",
    "map_label_public_id_unique",
    // Die Kraftlinie (WI-0205 K4): ein Abschnitt oder Kraftlinienpunkt mit derselben Kennung zweimal angelegt.
    "powerline_public_id_key",
    "nodix_public_id_unique",
    // Der Spracheditor (WI-0261 S5d): zwei Operationen ordnen denselben freien Wiki-Artikel zugleich verschiedenen Sprachen zu (ein Artikel gehört höchstens einer).
    "sprache_wiki_artikel_aktiv",
]);

export type MapWork = (tx: Sql) => Promise<{
    receipt: Omit<OperationReceipt, "operationId" | "status" | "environment">;
    entries: MapAuditEntry[];
    summary?: string;
    /** `false`: keine Aufträge danach. Nur für Werte, die in kein abgeleitetes Ergebnis eingehen (`deriveAfter`). */
    ableitung?: false;
}>;

/** Die Pausen vor dem zweiten und dritten Versuch, wenn eine Operation an `lock_timeout` scheiterte (55P03), in Millisekunden. */
export const SPERR_PAUSEN_MS: readonly number[] = [300, 900];

/**
 * Versucht `lauf` noch einmal, wenn er an `lock_timeout` scheiterte (Stage 2026-10-19: Speichern eines Gebiets, während die Ableitung
 * lief; Hauptorchestrierung: „mit einem Wiederholversuch“) oder als Opfer eines Deadlocks abgebrochen wurde (Production 2026-11-05, einmal bei
 * `PATCH /api/editor/landscapes`, der Editor sah einen Speicherfehler; WI-0283). Gefahrlos: Die Transaktion ist dann ganz zurückgerollt, und die Kennung der
 * Operation hält einen doppelten Erfolg ab. Jeder andere Fehler und der letzte Versuch gehen unverändert weiter.
 */
export async function mitSperrWiederholung<T>(
    lauf: () => Promise<T>,
    pausenMs: readonly number[] = SPERR_PAUSEN_MS,
): Promise<T> {
    for (let versuch = 0; ; versuch += 1) {
        try {
            return await lauf();
        } catch (error) {
            const pause = pausenMs[versuch];
            if (!(isLockTimeout(error) || isDeadlock(error)) || pause === undefined) throw error;
            await new Promise((weiter) => setTimeout(weiter, pause));
        }
    }
}

/** Eine Operation an der Karte (`einmal`), bei einer Sperrzeit bis zu zweimal wiederholt (`mitSperrWiederholung`). */
export function mapOperation(...args: Parameters<typeof einmal>): Promise<OperationReceipt> {
    return mitSperrWiederholung(() => einmal(...args));
}

const UUID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Die Operationen, die eine Anfrage zurücknimmt (WI-0265 B1): ausdrücklich `reverts` (künftig mehrere, etwa eine Arbeitsserie), sonst das
 * Feld `reverts` im Anfragekörper, die Einzelrücknahme aller Editoren (↺ im Verlauf: eine Kennung). In der Reihenfolge der Anfrage, klein
 * geschrieben, ohne Doppelte. Ist eine Kennung nicht in UUID-Form: 400 `validation_failed` an `reverts`, bevor etwas geschrieben wird.
 */
export function ruecknahmeZiele(input: { body: unknown; reverts?: readonly string[] | undefined }): string[] {
    const koerper = input.body as { reverts?: unknown } | null | undefined;
    const roh: readonly unknown[] = input.reverts ?? (typeof koerper?.reverts === "string" ? [koerper.reverts] : []);
    const ziele = [...new Set(roh.map((id) => (typeof id === "string" ? id.toLowerCase() : id)))];
    const falsch = ziele.filter((id) => typeof id !== "string" || !UUID_FORM.test(id));
    if (falsch.length > 0) {
        throw new ApiError(400, "validation_failed", "Die Kennung der zurückzunehmenden Operation ist ungültig.", {
            field: "reverts",
        });
    }
    return ziele as string[];
}

/**
 * Jede zurückzunehmende Operation muss eine `map_operation` sein (Verknüpfung `map_operation_revert_link` hat einen Fremdschlüssel): Sonst
 * 400 `validation_failed` an `reverts`, VOR der Fachoperation und damit vor jeder Änderung (die Transaktion ist dann ohnehin leer).
 */
async function pruefeRuecknahmeZiele(tx: Sql, reverts: readonly string[]): Promise<void> {
    const bekannt = await tx<{ id: string }[]>`
        SELECT operation_id::text AS id FROM map_operation WHERE operation_id = ANY(${reverts as string[]}::uuid[])
    `;
    const da = new Set(bekannt.map((zeile) => zeile.id));
    const unbekannt = reverts.filter((id) => !da.has(id));
    if (unbekannt.length > 0) {
        throw new ApiError(
            400,
            "validation_failed",
            "Diese Operation ist unbekannt und lässt sich nicht zurücknehmen.",
            {
                field: "reverts",
                operationIds: unbekannt,
            },
        );
    }
}

/**
 * Eine Operation an der Karte: höchstens einmal je `operationId`, Änderung, Operation und Protokoll in EINER Transaktion. Zu Beginn
 * sperrt sie die Kennung selbst: Ein gleichzeitiger Doppelklick wartet auf die erste Anfrage und bekommt ihre Quittung, statt sich
 * selbst einen Bearbeitungskonflikt zu bescheren. Gleichzeitige Operationen mit verschiedener Kennung am selben Gegenstand trennt die
 * Revision (`UPDATE … AND revision = $baseRevision`, 409 `edit_conflict`); das prüft die Fachoperation in `work` (E10).
 */
async function einmal(
    database: Database,
    actor: MapActor,
    input: {
        operationId: string;
        operation: string;
        mapDomainId: string;
        body: unknown;
        source?: "editor" | "restore" | "wikisync";
        /**
         * Die Operationen, die diese zurücknimmt (WI-0265 B1, `map_operation_revert_link`). Fehlt es, gilt das Feld `reverts` des Anfragekörpers
         * (`ruecknahmeZiele`): Alle Einzelrücknahmen der Editoren tragen es dort. Eine Rücknahme mehrerer Operationen (Arbeitsserie) nennt sie hier.
         */
        reverts?: readonly string[];
    },
    work: MapWork,
): Promise<OperationReceipt> {
    if (actor.kind === "agent" && actor.approvalRef.trim() === "") {
        throw new Error(
            "Map Mutation Guard: Ein Agent schreibt die Karte nur mit Freigabe des Betreibers (approvalRef).",
        );
    }
    const reverts = ruecknahmeZiele(input);
    if (AUDIT_STRICT && input.source === "restore" && reverts.length === 0) {
        throw new Error(`Operation ${input.operation}: Quelle restore ohne zurückgenommene Operation (reverts)`);
    }
    // Die Herkunft aus einem Community-Vorgang (WI-0268 C7): vor der Transaktion geprüft, damit eine unbekannte Nummer nie das Speichern kostet.
    const communityVorgang = actor.kind === "person" ? await pruefeHerkunft(database, anfrageHerkunft()) : undefined;
    try {
        return await runOperation<MapOperationEvent>(
            database,
            {
                operationId: input.operationId,
                body: { operation: input.operation, mapDomainId: input.mapDomainId, ...(input.body as object) },
            },
            async (tx) => {
                // Nach der Sperre der Kennung und dem Replay, vor der Fachoperation: Eine unbekannte Operation ändert nichts.
                if (reverts.length > 0) await pruefeRuecknahmeZiele(tx, reverts);
                const { receipt, entries, summary, ableitung } = await work(tx);
                const after = await deriveAfter(
                    tx,
                    actor,
                    input.mapDomainId,
                    input.operation,
                    receipt.affected,
                    entries,
                    ableitung !== false,
                );
                return {
                    receipt: {
                        ...receipt,
                        derivedWork: [...receipt.derivedWork, ...after.derivedWork],
                        mapRevision: after.mapRevision,
                        environment: actor.environment,
                    },
                    event: {
                        operation: input.operation,
                        mapDomainId: input.mapDomainId,
                        source: input.source ?? "editor",
                        summary,
                        actor,
                        entries,
                        reverts,
                        communityVorgang,
                    },
                };
            },
            {
                store: MAP_OPERATION_STORE,
                serialize: async (tx) => {
                    await tx`SELECT pg_advisory_xact_lock(hashtext(${`map_operation:${input.operationId}`}))`;
                    // Der Zug importiert gerade (exklusive Sperre der Domäne, `derive-lock.ts`): nichts schreiben, später noch einmal
                    // (EDIT-0001 §4.6, N4). Geteilt, damit Speichern und die Jobs der Queue einander nicht aufhalten.
                    const [frei] = await tx<{ ok: boolean }[]>`
                        SELECT pg_try_advisory_xact_lock_shared(hashtext(${DERIVE_LOCK_CLASS}), hashtext(${input.mapDomainId})) AS ok
                    `;
                    if (frei?.ok !== true) throw mapImportRunning();
                },
            },
        );
    } catch (error) {
        // Ein eindeutiger Schlüssel, an dem eine gleichzeitige Operation mit anderer Kennung gewann: „jemand war schneller“.
        const fehler = error as { code?: string; constraint_name?: string };
        if (fehler.code === "23505" && KONKURRENZ_SCHLUESSEL.has(fehler.constraint_name ?? "")) {
            throw new ApiError(
                409,
                "edit_conflict",
                "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
                // Welche Revision jetzt gilt, weiß diese Stelle nicht: Die Transaktion ist zurückgerollt, und die gewinnende steht
                // in einer anderen. 0 ist der vereinbarte Platzhalter (`EditConflictDetails` verlangt das Feld); beide Clients
                // lesen den Ort danach ohnehin neu (`ort-bearbeitung.ts`, `ort-verschieben.ts`).
                { currentRevision: 0 },
            );
        }
        throw error;
    }
}
