import type { Queryable } from "../../database.ts";
import type { Flaeche, Punkt, Ring, Teilflaeche } from "./geometrie.ts";

/**
 * Die Daten des SVG-Abzugs (WI-0280 K2): alles, was der reine Bauer (`bauer.ts`) braucht, aus der Datenbank, mit NUR `SELECT`.
 *
 * 🔴 LIEST NUR. Kartendaten werden hier nie geschrieben (Map Mutation Guard); jede Abfrage ist eine Auswahl, und
 * `karten-svg-daten.test.ts` hält das für jede Zeile fest, die der Lader schickt. Es gibt keine Temp-Tabelle und keine Sitzungsvariable.
 *
 * 🔴 DIESELBE SICHTBARKEIT WIE DIE KARTE. Aus den Renderansichten (`place_render`, `path_render`, `region_area_render`,
 * `powerline_render`, `terrain_peak_render`, `map_label_render`, `territory_fill_render`) stammen die Filter, nicht die Geometrie: Jene
 * liefern Renderkoordinaten (EPSG:3857, ADR-0003), der Abzug braucht Kartenkoordinaten (`aventuria-v1`), und eine Rückrechnung
 * brächte Rauschen in jede Zahl. Also dieselben Tabellen, dieselben Bedingungen, Geometrie unverändert:
 *   Orte          `is_active AND NOT is_hidden` (verborgene Orte zeichnet nur der Editor, `place-layers.ts`)
 *   Wege          `is_active`; die Seewege nicht (`WEGARTEN_VERBORGEN`: Die Karte zeigt keine, Betreiber 2026-09-27)
 *   Flächen       `region_area.is_active AND region.is_active AND NOT region.is_hidden`
 *   Kraftlinien   `is_active`, die gezeichnete Bahn (`drawn_geom`), nicht die Sehne
 *   Landmarken    `is_active AND show_name`, nicht „verborgen“ und nicht „nur Gelände“ (steht auf keiner Karte)
 *   Beschriftung  `map_label`: `is_active`, Name nicht abgeschaltet, Landschaft nicht verborgen
 *   Gebiete       `territory_shape` im höchsten abgeleiteten Band, `territory.is_active`; ohne Ableitung keine Gebiete
 *                 (die Karte zeigt dann auch keine: `routes/territories.ts`, 404 `no_territories`)
 *
 * 🔴 Die Wege sind die ROHE Geometrie (`path.geom`), nicht `path_visual`. `path_visual` ist die Catmull-Rom-Kurve als Punktwolke aus
 * acht Abtastungen je Segment (`LEGACY_CATMULL`); der Bauer schreibt dieselbe Kurve exakt als Bézier (`geometrie.ts`). Die rohe
 * Fassung trägt die Stützpunkte, wie sie in den Daten stehen, und das ist ihre Zusage.
 *
 * 🔴 DIE STÄNDE. Legacy stempelt `avm:kartenfassung` (`revision` von `map-features.php`) und `avm:landschaftsfassung` (`revision` von
 * `ecosystem-areas.php`). Avesmaps3D hat keinen solchen Zähler je Endpunkt; genommen ist, was die Karte selbst als ihren Stand führt:
 *   kartenfassung      größte `map_operation.seq` der Domäne (jede Editor-Operation an der Karte; dieselbe Zahl geht in die Revision der
 *                      Objektantworten ein, `subjects/revision.ts`), „0“ solange kein Editor etwas geändert hat
 *   landschaftsfassung größte `map_operation.seq` einer Operation, die eine Landschaft, eine Teilfläche oder einen Namen berührt hat
 *   importstand        Zeit des jüngsten abgeschlossenen Imports der Kartendomänen (Orte, Wege, Landschaften, Kraftlinien, Gebiete,
 *                      Gelände), UTC. ZUSATZ gegenüber Legacy: Ein Import schreibt keine `map_operation`, die Fassungen allein sähen ihn nicht.
 * Wer prüfen will, ob sich die Karte seit einem Abzug geändert hat, vergleicht alle drei.
 *
 * ⚠️ Mehrere Abfragen sind kein Schnappschuss. Wer sie gegen eine laufende Datenbank stellt, ruft den Lader in einer Transaktion
 * `REPEATABLE READ, READ ONLY` auf; sonst kann ein Editor zwischen zwei Abfragen speichern, und Flächen und Stempel stammen aus
 * zwei Ständen.
 */

export type LandschaftsEbene = "klima" | "derographisch" | "vegetation" | "topographie";

