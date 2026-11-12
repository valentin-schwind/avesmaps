import {
    EDITOR_LANDSCAPE_LAYERS,
    GEBIRGS_WERTE,
    LANDSCAPE_TARGET_MARGIN,
    LANDSCAPE_TARGETS_MAX_SIDE,
    editorLandscapeCircle,
    ordneGefahren,
    type EditorHiddenLandscape,
    type EditorHiddenLandscapes,
    type EditorLandscapeArea,
    type EditorLandscapeDetail,
    type EditorLandscapeLabel,
    type EditorLandscapeLayer,
    type EditorLandscapeList,
    type EditorLandscapeNeighbor,
    type EditorLandscapePeakRow,
    type EditorLandscapeRow,
    type EditorLandscapeTargets,
    type GebirgsMuster,
    type GefahrenArt,
    type GebirgsStand,
    type GebirgsWert,
    type Gebirgstyp,
    type LandscapeBoxTargetsQuery,
} from "@avesmaps3d/shared";
import { ladeLandmarkenKandidaten } from "./landmarken-kandidaten.ts";
import { ladeWikiEintraege } from "./wiki-eintraege.ts";
import type { Queryable } from "../database.ts";
import { leseGebirgsZusatz } from "../terrain/gebirge-editor.ts";
import { fuerBesucherVerborgen, merkmaleGeordnet } from "./peak-update.ts";

/**
 * Der Lesepfad des Landschaftseditors (WI-0178 Paket A1, EDIT-0004 §2.2, §5; Vertrag `packages/shared/src/landscape-editor.ts`),
 * nach dem Muster der Ortsliste (`places.ts`).
 *
 * - **Liste:** eine Abfrage für alle aktiven Regionen der Domäne ohne Klimazonen, mit der Zahl ihrer Teilflächen und Beschriftungen,
 *   dem Rahmen der Flächen zum Hinfliegen und dem Wiki-Artikel (`region.wiki_url`, Titel aus `wiki_region_snapshot` über
 *   `wiki_region_key`, wie das Infopanel `subjects/detail-area.ts`). Der Kreis kommt aus `editorLandscapeCircle` (vier Zustände,
 *   EDIT-0003 T26 (5)).
 * - **Detail:** die Felder, die Teilflächen eckig wie gespeichert (nie die gerundete Fassung aus `region_area_smooth`), die
 *   Beschriftungen und die Nachbarn mit gemeinsamen Ecken in derselben Ebene (B4: Sie ziehen beim Bearbeiten mit). Gemeinsam heißt
 *   koordinatengleich, wie Legacy und die Glättung (`packages/shared/src/flaechen-rundung/smooth-net.ts`) Ecken teilen.
 * - Revisionen kommen mit der Datenseite (Paket B1, Migration M1); bis dahin trägt das Detail keine.
 * - **Gipfel und Vulkane** (P3) als eigene Zeilen `peaks` der Ebene Topographie: Name, Art, Höhe, Lage, der Artikel wie im Infopanel
 *   (`subjects/detail-peak.ts`: die aktive Zuordnung, der Titel aus ihrem Abzug), die Merkmale „verborgen“ und „nur Gelände“ als `hidden`.
 */

interface ListRow {
    public_id: string;
    name: string;
    region_layer: EditorLandscapeLayer;
    region_type: string | null;
    wiki_url: string | null;
    wiki_region_key: string | null;
    wiki_title: string | null;
    areas: number;
    labels: number;
    label_curve_enabled: boolean | null;
    is_locked: boolean;
    stack_order: number;
    x0: number | null;
    y0: number | null;
    x1: number | null;
    y1: number | null;
    source_system: string;
    is_active: boolean;
    off_map: boolean;
    is_hidden: boolean;
    /** Die Gefahrenlage (WI-0308), wie gespeichert. */
    hazards: string[];
}

/** Die Gefahrenlage einer Zeile in der Folge des Katalogs; fehlt bei „ungefährlich“. */
const gefahrenVon = (r: { hazards: string[] }): { hazards?: GefahrenArt[] } => {
    const arten = ordneGefahren(r.hazards);
    return arten.length === 0 ? {} : { hazards: arten };
};

/** Der stille Stand (D2, T54): von der Karte genommen oder gelöscht; auf der Karte nichts. */
const standVon = (r: { is_active: boolean; off_map: boolean }): { state?: "off_map" | "retired" } =>
    r.is_active ? {} : { state: r.off_map ? "off_map" : "retired" };

