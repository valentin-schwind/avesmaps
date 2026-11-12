import { formtGelaende, type InhalteTraegerArt, type WikisyncBereich } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { TRAEGER } from "../../inhalte/traeger.ts";
import { GEBIET_FELDER } from "../infobox/gebiet.ts";
import { LANDMARKE_FELDER, landmarkeSchluessel } from "../infobox/landmarke.ts";
import { LITERATUR_FELDER } from "../infobox/literatur.ts";
import { SPRACHE_FELDER } from "../infobox/sprache.ts";
import { VORKOMMEN_EIGENE_FELDER, VORKOMMEN_FELDER } from "../infobox/vorkommen.ts";
import { titelAusWikiAdresse } from "../vorschau/adresse.ts";
import { ladeRegelBestand } from "../regeln/laden.ts";
import { vermerkAus, zuweisungsHerkunftAus, zuweisungszustandAus, type Zuweisungszustand } from "./herkunft.ts";
import type { OrtsHerkunft, OrtsZeile } from "./ortsliste.ts";
import { bekannterTitelSchluessel, type LokalerWert, type PlanObjekt } from "./plan.ts";
import type { QuellenHerkunft, QuellenVerknuepfung } from "./quellen.ts";
import { LANDMARKE_ARTIKEL_ART, LANDMARKE_SPALTEN, landmarkeAdresse } from "./landmarken.ts";
import { ORT_ARTIKEL_ART, ORT_ARTIKEL_FELDER, ortArtikelSchluessel } from "./ort-artikel.ts";
import { REGION_ARTIKEL_ART } from "./region-artikel.ts";
import { ARTIKEL_FELD, SPRACHE_ARTIKEL_ART, SPRACHE_SPALTEN, navigationWert, spracheAdresse } from "./sprachen.ts";
import { gueltigeRolle, type LoreZeile } from "./vorkommen.ts";

/**
 * Die Objekte der Karte mit Wiki-Zuordnung für den Abgleich (WI-0253 C): je Bereich EINE lesende Abfrage, die Zuordnung (Adresse, Zustand, Herkunft), die
 * Felder, die das Objekt selbst führt (mit ihrem Vermerk), und den Wiki-Stand des letzten Abgleichs (den Schnappschuss) liefert. REIN LESEND: kein Schreiben,
 * keine Sperre.
 *
 * Wo die Zuordnung steht, ist je Art verschieden (Migration 0065 und 0010/0055): Ort, Weg, Kraftlinie und Gipfel in `*_wiki_assignment`, die Landschaft in
 * `region.wiki_url` / `wiki_region_key`, das Gebiet in `territory.wiki_url` / `wiki_key`. Eine getrennte oder unterdrückte Zuordnung hat keine Adresse (die
 * Tafel verbietet sie); trägt das Objekt in der Zuordnungstafel X2 (`wiki_key_assignment`) trotzdem eine, geht sie mit.
 *
 * Wo ein Feld sein Eigentum hat, steht in `herkunft.ts`. Der Wert „leer“ unterscheidet nur das Gebiet (`territory_detail`: NULL = kein Wert, `''` = bewusst leer);
 * überall sonst ist ein leerer Text dasselbe wie kein Wert.
 */

type Zeile = Record<string, unknown>;
const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);
const leerZuNull = (wert: string | null): string | null => (wert === null || wert.trim() === "" ? null : wert);

/** Ein Feld am Objekt: Text oder kein Wert; Leerraum allein ist kein Wert. */
function lokalerWert(wert: string | null, herkunft: unknown): LokalerWert {
    const gefuellt = leerZuNull(wert);
    return gefuellt === null
        ? { zustand: "kein", wert: null, vermerk: "kein" }
        : { zustand: "text", wert: gefuellt, vermerk: vermerkAus(text(herkunft)) };
}

/** Der Schnappschuss als Abbildung: leer heißt „das Wiki kannte nichts“ (NULL). */
function schnappschussAus(zeile: Zeile, spalten: Readonly<Record<string, string>>): Map<string, string | null> {
    const karte = new Map<string, string | null>();
    for (const [feld, spalte] of Object.entries(spalten)) karte.set(feld, leerZuNull(text(zeile[spalte])));
    return karte;
}

/** „Region · Staat“, wie Legacys Infobox-Parser es für `lage` zusammensetzt (gleiche Teile nur einmal). */
function lageAusRegionUndStaat(region: string | null, staat: string | null): string | null {
    const teile = [region, staat].filter((teil): teil is string => teil !== null && teil.trim() !== "");
    const lage = [...new Set(teile)].join(" · ");
    return lage === "" ? null : Array.from(lage).slice(0, 300).join("");
}

interface Rumpf {
    bereich: WikisyncBereich;
    objektArt: string;
    id: string;
    name: string;
    adresse: string | null;
    zustand: Zuweisungszustand;
    herkunft: string | null;
    hauptzuweisung?: boolean;
    lokal: Map<string, LokalerWert>;
    schnappschuss: Map<string, string | null> | null;
    unbekannt?: Set<string>;
    ortsliste?: PlanObjekt["ortsliste"];
    vorkommen?: PlanObjekt["vorkommen"];
    sprache?: PlanObjekt["sprache"];
    landmarke?: PlanObjekt["landmarke"];
    regionArtikel?: PlanObjekt["regionArtikel"];
    ortArtikel?: PlanObjekt["ortArtikel"];
    nichtGefuehrt?: Set<string>;
}

function objektAus(rumpf: Rumpf): PlanObjekt {
    return {
        ...(rumpf.nichtGefuehrt === undefined ? {} : { nichtGefuehrt: rumpf.nichtGefuehrt }),
        ...(rumpf.ortsliste === undefined ? {} : { ortsliste: rumpf.ortsliste }),
        ...(rumpf.vorkommen === undefined ? {} : { vorkommen: rumpf.vorkommen }),
        ...(rumpf.sprache === undefined ? {} : { sprache: rumpf.sprache }),
        ...(rumpf.landmarke === undefined ? {} : { landmarke: rumpf.landmarke }),
        ...(rumpf.regionArtikel === undefined ? {} : { regionArtikel: rumpf.regionArtikel }),
        ...(rumpf.ortArtikel === undefined ? {} : { ortArtikel: rumpf.ortArtikel }),
        bereich: rumpf.bereich,
        objektArt: rumpf.objektArt,
        id: rumpf.id,
        name: rumpf.name,
        adresse: rumpf.adresse,
        zustand: rumpf.zustand,
        herkunft: zuweisungsHerkunftAus(rumpf.herkunft),
        hauptzuweisung: rumpf.hauptzuweisung ?? true,
        lokal: rumpf.lokal,
        schnappschuss: rumpf.schnappschuss,
        schnappschussUnbekannt: rumpf.unbekannt ?? new Set(),
    };
}

/** Die Adresse der Zuordnung; bei einer getrennten oder unterdrückten (die keine trägt) die der Tafel X2. */
const adresseVon = (eigene: unknown, x2: unknown): string | null => text(eigene) ?? text(x2);

// ----------------------------------------------------------------------------------------------------------------------------
// Orte
// ----------------------------------------------------------------------------------------------------------------------------