/** Eine Landschaftsteilfläche oder ein Klimaband. */
export interface SvgFlaeche {
    /** `public_id` der Teilfläche, bei einem Klimaband die Zonenart. */
    readonly kennung: string;
    /** `public_id` der Landschaft, zu der die Teilfläche gehört; leer bei einem Klimaband. */
    readonly landschaft: string;
    readonly name: string;
    readonly ebene: LandschaftsEbene;
    /** Die Landschaftsart (`region_type`), `ohne_typ` ohne Art. */
    readonly typ: string;
    readonly flaeche: Flaeche;
}

export interface SvgGebiet {
    readonly kennung: string;
    readonly name: string;
    /** Die Gebietsart (`territory_type`: Baronie, Grafschaft, Königreich …), `Gebiet` ohne Art. */
    readonly typ: string;
    readonly flaeche: Flaeche;
}

export interface SvgWeg {
    readonly kennung: string;
    readonly name: string;
    /** Die gespeicherte Wegart (`Flussweg`, nicht `Bach`: der Bach ist ein Flussweg mit `bach`). */
    readonly art: string;
    readonly bach: boolean;
    /** Der Name steht auf der Karte (`label_visible`). */
    readonly beschriftung: boolean;
    readonly punkte: readonly Punkt[];
}

export interface SvgKraftlinie {
    readonly kennung: string;
    readonly name: string;
    /** Die gezeichnete Bahn (`drawn_geom`). */
    readonly punkte: readonly Punkt[];
}

export interface SvgOrt {
    readonly kennung: string;
    readonly name: string;
    /** Die Ortsklasse (`metropole` … `stadtviertel`). */
    readonly art: string;
    readonly x: number;
    readonly y: number;
    readonly beschriftung: boolean;
}

export interface SvgLandmarke {
    readonly kennung: string;
    readonly name: string;
    /** Die Landmarkenart (`berggipfel`, `wasserfall` …, `packages/shared/src/landmarken.ts`). */
    readonly art: string;
    readonly x: number;
    readonly y: number;
    /** Höhe in Metern, nur Berggipfel und Vulkan; sonst `null`. */
    readonly hoehe: number | null;
}

/** Ein freier Name auf der Karte (`map_label`: Landschafts- und Regionsnamen). */
export interface SvgBeschriftung {
    readonly kennung: string;
    readonly name: string;
    readonly x: number;
    readonly y: number;
}

/** Ein Gipfel, der nur die Höhe des Reliefs liefert (alle Gelände formenden Punkte mit Höhe, auch „nur Gelände“). */
export interface SvgGipfel {
    readonly x: number;
    readonly y: number;
    readonly hoehe: number;
}

export interface KartenSvgStaende {
    readonly kartenfassung: string;
    readonly landschaftsfassung: string;
    /** UTC, `YYYY-MM-DDTHH:MM:SSZ`; `null` ohne abgeschlossenen Import. */
    readonly importstand: string | null;
}

export interface KartenSvgDaten {
    readonly staende: KartenSvgStaende;
    /** In Zeichenreihenfolge: Klima, Derographisch, Vegetation, Topographie, je nach `stack_order`. */
    readonly flaechen: readonly SvgFlaeche[];
    readonly gebiete: readonly SvgGebiet[];
    readonly wege: readonly SvgWeg[];
    readonly kraftlinien: readonly SvgKraftlinie[];
    readonly orte: readonly SvgOrt[];
    readonly landmarken: readonly SvgLandmarke[];
    readonly beschriftungen: readonly SvgBeschriftung[];
    readonly gipfel: readonly SvgGipfel[];
}

/**
 * Wegarten, die die Karte nicht zeigt: Seewege (Betreiber 2026-09-27: „wir tun so, als ob es seewege nicht mehr gibt“;
 * `hidden` in `config/map-cartography/aventuria-paths.json`). Legacy führte sie im Abzug; hier stehen sie nicht in der Datei, weil
 * der Abzug zeigen soll, was die Karte zeigt. Eine Zeile ändert das.
 */
export const WEGARTEN_VERBORGEN: readonly string[] = ["Seeweg"];

/** Die Anzahl Abfragen, die der Lader schickt: Der Test hält sie fest, damit keine unbemerkt dazukommt. */
export const LADER_ABFRAGEN = 12;

// ---- GeoJSON → Typen ----------------------------------------------------------------------------------------------------

function alsPunkt(koordinate: unknown): Punkt {
    const wert = koordinate as readonly number[];
    return [wert[0] ?? 0, wert[1] ?? 0];
}