const rund = (v: number): number => Math.round(v * 100) / 100;
const mitWiki = (r: { wiki_url: string | null; wiki_region_key: string | null }): boolean =>
    r.wiki_url !== null || r.wiki_region_key !== null;

export async function listEditorLandscapes(
    database: Queryable,
    mapDomainId = "aventuria",
): Promise<EditorLandscapeList> {
    // Auch stille Flächen (D2, T54): Ihre Teile zählen und rahmen, die mit ihr still wurden.
    const rows = await database<ListRow[]>`
        WITH a AS (
            SELECT a.region_id, count(*)::int AS n, ST_Extent(a.geom) AS rahmen
              FROM region_area a JOIN region r ON r.id = a.region_id
             WHERE (a.is_active OR NOT r.is_active) AND a.map_domain_id = ${mapDomainId} GROUP BY a.region_id
        ), l AS (
            SELECT l.region_id, count(*)::int AS n
              FROM map_label l JOIN region r ON r.id = l.region_id
             WHERE (l.is_active OR NOT r.is_active) AND l.map_domain_id = ${mapDomainId} GROUP BY l.region_id
        )
        SELECT r.public_id::text AS public_id, r.name, r.region_layer, r.region_type,
               coalesce(r.wiki_url, s.wiki_url) AS wiki_url, r.wiki_region_key, s.name AS wiki_title,
               coalesce(a.n, 0) AS areas, coalesce(l.n, 0) AS labels, r.label_curve_enabled, r.is_locked, r.stack_order,
               ST_XMin(a.rahmen) AS x0, ST_YMin(a.rahmen) AS y0, ST_XMax(a.rahmen) AS x1, ST_YMax(a.rahmen) AS y1, r.source_system,
               r.is_active, r.off_map, r.is_hidden, r.hazards
          FROM region r
          LEFT JOIN a ON a.region_id = r.id
          LEFT JOIN l ON l.region_id = r.id
          LEFT JOIN wiki_region_snapshot s ON s.wiki_key = r.wiki_region_key AND s.is_active
         WHERE r.map_domain_id = ${mapDomainId} AND r.region_layer <> 'klima'
         ORDER BY r.name, r.public_id
    `;
    const peaks = await database<PeakRow[]>`
        SELECT p.public_id::text AS public_id, p.name, p.subtype, p.height_schritt, p.merkmale, ST_X(p.geom) AS x,
               ST_Y(p.geom) AS y, w.wiki_url, w.wiki_title, p.is_active
          FROM terrain_peak p
          LEFT JOIN LATERAL (
              SELECT a.wiki_url, s.name AS wiki_title
                FROM terrain_peak_wiki_assignment a
                LEFT JOIN wiki_region_snapshot s ON s.id = a.snapshot_id
               WHERE a.terrain_peak_id = p.id AND a.is_active
               ORDER BY a.id LIMIT 1
          ) w ON TRUE
         WHERE p.map_domain_id = ${mapDomainId}
         ORDER BY p.name, p.public_id
    `;
    // Die Landmarken-Kandidaten des WikiSync (WI-0271 L7): Artikel ohne Landmarke auf der Karte, als ◐-Zeilen der Topographie.
    const kandidaten = await ladeLandmarkenKandidaten(database);
    // Die Wiki-Einträge ohne Fläche (WI-0284): dieselbe ◐-Zeile wie ein Kandidat.
    const wikiEintraege = await ladeWikiEintraege(database);
    return {
        rows: rows.map(zeile),
        peaks: peaks.map(gipfelZeile),
        ...(kandidaten.length === 0 ? {} : { kandidaten }),
        ...(wikiEintraege.length === 0 ? {} : { wikiEintraege }),
    };
}

interface PeakRow {
    public_id: string;
    name: string;
    subtype: EditorLandscapePeakRow["subtype"];
    height_schritt: number | null;
    merkmale: string[];
    x: number;
    y: number;
    wiki_url: string | null;
    wiki_title: string | null;
    is_active: boolean;
}

