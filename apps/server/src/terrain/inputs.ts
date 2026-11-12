import { createHash } from "node:crypto";
import type { Queryable } from "../database.ts";
import type { FreePeak } from "./peak-cone.ts";
import {
    eigeneZiele,
    faelltZumFreienEnde,
    GEBIRGS_MUSTER,
    GEBIRGS_WERTE,
    GEBIRGSTYPEN,
    gebirgsRegler,
    type GebirgsMuster,
    type GebirgsStand,
    type Gebirgstyp,
    KAMM_AUSLAUF_QUELLE,
    pointInGeometry,
    RUECKENNETZ_QUELLE,
    rechnetRueckennetz,
    rueckennetzRegler,
    TREFFEN_FLUSS_QUELLE,
    TREFFEN_QUELLE,
    TREFFEN_SEE_QUELLE,
    V12_SOURCE,
    type Pass,
    type V12Input,
} from "@avesmaps3d/shared";
import { resolveTerrainRecipe } from "./auswahl.ts";
import type { TerrainRecipe } from "./domain/recipes.ts";
import { kantenJeGebirge, ladeGebirgsNaehte, type NahtKante } from "./gebirgs-naehte.ts";
import { MAP_EXTENT } from "./hydrology/grid.ts";
import { leseGebirgsZusatz } from "./gebirge-zusatz.ts";
import { generateRidge } from "./ridge.ts";

/**
 * Die Eingaben der Gebirgsrechnung aus der Datenbank, so zusammengestellt wie Legacys Editor
 * (`height-render.js#L395-655`, aff0449a5), dazu die Regeln des Betreibers vom 2026-09-27.
 *
 * 🔴 Die Regeln ändern keinen gespeicherten Wert. Sie gelten beim Rechnen und stehen im
 * Fingerabdruck, damit eine geänderte Regel jedes betroffene Gebirge neu rechnet.
 */

/** Steigt mit jeder Änderung an den Regeln unten. */
export const TERRAIN_RULES_VERSION = "1";

/** Grundhöhe, wo Legacy keine Maximalhöhe führt (Betreiber 2026-09-27): klein und mittel 1.000 Schritt. */
export const GRUNDHOEHE_KLEIN = 1000;
/** … große Gebirge 1.500 Schritt. */
export const GRUNDHOEHE_GROSS = 1500;
/** Ab dieser Fläche (Karteneinheiten², rund 9.000 km²) ist ein Gebirge groß (Betreiber 2026-09-27). */
export const GROSS_AB_E2 = 1000;

export type KammQuelle = "kammlinie" | "beschriftungskurve" | "erzeugt" | "gipfel" | "keiner";

export interface MountainJob {
    areaId: number;
    areaPublicId: string;
    name: string;
    /** Fläche in Karteneinheiten². */
    flaeche: number;
    input: V12Input;
    kammQuelle: KammQuelle;
    kammlinieErzeugt: [number, number][] | null;
    /** Die angewandte Grundhöhe, wenn Legacy keine Maximalhöhe führt. */
    grundhoehe: number | null;
    /** Die Durchschnittshöhe aus Avesmaps3D (C3), sonst `null`. */
    durchschnittshoehe: number | null;
    /** Typ und Abweichungen, wie gespeichert (WI-0226, für den Editor); die Rechnung liest `input.regler`. */
    stand: GebirgsStand;
    fingerprint: string;
    /**
     * Rückennetz (WI-0247): Fingerabdruck der Form ohne Täler, an dem ein gefundener Talboden gemerkt wird (`terrain_raster`,
     * Migration 0213); `null` ohne gezeichneten Kamm.
     */
    talbodenFingerprint: string | null;
    /** Ein gemerkter Talboden derselben Form; setzt der Geländelauf aus `terrain_raster`, der Lader nie. */
    talbodenGemerkt: number | null;
    /**
     * Erosionsfestigkeit des Gebirges (WI-0249, Migration 0222, nur Fassung 19) als Anteil 0 bis 1 (gespeichert in Prozent), nur wenn es das
     * Rückennetz rechnet und der Wert über 0 liegt. Sie wirkt erst in der Erosion des Geländes (`domain/formerhalt.ts`), nicht in der Saat, und steht darum NICHT im Fingerabdruck der
     * Saat, sondern in dem der Eingaben des Geländes (`domain/inputs.ts`).
     */
    erosionsfestigkeit?: number;
}