async function ladeOrte(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT p.public_id::text AS id, p.name, a.assignment_state AS zustand, a.assignment_origin AS herkunft, a.wiki_url AS adresse,
               x.wiki_url AS x2_adresse, (s.id IS NOT NULL) AS hat_schnappschuss,
               s.wiki_name, s.description, s.einwohner AS s_einwohner, s.oberhaupt AS s_oberhaupt, s.region_text, s.staat_text,
               s.handelszone, s.verkehrswege, s.bevoelkerung, s.tempel,
               s.settlement_class AS s_settlement_class, s.settlement_class_guessed AS s_settlement_class_guessed, s.building_type AS s_building_type,
               p.subtype, p.place_kind,
               d.einwohner AS d_einwohner, d.lage AS d_lage, d.oberhaupt AS d_oberhaupt,
               d.einwohner_origin, d.lage_origin, d.oberhaupt_origin,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'place' AND f.object_id = p.public_id AND f.field = 'name') AS name_origin,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'place' AND f.object_id = p.public_id AND f.field = 'subtype') AS subtype_origin
          FROM place_wiki_assignment a
          JOIN place p ON p.id = a.place_id AND p.is_active
          LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
          LEFT JOIN place_detail d ON d.place_id = p.id AND d.is_active
          LEFT JOIN wiki_key_assignment x
            ON x.legacy_art = 'siedlung' AND x.object_public_id = p.public_id AND x.is_active
         WHERE a.is_active AND (${domain}::text IS NULL OR p.map_domain_id = ${domain})
         ORDER BY p.public_id
    `;
    return zeilen.map((zeile) => {
        const snap = zeile["hat_schnappschuss"] === true;
        const schnappschuss = snap
            ? schnappschussAus(zeile, {
                  name: "wiki_name",
                  einwohner: "s_einwohner",
                  oberhaupt: "s_oberhaupt",
                  region_text: "region_text",
                  staat_text: "staat_text",
                  handelszone: "handelszone",
                  verkehrswege: "verkehrswege",
                  bevoelkerung: "bevoelkerung",
                  tempel: "tempel",
                  description: "description",
                  settlement_class: "s_settlement_class",
                  building_type: "s_building_type",
              })
            : null;
        // `lage` ist keine Spalte des Schnappschusses, sondern „Region · Staat“ daraus – so setzt Legacy den Wert, den der Ort als eigene Lage führt.
        if (schnappschuss !== null) {
            schnappschuss.set(
                "lage",
                lageAusRegionUndStaat(
                    schnappschuss.get("region_text") ?? null,
                    schnappschuss.get("staat_text") ?? null,
                ),
            );
        }
        // Ortsgröße und Bauwerkart kommen im Wiki-Teil (C-2) aus den Kategorien. Die Ortsgröße führt der Ort selbst (`place.subtype`, Vermerk in `field_origin`); die Bauwerkart nur, wenn
        // jemand sie gesetzt hat (`place.place_kind`, ohne Vermerk: ein Wert ohne Beleg ist unbekannt und wird nie überschrieben). Sonst steht sie nur im Schnappschuss.
        const lokal = new Map<string, LokalerWert>([
            ["name", { zustand: "text", wert: String(zeile["name"]), vermerk: vermerkAus(text(zeile["name_origin"])) }],
            ["einwohner", lokalerWert(text(zeile["d_einwohner"]), zeile["einwohner_origin"])],
            ["lage", lokalerWert(text(zeile["d_lage"]), zeile["lage_origin"])],
            ["oberhaupt", lokalerWert(text(zeile["d_oberhaupt"]), zeile["oberhaupt_origin"])],
            ["settlement_class", lokalerWert(text(zeile["subtype"]), zeile["subtype_origin"])],
        ]);
        if (leerZuNull(text(zeile["place_kind"])) !== null) {
            lokal.set("building_type", lokalerWert(text(zeile["place_kind"]), null));
        }
        // 🔴 Legacys Regel (`js/ui/wiki-assign-ort.js`, `avesmapsWikiAssignOrtGroesseIstGeraten`, nach dem Unfall „Gareth wird Dorf“): Eine geratene Ortsklasse ist unbekannt; trägt der
        // Schnappschuss kein Kennzeichen, gilt „dorf“ als geraten, weil der Parser darauf zurückfällt.
        const klasse = leerZuNull(text(zeile["s_settlement_class"]))?.toLowerCase() ?? null;
        const geraten =
            zeile["s_settlement_class_guessed"] === true ||
            (zeile["s_settlement_class_guessed"] === null && klasse === "dorf");
        return objektAus({
            bereich: "ort",
            objektArt: "place",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: adresseVon(zeile["adresse"], zeile["x2_adresse"]),
            zustand: zuweisungszustandAus(String(zeile["zustand"])),
            herkunft: text(zeile["herkunft"]),
            lokal,
            schnappschuss,
            ...(geraten ? { unbekannt: new Set(["settlement_class"]) } : {}),
        });
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Wege
// ----------------------------------------------------------------------------------------------------------------------------

async function ladeWege(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT pa.public_id::text AS id, pa.name, a.role, a.assignment_state AS zustand, a.assignment_origin AS herkunft, a.wiki_url AS adresse,
               x.wiki_url AS x2_adresse, (s.id IS NOT NULL) AS hat_schnappschuss, s.is_lean,
               s.name AS s_name, s.kind AS s_kind, s.art AS s_art, s.lage AS s_lage, s.verlauf AS s_verlauf, s.laenge AS s_laenge,
               s.description AS s_description,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'path' AND f.object_id = pa.public_id AND f.field = 'name') AS name_origin
          FROM path_wiki_assignment a
          JOIN path pa ON pa.id = a.path_id AND pa.is_active
          LEFT JOIN wiki_path_snapshot s ON s.id = a.snapshot_id AND s.is_active
          LEFT JOIN wiki_key_assignment x
            ON x.legacy_art = 'weg' AND x.object_public_id = pa.public_id AND x.is_active AND a.role = 'main'
         WHERE a.is_active AND (${domain}::text IS NULL OR pa.map_domain_id = ${domain})
         ORDER BY pa.public_id, a.role
    `;
    return zeilen.map((zeile) => {
        const snap = zeile["hat_schnappschuss"] === true;
        // Ein schlanker Schnappschuss kennt nur Schlüssel, Name, Art und Wegart: Der Rest ist unbekannt, nicht „das Wiki kannte nichts“.
        const schlank = zeile["is_lean"] === true;
        return objektAus({
            bereich: "weg",
            objektArt: "path",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: adresseVon(zeile["adresse"], zeile["x2_adresse"]),
            zustand: zuweisungszustandAus(String(zeile["zustand"])),
            herkunft: text(zeile["herkunft"]),
            hauptzuweisung: zeile["role"] === "main",
            lokal: new Map([
                [
                    "name",
                    { zustand: "text", wert: String(zeile["name"]), vermerk: vermerkAus(text(zeile["name_origin"])) },
                ],
            ]),
            schnappschuss: snap
                ? schnappschussAus(zeile, {
                      name: "s_name",
                      kind: "s_kind",
                      art: "s_art",
                      lage: "s_lage",
                      laenge: "s_laenge",
                      verlauf: "s_verlauf",
                      description: "s_description",
                  })
                : null,
            unbekannt: schlank ? new Set(["lage", "laenge", "verlauf", "description"]) : new Set(),
        });
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Kraftlinien
// ----------------------------------------------------------------------------------------------------------------------------

async function ladeKraftlinien(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT pl.public_id::text AS id, pl.name, pl.description AS d_description,
               a.assignment_state AS zustand, a.assignment_origin AS herkunft, a.wiki_url AS adresse, x.wiki_url AS x2_adresse,
               (s.id IS NOT NULL) AS hat_schnappschuss,
               s.name AS s_name, s.staerke, s.affinitaet, s.laenge, s.regionen, s.verlauf, s.description AS s_description,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'powerline' AND f.object_id = pl.public_id AND f.field = 'name') AS name_origin,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'powerline' AND f.object_id = pl.public_id AND f.field = 'description') AS description_origin
          FROM powerline_wiki_assignment a
          JOIN powerline pl ON pl.id = a.powerline_id AND pl.is_active
          LEFT JOIN wiki_powerline_snapshot s ON s.id = a.snapshot_id AND s.is_active
          LEFT JOIN wiki_key_assignment x
            ON x.legacy_art = 'kraftlinie' AND x.object_public_id = pl.public_id AND x.is_active
         WHERE a.is_active AND (${domain}::text IS NULL OR pl.map_domain_id = ${domain})
         ORDER BY pl.public_id
    `;
    const objekte = zeilen.map((zeile) =>
        objektAus({
            bereich: "kraftlinie",
            objektArt: "powerline",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: adresseVon(zeile["adresse"], zeile["x2_adresse"]),
            zustand: zuweisungszustandAus(String(zeile["zustand"])),
            herkunft: text(zeile["herkunft"]),
            lokal: new Map([
                [
                    "name",
                    { zustand: "text", wert: String(zeile["name"]), vermerk: vermerkAus(text(zeile["name_origin"])) },
                ],
                ["description", lokalerWert(text(zeile["d_description"]), zeile["description_origin"])],
            ]),
            schnappschuss:
                zeile["hat_schnappschuss"] === true
                    ? schnappschussAus(zeile, {
                          name: "s_name",
                          staerke: "staerke",
                          affinitaet: "affinitaet",
                          laenge: "laenge",
                          regionen: "regionen",
                          verlauf: "verlauf",
                          description: "s_description",
                      })
                    : null,
        }),
    );
    return erbeLinienStand(objekte);
}

/**
 * Die Abschnitte einer Linie teilen sich den Artikel und damit den Wiki-Stand: Der Leser (`subjects/detail-powerline.ts`) zeigt für die GANZE Linie den Stand des ersten Abschnitts, der einen
 * hat. Ein Abschnitt, der nur mit der Adresse am selben Artikel hängt (`address_only`, bei Legacy 4 von 84), ist dort also gedeckt. Hier erbt er den Stand seiner Linie, damit Vorschau und
 * Übernahme ihn vergleichen wie die Abschnitte mit Stand – statt ihm einen leeren Istwert zu unterstellen, der nie „übernommen“ werden könnte (WI-0253, erster Lauf auf der Stage). Hat KEIN
 * Abschnitt des Artikels einen Stand, bleibt er ohne (`hatWikiStand`, `plan.ts`): dann sagt die Vorschau es als Befund.
 */
function erbeLinienStand(objekte: PlanObjekt[]): PlanObjekt[] {
    const stand = new Map<string, ReadonlyMap<string, string | null>>();
    const schluesselVon = (objekt: PlanObjekt): string | null => {
        const titel = titelAusWikiAdresse(objekt.adresse);
        return titel === null ? null : bekannterTitelSchluessel(titel);
    };
    for (const objekt of objekte) {
        if (objekt.schnappschuss === null || objekt.zustand !== "zugewiesen") continue;
        const schluessel = schluesselVon(objekt);
        if (schluessel !== null && !stand.has(schluessel)) stand.set(schluessel, objekt.schnappschuss);
    }
    return objekte.map((objekt) => {
        if (objekt.schnappschuss !== null || objekt.zustand !== "nur_adresse") return objekt;
        const schluessel = schluesselVon(objekt);
        const geerbt = schluessel === null ? undefined : stand.get(schluessel);
        return geerbt === undefined ? objekt : { ...objekt, schnappschuss: geerbt, schnappschussGeerbt: true };
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Landschaften
// ----------------------------------------------------------------------------------------------------------------------------

const NACHBAR_FELDER: Readonly<Record<string, string>> = {
    N: "nachbar_n",
    NO: "nachbar_no",
    O: "nachbar_o",
    SO: "nachbar_so",
    S: "nachbar_s",
    SW: "nachbar_sw",
    W: "nachbar_w",
    NW: "nachbar_nw",
};

/**
 * Der Wiki-Stand einer Landschafts-Infobox aus einer Zeile mit den Spalten von `wiki_region_snapshot` (Landschaft und Gipfel teilen ihn). `art` steht roh im Schnappschuss (Legacy liest
 * die erste Komponente vor dem „|“), der Leser liest sie ebenso; die Nachbarn kommen als Text je Richtung (`nachbarn`).
 */
function landschaftsStand(zeile: Zeile, weitere: Readonly<Record<string, string>> = {}): Map<string, string | null> {
    const schnappschuss = schnappschussAus(zeile, {
        name: "s_name",
        art: "s_art",
        region_parent: "region_parent",
        affiliation_staat: "affiliation_staat",
        einwohner: "einwohner",
        sprache: "sprache",
        vegetation: "vegetation",
        verkehrswege: "verkehrswege",
        description: "s_description",
        ...weitere,
    });
    const art = schnappschuss.get("art");
    if (art !== null && art !== undefined) schnappschuss.set("art", leerZuNull((art.split("|")[0] ?? "").trim()));
    const nachbarn = (zeile["nachbarn"] ?? {}) as Record<string, string>;
    for (const [richtung, feld] of Object.entries(NACHBAR_FELDER))
        schnappschuss.set(feld, leerZuNull(nachbarn[richtung] ?? null));
    return schnappschuss;
}

async function ladeLandschaften(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT r.public_id::text AS id, r.name, r.wiki_url AS adresse, r.wiki_region_key, x.wiki_url AS x2_adresse,
               (s.id IS NOT NULL) AS hat_schnappschuss,
               s.name AS s_name, s.art AS s_art, s.region_parent, s.affiliation_staat, s.einwohner, s.sprache, s.vegetation,
               s.verkehrswege, s.description AS s_description, s.continent AS s_continent,
               (SELECT coalesce(jsonb_object_agg(n.direction, n.namen), '{}'::jsonb)
                  FROM (SELECT direction, string_agg(name, ', ' ORDER BY position) AS namen
                          FROM wiki_region_snapshot_neighbor WHERE snapshot_id = s.id GROUP BY direction) n) AS nachbarn,
               (SELECT f.origin FROM field_origin f
                 WHERE f.object_kind = 'landscape' AND f.object_id = r.public_id AND f.field = 'name') AS name_origin
          FROM region r
          LEFT JOIN wiki_region_snapshot s ON s.wiki_key = r.wiki_region_key AND s.is_active
          LEFT JOIN wiki_key_assignment x
            ON x.legacy_art = 'landschaft' AND x.object_public_id = r.public_id AND x.is_active
         WHERE r.is_active AND (r.wiki_url IS NOT NULL OR r.wiki_region_key IS NOT NULL)
           AND (${domain}::text IS NULL OR r.map_domain_id = ${domain})
         ORDER BY r.public_id
    `;
    return zeilen.map((zeile) => {
        const schnappschuss =
            zeile["hat_schnappschuss"] === true ? landschaftsStand(zeile, { continent: "s_continent" }) : null;
        return objektAus({
            bereich: "region",
            objektArt: "region",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: adresseVon(zeile["adresse"], zeile["x2_adresse"]),
            zustand: text(zeile["adresse"]) !== null ? "zugewiesen" : "nur_adresse",
            herkunft: null,
            lokal: new Map([
                [
                    "name",
                    { zustand: "text", wert: String(zeile["name"]), vermerk: vermerkAus(text(zeile["name_origin"])) },
                ],
            ]),
            schnappschuss,
        });
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Gipfel
// ----------------------------------------------------------------------------------------------------------------------------

/**
 * Gipfel und Vulkane (`terrain_peak`): Ihr Wiki-Stand ist der Landschafts-Stand ihres Artikels (`wiki_region_snapshot`, über `terrain_peak_wiki_assignment.snapshot_id`), wie Legacy ihnen
 * dasselbe Nest anhängte wie einer Landschaft. Name und Art gehören dem Editor und dem Gelände; EIN Feld führt der Gipfel selbst und folgt dem Wiki: die Höhe (`height`, `terrain_peak.height_schritt`,
 * WI-0253 §21; Vali 2026-10-27). Ihr Vermerk (`field_origin`, Art `peak`): `manual`, wo eine Hand sie gesetzt hat; **jede andere Höhe, auch eine ohne Vermerk, folgt dem Wiki**, wo es einen Wert gibt
 * (bewusste Ausnahme von „unbelegt ist Befund“, nur für diese Höhe). Dass der Schnappschuss die Höhe noch nie kannte (`height_schritt` NULL), ist „Wiki-Wert unbekannt“ und kein Widerspruch.
 * Nur Berggipfel und Vulkan führen die Höhe (WI-0271 L3): Eine Landmarke ohne Gelände (Höhle, Quelle …) hat keine; ihr Wiki-Wert steht nur im Wiki-Stand (`nichtGefuehrt`).
 */
async function ladeGipfel(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT tp.public_id::text AS id, tp.name, a.assignment_state AS zustand, a.assignment_origin AS herkunft, a.wiki_url AS adresse,
               x.wiki_url AS x2_adresse, (s.id IS NOT NULL) AS hat_schnappschuss,
               s.name AS s_name, s.art AS s_art, s.region_parent, s.affiliation_staat, s.einwohner, s.sprache, s.vegetation,
               s.verkehrswege, s.description AS s_description, tp.height_schritt AS hoehe, s.height_schritt AS s_hoehe, tp.subtype AS art,
               (SELECT f.origin FROM field_origin f WHERE f.object_kind = 'peak' AND f.object_id = tp.public_id AND f.field = 'height') AS hoehe_origin,
               (SELECT coalesce(jsonb_object_agg(n.direction, n.namen), '{}'::jsonb)
                  FROM (SELECT direction, string_agg(name, ', ' ORDER BY position) AS namen
                          FROM wiki_region_snapshot_neighbor WHERE snapshot_id = s.id GROUP BY direction) n) AS nachbarn
          FROM terrain_peak_wiki_assignment a
          JOIN terrain_peak tp ON tp.id = a.terrain_peak_id AND tp.is_active
          LEFT JOIN wiki_region_snapshot s ON s.id = a.snapshot_id AND s.is_active
          LEFT JOIN wiki_key_assignment x
            ON x.legacy_art = 'region' AND x.object_public_id = tp.public_id AND x.is_active
         WHERE a.is_active AND (${domain}::text IS NULL OR tp.map_domain_id = ${domain})
         ORDER BY tp.public_id
    `;
    return zeilen.map((zeile) => {
        const hatStand = zeile["hat_schnappschuss"] === true;
        const hoehe = typeof zeile["hoehe"] === "number" ? zeile["hoehe"] : null;
        const standHoehe = typeof zeile["s_hoehe"] === "number" ? zeile["s_hoehe"] : null;
        const stand = hatStand ? landschaftsStand(zeile) : null;
        stand?.set("height", standHoehe === null ? null : String(standHoehe));
        // Die Höhe: von Hand gesetzt (`manual`) gehört sie der Redaktion, jede andere folgt dem Wiki (auch ohne Vermerk). Ohne Gelände führt die Landmarke keine.
        const lokal = new Map<string, LokalerWert>();
        const fuehrtHoehe = formtGelaende(String(zeile["art"]));
        if (fuehrtHoehe)
            lokal.set(
                "height",
                hoehe === null
                    ? { zustand: "kein", wert: null, vermerk: "kein" }
                    : {
                          zustand: "text",
                          wert: String(hoehe),
                          vermerk: text(zeile["hoehe_origin"]) === "manual" ? "manual" : "wiki",
                      },
            );
        return objektAus({
            bereich: "gipfel",
            objektArt: "peak",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: adresseVon(zeile["adresse"], zeile["x2_adresse"]),
            zustand: zuweisungszustandAus(String(zeile["zustand"])),
            herkunft: text(zeile["herkunft"]),
            ...(fuehrtHoehe ? {} : { nichtGefuehrt: new Set(["height"]) }),
            lokal,
            schnappschuss: stand,
            // Kennt der Stand die Höhe noch nicht, ist der Wiki-Wert UNBEKANNT (kein Widerspruch zum Vermerk, keine Marke in der Datenbank: NULL ist sie).
            ...(hatStand && standHoehe === null ? { unbekannt: new Set(["height"]) } : {}),
        });
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Herrschaftsgebiete
// ----------------------------------------------------------------------------------------------------------------------------

async function ladeGebiete(db: Queryable, domain: string | null): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT t.public_id::text AS id, t.name, t.wiki_url AS adresse, t.wiki_key, (s.id IS NOT NULL) AS hat_schnappschuss,
               (d.id IS NOT NULL) AS hat_detail, d.state AS detail_zustand,
               d.founded_text AS d_founded_text, d.dissolved_text AS d_dissolved_text,
               d.form_of_government AS d_form_of_government, d.capital_name AS d_capital_name, d.seat_name AS d_seat_name,
               d.ruler AS d_ruler, d.language AS d_language, d.currency AS d_currency, d.population AS d_population,
               d.founder AS d_founder, d.trade_goods AS d_trade_goods, d.geographic AS d_geographic, d.blazon AS d_blazon,
               d.affiliation_raw AS d_affiliation_raw, d.continent AS d_continent,
               s.founded_text AS s_founded_text, s.dissolved_text AS s_dissolved_text,
               s.form_of_government AS s_form_of_government, s.capital_name AS s_capital_name, s.seat_name AS s_seat_name,
               s.ruler AS s_ruler, s.language AS s_language, s.currency AS s_currency, s.population AS s_population,
               s.founder AS s_founder, s.trade_goods AS s_trade_goods, s.geographic AS s_geographic, s.blazon AS s_blazon,
               s.affiliation_raw AS s_affiliation_raw, s.continent AS s_continent,
               (SELECT coalesce(jsonb_object_agg(o.field, o.origin), '{}'::jsonb)
                  FROM territory_detail_field_origin o WHERE o.territory_detail_id = d.id) AS herkunft,
               (SELECT coalesce(array_agg(u.field), '{}'::text[])
                  FROM wiki_territory_snapshot_unknown u WHERE u.snapshot_id = s.id) AS unbekannt
          FROM territory t
          LEFT JOIN territory_detail d ON d.territory_id = t.id AND d.is_active
          LEFT JOIN wiki_territory_snapshot s ON s.wiki_key = t.wiki_key AND s.is_active
         WHERE t.is_active AND (t.wiki_url IS NOT NULL OR t.wiki_key IS NOT NULL)
           AND (${domain}::text IS NULL OR t.map_domain_id = ${domain})
         ORDER BY t.public_id
    `;
    return zeilen.map((zeile) => {
        const herkunft = (zeile["herkunft"] ?? {}) as Record<string, string>;
        const lokal = new Map<string, LokalerWert>();
        const spalten: Record<string, string> = {};
        // Der Kontinent liest der Wiki-Teil (C-2) aus den Kategorien; die Infobox nennt ihn nicht (GEBIET_FELDER) – er gehört trotzdem zu den Feldern des Objekts.
        for (const feld of [...GEBIET_FELDER, "continent"]) {
            spalten[feld] = `s_${feld}`;
            const wert = text(zeile[`d_${feld}`]);
            // Im Gebiet ist `''` ein BEWUSSTER Leerwert (nur mit der Herkunft override), NULL kein Wert.
            lokal.set(
                feld,
                wert === null
                    ? { zustand: "kein", wert: null, vermerk: "kein" }
                    : { zustand: wert === "" ? "leer" : "text", wert, vermerk: vermerkAus(herkunft[feld]) },
            );
        }
        return objektAus({
            bereich: "gebiet",
            objektArt: "territory",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: text(zeile["adresse"]),
            // `territory_detail.state = suppressed` ist für den Editor reserviert: Eine unterdrückte Detailzeile gibt keinen Wert zur Übernahme frei.
            zustand:
                zeile["detail_zustand"] === "suppressed"
                    ? "unterdrueckt"
                    : text(zeile["wiki_key"])?.startsWith("wiki:") === true
                      ? "zugewiesen"
                      : "nur_adresse",
            herkunft: null,
            lokal,
            schnappschuss: zeile["hat_schnappschuss"] === true ? schnappschussAus(zeile, spalten) : null,
            unbekannt: new Set((zeile["unbekannt"] ?? []) as string[]),
        });
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Literatur
// ----------------------------------------------------------------------------------------------------------------------------

/**
 * Die Werke der Spielliteratur (`adventure`, WI-0253 Scheibe Literatur). Ein Werk ist kein Kartenobjekt; seine Zuordnung zum Wiki ist die gespeicherte Adresse
 * (`adventure.wiki_url`), verglichen wird wie überall nur über sie, nie über den Titel. `adventure.wiki_key` (die Kennung aus Legacys privatem Export) spielt keine Rolle.
 *
 * - **Felder:** Jedes Feld führt das Werk selbst, mit dem Vermerk je Feld aus `adventure_field_origin` (`wiki` | `manual`; kein Eintrag heißt: kein Vermerk).
 * - **Ein Werk ist sein eigener Wiki-Stand.** Avesmaps3D speichert keine Wiki-Werte eines Werks (WI-0254 §11, „Spätere Pakete“): Es gibt nichts hinter ↺, und die Übernahme
 *   schreibt die Spalten des Werks selbst. Damit Vorschau und Übernahme das Werk als eines MIT Stand behandeln (`hatWikiStand`), trägt es einen leeren Stand, dessen
 *   Werte alle unbekannt sind: Kein früherer Wiki-Wert wird behauptet. Eine Folge: Ein eigener oder unbelegter Wert, der vom Wiki abweicht, steht bei jedem Lauf im
 *   Bericht (ohne Stand lässt sich „das Wiki hat sich nicht bewegt“ nicht sagen).
 * - 🔴 **Ein Werk der Redaktion** (`source_system = 'editor'`, WI-0254: Importschutz auf Werksebene, „der Legacy-Zug und WikiSync fassen es nicht mehr an“): Jedes Feld gilt
 *   als eigene Entscheidung (Vermerk `manual`), gleich welchen Vermerk es trägt, ein leeres als bewusst leer.
 * - Ein unterdrücktes Werk (`state = 'suppressed'`) ist eine gesperrte Zuordnung; ein stillgelegtes (`retired`) wird nicht verglichen.
 * - **Die Ortsliste** (`adventure_place`, WI-0253 Scheibe Ortslisten): die aktiven Zeilen und die Tombstones (`suppressed`), je mit ihrer Herkunft (`ortsHerkunft`).
 */
async function ladeLiteratur(db: Queryable): Promise<PlanObjekt[]> {
    const orte = await ladeOrtslisten(db);
    const zeilen = await db<Zeile[]>`
        SELECT a.public_id::text AS id, a.title, a.product_type, a.edition, a.genre, a.complexity_gm, a.complexity_pl, a.authors, a.series,
               a.fshop_code, a.wiki_url AS adresse, a.state, a.source_system,
               (SELECT coalesce(jsonb_object_agg(o.field, o.origin), '{}'::jsonb)
                  FROM adventure_field_origin o WHERE o.adventure_id = a.id) AS herkunft
          FROM adventure a
         WHERE a.state IN ('active', 'suppressed')
         ORDER BY a.public_id
    `;
    return zeilen.map((zeile) => {
        const herkunft = (zeile["herkunft"] ?? {}) as Record<string, string>;
        const redaktion = zeile["source_system"] === "editor";
        const lokal = new Map<string, LokalerWert>();
        for (const feld of LITERATUR_FELDER) {
            const vermerk = redaktion ? "manual" : herkunft[feld];
            const wert = lokalerWert(text(zeile[feld]), vermerk);
            // Ein leeres Feld mit dem Vermerk `manual` ist bewusst leer (eine Entscheidung, `herkunft.ts` Zeile 3), kein „das Wiki darf füllen“.
            lokal.set(
                feld,
                wert.zustand === "kein" && vermerk === "manual"
                    ? { zustand: "leer", wert: "", vermerk: "manual" }
                    : wert,
            );
        }
        return objektAus({
            bereich: "literatur",
            objektArt: "work",
            id: String(zeile["id"]),
            name: String(zeile["title"]),
            adresse: text(zeile["adresse"]),
            zustand: zeile["state"] === "suppressed" ? "unterdrueckt" : "zugewiesen",
            herkunft: redaktion ? "editor" : null,
            lokal,
            schnappschuss: new Map(),
            unbekannt: new Set(LITERATUR_FELDER),
            ortsliste: { zeilen: orte.get(String(zeile["id"])) ?? [], redaktion },
        });
    });
}

/**
 * Wem eine Zeile der Ortsliste gehört: der Redaktion, wenn sie sie angelegt oder ihr Ziel gesetzt hat oder Legacy sie als eigene führte (`manual`); dem Wiki, wenn
 * Legacy sie aus dem Wiki hatte oder der WikiSync sie anlegte (`legacy_origin = 'wiki'`); sonst ist sie unbelegt (`unknown`: der öffentliche Katalog nennt keine Herkunft).
 */
export function ortsHerkunft(zeile: Readonly<Record<string, unknown>>): OrtsHerkunft {
    if (
        zeile["target_origin"] === "editor" ||
        zeile["legacy_origin"] === "manual" ||
        zeile["source_system"] === "editor"
    )
        return "manual";
    return zeile["legacy_origin"] === "wiki" ? "wiki" : "unbekannt";
}

/** Die Ortslisten aller Werke: aktive Zeilen und Tombstones, je Werk (`adventure.public_id`). */
async function ladeOrtslisten(db: Queryable): Promise<Map<string, OrtsZeile[]>> {
    const zeilen = await db<Zeile[]>`
        SELECT a.public_id::text AS werk, p.id::text AS id, p.sort_order, p.name_key, p.raw_name, p.role, p.state, p.legacy_origin, p.target_origin,
               p.source_system
          FROM adventure_place p
          JOIN adventure a ON a.id = p.adventure_id
         WHERE p.state IN ('active', 'suppressed') AND a.state IN ('active', 'suppressed')
         ORDER BY a.public_id, p.sort_order, p.export_ordinal, p.id
    `;
    const jeWerk = new Map<string, OrtsZeile[]>();
    for (const zeile of zeilen) {
        const liste = jeWerk.get(String(zeile["werk"])) ?? [];
        liste.push({
            id: String(zeile["id"]),
            stelle: Number(zeile["sort_order"]),
            schluessel: String(zeile["name_key"]),
            name: String(zeile["raw_name"]),
            rolle: String(zeile["role"]),
            zustand: zeile["state"] === "suppressed" ? "suppressed" : "active",
            herkunft: ortsHerkunft(zeile),
        });
        jeWerk.set(String(zeile["werk"]), liste);
    }
    return jeWerk;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Quellen
// ----------------------------------------------------------------------------------------------------------------------------

/** Die Bereiche, deren Objekte Träger von Quellen sind, und ihre Art im Fenster „Inhalte bearbeiten“ (`inhalte/traeger.ts`). Kraftlinien tragen keine Quellen (kein `powerline_source`). */
const QUELLEN_TRAEGER = [
    ["ort", "place"],
    ["weg", "path"],
    ["gebiet", "territory"],
    ["region", "area"],
    ["gipfel", "peak"],
] as const satisfies readonly (readonly [WikisyncBereich, InhalteTraegerArt])[];

/**
 * Wem eine Verknüpfung gehört: dem Wiki, wenn Legacy sie aus einer Publikation machte (`legacy_origin = 'wiki_publication'`); der Redaktion, wenn sie sie anlegte oder
 * änderte (`source_system = 'editor'`) oder Legacy sie als eigene führte (jede andere Herkunft); sonst ist sie unbelegt (`unbekannt`: Legacys Export E1+ fehlt, so stehen auf
 * der Stage alle).
 */
export function verknuepfungsHerkunft(zeile: Readonly<Record<string, unknown>>): QuellenHerkunft {
    if (zeile["source_system"] === "editor") return "manual";
    const herkunft = zeile["legacy_origin"];
    if (herkunft === "wiki_publication") return "wiki";
    return typeof herkunft === "string" ? "manual" : "unbekannt";
}

/**
 * Die Quellen im WikiSync (WI-0253, Scheibe Quellen): Katalogquellen (`feature_source`) und Träger mit Wiki-Zuordnung, beide als Objekte des Bereichs `quelle`.
 *
 * - **Träger:** dieselben Objekte mit derselben Adresse wie in den Bereichen Orte, Wege, Gebiete, Landschaften und Gipfel (die Lader dort; bei den Wegen nur die Hauptzuweisung), mit ihren
 *   Verknüpfungen zu Quellen aller Zustände. Sie tragen keine Felder und keinen Wiki-Stand: Verglichen werden ihre Publikationen.
 * - **Quellen:** jede Katalogquelle mit ihrem Titel (Vermerk `wiki`, außer die Redaktion hat die Stammdaten angelegt oder geändert: `source_system = 'editor'`, dann `manual`; Legacy
 *   überschrieb den Titel bei jedem Lauf) und mit allen ihren Verwendungen. Wie ein Werk ist die Quelle ihr eigener Wiki-Stand: Avesmaps3D speichert keinen Wiki-Titel (leerer Stand, Wert unbekannt).
 */
async function ladeQuellen(db: Queryable, _domain: string | null, lade: BereichsLader): Promise<PlanObjekt[]> {
    const traeger = new Map<string, PlanObjekt>();
    for (const [bereich, art] of QUELLEN_TRAEGER) {
        for (const objekt of await lade(bereich)) {
            if (objekt.hauptzuweisung) traeger.set(`${art}:${objekt.id}`, objekt);
        }
    }
    const jeTraeger = new Map<string, QuellenVerknuepfung[]>();
    const jeQuelle = new Map<string, QuellenVerknuepfung[]>();
    for (const art of Object.keys(TRAEGER) as InhalteTraegerArt[]) {
        const tafeln = TRAEGER[art];
        const zeilen = await db.unsafe<Zeile[]>(
            `SELECT c.public_id::text AS traeger, c.name AS traeger_name, f.public_id::text AS quelle_id, f.source_key, f.title,
                    l.reference_kind, l.pages, l.note, l.state, l.retired_origin, l.legacy_origin, l.source_system
               FROM ${tafeln.link} l
               JOIN ${tafeln.carrier} c ON c.id = l.${tafeln.foreignKey}
               JOIN feature_source f ON f.id = l.source_id
              ORDER BY c.public_id, l.position, l.id`,
        );
        for (const zeile of zeilen) {
            const id = String(zeile["traeger"]);
            const zustand = String(zeile["state"]);
            const verknuepfung: QuellenVerknuepfung = {
                traegerArt: art,
                traegerId: id,
                traegerName: String(zeile["traeger_name"]),
                traegerAdresse: traeger.get(`${art}:${id}`)?.adresse ?? null,
                quelle: String(zeile["source_key"]),
                quelleId: String(zeile["quelle_id"]),
                titel: String(zeile["title"]),
                art: text(zeile["reference_kind"]),
                seiten: text(zeile["pages"]),
                notiz: text(zeile["note"]),
                zustand: zustand === "suppressed" ? "suppressed" : zustand === "retired" ? "retired" : "active",
                vonRedaktionGeloest: zustand === "retired" && zeile["retired_origin"] === "editor",
                vonWikisyncGeloest: zustand === "retired" && zeile["retired_origin"] === "wikisync",
                vonImportGeloest: zustand === "retired" && zeile["retired_origin"] === "import",
                herkunft: verknuepfungsHerkunft(zeile),
            };
            jeTraeger.set(`${art}:${id}`, [...(jeTraeger.get(`${art}:${id}`) ?? []), verknuepfung]);
            jeQuelle.set(verknuepfung.quelleId, [...(jeQuelle.get(verknuepfung.quelleId) ?? []), verknuepfung]);
        }
    }

    const quellen = await db<Zeile[]>`
        SELECT public_id::text AS id, source_key, title, is_active, retired_origin, source_system FROM feature_source ORDER BY public_id
    `;
    const objekte: PlanObjekt[] = quellen.map((zeile) => {
        const redaktion = zeile["source_system"] === "editor";
        const titel = String(zeile["title"]);
        return {
            bereich: "quelle",
            objektArt: "source",
            id: String(zeile["id"]),
            name: titel,
            adresse: null,
            zustand: "zugewiesen",
            herkunft: redaktion ? "editor" : null,
            hauptzuweisung: true,
            lokal: new Map<string, LokalerWert>([
                ["title", { zustand: "text", wert: titel, vermerk: redaktion ? "manual" : "wiki" }],
            ]),
            schnappschuss: new Map(),
            schnappschussUnbekannt: new Set(["title"]),
            quelle: {
                art: "quelle",
                schluessel: String(zeile["source_key"]),
                aktiv: zeile["is_active"] === true,
                ...(zeile["is_active"] !== true && zeile["retired_origin"] === "wikisync"
                    ? { vonWikisyncStill: true }
                    : {}),
                redaktion,
                verwendungen: jeQuelle.get(String(zeile["id"])) ?? [],
            },
        };
    });
    for (const [schluessel, objekt] of traeger) {
        const art = schluessel.slice(0, schluessel.indexOf(":")) as InhalteTraegerArt;
        objekte.push({
            bereich: "quelle",
            objektArt: objekt.objektArt,
            id: objekt.id,
            name: objekt.name,
            adresse: objekt.adresse,
            zustand: objekt.zustand,
            herkunft: objekt.herkunft,
            hauptzuweisung: true,
            lokal: new Map(),
            schnappschuss: null,
            schnappschussUnbekannt: new Set(),
            quelle: { art: "traeger", traegerArt: art, verknuepfungen: jeTraeger.get(schluessel) ?? [] },
        });
    }
    objekte.push(...(await ladeVorkommenTraeger(db)));
    return objekte;
}

/**
 * Die Einträge der Vorkommen mit Wiki-Adresse als Träger von Zitaten (WI-0254 §12): `lore_entry` mit `wiki_url`, aktive und unterdrückte (die unterdrückten zählt der Plan nur). Sie tragen keine
 * Verknüpfungen für den Vergleich (`QuellenSicht` `vorkommen`): Die Quellen eines Eintrags (`lore_entry_source`) gehören Legacy-Zug und Redaktion, der Lauf legt dort nichts an, legt nichts still und ändert
 * nichts. Ein Eintrag ohne Adresse (die Redaktion legte ihn ohne Wiki-Artikel an) hat keinen Artikel und nichts zu zitieren.
 */
async function ladeVorkommenTraeger(db: Queryable): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT public_id::text AS id, name, wiki_url AS adresse, state
          FROM lore_entry
         WHERE state IN ('active', 'suppressed') AND wiki_url IS NOT NULL
         ORDER BY public_id
    `;
    return zeilen.map((zeile) => ({
        bereich: "quelle",
        objektArt: "lore",
        id: String(zeile["id"]),
        name: String(zeile["name"]),
        adresse: text(zeile["adresse"]),
        zustand: zeile["state"] === "suppressed" ? "unterdrueckt" : "zugewiesen",
        herkunft: null,
        hauptzuweisung: true,
        lokal: new Map(),
        schnappschuss: null,
        schnappschussUnbekannt: new Set(),
        quelle: { art: "vorkommen" },
    }));
}

// ----------------------------------------------------------------------------------------------------------------------------
// Vorkommen
// ----------------------------------------------------------------------------------------------------------------------------

/** Die Spalte im Wiki-Stand (`wiki_lore_snapshot`) zu einem Feld des Plans. */
export const VORKOMMEN_STAND_SPALTEN: Readonly<Record<string, string>> = {
    name: "name",
    gruppe: "gruppe",
    typ: "typ",
    lebensraum: "lebensraum",
    synonyme: "synonyme",
    continent: "continent",
    kurzbeschreibung: "kurzbeschreibung",
    roh_verbreitung: "verbreitung_roh",
    roh_herkunft: "herkunft_roh",
    roh_regionen: "regionen_roh",
    roh_vorkommen: "vorkommen_roh",
    liste: "liste",
};

/**
 * Die Vorkommen (`lore_entry`, WI-0253 Scheibe Vorkommen, §23): Waren, Fauna, Flora und Spezies. Wie ein Werk ist ein Eintrag kein Kartenobjekt; seine Zuordnung zum Wiki ist die gespeicherte
 * Adresse (`lore_entry.wiki_url`), verglichen wird nur über sie, nie über den Namen oder `wiki_key` (Legacys Slug). Ein Eintrag ohne Adresse (die Redaktion legte ihn ohne Wiki-Artikel an) wird nur gezählt.
 *
 * - **Felder:** Name, Gruppe, Typ, Lebensraum, Weitere Namen (`synonyme`) und Kontinent führt der Eintrag selbst, mit dem Vermerk je Feld aus `lore_entry_field_origin` (`wiki` | `manual`; kein Eintrag
 *   heißt: kein Vermerk, ein Wert ohne Vermerk ist unbelegt und ein Befund).
 * - **Der Wiki-Stand** (`wiki_lore_snapshot`, nur vom WikiSync geschrieben) trägt die Wiki-Werte dieser Felder und die Rohtexte der Infobox. Gibt es für einen Eintrag noch keinen, ist er leer mit lauter
 *   unbekannten Werten (`hatWikiStand`: Die Übernahme legt ihn an); `unbekannt` nennt die Felder, die der WikiSync noch nie gelesen hat.
 * - 🔴 **Ein Eintrag der Redaktion** (`source_system = 'editor'`, WI-0254: Importschutz auf Eintragsebene): Jedes Feld gilt als eigene Entscheidung (Vermerk `manual`), ein leeres als bewusst leer, und seine
 *   ganze Liste von Ortszeilen gehört ihr.
 * - Ein unterdrückter Eintrag (`state = 'suppressed'`) ist eine gesperrte Zuordnung; ein stillgelegter (`retired`, Legacy: das Wiki kenne den Artikel nicht mehr) wird nicht verglichen.
 * - **Die Ortszeilen** (`lore_place`): alle Zeilen in jedem Zustand mit Herkunft (`ortsHerkunft`) und Rolle.
 */
async function ladeVorkommen(db: Queryable): Promise<PlanObjekt[]> {
    const orte = await ladeLoreZeilen(db);
    const regeln = await ladeRegelBestand(db);
    const zeilen = await db<Zeile[]>`
        SELECT e.public_id::text AS id, e.wiki_key, e.kind, e.name, e.gruppe, e.typ, e.lebensraum, e.synonyme, e.continent, e.kurzbeschreibung, e.wiki_url AS adresse, e.state, e.source_system,
               (SELECT coalesce(jsonb_object_agg(o.field, o.origin), '{}'::jsonb)
                  FROM lore_entry_field_origin o WHERE o.lore_entry_id = e.id) AS herkunft,
               (s.id IS NOT NULL) AS hat_stand, s.unbekannt AS s_unbekannt,
               s.name AS s_name, s.gruppe AS s_gruppe, s.typ AS s_typ, s.lebensraum AS s_lebensraum, s.synonyme AS s_synonyme, s.continent AS s_continent,
               s.kurzbeschreibung AS s_kurzbeschreibung,
               s.verbreitung_roh AS s_roh_verbreitung, s.herkunft_roh AS s_roh_herkunft, s.regionen_roh AS s_roh_regionen, s.vorkommen_roh AS s_roh_vorkommen,
               s.liste AS s_liste
          FROM lore_entry e
          LEFT JOIN wiki_lore_snapshot s ON s.lore_entry_id = e.id
         WHERE e.state IN ('active', 'suppressed')
         ORDER BY e.public_id
    `;
    return zeilen.map((zeile) => {
        const herkunft = (zeile["herkunft"] ?? {}) as Record<string, string>;
        const redaktion = zeile["source_system"] === "editor";
        const lokal = new Map<string, LokalerWert>();
        for (const feld of VORKOMMEN_EIGENE_FELDER) {
            const vermerk = redaktion ? "manual" : herkunft[feld];
            const wert = lokalerWert(text(zeile[feld]), vermerk);
            // Ein leeres Feld mit dem Vermerk `manual` ist bewusst leer (eine Entscheidung, `herkunft.ts`), kein „das Wiki darf füllen“.
            lokal.set(
                feld,
                wert.zustand === "kein" && vermerk === "manual"
                    ? { zustand: "leer", wert: "", vermerk: "manual" }
                    : wert,
            );
        }
        const hatStand = zeile["hat_stand"] === true;
        const schnappschuss = new Map<string, string | null>();
        if (hatStand)
            for (const feld of VORKOMMEN_FELDER) schnappschuss.set(feld, leerZuNull(text(zeile[`s_${feld}`])));
        return objektAus({
            bereich: "vorkommen",
            objektArt: "lore",
            id: String(zeile["id"]),
            name: String(zeile["name"]),
            adresse: text(zeile["adresse"]),
            zustand: zeile["state"] === "suppressed" ? "unterdrueckt" : "zugewiesen",
            herkunft: redaktion ? "editor" : null,
            lokal,
            schnappschuss,
            unbekannt: new Set<string>(hatStand ? ((zeile["s_unbekannt"] ?? []) as string[]) : VORKOMMEN_FELDER),
            vorkommen: {
                art: String(zeile["kind"]),
                zeilen: orte.get(String(zeile["id"])) ?? [],
                redaktion,
                // Ein Eintrag der Redaktion ohne Wiki-Artikel hat keinen Schlüssel: Für ihn leitet der Abgleich keine Regeln ab.
                ...(zeile["wiki_key"] === null ? {} : { wikiKey: String(zeile["wiki_key"]) }),
                regeln: regeln.get(String(zeile["id"])) ?? [],
            },
        });
    });
}

/** Die Ortszeilen aller Einträge, je Eintrag (`lore_entry.public_id`): aktive, still gelegte und Tombstones. */
async function ladeLoreZeilen(db: Queryable): Promise<Map<string, LoreZeile[]>> {
    const zeilen = await db<Zeile[]>`
        SELECT e.public_id::text AS eintrag, p.id::text AS id, p.place_wiki_key, p.place_title, p.relation, p.sort_order, p.state, p.retired_origin,
               p.legacy_origin, p.target_origin, p.source_system, p.role
          FROM lore_place p
          JOIN lore_entry e ON e.id = p.lore_entry_id
         WHERE e.state IN ('active', 'suppressed')
         ORDER BY e.public_id, p.sort_order, p.id
    `;
    const jeEintrag = new Map<string, LoreZeile[]>();
    for (const zeile of zeilen) {
        const liste = jeEintrag.get(String(zeile["eintrag"])) ?? [];
        liste.push({
            id: String(zeile["id"]),
            schluessel: text(zeile["place_wiki_key"]),
            titel: text(zeile["place_title"]),
            beziehung: String(zeile["relation"]),
            stelle: Number(zeile["sort_order"]),
            zustand:
                zeile["state"] === "suppressed" ? "suppressed" : zeile["state"] === "retired" ? "retired" : "active",
            stillVon: text(zeile["retired_origin"]),
            herkunft: ortsHerkunft(zeile),
            rolle: gueltigeRolle(text(zeile["role"])),
        });
        jeEintrag.set(String(zeile["eintrag"]), liste);
    }
    return jeEintrag;
}

/**
 * Die Landschaften der Karte mit Wiki-Adresse, als kleingeschriebene Titel: Das Ziel eines Links ist eine Fläche der Karte, wenn sein Artikel hier steht (`abgleich/ortsrolle.ts`). Aufgelöst wird
 * dabei nie über einen Namen, nur über die gespeicherte Adresse.
 */
export async function ladeFlaechenTitel(db: Queryable): Promise<Set<string>> {
    const zeilen = await db<
        { adresse: string }[]
    >`SELECT wiki_url AS adresse FROM region WHERE is_active AND wiki_url IS NOT NULL`;
    const titel = new Set<string>();
    for (const { adresse } of zeilen) {
        const eins = titelAusWikiAdresse(adresse);
        if (eins !== null) titel.add(eins.replaceAll("_", " ").trim().toLowerCase());
    }
    return titel;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Sprachen
// ----------------------------------------------------------------------------------------------------------------------------

/**
 * Die Sprachartikel (`wiki_sprache_artikel`, WI-0261 S3): ALLE Zeilen, aktive und still gelegte (der WikiSync legt still und belebt selbst; eine still gelegte Zeile hält den Schlüssel, ein
 * zurückgekehrter Artikel lebt in ihr wieder auf). Der Sprachartikel IST sein Wiki-Stand: Jedes Feld führt er selbst, und jedes folgt dem Wiki (Vermerk `wiki`); der Schnappschuss ist derselbe
 * Stand (`hatWikiStand`). Der Lebenslauf steht im Feld `artikel`: der Titel, solange die Zeile aktiv ist, sonst kein Wert. Die Adresse wird aus dem Titel gebildet (`spracheAdresse`), damit der
 * Durchgang des Dumps die Seite auch als Weiterleitung findet (Grund des Stilllegens). Die Zuordnung zu einer Sprache (`sprache_wiki`) liest der Abgleich nicht: Er schreibt sie nie (O6).
 */
async function ladeSprachartikel(db: Queryable): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT a.public_id::text AS id, a.schluessel, a.titel, a.is_active, a.unbekannt,
               a.name, a.sprachfamilie, a.vorstufen, a.schrift, a.sprecheranzahl, a.offizielle_sprache, a.weitere_verbreitung, a.kurzbeschreibung,
               a.vorstufen_roh, a.schrift_roh, a.offizielle_sprache_roh, a.weitere_verbreitung_roh, a.navigation
          FROM wiki_sprache_artikel a
         ORDER BY a.public_id
    `;
    return zeilen.map(sprachartikelObjekt);
}

/**
 * Ein Sprachartikel als Objekt des Abgleichs, aus seiner Zeile (Spalten wie in `wiki_sprache_artikel`, `id` = `public_id`). REIN; der Lader und die Tests des Plans teilen sie.
 */
export function sprachartikelObjekt(zeile: Readonly<Record<string, unknown>>): PlanObjekt {
    const aktiv = zeile["is_active"] === true;
    const titel = String(zeile["titel"]);
    const unbekannt = new Set<string>((zeile["unbekannt"] ?? []) as string[]);
    const lokal = new Map<string, LokalerWert>();
    const schnappschuss = new Map<string, string | null>();
    for (const feld of SPRACHE_FELDER) {
        const spalte = SPRACHE_SPALTEN[feld] as string;
        const wert =
            feld === "navigation" ? navigationWert((zeile[spalte] ?? []) as string[]) : leerZuNull(text(zeile[spalte]));
        // Ein Wert, den der WikiSync noch nie geschrieben hat, ist unbekannt (`schnappschussUnbekannt`), nie ein eigener.
        const bekannt = unbekannt.has(feld) ? null : wert;
        lokal.set(feld, lokalerWert(bekannt, "wiki"));
        schnappschuss.set(feld, bekannt);
    }
    lokal.set(ARTIKEL_FELD, lokalerWert(aktiv ? titel : null, "wiki"));
    schnappschuss.set(ARTIKEL_FELD, aktiv ? titel : null);
    return objektAus({
        bereich: "sprachen",
        objektArt: SPRACHE_ARTIKEL_ART,
        id: String(zeile["id"]),
        name: titel,
        adresse: spracheAdresse(titel),
        zustand: "zugewiesen",
        herkunft: null,
        lokal,
        schnappschuss,
        unbekannt,
        sprache: { schluessel: String(zeile["schluessel"]), aktiv },
    });
}

// ----------------------------------------------------------------------------------------------------------------------------
// Landmarken (WI-0271 L7)
// ----------------------------------------------------------------------------------------------------------------------------

export async function ladeLandmarkenArtikel(db: Queryable): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT a.public_id::text AS id, a.schluessel, a.titel, a.is_active, a.unbekannt,
               a.name, a.art, a.wiki_art, a.region, a.hoehe_schritt::text AS hoehe_schritt, a.kurzbeschreibung
          FROM wiki_landmarke_artikel a
         ORDER BY a.public_id
    `;
    return zeilen.map(landmarkenArtikelObjekt);
}

/** Ein Landmarken-Artikel als Objekt des Abgleichs, aus seiner Zeile (Spalten wie in `wiki_landmarke_artikel`, `id` = `public_id`). REIN; der Lader und die Tests des Plans teilen sie. */
export function landmarkenArtikelObjekt(zeile: Readonly<Record<string, unknown>>): PlanObjekt {
    const aktiv = zeile["is_active"] === true;
    const titel = String(zeile["titel"]);
    const unbekannt = new Set<string>((zeile["unbekannt"] ?? []) as string[]);
    const lokal = new Map<string, LokalerWert>();
    const schnappschuss = new Map<string, string | null>();
    for (const feld of LANDMARKE_FELDER) {
        const wert = leerZuNull(text(zeile[LANDMARKE_SPALTEN[feld] as string]));
        // Ein Wert, den der WikiSync noch nie geschrieben hat, ist unbekannt (`schnappschussUnbekannt`), nie ein eigener.
        const bekannt = unbekannt.has(feld) ? null : wert;
        lokal.set(feld, lokalerWert(bekannt, "wiki"));
        schnappschuss.set(feld, bekannt);
    }
    lokal.set(ARTIKEL_FELD, lokalerWert(aktiv ? titel : null, "wiki"));
    schnappschuss.set(ARTIKEL_FELD, aktiv ? titel : null);
    return objektAus({
        bereich: "gipfel",
        objektArt: LANDMARKE_ARTIKEL_ART,
        id: String(zeile["id"]),
        name: titel,
        adresse: landmarkeAdresse(titel),
        zustand: "zugewiesen",
        herkunft: null,
        lokal,
        schnappschuss,
        unbekannt,
        landmarke: { schluessel: String(zeile["schluessel"]), aktiv },
    });
}

/**
 * Die Wiki-Einträge ohne Fläche (WI-0284): alle Zeilen in `wiki_region_snapshot`, deren Artikel an keiner aktiven Fläche und keinem Gipfel hängt (`ladeBelegteRegionArtikel`), auch die still gelegten (sie können
 * wieder aufleben). Eine Zeile, die an einer Fläche hängt, ist deren Wiki-Stand und gehört nicht hierher.
 */
export async function ladeRegionArtikel(db: Queryable): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT s.public_id::text AS id, s.wiki_key, s.wiki_url, s.is_active, s.name AS s_name, s.art AS s_art, s.region_parent, s.affiliation_staat, s.einwohner,
               s.sprache, s.vegetation, s.verkehrswege, s.description AS s_description,
               (SELECT coalesce(jsonb_object_agg(n.direction, n.namen), '{}'::jsonb)
                  FROM (SELECT direction, string_agg(name, ', ' ORDER BY position) AS namen
                          FROM wiki_region_snapshot_neighbor WHERE snapshot_id = s.id GROUP BY direction) n) AS nachbarn
          FROM wiki_region_snapshot s
         ORDER BY s.public_id
    `;
    const belegt = await ladeBelegteRegionArtikel(db);
    return zeilen.map(regionArtikelObjekt).filter((objekt) => !belegt.has(objekt.regionArtikel!.schluessel));
}

/** Ein Wiki-Eintrag ohne Fläche als Objekt des Abgleichs, aus seiner Zeile. REIN; der Lader und die Tests des Plans teilen sie. */
export function regionArtikelObjekt(zeile: Readonly<Record<string, unknown>>): PlanObjekt {
    const aktiv = zeile["is_active"] === true;
    const adresse = String(zeile["wiki_url"]);
    const titel = titelAusWikiAdresse(adresse) ?? text(zeile["s_name"]) ?? String(zeile["wiki_key"]);
    const schnappschuss = landschaftsStand(zeile as Zeile);
    const lokal = new Map<string, LokalerWert>();
    for (const [feld, wert] of schnappschuss) lokal.set(feld, lokalerWert(wert, "wiki"));
    lokal.set(ARTIKEL_FELD, lokalerWert(aktiv ? titel : null, "wiki"));
    schnappschuss.set(ARTIKEL_FELD, aktiv ? titel : null);
    return objektAus({
        bereich: "region",
        objektArt: REGION_ARTIKEL_ART,
        id: String(zeile["id"]),
        name: titel,
        adresse,
        zustand: "zugewiesen",
        herkunft: null,
        lokal,
        schnappschuss,
        regionArtikel: { schluessel: landmarkeSchluessel(titel), aktiv },
    });
}

/**
 * Die Schlüssel (`landmarkeSchluessel`) der Artikel, die an einer aktiven Fläche oder an einem Gipfel der Karte hängen, über die Adresse, den Schlüssel der Fläche oder die Tafel X2: Sie sind keine Wiki-Einträge ohne
 * Fläche. Eine entfernte Fläche gibt ihren Artikel frei: Er steht dann wieder in der Liste. Ein Gipfel behält seinen, auch stillgelegt (WI-0271 §4.2 Tombstones).
 */
export async function ladeBelegteRegionArtikel(db: Queryable): Promise<Set<string>> {
    const zeilen = await db<{ adresse: string }[]>`
        SELECT r.wiki_url AS adresse FROM region r WHERE r.is_active AND r.wiki_url IS NOT NULL
        UNION ALL
        SELECT s.wiki_url FROM wiki_region_snapshot s JOIN region r ON r.wiki_region_key = s.wiki_key AND r.is_active
        UNION ALL
        SELECT x.wiki_url FROM wiki_key_assignment x JOIN region r ON r.public_id = x.object_public_id AND r.is_active
         WHERE x.legacy_art = 'landschaft' AND x.is_active AND x.wiki_url IS NOT NULL
        UNION ALL
        SELECT a.wiki_url FROM terrain_peak_wiki_assignment a WHERE a.wiki_url IS NOT NULL
        UNION ALL
        SELECT s.wiki_url FROM terrain_peak_wiki_assignment a JOIN wiki_region_snapshot s ON s.id = a.snapshot_id
    `;
    const belegt = new Set<string>();
    for (const { adresse } of zeilen) {
        const titel = titelAusWikiAdresse(adresse);
        if (titel !== null) belegt.add(landmarkeSchluessel(titel));
    }
    return belegt;
}

/**
 * Die Schlüssel (`landmarkeSchluessel`) der Artikel, die an einer Landmarke der Karte hängen: jede Zuordnung von `terrain_peak` mit Adresse, auch die einer stillgelegten Landmarke (§4.2
 * Tombstones: ihr Artikel kommt nicht wieder), dazu die Gipfel-Zeilen der Tafel X2 (`legacy_art = 'region'`, wie `ladeGipfel`). Kein Kandidat entsteht für sie.
 */
export async function ladeLandmarkenAufDerKarte(db: Queryable): Promise<Set<string>> {
    const zeilen = await db<{ adresse: string }[]>`
        SELECT a.wiki_url AS adresse FROM terrain_peak_wiki_assignment a WHERE a.wiki_url IS NOT NULL
        UNION ALL
        SELECT x.wiki_url FROM wiki_key_assignment x JOIN terrain_peak tp ON tp.public_id = x.object_public_id
         WHERE x.legacy_art = 'region' AND x.wiki_url IS NOT NULL
    `;
    const schluessel = new Set<string>();
    for (const { adresse } of zeilen) {
        const titel = titelAusWikiAdresse(adresse);
        if (titel !== null) schluessel.add(landmarkeSchluessel(titel));
    }
    return schluessel;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Orts- und Bauwerk-Artikel ohne Ort (WI-0295)
// ----------------------------------------------------------------------------------------------------------------------------

/**
 * Die Orts-Artikel des WikiSync: alle Zeilen der Registry mit `source_system = 'wikisync'`, aktive und still gelegte (sie können wieder aufleben), mit ihren genannten Orten und ihrem Wiki-Stand (dieselbe Seite in
 * `wiki_settlement_snapshot`, ebenfalls vom WikiSync). Legacys Zeilen nie. Ausgenommen ist eine Zeile, deren Artikel an einem Objekt der Karte hängt: ihr Wiki-Stand an einem Ort (`place_wiki_assignment`) oder ihr
 * Key in der Tafel X2 an einem aktiven Ort, einem Ort ohne Lage oder einer Landmarke. Dann gehört der Artikel dem Abgleich der Orte, und die Zeile bleibt, wie sie ist.
 */
export async function ladeOrtArtikel(db: Queryable): Promise<PlanObjekt[]> {
    const zeilen = await db<Zeile[]>`
        SELECT r.public_id::text AS id, r.wiki_key, r.title, r.wiki_url, r.is_active, r.settlement_class AS r_settlement_class, r.building_type, r.is_ruined, r.lage, r.standort,
               (SELECT string_agg(CASE WHEN n.target_key IS NULL THEN n.target_raw ELSE n.target_raw || ' → ' || n.target_key END, E'\n' ORDER BY n.position)
                  FROM wiki_settlement_registry_named_place n WHERE n.registry_id = r.id) AS standort_orte,
               (s.id IS NOT NULL) AS hat_stand, s.wiki_name, s.settlement_class AS s_settlement_class, s.einwohner, s.oberhaupt, s.region_text, s.staat_text,
               s.handelszone, s.verkehrswege, s.bevoelkerung, s.tempel, s.description
          FROM wiki_settlement_registry r
          LEFT JOIN wiki_settlement_snapshot s ON s.wiki_key = substr(r.wiki_key, 6) AND s.source_system = 'wikisync'
         WHERE r.source_system = 'wikisync'
           AND NOT EXISTS (SELECT 1 FROM place_wiki_assignment a WHERE s.id IS NOT NULL AND a.snapshot_id = s.id AND a.is_active)
           AND NOT EXISTS (
               SELECT 1 FROM wiki_key_assignment x
                WHERE x.is_active AND x.wiki_key = r.wiki_key
                  AND (EXISTS (SELECT 1 FROM place p WHERE p.public_id = x.object_public_id AND p.is_active)
                       OR EXISTS (SELECT 1 FROM place_unplaced u WHERE u.public_id = x.object_public_id AND u.is_active)
                       OR EXISTS (SELECT 1 FROM terrain_peak tp WHERE tp.public_id = x.object_public_id AND tp.is_active))
           )
         ORDER BY r.public_id
    `;
    return zeilen.map(ortArtikelObjekt);
}

/**
 * Ein Orts-Artikel als Objekt des Abgleichs, aus seiner Zeile (Spalten wie in `ladeOrtArtikel`). REIN; der Lader und die Tests des Plans teilen sie. Die Zeile IST ihr Wiki-Stand: Jedes Feld folgt dem Wiki (Vermerk
 * `wiki`). Die Ortsklasse steht im Wiki-Stand nur, wo sie bekannt ist; „dorf“ in der Registry ohne Klasse im Wiki-Stand ist geraten und gilt als kein Wert.
 */
export function ortArtikelObjekt(zeile: Readonly<Record<string, unknown>>): PlanObjekt {
    const aktiv = zeile["is_active"] === true;
    const titel = String(zeile["title"]);
    const hatStand = zeile["hat_stand"] === true;
    const registryKlasse = leerZuNull(text(zeile["r_settlement_class"]));
    const werte: Record<string, string | null> = {
        name: text(zeile["wiki_name"]),
        settlement_class: hatStand
            ? text(zeile["s_settlement_class"])
            : registryKlasse === "dorf"
              ? null
              : registryKlasse,
        building_type: text(zeile["building_type"]),
        lage: text(zeile["lage"]),
        standort: text(zeile["standort"]),
        standort_orte: text(zeile["standort_orte"]),
        ruine: zeile["is_ruined"] === true ? "ja" : null,
        einwohner: text(zeile["einwohner"]),
        oberhaupt: text(zeile["oberhaupt"]),
        region_text: text(zeile["region_text"]),
        staat_text: text(zeile["staat_text"]),
        handelszone: text(zeile["handelszone"]),
        verkehrswege: text(zeile["verkehrswege"]),
        bevoelkerung: text(zeile["bevoelkerung"]),
        tempel: text(zeile["tempel"]),
        description: text(zeile["description"]),
    };
    const lokal = new Map<string, LokalerWert>();
    const schnappschuss = new Map<string, string | null>();
    for (const feld of ORT_ARTIKEL_FELDER) {
        const wert = leerZuNull(werte[feld] ?? null);
        lokal.set(feld, lokalerWert(wert, "wiki"));
        schnappschuss.set(feld, wert);
    }
    lokal.set(ARTIKEL_FELD, lokalerWert(aktiv ? titel : null, "wiki"));
    schnappschuss.set(ARTIKEL_FELD, aktiv ? titel : null);
    return objektAus({
        bereich: "ort",
        objektArt: ORT_ARTIKEL_ART,
        id: String(zeile["id"]),
        name: titel,
        adresse: text(zeile["wiki_url"]) ?? landmarkeAdresse(titel),
        zustand: "zugewiesen",
        herkunft: null,
        lokal,
        schnappschuss,
        ortArtikel: { schluessel: String(zeile["wiki_key"]), aktiv },
    });
}

/**
 * Die Schlüssel (`ortArtikelSchluessel`, Legacys Key der Registry) der Artikel, die die Karte oder Legacys Registry schon kennt: alle Adressen der Zuordnungen (wie `ladeBekannteTitel`), die Keys der Tafel X2, Legacys
 * Zeilen der Registry (auch still gelegte: Ihr Key ist vergeben) samt Titel, und Legacys Wiki-Stände der Orte. Sie werden kein Orts-Artikel; ein vorhandener wird still gelegt. Die Zeilen des WikiSync selbst
 * zählen nicht, sonst legte jeder Lauf seine eigenen still.
 */
export async function ladeBekannteOrtArtikel(db: Queryable): Promise<Set<string>> {
    const adressen = await db<{ adresse: string }[]>`
        SELECT wiki_url AS adresse FROM place_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM path_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM powerline_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM terrain_peak_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM territory WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM wiki_key_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM wiki_settlement_registry WHERE source_system <> 'wikisync' AND wiki_url IS NOT NULL
    `;
    const bekannt = new Set<string>();
    for (const { adresse } of adressen) {
        const titel = titelAusWikiAdresse(adresse);
        if (titel !== null) bekannt.add(ortArtikelSchluessel(titel));
    }
    const schluessel = await db<{ schluessel: string }[]>`
        SELECT wiki_key AS schluessel FROM wiki_key_assignment WHERE is_active
        UNION SELECT wiki_key FROM wiki_settlement_registry WHERE source_system <> 'wikisync'
        UNION SELECT 'wiki:' || wiki_key FROM wiki_settlement_snapshot WHERE source_system <> 'wikisync'
    `;
    for (const zeile of schluessel) bekannt.add(zeile.schluessel);
    const titel = await db<
        { titel: string }[]
    >`SELECT title AS titel FROM wiki_settlement_registry WHERE source_system <> 'wikisync'`;
    for (const zeile of titel) bekannt.add(ortArtikelSchluessel(zeile.titel));
    bekannt.delete("");
    return bekannt;
}

// ----------------------------------------------------------------------------------------------------------------------------
// Alle Bereiche
// ----------------------------------------------------------------------------------------------------------------------------

/** Die Zuordnungen der Tafel X2 ohne gültige Wiki-Adresse, deren Objekt die Abfrage des Bereichs nicht gefunden hat: Eigenkennungen, die nur gezählt werden. */
async function ladeEigenkennungenAusX2(
    db: Queryable,
    bereiche: readonly WikisyncBereich[],
    geladen: ReadonlyMap<WikisyncBereich, ReadonlySet<string>>,
): Promise<PlanObjekt[]> {
    // Legacys Art -> Bereich. `region` (eine Beschriftung) bleibt außen: Sie gehört weder der Landschaft noch dem Gipfel allein.
    const bereichJeArt: Readonly<Record<string, WikisyncBereich>> = {
        siedlung: "ort",
        weg: "weg",
        gebiet: "gebiet",
        landschaft: "region",
        kraftlinie: "kraftlinie",
    };
    const zeilen = await db<Zeile[]>`
        SELECT legacy_art, object_public_id::text AS id, wiki_url, coalesce(wiki_title, wiki_key) AS name
          FROM wiki_key_assignment
         WHERE is_active AND legacy_art = ANY(${Object.keys(bereichJeArt)}::text[])
         ORDER BY legacy_art, object_public_id
    `;
    const extras: PlanObjekt[] = [];
    for (const zeile of zeilen) {
        const bereich = bereichJeArt[String(zeile["legacy_art"])];
        const id = String(zeile["id"]);
        if (bereich === undefined || !bereiche.includes(bereich)) continue;
        if (geladen.get(bereich)?.has(id) === true) continue;
        // Eine gültige Adresse gehört in die Abfrage des Bereichs; hier geht es nur um die, die keine hat.
        if (titelAusWikiAdresse(text(zeile["wiki_url"])) !== null) continue;
        extras.push(
            objektAus({
                bereich,
                objektArt:
                    bereich === "ort"
                        ? "place"
                        : bereich === "weg"
                          ? "path"
                          : bereich === "gebiet"
                            ? "territory"
                            : bereich === "region"
                              ? "region"
                              : "powerline",
                id,
                name: String(zeile["name"]),
                adresse: text(zeile["wiki_url"]),
                zustand: "zugewiesen",
                herkunft: null,
                lokal: new Map(),
                schnappschuss: null,
            }),
        );
    }
    return extras;
}

/** Lädt die Objekte eines Bereichs; ein Bereich, den der Aufruf schon geladen hat, kommt aus dem Speicher (die Quellen brauchen die Träger der fünf Bereiche). */
type BereichsLader = (bereich: WikisyncBereich) => Promise<PlanObjekt[]>;

const LADER: Readonly<
    Record<WikisyncBereich, (db: Queryable, domain: string | null, lade: BereichsLader) => Promise<PlanObjekt[]>>
> = {
    ort: ladeOrte,
    weg: ladeWege,
    gebiet: ladeGebiete,
    region: ladeLandschaften,
    gipfel: ladeGipfel,
    kraftlinie: ladeKraftlinien,
    // Werke gehören keiner Kartendomäne: Die Einschränkung auf eine Domäne gilt für sie nicht.
    literatur: (db) => ladeLiteratur(db),
    quelle: ladeQuellen,
    // Einträge gehören keiner Kartendomäne.
    vorkommen: (db) => ladeVorkommen(db),
    // Sprachartikel gehören keiner Kartendomäne.
    sprachen: (db) => ladeSprachartikel(db),
};

/**
 * Die Objekte für den Plan eines Laufs: die der Bereiche und, mit den Landmarken (`gipfel`), die Kandidaten ohne Landmarke auf der Karte (WI-0271). Nur Plan und Übernahme kennen die Kandidaten: Für jeden anderen Leser
 * des Bereichs (Wiki-Box, Kategorien, Vergleich eines Artikels) sind `gipfel` die Landmarken der Karte.
 */
export async function ladeObjekteDesLaufs(db: Queryable, bereiche: readonly WikisyncBereich[]): Promise<PlanObjekt[]> {
    const objekte = await ladeObjekte(db, bereiche);
    return [
        ...objekte,
        ...(bereiche.includes("gipfel") ? await ladeLandmarkenArtikel(db) : []),
        ...(bereiche.includes("region") ? await ladeRegionArtikel(db) : []),
        ...(bereiche.includes("ort") ? await ladeOrtArtikel(db) : []),
    ];
}

/** Alle Objekte der genannten Bereiche; `domain` schränkt auf eine Kartendomäne ein (`null`: alle). */
export async function ladeObjekte(
    db: Queryable,
    bereiche: readonly WikisyncBereich[],
    domain: string | null = null,
): Promise<PlanObjekt[]> {
    const objekte: PlanObjekt[] = [];
    const geladen = new Map<WikisyncBereich, Set<string>>();
    const schon = new Map<WikisyncBereich, Promise<PlanObjekt[]>>();
    const lade: BereichsLader = (bereich) => {
        const da = schon.get(bereich);
        if (da !== undefined) return da;
        const neu = LADER[bereich](db, domain, lade);
        schon.set(bereich, neu);
        return neu;
    };
    for (const bereich of bereiche) {
        const liste = await lade(bereich);
        objekte.push(...liste);
        geladen.set(bereich, new Set(liste.map((objekt) => objekt.id)));
    }
    objekte.push(...(await ladeEigenkennungenAusX2(db, bereiche, geladen)));
    return objekte;
}

/**
 * Alle Titel, die die Karte oder die Registry kennt (Adressen aller Zuordnungen, Titel der Registry), für den Befund „neuer Artikel“. Immer von ALLEN Bereichen,
 * auch wenn der Lauf nur einen rechnet: Ein Artikel, den ein anderer Bereich schon trägt, ist nicht neu.
 */
export async function ladeBekannteTitel(db: Queryable): Promise<Set<string>> {
    const adressen = await db<{ adresse: string }[]>`
        SELECT wiki_url AS adresse FROM place_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM path_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM powerline_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM terrain_peak_wiki_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM territory WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM wiki_key_assignment WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM wiki_settlement_registry WHERE is_active AND wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM adventure WHERE wiki_url IS NOT NULL
        UNION ALL SELECT wiki_url FROM lore_entry WHERE wiki_url IS NOT NULL
    `;
    const bekannt = new Set<string>();
    for (const { adresse } of adressen) {
        const titel = titelAusWikiAdresse(adresse);
        if (titel !== null) bekannt.add(bekannterTitelSchluessel(titel));
    }
    const titel = await db<{ titel: string }[]>`SELECT title AS titel FROM wiki_settlement_registry WHERE is_active`;
    for (const zeile of titel) bekannt.add(bekannterTitelSchluessel(zeile.titel));
    // Die Sprachartikel (WI-0261 S3) führen keine Adresse, nur ihren Titel.
    const sprachen = await db<{ titel: string }[]>`SELECT titel FROM wiki_sprache_artikel WHERE is_active`;
    for (const zeile of sprachen) bekannt.add(bekannterTitelSchluessel(zeile.titel));
    // Die Landmarken-Artikel (WI-0271 L7) ebenso: Ein Kandidat ist für die übrigen Bereiche kein neuer Artikel mehr.
    const landmarken = await db<{ titel: string }[]>`SELECT titel FROM wiki_landmarke_artikel WHERE is_active`;
    for (const zeile of landmarken) bekannt.add(bekannterTitelSchluessel(zeile.titel));
    // Die Wiki-Einträge ohne Fläche (WI-0284) ebenso, über ihre Adresse.
    const eintraege = await db<
        { adresse: string }[]
    >`SELECT wiki_url AS adresse FROM wiki_region_snapshot WHERE is_active`;
    for (const { adresse } of eintraege) {
        const eintrag = titelAusWikiAdresse(adresse);
        if (eintrag !== null) bekannt.add(bekannterTitelSchluessel(eintrag));
    }
    return bekannt;
}