function gipfelZeile(r: PeakRow): EditorLandscapePeakRow {
    return {
        id: r.public_id,
        name: r.name,
        subtype: r.subtype,
        ...(r.height_schritt === null ? {} : { height: r.height_schritt }),
        ...(r.merkmale.length === 0 ? {} : { merkmale: merkmaleGeordnet(r.merkmale) }),
        circle: editorLandscapeCircle(true, r.wiki_url !== null),
        ...(r.wiki_url ? { wiki: { url: r.wiki_url, ...(r.wiki_title ? { title: r.wiki_title } : {}) } } : {}),
        ...(fuerBesucherVerborgen(r.merkmale) ? { hidden: true as const } : {}),
        position: [rund(r.x), rund(r.y)],
        // Gelöscht („Gipfel entfernen …“): steht unter „Gelöscht“ wie eine gelöschte Fläche.
        ...(r.is_active ? {} : { state: "retired" as const }),
    };
}

function zeile(r: ListRow): EditorLandscapeRow {
    return {
        id: r.public_id,
        name: r.name,
        layer: r.region_layer,
        ...(r.region_type ? { type: r.region_type } : {}),
        circle: editorLandscapeCircle(r.areas > 0, mitWiki(r)),
        ...(r.wiki_url ? { wiki: { url: r.wiki_url, ...(r.wiki_title ? { title: r.wiki_title } : {}) } } : {}),
        ...(r.areas > 0 ? { areas: r.areas } : {}),
        ...(r.labels > 0 ? { labels: r.labels } : {}),
        ...(r.label_curve_enabled ? { curve: true as const } : {}),
        ...(r.is_locked ? { clickLocked: true as const } : {}),
        ...(r.is_hidden ? { hidden: true as const } : {}),
        ...gefahrenVon(r),
        order: r.stack_order,
        ...(r.x0 !== null && r.y0 !== null && r.x1 !== null && r.y1 !== null
            ? { bounds: [rund(r.x0), rund(r.y0), rund(r.x1), rund(r.y1)] as [number, number, number, number] }
            : {}),
        ...(r.source_system !== "legacy" ? { source: r.source_system } : {}),
        ...standVon(r),
    };
}

interface DetailRow extends Omit<ListRow, "areas" | "labels" | "x0" | "y0" | "x1" | "y1"> {
    id: string;
    label_curve_max: number | null;
    primary_label_id: string | null;
    revision: string;
}

type GeoJsonFlaeche =
    { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };

/** GeoJSON-Ringe ohne den Schlusspunkt, je Polygon zuerst außen, dann die Löcher. */
function polygoneVon(g: GeoJsonFlaeche): EditorLandscapeArea["polygons"] {
    const polygone = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    return polygone.map((ringe) =>
        ringe.map((ring) => {
            const ecken = ring.map(([x, y]) => [x, y] as [number, number]);
            const [a, z] = [ecken[0], ecken[ecken.length - 1]];
            return a && z && ecken.length > 1 && a[0] === z[0] && a[1] === z[1] ? ecken.slice(0, -1) : ecken;
        }),
    );
}

/**
 * Die verborgenen Landschaften für Editoren (WI-0178 T41; Claudio 2026-10-18: eine kleine Zusatzschicht über die App statt einer zweiten
 * vollen Kachelquelle): je aktive, verborgene Landschaft ihre aktiven Teilflächen eckig in Karteneinheiten und der Punkt für das Auge (die
 * erste Beschriftung, sonst ein Punkt in der größten Teilfläche).
 */
export async function listHiddenLandscapes(
    database: Queryable,
    mapDomainId = "aventuria",
): Promise<EditorHiddenLandscapes> {
    const zeilen = await database<
        {
            public_id: string;
            name: string;
            region_layer: EditorLandscapeLayer;
            region_type: string | null;
            g: GeoJsonFlaeche | null;
            ax: number | null;
            ay: number | null;
        }[]
    >`
        SELECT r.public_id::text AS public_id, r.name, r.region_layer, r.region_type,
               ST_AsGeoJSON(a.geom, 15)::json AS g, punkt.ax, punkt.ay
          FROM region r
          LEFT JOIN region_area a ON a.region_id = r.id AND a.is_active
          LEFT JOIN LATERAL (
              SELECT coalesce(ST_X(l.geom), ST_X(ST_PointOnSurface(gross.geom))) AS ax,
                     coalesce(ST_Y(l.geom), ST_Y(ST_PointOnSurface(gross.geom))) AS ay
                FROM (SELECT 1) eins
                LEFT JOIN LATERAL (
                    SELECT geom FROM map_label WHERE region_id = r.id AND is_active ORDER BY id LIMIT 1
                ) l ON true
                LEFT JOIN LATERAL (
                    SELECT geom FROM region_area WHERE region_id = r.id AND is_active ORDER BY ST_Area(geom) DESC LIMIT 1
                ) gross ON true
          ) punkt ON true
         WHERE r.is_active AND r.is_hidden AND r.map_domain_id = ${mapDomainId} AND r.region_layer <> 'klima'
         ORDER BY r.public_id, a.id
    `;
    const nachId = new Map<string, EditorHiddenLandscape>();
    for (const z of zeilen) {
        let eintrag = nachId.get(z.public_id);
        if (eintrag === undefined) {
            eintrag = {
                id: z.public_id,
                name: z.name,
                layer: z.region_layer,
                ...(z.region_type ? { type: z.region_type } : {}),
                polygons: [],
                ...(z.ax !== null && z.ay !== null ? { at: [z.ax, z.ay] as [number, number] } : {}),
            };
            nachId.set(z.public_id, eintrag);
        }
        if (z.g !== null) eintrag.polygons.push(...polygoneVon(z.g));
    }
    return { rows: [...nachId.values()] };
}