type Polygonal = V12Input["geometry"];

interface AreaRow {
    area_id: string;
    public_id: string;
    name: string;
    geometry_revision: string | null;
    geometry: string;
    min_x: number;
    min_y: number;
    max_x: number;
    max_y: number;
    flaeche: number;
    koernung: number | null;
    stufen: number | null;
    erosion: number | null;
    plateau: number | null;
    hypsometrie: number | null;
    maximalhoehe: number | null;
    bergform: number | null;
    rauschen: number | null;
    sattel: number | null;
    talbreite: number | null;
    einschnitt: number | null;
    kammlinie: string | null;
    beschriftungskurve: string | null;
    durchschnittshoehe: number | null;
    gebirgstyp: string | null;
    muster: string | null;
    /** Die gewürfelte Saat (Migration 0214, Reiter „Gebirge“); leer heißt abgeleitet (`seedOf`). */
    saat: string | null;
}

/**
 * Das Gitter des Geländes für Rückennetz-Saaten (WI-0249 P2 Schritt 2): Zellmitten der groben Stufe (`terrain/hydrology/grid.ts`), nur mit
 * dem Formerhalt der Fassung (`mountainMorphology.rueckennetz`); sonst `null`, und die Saat rechnet ab dem Rahmen der Fläche wie zuvor.
 */
export function rueckennetzGitter(
    rezept: Pick<TerrainRecipe, "generator" | "mountainMorphology">,
): { zelle: number; mitte: number } | null {
    if (!rezept.mountainMorphology.rueckennetz) return null;
    const zelle = MAP_EXTENT / rezept.generator.size;
    return { zelle, mitte: zelle / 2 };
}

/** Wortgleich zu Legacys `ecosystemHeightSeed` (height-field.js#L149-157). */
export function seedOf(publicId: string, geometryRevision: number | null): number {
    const text = `${publicId}#${String(geometryRevision ?? 0)}`;
    let seed = 0;
    for (let i = 0; i < text.length; i += 1) {
        seed = (Math.imul(seed, 31) + text.charCodeAt(i)) | 0;
    }
    return seed;
}

/** Die Grundhöhe eines Gebirges ohne eigene Maximalhöhe. */
export function grundhoeheFor(flaeche: number): number {
    return flaeche >= GROSS_AB_E2 ? GRUNDHOEHE_GROSS : GRUNDHOEHE_KLEIN;
}

const line = (geoJson: string | null): [number, number][] | null =>
    geoJson ? (JSON.parse(geoJson) as { coordinates: [number, number][] }).coordinates : null;

/** Die Teile einer Linie (LineString oder MultiLineString) als Linienzüge. */
const parts = (geoJson: string): [number, number][][] => {
    const g = JSON.parse(geoJson) as { type: string; coordinates: unknown };
    return g.type === "LineString"
        ? [g.coordinates as [number, number][]]
        : g.type === "MultiLineString"
          ? (g.coordinates as [number, number][][])
          : [];
};

/**
 * Die Pässe eines Rückennetz-Gebirges (WI-0247): Wege vom Typ Gebirgspass mit einem Stützpunkt in der Fläche, wie die Flüsse. Das
 * Modell senkt das Gelände entlang der Route auf höchstens 30 % Steigung (`paesse.ts`).
 */
async function loadPasses(
    database: Queryable,
    mapDomainId: string,
    bounds: V12Input["bounds"],
    inside: (x: number, y: number) => boolean,
): Promise<Pass[]> {
    const rows = await database<{ public_id: string; name: string | null; geometry: string }[]>`
        SELECT public_id::text, name, ST_AsGeoJSON(geom, 15) AS geometry
        FROM path
        WHERE map_domain_id = ${mapDomainId} AND is_active AND subtype = 'Gebirgspass'
          AND geom && ST_MakeEnvelope(${bounds.min_x}, ${bounds.min_y}, ${bounds.max_x}, ${bounds.max_y}, 0)
        ORDER BY public_id
    `;
    return rows.flatMap((row) =>
        parts(row.geometry)
            .filter((part) => part.length >= 2 && part.some(([x, y]) => inside(x, y)))
            .map((punkte) => ({ id: row.public_id, name: row.name, punkte })),
    );
}