function alsRing(koordinaten: unknown): Ring {
    return (koordinaten as readonly unknown[]).map(alsPunkt);
}

function alsTeil(koordinaten: unknown): Teilflaeche {
    return (koordinaten as readonly unknown[]).map(alsRing);
}

interface GeoJson {
    type?: string;
    coordinates?: unknown;
}

/** Polygon und MultiPolygon; alles andere (und alles Leere) ist eine Fläche ohne Teile. */
export function alsFlaeche(geoJson: string | null): Flaeche {
    if (!geoJson) return [];
    const geometrie = JSON.parse(geoJson) as GeoJson;
    if (geometrie.type === "Polygon") return [alsTeil(geometrie.coordinates)];
    if (geometrie.type === "MultiPolygon") return (geometrie.coordinates as readonly unknown[]).map(alsTeil);
    return [];
}

/** LineString; ein MultiLineString ergibt seine erste Linie nicht, sondern nichts (eine Linie ist hier EINE Linie). */
export function alsLinie(geoJson: string | null): readonly Punkt[] {
    if (!geoJson) return [];
    const geometrie = JSON.parse(geoJson) as GeoJson;
    return geometrie.type === "LineString" ? alsRing(geometrie.coordinates) : [];
}

// ---- Der Lader ----------------------------------------------------------------------------------------------------------

interface FlaechenZeile {
    kennung: string;
    landschaft: string;
    name: string;
    ebene: string;
    typ: string;
    geometrie: string | null;
}

interface GebietsZeile {
    kennung: string;
    name: string;
    typ: string;
    geometrie: string | null;
}

interface WegZeile {
    kennung: string;
    name: string;
    art: string;
    bach: boolean;
    beschriftung: boolean;
    geometrie: string | null;
}

interface KraftlinienZeile {
    kennung: string;
    name: string;
    geometrie: string | null;
}

interface PunktZeile {
    kennung: string;
    name: string;
    art: string;
    x: number;
    y: number;
    beschriftung: boolean;
}

interface LandmarkenZeile {
    kennung: string;
    name: string;
    art: string;
    x: number;
    y: number;
    hoehe: number | null;
}

interface NamenZeile {
    kennung: string;
    name: string;
    x: number;
    y: number;
}

interface GipfelZeile {
    x: number;
    y: number;
    hoehe: number;
}

const EBENEN: readonly string[] = ["klima", "derographisch", "vegetation", "topographie"];

/**
 * Die dauerhafte Kennung (`avm:id`) der acht Klimabänder: die UUIDs aus Legacys Abzug (letzter Stand r221808, 2026-11-05). Bei uns entstehen die Bänder aus den
 * Trennlinien und haben keine eigene `public_id`; ohne diese Tafel trügen sie ihre Zonenart (`polar`). Die Terrain-Pipeline verfolgt Elemente über `avm:id` von Abzug zu
 * Abzug und verlangt dort eine UUID; ein Band mit neuer Kennung hielte sie für neu, und es deckt die ganze Breite der Karte (Vali 2026-11-05, SVG-Vertrag §4, §5).
 * Eine künftige neue Zonenart bekommt keine erfundene UUID, sondern bleibt bei ihrer Art, bis jemand ihr eine gibt.
 */
const KLIMABAND_KENNUNG: Readonly<Record<string, string>> = {
    polar: "ea8728be-473d-463f-aaf4-8b3c3b0878ae",
    subpolar: "b14ec895-27c6-4a62-848c-b7acfb8cd3a2",
    boreal: "c569abc8-6254-4a82-a159-76195c44fa99",
    gemaessigt: "98c7ee0a-9d7b-4c8c-bd39-7682e9ca4e14",
    subtropen_winterfeucht: "479c560d-8dbb-4c25-b505-d87d5adc6eac",
    trockene_subtropen: "08241676-37f6-4956-9caa-cb31eb525604",
    subtropisch: "fda3dc4c-5079-42f9-a1c4-cc9865aeff6f",
    tropisch: "0339b0a1-8bc3-4003-8757-b4e93f530644",
};

function alsEbene(wert: string): LandschaftsEbene {
    return (EBENEN.includes(wert) ? wert : "topographie") as LandschaftsEbene;
}

/**
 * Lädt alles, was `baueKartenSvg` braucht. Die Auswahl steht oben im Kopf der Datei; hier nur die Reihenfolge der Dinge:
 * Klimabänder zuerst (sie decken die ganze Karte), dann Derographisch, Vegetation, Topographie, innerhalb einer Ebene nach
 * `stack_order` (wer vorn liegt, steht später), bei Gleichstand nach `public_id`. Jede Liste hat eine feste Reihenfolge: Dieselben
 * Daten ergeben dieselben Bytes.
 */