/** Die Spalten von `terrain_control`, die der Reiter „Gebirge“ liest; `maximalhoehe` ist die Kammhöhe. */
type GebirgsSpalten = {
    gebirgstyp: Gebirgstyp | null;
    muster: GebirgsMuster | null;
    maximalhoehe: number | null;
    /** Die gewürfelte Saat (Migration 0214). */
    saat: number | null;
} & Record<GebirgsWert, number | null>;

/** Typ und Abweichungen einer Teilfläche (`GebirgsStand`); leer heißt jeweils „Vorgabe“. */
function gebirgsStandVon(f: GebirgsSpalten): GebirgsStand {
    const werte: GebirgsStand["werte"] = {};
    for (const wert of GEBIRGS_WERTE) {
        const zahl = f[wert];
        if (zahl !== null) werte[wert] = Number(zahl);
    }
    return {
        typ: f.gebirgstyp,
        muster: f.muster,
        kammhoehe: f.maximalhoehe === null ? null : Number(f.maximalhoehe),
        werte,
    };
}

export async function readEditorLandscape(
    database: Queryable,
    publicId: string,
    mapDomainId = "aventuria",
): Promise<EditorLandscapeDetail | undefined> {
    const [r] = await database<DetailRow[]>`
        SELECT r.id::text AS id, r.public_id::text AS public_id, r.name, r.region_layer, r.region_type,
               coalesce(r.wiki_url, s.wiki_url) AS wiki_url, r.wiki_region_key, s.name AS wiki_title,
               r.label_curve_enabled, r.label_curve_max, r.is_locked, r.stack_order, r.primary_label_id::text AS primary_label_id, r.source_system,
               r.revision::text AS revision, r.is_active, r.off_map, r.is_hidden, r.hazards
          FROM region r
          LEFT JOIN wiki_region_snapshot s ON s.wiki_key = r.wiki_region_key AND s.is_active
         WHERE r.public_id = ${publicId} AND r.map_domain_id = ${mapDomainId} AND r.region_layer <> 'klima'
    `;
    if (r === undefined) return undefined;

    // Am Gebirge die Werte der Teilfläche (P4): Typ und Abweichungen aus `terrain_control`, eine stillgelegte Zeile zählt nicht.
    const flaechen = await database<
        ({
            area_id: string;
            public_id: string;
            g: GeoJsonFlaeche;
            affects_paths: boolean;
            revision: string;
        } & GebirgsSpalten)[]
    >`
        SELECT a.id::text AS area_id, a.public_id::text AS public_id, ST_AsGeoJSON(a.geom, 15)::json AS g, a.affects_paths, a.revision::text AS revision,
               c.gebirgstyp, c.muster, c.maximalhoehe, c.hypsometrie, c.plateau, c.rauschen, c.einschnitt, c.erosion, c.talbreite,
               c.koernung, c.stufen, c.bergform, c.sattel,
               -- Die Saat (0214) über to_jsonb wie Typ und Muster in inputs.ts: Stände ohne die Migration lesen leer statt eines Fehlers.
               (to_jsonb(c) ->> 'saat')::int AS saat
          FROM region_area a
          LEFT JOIN terrain_control c ON c.area_id = a.id AND c.is_active
         WHERE a.region_id = ${r.id} AND (a.is_active OR ${!r.is_active}) ORDER BY a.id
    `;
    const istGebirge = r.region_layer === "topographie" && r.region_type === "gebirge";
    // Am Gebirge dazu Netz, Werte des Rückennetzes und Revision der Gebirgswerte (WI-0245), der Anfang des Entwurfs.
    const zusatz = istGebirge
        ? await leseGebirgsZusatz(
              database,
              flaechen.map((f) => f.area_id),
          )
        : new Map();
    // Am Gebirge die Gipfel in seinen Teilflächen (P5), wie Legacy `peaksInsideArea`: der Punkt liegt in einer aktiven Teilfläche.
    const gipfel = istGebirge
        ? await database<
              {
                  public_id: string;
                  name: string;
                  subtype: "berggipfel" | "vulkan";
                  height_schritt: number | null;
                  merkmale: string[];
                  x: number;
                  y: number;
                  revision: number;
              }[]
          >`
              SELECT p.public_id::text AS public_id, p.name, p.subtype, p.height_schritt, p.merkmale, ST_X(p.geom) AS x,
                     ST_Y(p.geom) AS y, p.revision::int AS revision
                FROM terrain_peak_gelaende p
               WHERE p.is_active AND p.map_domain_id = ${mapDomainId}
                 AND EXISTS (SELECT 1 FROM region_area a WHERE a.region_id = ${r.id} AND a.is_active AND ST_Covers(a.geom, p.geom))
               ORDER BY p.height_schritt DESC NULLS LAST, p.name, p.public_id
          `
        : [];
    const beschriftungen = await database<
        {
            id: string;
            public_id: string;
            name: string;
            x: number;
            y: number;
            label_size: string | null;
            label_priority: number | null;
            label_min_zoom: number | null;
            label_max_zoom: number | null;
            show_name: boolean | null;
            revision: string;
            band_from: number | null;
            band_to: number | null;
        }[]
    >`
        SELECT l.id::text AS id, l.public_id::text AS public_id, l.name, ST_X(l.geom) AS x, ST_Y(l.geom) AS y,
               l.label_size, l.label_priority, l.label_min_zoom, l.label_max_zoom, l.show_name, l.revision::text AS revision,
               t.band_from, t.band_to
          FROM map_label l
          -- Die Spanne der Art wie in map_label_effective (0057): die eigene Art zuerst, sonst die Grundvorgabe.
          LEFT JOIN LATERAL (
              SELECT a.band_from, a.band_to FROM landscape_display_art a
               WHERE a.map_domain_id = l.map_domain_id AND (a.art_key = l.subtype OR a.art_key = '*')
               ORDER BY (a.art_key = '*') LIMIT 1
          ) t ON true
         WHERE l.region_id = ${r.id} AND (l.is_active OR ${!r.is_active})
         ORDER BY (l.id::text = ${r.primary_label_id ?? ""}) DESC, l.id
    `;
    // Nachbarn derselben Ebene mit koordinatengleichen Ecken; der Rahmen der eigenen Flächen grenzt die Suche ein.
    const nachbarn = await database<{ public_id: string; name: string; n: number }[]>`
        WITH meine AS (
            SELECT DISTINCT ST_X(d.geom) AS x, ST_Y(d.geom) AS y
              FROM region_area a CROSS JOIN LATERAL ST_DumpPoints(a.geom) d
             WHERE a.region_id = ${r.id} AND a.is_active
        ), rahmen AS (
            SELECT ST_Envelope(ST_Collect(geom)) AS b FROM region_area WHERE region_id = ${r.id} AND is_active
        )
        SELECT o.public_id::text AS public_id, o.name, count(DISTINCT (m.x, m.y))::int AS n
          FROM region_area a
          JOIN region o ON o.id = a.region_id AND o.is_active AND o.region_layer = ${r.region_layer}
          CROSS JOIN LATERAL ST_DumpPoints(a.geom) d
          JOIN meine m ON m.x = ST_X(d.geom) AND m.y = ST_Y(d.geom)
         WHERE a.is_active AND a.region_id <> ${r.id} AND a.geom && (SELECT b FROM rahmen)
         GROUP BY o.public_id, o.name
         ORDER BY n DESC, o.name
    `;

    // Der Platz in der Ebene (D1): 1 liegt ganz vorn, der höchste Rang.
    const [platz] = await database<{ n: number; of: number }[]>`
        SELECT (count(*) FILTER (WHERE stack_order > ${r.stack_order}) + 1)::int AS n, count(*)::int AS of
          FROM region WHERE map_domain_id = ${mapDomainId} AND region_layer = ${r.region_layer} AND is_active
    `;

    const labels: EditorLandscapeLabel[] = beschriftungen.map((b) => ({
        id: b.public_id,
        text: b.name,
        x: b.x,
        y: b.y,
        ...(b.label_size !== null ? { size: Number(b.label_size) } : {}),
        ...(b.label_priority !== null ? { priority: b.label_priority } : {}),
        ...(b.label_min_zoom !== null ? { zoomMin: b.label_min_zoom } : {}),
        ...(b.label_max_zoom !== null ? { zoomMax: b.label_max_zoom } : {}),
        ...(b.band_from !== null && b.band_to !== null ? { zoomDefault: { min: b.band_from, max: b.band_to } } : {}),
        visible: b.show_name !== false,
        ...(b.id === r.primary_label_id ? { primary: true as const } : {}),
        revision: Number(b.revision),
    }));
    const neighbors: EditorLandscapeNeighbor[] = nachbarn.map((n) => ({
        id: n.public_id,
        name: n.name,
        sharedCorners: n.n,
    }));
    return {
        id: r.public_id,
        name: r.name,
        layer: r.region_layer,
        ...(r.region_type ? { type: r.region_type } : {}),
        circle: editorLandscapeCircle(flaechen.length > 0, mitWiki(r)),
        ...(r.wiki_url
            ? {
                  wiki: {
                      url: r.wiki_url,
                      ...(r.wiki_title ? { title: r.wiki_title } : {}),
                      ...(r.wiki_region_key ? { key: r.wiki_region_key } : {}),
                  },
              }
            : {}),
        order: r.stack_order,
        ...(r.is_hidden ? { hidden: true as const } : {}),
        ...gefahrenVon(r),
        ...(r.is_active && platz !== undefined && platz.of > 0 ? { place: { n: platz.n, of: platz.of } } : {}),
        clickLocked: r.is_locked,
        ...(r.label_curve_enabled === null
            ? {}
            : {
                  curve: {
                      enabled: r.label_curve_enabled,
                      ...(r.label_curve_max !== null ? { max: r.label_curve_max } : {}),
                  },
              }),
        areas: flaechen.map((f) => ({
            id: f.public_id,
            polygons: polygoneVon(f.g),
            affectsPaths: f.affects_paths,
            revision: Number(f.revision),
            ...(istGebirge ? { gebirge: { ...gebirgsStandVon(f), ...zusatz.get(f.area_id)!, saat: f.saat } } : {}),
        })),
        labels,
        neighbors,
        ...(istGebirge
            ? {
                  peaks: gipfel.map((p) => ({
                      id: p.public_id,
                      name: p.name,
                      subtype: p.subtype,
                      ...(p.height_schritt === null ? {} : { height: p.height_schritt }),
                      ...(fuerBesucherVerborgen(p.merkmale) ? { hidden: true as const } : {}),
                      position: [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000] as [number, number],
                      revision: p.revision,
                  })),
              }
            : {}),
        ...(r.source_system !== "legacy" ? { source: r.source_system } : {}),
        ...standVon(r),
        revision: Number(r.revision),
    };
}