/**
 * Stellt die Eingaben aller aktiven Gebirge zusammen.
 *
 * @param only  optional nur diese Flächen (public_id oder Name), für Proben.
 * @param optionen.auchOhneWerte  auch Gebirge ohne Zeile in `terrain_control` (ein neues Gebirge im Editor, WI-0226); die Rechnung des
 *   Geländes nimmt sie nicht, sie kennt nur Gebirge mit Zeile.
 */
/**
 * Der erzeugte Kamm einer Fläche, je Prozess einmal (WI-0283): Er folgt allein aus ihrer Form, kostet aber mehrere Abfragen (Delaunay in PostGIS), und auf der Stage
 * braucht ihn der größte Teil der Gebirge. Ein Geländelauf lädt die Aufträge zweimal (Saaten, dann Schnappschuss); so rechnet er ihn beim ersten Mal.
 */
const erzeugteKaemme = new Map<string, [number, number][] | null>();
const KAEMME_HOECHSTENS = 2000;

async function erzeugterKamm(
    database: Queryable,
    area: { public_id: string; geometry: string },
): Promise<[number, number][] | null> {
    const schluessel = `${area.public_id}|${createHash("sha256").update(area.geometry).digest("hex")}`;
    const bekannt = erzeugteKaemme.get(schluessel);
    if (bekannt !== undefined) return bekannt;
    const kamm = await generateRidge(database, area.public_id);
    if (erzeugteKaemme.size >= KAEMME_HOECHSTENS) erzeugteKaemme.clear();
    erzeugteKaemme.set(schluessel, kamm);
    return kamm;
}