export async function ladeKartenSvgDaten(sql: Queryable, mapDomainId: string): Promise<KartenSvgDaten> {
    // Klimabänder: eine Zone ist ein Polygon über die ganze Breite. Die Tafel kennt keine Domäne (die Ansicht `climate_band_render`
    // schreibt `aventuria` fest); es gibt genau eine Welt, und eine zweite brächte ihre eigene Tafel mit.
    const baender = await sql<FlaechenZeile[]>`
        SELECT b.type_key AS kennung, '' AS landschaft, t.label AS name, 'klima' AS ebene, b.type_key AS typ,
               ST_AsGeoJSON(b.geom, 6) AS geometrie
        FROM climate_band b
        JOIN climate_zone_type t ON t.type_key = b.type_key
        WHERE t.is_active
        ORDER BY t.sort_order, b.type_key
    `;
    const teilflaechen = await sql<FlaechenZeile[]>`
        SELECT a.public_id::text AS kennung, r.public_id::text AS landschaft, r.name, r.region_layer AS ebene,
               coalesce(r.region_type, 'ohne_typ') AS typ, ST_AsGeoJSON(a.geom, 6) AS geometrie
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        WHERE a.map_domain_id = ${mapDomainId} AND r.map_domain_id = ${mapDomainId}
          AND a.is_active AND r.is_active AND NOT r.is_hidden
        ORDER BY CASE r.region_layer WHEN 'derographisch' THEN 0 WHEN 'vegetation' THEN 1 WHEN 'topographie' THEN 2 ELSE 3 END,
                 r.stack_order, a.public_id
    `;
    // Die Gebiete des höchsten abgeleiteten Bandes: das ist, was die Karte bei der größten Stufe zeigt. Ohne Ableitung (`derived_revision`
    // leer, ein Import hat sie entwertet) zeigt die Karte keine Gebiete, und der Abzug auch keine.
    const gebiete = await sql<GebietsZeile[]>`
        SELECT t.public_id::text AS kennung, t.name, coalesce(t.territory_type, 'Gebiet') AS typ,
               ST_AsGeoJSON(s.geom, 6) AS geometrie
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        JOIN territory_state z ON z.map_domain_id = t.map_domain_id AND z.derived_revision IS NOT NULL
        WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
          AND s.band = (SELECT max(h.band)
                          FROM territory_shape h JOIN territory u ON u.id = h.territory_id
                         WHERE u.map_domain_id = ${mapDomainId})
        ORDER BY t.sort_order, t.public_id
    `;
    const wege = await sql<WegZeile[]>`
        SELECT p.public_id::text AS kennung, p.name, p.subtype AS art, p.is_bach AS bach, p.label_visible AS beschriftung,
               ST_AsGeoJSON(p.geom, 6) AS geometrie
        FROM path p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND p.subtype <> ALL (${[...WEGARTEN_VERBORGEN]}::text[])
        ORDER BY p.public_id
    `;
    const kraftlinien = await sql<KraftlinienZeile[]>`
        SELECT p.public_id::text AS kennung, p.name, ST_AsGeoJSON(p.drawn_geom, 6) AS geometrie
        FROM powerline p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active
        ORDER BY p.public_id
    `;
    const orte = await sql<PunktZeile[]>`
        SELECT p.public_id::text AS kennung, p.name, p.subtype AS art, ST_X(p.geom)::float8 AS x, ST_Y(p.geom)::float8 AS y,
               (p.label_visible_override IS DISTINCT FROM false) AS beschriftung
        FROM place p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND NOT p.is_hidden
        ORDER BY p.public_id
    `;
    const landmarken = await sql<LandmarkenZeile[]>`
        SELECT p.public_id::text AS kennung, p.name, p.subtype AS art, ST_X(p.geom)::float8 AS x, ST_Y(p.geom)::float8 AS y,
               p.height_schritt AS hoehe
        FROM terrain_peak p
        WHERE p.map_domain_id = ${mapDomainId} AND p.is_active AND p.show_name
          AND NOT 'verborgen' = ANY (p.merkmale) AND NOT 'nur_gelaende' = ANY (p.merkmale)
        ORDER BY p.public_id
    `;
    const beschriftungen = await sql<NamenZeile[]>`
        SELECT l.public_id::text AS kennung, l.name, ST_X(l.geom)::float8 AS x, ST_Y(l.geom)::float8 AS y
        FROM map_label l
        WHERE l.map_domain_id = ${mapDomainId} AND l.is_active AND l.show_name IS DISTINCT FROM false
          AND btrim(l.name) <> ''
          AND NOT EXISTS (SELECT 1 FROM region v WHERE v.id = l.region_id AND v.is_hidden)
        ORDER BY l.public_id
    `;
    // Alle Punkte, die Gelände formen, mit Höhe (auch „nur Gelände“): die Quelle von `avm:hoehe`. Über die Sicht, nie über die Tabelle
    // (`terrain-peak-gelaende.test.ts`): Eine Höhle ist kein Berg.
    const gipfel = await sql<GipfelZeile[]>`
        SELECT ST_X(g.geom)::float8 AS x, ST_Y(g.geom)::float8 AS y, g.height_schritt AS hoehe
        FROM terrain_peak_gelaende g
        WHERE g.map_domain_id = ${mapDomainId} AND g.is_active AND g.height_schritt > 0
        ORDER BY g.public_id
    `;
    const [kartenfassung] = await sql<{ seq: string }[]>`
        SELECT coalesce(max(o.seq), 0)::text AS seq FROM map_operation o WHERE o.map_domain_id = ${mapDomainId}
    `;
    const [landschaftsfassung] = await sql<{ seq: string }[]>`
        SELECT coalesce((
                   SELECT o.seq FROM map_operation o
                   WHERE o.map_domain_id = ${mapDomainId}
                     AND EXISTS (SELECT 1 FROM map_audit_event e
                                 WHERE e.operation_id = o.operation_id
                                   AND (e.region_public_id IS NOT NULL OR e.region_area_public_id IS NOT NULL
                                        OR e.map_label_public_id IS NOT NULL))
                   ORDER BY o.seq DESC LIMIT 1), 0)::text AS seq
    `;
    const [importstand] = await sql<{ zeit: string | null }[]>`
        SELECT to_char(max(m.completed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS zeit
        FROM migration_run m
        WHERE m.status = 'completed' AND m.completed_at IS NOT NULL
          AND m.data_domain IN ('places', 'paths', 'regions', 'powerlines', 'territories', 'terrain')
    `;

    const nichtLeer = <T extends { readonly flaeche: Flaeche }>(zeile: T): boolean => zeile.flaeche.length > 0;
    const alsFlaechen = (zeilen: readonly FlaechenZeile[]): SvgFlaeche[] =>
        zeilen
            .map((zeile) => ({
                kennung: zeile.kennung,
                landschaft: zeile.landschaft,
                name: zeile.name,
                ebene: alsEbene(zeile.ebene),
                typ: zeile.typ,
                flaeche: alsFlaeche(zeile.geometrie),
            }))
            .filter(nichtLeer);

    return {
        staende: {
            kartenfassung: kartenfassung?.seq ?? "0",
            landschaftsfassung: landschaftsfassung?.seq ?? "0",
            importstand: importstand?.zeit ?? null,
        },
        flaechen: [
            ...alsFlaechen(
                baender.map((band) => ({ ...band, kennung: KLIMABAND_KENNUNG[band.kennung] ?? band.kennung })),
            ),
            ...alsFlaechen(teilflaechen),
        ],
        gebiete: gebiete
            .map((zeile) => ({
                kennung: zeile.kennung,
                name: zeile.name,
                typ: zeile.typ,
                flaeche: alsFlaeche(zeile.geometrie),
            }))
            .filter(nichtLeer),
        wege: wege
            .map((zeile) => ({
                kennung: zeile.kennung,
                name: zeile.name,
                art: zeile.art,
                bach: zeile.bach,
                beschriftung: zeile.beschriftung,
                punkte: alsLinie(zeile.geometrie),
            }))
            .filter((weg) => weg.punkte.length >= 2),
        kraftlinien: kraftlinien
            .map((zeile) => ({ kennung: zeile.kennung, name: zeile.name, punkte: alsLinie(zeile.geometrie) }))
            .filter((linie) => linie.punkte.length >= 2),
        orte: orte.map((zeile) => ({ ...zeile })),
        landmarken: landmarken.map((zeile) => ({ ...zeile })),
        beschriftungen: beschriftungen.map((zeile) => ({ ...zeile })),
        gipfel: gipfel.map((zeile) => ({ x: zeile.x, y: zeile.y, hoehe: zeile.hoehe })),
    };
}