/**
 * Die Andockziele um eine Landschaft (WI-0178 C1, Vertrag `EditorLandscapeTargets`): Nachbarn derselben Ebene mit gemeinsamen Ecken
 * ganz, die Kanten anderer Teilflächen der sichtbaren Ebenen im Kasten und die Stützpunkte der Flusswege darin. Ohne Teilfläche gibt
 * es keinen Kasten und nichts anzudocken; `undefined`, wenn es die Landschaft nicht gibt.
 *
 * Liefert die fertige Antwort als JSON in Bytes (WI-0298 Stufe 5): Kanten und Flusspunkte baut PostgreSQL als Text zusammen, und die
 * Bytes gehen ungelesen durch (`.raw()`), also außerhalb des Heaps. Um die Landschaft „Meer“ (Kasten fast die ganze Karte) sind das
 * auf der Stage 247.000 Kanten und 34 MB. Als Zeilen und Objekte belegten sie rund 185 MB Heap je Anfrage, zwei gleichzeitig brachten
 * Production am 2026-11-12 an die Grenze von 512 MB. Die Route lässt dazu nur eine solche Abfrage zur Zeit laufen (`einzeln-laden.ts`).
 */
export async function readEditorLandscapeTargets(
    database: Queryable,
    publicId: string,
    layers: readonly EditorLandscapeLayer[] = EDITOR_LANDSCAPE_LAYERS,
    mapDomainId = "aventuria",
): Promise<Buffer | undefined> {
    const [r] = await database<
        {
            id: string;
            region_layer: EditorLandscapeLayer;
            x0: number | null;
            y0: number | null;
            x1: number | null;
            y1: number | null;
        }[]
    >`
        SELECT r.id::text AS id, r.region_layer, ST_XMin(e.b) AS x0, ST_YMin(e.b) AS y0, ST_XMax(e.b) AS x1, ST_YMax(e.b) AS y1
          FROM region r
          LEFT JOIN LATERAL (SELECT ST_Extent(a.geom)::geometry AS b FROM region_area a WHERE a.region_id = r.id AND a.is_active) e ON true
         WHERE r.public_id = ${publicId} AND r.is_active AND r.map_domain_id = ${mapDomainId} AND r.region_layer <> 'klima'
    `;
    if (r === undefined) return undefined;
    const margin = LANDSCAPE_TARGET_MARGIN;
    if (r.x0 === null || r.y0 === null || r.x1 === null || r.y1 === null)
        return Buffer.from(
            JSON.stringify({ margin, neighbors: [], edges: [], riverPoints: [] } satisfies EditorLandscapeTargets),
        );
    const kasten = [r.x0 - margin, r.y0 - margin, r.x1 + margin, r.y1 + margin] as const;
    const neighbors = await database<
        { id: string; region_id: string; name: string; revision: string; g: GeoJsonFlaeche }[]
    >`
        WITH meine AS (
            SELECT DISTINCT ST_X(d.geom) AS x, ST_Y(d.geom) AS y
              FROM region_area a CROSS JOIN LATERAL ST_DumpPoints(a.geom) d
             WHERE a.region_id = ${r.id} AND a.is_active
        ), kandidaten AS (
            SELECT a.id
              FROM region_area a
              JOIN region o ON o.id = a.region_id AND o.is_active AND o.region_layer = ${r.region_layer}
             WHERE a.is_active AND a.region_id <> ${r.id}
               AND a.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
               AND EXISTS (
                   SELECT 1 FROM ST_DumpPoints(a.geom) d JOIN meine m ON m.x = ST_X(d.geom) AND m.y = ST_Y(d.geom)
               )
        )
        SELECT a.public_id::text AS id, o.public_id::text AS region_id, o.name, a.revision::text AS revision,
               ST_AsGeoJSON(a.geom, 15)::json AS g
          FROM kandidaten k JOIN region_area a ON a.id = k.id JOIN region o ON o.id = a.region_id
         ORDER BY o.name, a.public_id
    `;
    const nachbarIds = neighbors.map((n) => n.id);
    // Form wie `EditorLandscapeTargetEdge` und `EditorLandscapeTargetRiverPoint`, Reihenfolge wie zuvor als Zeilen.
    const [[edges] = []] = await database`
        SELECT coalesce(json_agg(json_build_object('areaId', k.area_id, 'name', k.name, 'a', json_build_array(k.ax, k.ay),
                                                   'b', json_build_array(k.bx, k.by)) ORDER BY k.public_id, k.path), '[]')::text AS json
          FROM (
            SELECT a.public_id, a.public_id::text AS area_id, o.name, s.path,
                   ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
                   ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
              FROM region_area a
              JOIN region o ON o.id = a.region_id AND o.is_active AND o.region_layer = ANY(${layers as unknown as string[]})
             CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(a.geom)) s
             WHERE a.is_active AND a.region_id <> ${r.id} AND a.map_domain_id = ${mapDomainId}
               AND a.public_id <> ALL(${nachbarIds}::uuid[])
               AND a.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
               AND s.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
          ) k
    `.raw();
    const [[riverPoints] = []] = await database`
        SELECT coalesce(json_agg(json_build_object('pathId', k.path_id, 'name', k.name, 'x', k.x, 'y', k.y)
                                 ORDER BY k.public_id, k.n), '[]')::text AS json
          FROM (
            SELECT w.public_id, w.public_id::text AS path_id, w.name, d.path[1] AS n, ST_X(d.geom) AS x, ST_Y(d.geom) AS y
              FROM path w CROSS JOIN LATERAL ST_DumpPoints(w.geom) d
             WHERE w.is_active AND w.map_domain_id = ${mapDomainId} AND w.subtype = 'Flussweg'
               AND w.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
               AND d.geom && ST_MakeEnvelope(${kasten[0]}, ${kasten[1]}, ${kasten[2]}, ${kasten[3]}, 0)
          ) k
    `.raw();
    const nachbarn: EditorLandscapeTargets["neighbors"] = neighbors.map((n) => ({
        id: n.id,
        regionId: n.region_id,
        name: n.name,
        revision: Number(n.revision),
        polygons: polygoneVon(n.g),
    }));
    return Buffer.concat([
        Buffer.from(`{"margin":${String(margin)},"neighbors":${JSON.stringify(nachbarn)},"edges":`),
        edges ?? Buffer.from("[]"),
        Buffer.from(',"riverPoints":'),
        riverPoints ?? Buffer.from("[]"),
        Buffer.from("}"),
    ]);
}