export async function loadMountainJobs(
    database: Queryable,
    mapDomainId: string,
    only: readonly string[] = [],
    optionen: { auchOhneWerte?: boolean } = {},
): Promise<MountainJob[]> {
    const areas = await database<AreaRow[]>`
        SELECT a.id::text AS area_id, a.public_id::text, r.name, a.geometry_revision::text,
               ST_AsGeoJSON(a.geom, 15) AS geometry,
               ST_XMin(a.geom) AS min_x, ST_YMin(a.geom) AS min_y, ST_XMax(a.geom) AS max_x, ST_YMax(a.geom) AS max_y,
               ST_Area(a.geom) AS flaeche,
               c.koernung, c.stufen, c.erosion, c.plateau, c.hypsometrie, c.maximalhoehe, c.bergform,
               c.rauschen, c.sattel, c.talbreite, c.einschnitt,
               ST_AsGeoJSON(c.kammlinie, 15) AS kammlinie,
               ST_AsGeoJSON(c.beschriftungskurve, 15) AS beschriftungskurve,
               c.durchschnittshoehe,
               -- Typ und Muster (WI-0226, Migration 0194) über to_jsonb: Vor der Migration fehlen die Spalten, dann steht hier leer statt
               -- eines Fehlers (Stände ohne 0194, geteilte lokale Datenbanken).
               to_jsonb(c) ->> 'gebirgstyp' AS gebirgstyp, to_jsonb(c) ->> 'muster' AS muster,
               to_jsonb(c) ->> 'saat' AS saat
        FROM region_area a
        JOIN region r ON r.id = a.region_id
        LEFT JOIN terrain_control c ON c.area_id = a.id AND c.is_active
        WHERE (c.id IS NOT NULL OR ${optionen.auchOhneWerte === true}::boolean)
          AND a.is_active AND a.map_domain_id = ${mapDomainId}
          AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        ORDER BY a.public_id
    `;
    // Die Presets der gültigen Fassung (F3). Ohne Gruppe (bis Fassung 19) bleibt ein gesetzter Typ ohne Wirkung; die Fassung rechnet
    // reproduzierbar wie bisher (Editor-Orchestrierung 2026-10-18).
    const rezept = await resolveTerrainRecipe(database, mapDomainId);
    const presets = rezept.gebirgsPresets ?? null;
    // Mit dem Formerhalt der Fassung (WI-0249 P2) rechnen Rückennetz-Saaten auf dem Gitter des Geländes; sonst ab dem Rahmen der Fläche.
    const gitter = rueckennetzGitter(rezept);
    // Gemeinsame Grenzen (OPS-000089): nur mit `andock` der Fassung (19), sonst bleiben Eingabe und Fingerabdruck.
    const andock = rezept.mountainMorphology.andock;
    const andockKanten = andock
        ? kantenJeGebirge(await ladeGebirgsNaehte(database, mapDomainId, only))
        : new Map<string, NahtKante[]>();
    const selected =
        only.length === 0 ? areas : areas.filter((a) => only.includes(a.public_id) || only.includes(a.name));

    // 🪤 Die Reihenfolge der Gipfel ist Teil der Rechnung: Bei Gleichstand im Spannbaum und beim
    // Aufaddieren der Kegel entscheidet sie das letzte Bit (Rote Sichel). Legacy liefert sie in der
    // Reihenfolge seiner Kennungen; der Import legt sie in genau dieser Reihenfolge an, und neue
    // Gipfel kommen in beiden Welten hinten dazu. Deshalb `id`, nicht `public_id`.
    const peaks = await database<{ x: number; y: number; height_schritt: number | null }[]>`
        SELECT ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt
        FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active
        ORDER BY id
    `;
    // Gezeichnete Kämme, Nebengipfel und die drei Werte des Rückennetzes je Fläche (WI-0245, Lesehelfer der Derographie).
    const zusaetze = await leseGebirgsZusatz(
        database,
        selected.map((area) => area.area_id),
    );

    // Flüsse und Seen einmal für alle, je Gebirge nur noch gefiltert (WI-0283): Vorher zwei Abfragen je Gebirge, bei 284 Gebirgen 568 Anfragen, und das zweimal je
    // Lauf (Claudio: `inputs` und `seeds` rund 30 s bei CPU/Wand 0,4). Der Rahmen aller Gebirge hält das Laden eines einzelnen so klein wie vorher.
    const rahmen = {
        min_x: Math.min(...selected.map((area) => area.min_x)),
        min_y: Math.min(...selected.map((area) => area.min_y)),
        max_x: Math.max(...selected.map((area) => area.max_x)),
        max_y: Math.max(...selected.map((area) => area.max_y)),
    };
    const alleFluesse =
        selected.length === 0
            ? []
            : await database<
                  {
                      public_id: string;
                      name: string | null;
                      is_bach: boolean;
                      flow_direction: string | null;
                      geometry: string;
                      min_x: number;
                      min_y: number;
                      max_x: number;
                      max_y: number;
                  }[]
              >`
                  SELECT public_id::text, name, is_bach, flow_direction, ST_AsGeoJSON(geom, 15) AS geometry,
                         ST_XMin(geom) AS min_x, ST_YMin(geom) AS min_y, ST_XMax(geom) AS max_x, ST_YMax(geom) AS max_y
                  FROM path
                  WHERE map_domain_id = ${mapDomainId} AND is_active AND subtype = 'Flussweg'
                    AND geom && ST_MakeEnvelope(${rahmen.min_x}, ${rahmen.min_y}, ${rahmen.max_x}, ${rahmen.max_y}, 0)
                  ORDER BY public_id
              `;
    const alleSeen =
        selected.length === 0
            ? []
            : await database<
                  { name: string; geometry: string; min_x: number; min_y: number; max_x: number; max_y: number }[]
              >`
                  SELECT r.name, ST_AsGeoJSON(l.geom, 15) AS geometry,
                         ST_XMin(l.geom) AS min_x, ST_YMin(l.geom) AS min_y, ST_XMax(l.geom) AS max_x, ST_YMax(l.geom) AS max_y
                  FROM region_area l JOIN region r ON r.id = l.region_id
                  WHERE l.map_domain_id = ${mapDomainId} AND l.is_active
                    AND r.region_layer = 'topographie' AND r.region_type = 'see'
                    AND NOT (ST_XMax(l.geom) < ${rahmen.min_x} OR ${rahmen.max_x} < ST_XMin(l.geom)
                          OR ST_YMax(l.geom) < ${rahmen.min_y} OR ${rahmen.max_y} < ST_YMin(l.geom))
                  ORDER BY l.public_id
              `;

    const jobs: MountainJob[] = [];
    for (const area of selected) {
        const geometry = JSON.parse(area.geometry) as Polygonal;
        const bounds = { min_x: area.min_x, min_y: area.min_y, max_x: area.max_x, max_y: area.max_y };
        // Das Hüllrechteck zuerst: Außerhalb liegt kein Punkt in der Fläche, und die allermeisten Gipfel und Stützpunkte liegen außerhalb.
        const inside = (x: number, y: number): boolean =>
            x >= bounds.min_x &&
            x <= bounds.max_x &&
            y >= bounds.min_y &&
            y <= bounds.max_y &&
            pointInGeometry([x, y], geometry);
        /** Berührt das Hüllrechteck das des Gebirges? (`seenFuer`, und für Flüsse die Vorauswahl vor dem Stützpunkt in der Fläche.) */
        const beruehrt = (kasten: { min_x: number; min_y: number; max_x: number; max_y: number }): boolean =>
            !(
                kasten.max_x < bounds.min_x ||
                bounds.max_x < kasten.min_x ||
                kasten.max_y < bounds.min_y ||
                bounds.max_y < kasten.min_y
            );

        // Gipfel: jeder in der Fläche, wie `gipfelDieserFlaeche` (height-render.js#L399-406).
        const ownPeaks = peaks.filter((p) => inside(p.x, p.y)).map((p) => ({ x: p.x, y: p.y, h: p.height_schritt }));

        // Flüsse: jeder Flussweg, von dem ein Stützpunkt in der Fläche liegt (`fluesseFuer`, #L419-454).
        const fluesse: V12Input["fluesse"] = [];
        for (const river of alleFluesse) {
            if (!beruehrt(river)) continue;
            for (const part of parts(river.geometry)) {
                if (part.length < 2 || !part.some(([x, y]) => inside(x, y))) {
                    continue;
                }
                fluesse.push({
                    n: river.name || river.public_id,
                    bach: river.is_bach === true,
                    dir:
                        river.flow_direction === "forward" || river.flow_direction === "reverse"
                            ? river.flow_direction
                            : null,
                    p: part,
                });
            }
        }

        // Seen: jede Seefläche, deren Hüllrechteck das des Gebirges berührt (`seenFuer`, #L465-486).
        const seen = alleSeen
            .filter(beruehrt)
            .map((lake) => ({ n: lake.name, g: JSON.parse(lake.geometry) as Polygonal }));

        // 🔴 Regel Grundhöhe: nur wo Legacy nichts führt; Legacys Werte bleiben (Betreiber 2026-09-27).
        const grundhoehe = area.maximalhoehe === null ? grundhoeheFor(area.flaeche) : null;

        // 🔴 Regel Kammlinie: eigene vor Beschriftungskurve; fehlen beide und trägt die Fläche weniger
        // als zwei Gipfel, erzeugen wir sie wie Legacys Knopf. Ab zwei Gipfeln spannt V12 den Kamm
        // selbst zwischen ihnen auf (`stempleKamm`, hydrologie.js#L836-973).
        let kurve = line(area.kammlinie);
        let kammQuelle: KammQuelle = kurve ? "kammlinie" : "keiner";
        let kammlinieErzeugt: [number, number][] | null = null;
        if (!kurve) {
            kurve = line(area.beschriftungskurve);
            if (kurve) {
                kammQuelle = "beschriftungskurve";
            } else if (ownPeaks.length >= 2) {
                kammQuelle = "gipfel";
            } else {
                kammlinieErzeugt = await erzeugterKamm(database, area);
                kurve = kammlinieErzeugt;
                kammQuelle = kurve ? "erzeugt" : "keiner";
            }
        }

        // Die Regler aus Typ und Abweichungen (WI-0226): EINE Funktion für das Gelände und die Vorschau des Editors. Ohne Typ dieselben
        // Schlüssel in derselben Folge wie vorher; die Folge steht im Fingerabdruck der Saat.
        const werte: GebirgsStand["werte"] = {};
        for (const k of GEBIRGS_WERTE) {
            const wert = area[k];
            if (wert !== null) werte[k] = wert;
        }
        const typ = (GEBIRGSTYPEN as readonly string[]).includes(area.gebirgstyp ?? "")
            ? (area.gebirgstyp as Gebirgstyp)
            : null;
        const muster = (GEBIRGS_MUSTER as readonly string[]).includes(area.muster ?? "")
            ? (area.muster as GebirgsMuster)
            : null;
        const stand: GebirgsStand = { typ, werte, muster, kammhoehe: area.maximalhoehe };
        const regler = gebirgsRegler(typ && presets ? presets.typen[typ] : null, stand, grundhoehe);

        const revision = area.geometry_revision === null ? null : Number(area.geometry_revision);
        const input: V12Input = {
            bounds,
            geometry,
            peaks: ownPeaks,
            kurve,
            fluesse,
            seen,
            regler,
            // Eine gewürfelte Saat gilt (WI-0245, 0214); ohne sie bleibt alles Zeichen für Zeichen wie vorher.
            saat: area.saat !== null ? Number(area.saat) : seedOf(area.public_id, revision),
        };
        const kanten = andockKanten.get(area.public_id);
        if (andock && kanten) input.andock = { kanten, streifen: andock.streifen };
        // Das Rückennetz (WI-0247): mit gezeichneter Linie oder Mulde, mit Köpfen (WI-0249 P2) auch nur mit Nebengipfeln
        // (`rechnetRueckennetz`); ohne bleibt die Eingabe Zeichen für Zeichen die der V12.
        const zusatz = zusaetze.get(area.area_id);
        let talbodenFingerprint: string | null = null;
        let erosionsfestigkeit: number | undefined;
        const rueckennetz = zusatz ? rueckennetzRegler(presets, typ, zusatz.modell, area.durchschnittshoehe) : null;
        if (zusatz && rueckennetz && rechnetRueckennetz(zusatz.netz, rueckennetz.form.kopf)) {
            input.kaemme = zusatz.netz.kaemme;
            input.nebengipfel = zusatz.netz.nebengipfel;
            if (zusatz.netz.mulden?.length) input.mulden = zusatz.netz.mulden;
            input.paesse = await loadPasses(database, mapDomainId, bounds, inside);
            input.rueckennetz = gitter ? { ...rueckennetz, gitter } : rueckennetz;
            // Nur mit den Presets der Fassung (19); leer und 0 sind „wie die Landschaftsart“.
            const festigkeit = presets !== null ? Number(zusatz.modell.erosionsfestigkeit) : 0;
            if (festigkeit > 0) erosionsfestigkeit = Math.min(1, festigkeit / 100);
            // Eigene Höhen an Flüssen und Seen (WI-0249, 0230; Vali wählte A, 2026-10-26): nur mit den Presets der Fassung (19), nur mit
            // Einträgen; ohne sie bleibt die Eingabe und damit der Fingerabdruck der Saat, wie er war. Sie wirken in der Saat und im Gelände
            // (`domain/inputs.ts`, `finishDomainTerrain`), nie in der Wegfindung.
            if (presets !== null && zusatz.netz.flussHoehen?.length) input.flussHoehen = zusatz.netz.flussHoehen;
            if (presets !== null && zusatz.netz.seeHoehen?.length) input.seeHoehen = zusatz.netz.seeHoehen;
            // Die Form ohne Täler: Ändern sich nur Flüsse, Seen, Talbreite oder Taltiefe, gilt der gemerkte Talboden weiter.
            const form = { ...input.regler };
            delete form.talbreite;
            delete form.einschnitt;
            talbodenFingerprint = createHash("sha256")
                .update(
                    JSON.stringify({
                        ...input,
                        fluesse: [],
                        seen: [],
                        flussHoehen: undefined,
                        seeHoehen: undefined,
                        regler: form,
                    }),
                )
                .update(`|${RUECKENNETZ_QUELLE}|${TERRAIN_RULES_VERSION}`)
                .update(auslaufMarke(input))
                .digest("hex");
        }
        const fingerprint = createHash("sha256")
            .update(JSON.stringify(input))
            .update(`|${V12_SOURCE}|${TERRAIN_RULES_VERSION}|${String(area.durchschnittshoehe)}`)
            .update(input.kaemme ? `|${RUECKENNETZ_QUELLE}` : "")
            .update(treffenMarke(input))
            .update(auslaufMarke(input))
            .digest("hex");
        jobs.push({
            areaId: Number(area.area_id),
            areaPublicId: area.public_id,
            name: area.name,
            flaeche: area.flaeche,
            input,
            kammQuelle,
            kammlinieErzeugt,
            grundhoehe,
            durchschnittshoehe: area.durchschnittshoehe,
            stand,
            fingerprint,
            talbodenFingerprint,
            talbodenGemerkt: null,
            ...(erosionsfestigkeit !== undefined ? { erosionsfestigkeit } : {}),
        });
    }
    return jobs;
}

/**
 * Die freien Gipfel: aktiv und in keinem aktiven Gebirge (Betreiber 2026-09-27: „egal ob gebirge oder
 * nicht“). In einem Gebirge trägt ihn V12 selbst.
 */
export async function loadFreePeaks(
    database: Queryable,
    mapDomainId: string,
    jobs: readonly MountainJob[],
): Promise<FreePeak[]> {
    const peaks = await database<{ x: number; y: number; height_schritt: number | null }[]>`
        SELECT ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt
        FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active ORDER BY public_id
    `;
    return peaks
        .filter((peak) => {
            return !jobs.some((job) => {
                const b = job.input.bounds;
                return (
                    peak.x >= b.min_x &&
                    peak.x <= b.max_x &&
                    peak.y >= b.min_y &&
                    peak.y <= b.max_y &&
                    pointInGeometry([peak.x, peak.y], job.input.geometry)
                );
            });
        })
        .map((peak) => ({ x: peak.x, y: peak.y, h: peak.height_schritt }));
}

/**
 * Punkt trifft seine Höhe im Fingerabdruck der Saat (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe): `|treffen@…` nur, wo die Saat
 * Punkte anheftet (Presets der Fassung und mindestens ein Punkt mit eigener Höhe außerhalb der Seen), sonst leer. Ist ein Flusspunkt Ziel
 * (WI-0259: das Umland folgt der Flusshöhe), dazu `|treffen@WI-0259-…`; ist ein Punkt am Ufer eines Sees Ziel (Seen wie Flüsse), dazu
 * `|treffen-see@WI-0259-…`. So rechnet ein Gebirge, dessen Saat sich ändert, nach dem Wechsel neu; eines ohne eigene Fluss- und Seehöhen behält
 * Fingerabdruck und Saat.
 */