/** Ein Kasten, gekürzt auf die Mitte, wenn eine Seite länger ist als `LANDSCAPE_TARGETS_MAX_SIDE` (wie `zielKasten` des Wegs). */
export function landschaftsKasten(query: LandscapeBoxTargetsQuery): [number, number, number, number] {
    const seite = (a: number, b: number): [number, number] => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        if (hi - lo <= LANDSCAPE_TARGETS_MAX_SIDE) return [lo, hi];
        const mitte = (lo + hi) / 2;
        return [mitte - LANDSCAPE_TARGETS_MAX_SIDE / 2, mitte + LANDSCAPE_TARGETS_MAX_SIDE / 2];
    };
    const [x0, x1] = seite(query.x0, query.x1);
    const [y0, y1] = seite(query.y0, query.y1);
    return [x0, y0, x1, y1];
}

/**
 * Die Andockziele im Kasten für „Neue Fläche“ (WI-0178 T47, `GET /api/editor/landscapes/targets`): die Kanten aller aktiven Teilflächen
 * derselben Ebene und die Stützpunkte der Flüsse, dieselbe Auswahl wie um eine Landschaft (`readEditorLandscapeTargets`), nur um einen
 * Kasten und ohne Nachbarn (eine neue Fläche zieht nichts mit).
 */
export async function readLandscapeTargetsInBox(
    database: Queryable,
    query: LandscapeBoxTargetsQuery,
    mapDomainId = "aventuria",
): Promise<EditorLandscapeTargets> {
    const [x0, y0, x1, y1] = landschaftsKasten(query);
    const edges = await database<{ area_id: string; name: string; ax: number; ay: number; bx: number; by: number }[]>`
        SELECT a.public_id::text AS area_id, o.name,
               ST_X(ST_StartPoint(s.geom)) AS ax, ST_Y(ST_StartPoint(s.geom)) AS ay,
               ST_X(ST_EndPoint(s.geom)) AS bx, ST_Y(ST_EndPoint(s.geom)) AS by
          FROM region_area a
          JOIN region o ON o.id = a.region_id AND o.is_active AND o.region_layer = ${query.layer}
         CROSS JOIN LATERAL ST_DumpSegments(ST_Boundary(a.geom)) s
         WHERE a.is_active AND a.map_domain_id = ${mapDomainId}
           AND a.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND s.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY a.public_id, s.path
    `;
    const riverPoints = await database<{ path_id: string; name: string; x: number; y: number }[]>`
        SELECT w.public_id::text AS path_id, w.name, ST_X(d.geom) AS x, ST_Y(d.geom) AS y
          FROM path w CROSS JOIN LATERAL ST_DumpPoints(w.geom) d
         WHERE w.is_active AND w.map_domain_id = ${mapDomainId} AND w.subtype = 'Flussweg'
           AND w.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
           AND d.geom && ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 0)
         ORDER BY w.public_id, d.path[1]
    `;
    return {
        margin: 0,
        neighbors: [],
        edges: edges.map((e) => ({ areaId: e.area_id, name: e.name, a: [e.ax, e.ay], b: [e.bx, e.by] })),
        riverPoints: riverPoints.map((p) => ({ pathId: p.path_id, name: p.name, x: p.x, y: p.y })),
    };
}