export function treffenMarke(input: V12Input): string {
    if (!input.rueckennetz?.punktHoehenAbsolut) return "";
    const ziele = eigeneZiele(input);
    if (ziele.punkte.length === 0) return "";
    const fluss = ziele.punkte.some((p) => p.wasser === "fluss") ? `|${TREFFEN_FLUSS_QUELLE}` : "";
    const see = ziele.punkte.some((p) => p.wasser === "see") ? `|${TREFFEN_SEE_QUELLE}` : "";
    return `|${TREFFEN_QUELLE}${fluss}${see}`;
}

/**
 * Hinter dem letzten Knoten fällt eine Linie zum freien Ende ab (WI-0249; Vali 2026-10-30) im Fingerabdruck der Saat und des gemerkten
 * Talbodens: `|kamm-auslauf@…` nur, wo eine Linie mit eigenen Punkthöhen über ihren ersten oder letzten Knoten hinaus frei endet
 * (`faelltZumFreienEnde`), sonst leer. So rechnet nur ein Gebirge neu, dessen Saat sich ändert.
 */
export function auslaufMarke(input: V12Input): string {
    if (!input.kaemme) return "";
    const punkte = [...input.peaks, ...(input.nebengipfel ?? [])];
    return faelltZumFreienEnde(input.kaemme, punkte) ? `|${KAMM_AUSLAUF_QUELLE}` : "";
}
