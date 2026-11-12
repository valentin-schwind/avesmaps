import { createHash } from "node:crypto";
import { eigeneZiele, type TreffZiele, type WasserHoehe } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import type { AreaGeometry } from "../hydrology/water.ts";
import type { WaterArea } from "../hydrology/water.ts";
import type { MaterialArea } from "./materials.ts";
import type { StoredRaster } from "../dem-tiles.ts";
import { loadRiverInputs } from "../river-inputs.ts";
import type { RiverInputs } from "../river-inputs.ts";
import { resolveTerrainRecipe } from "../auswahl.ts";
import { ladeGebirgsNaehte } from "../gebirgs-naehte.ts";
import { grundhoeheFor, loadMountainJobs, type MountainJob } from "../inputs.ts";
import type { GebirgsNaht } from "./naht.ts";
import { gelaendeErosion, rueckennetzNetz, type RueckennetzNetz } from "./rueckennetz-flaechen.ts";
import type { PeakFloor } from "./peak-floor.ts";

/** Was die Prüfung der Saaten von einem Gebirge kennt; `name`, `kammQuelle` und `input` nur für die Meldung. */
export interface SeedJob {
    areaPublicId: string;
    fingerprint: string;
    name?: string;
    kammQuelle?: string;
    input?: object;
    durchschnittshoehe?: number | null;
}

/**
 * Je Teil der V12-Eingabe eines Gebirges ein kurzer Hash (WI-0223, Befund Stage 1696): Sagt die Prüfung „veraltet“, obwohl die
 * Saat-Phase kurz davor dasselbe Gebirge für aktuell hielt, zeigt der Vergleich zweier Ladungen, welcher Teil wechselt.
 */
export function mountainInputParts(job: SeedJob): Record<string, string> {
    const parts: Record<string, string> = {};
    for (const [key, value] of Object.entries(job.input ?? {}))
        parts[key] = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 10);
    parts["durchschnittshoehe"] = String(job.durchschnittshoehe ?? null);
    return parts;
}

export class StaleDomainSeedError extends Error {
    readonly seedId: string;
    readonly job: SeedJob | undefined;
    constructor(seedId: string, stored: string | null, job: SeedJob | undefined) {
        const what = job
            ? ` (${job.name ?? "?"}, Kamm ${job.kammQuelle ?? "?"}; gespeichert ${(stored ?? "keiner").slice(0, 12)}, jetzt ${job.fingerprint.slice(0, 12)})`
            : ` (kein aktives Gebirge mehr; gespeichert ${(stored ?? "keiner").slice(0, 12)})`;
        super(`Domain terrain has stale V12 seed ${seedId}${what}: derive:terrain first`);
        this.seedId = seedId;
        this.job = job;
    }
}

export function assertCurrentDomainSeeds(
    seeds: readonly { id: string; v12_fingerprint: string | null }[],
    jobs: readonly SeedJob[],
): void {
    const current = new Map(jobs.map((job) => [job.areaPublicId, job]));
    for (const seed of seeds) {
        const job = current.get(seed.id);
        if (job?.fingerprint !== seed.v12_fingerprint)
            throw new StaleDomainSeedError(seed.id, seed.v12_fingerprint, job);
    }
}

/**
 * Wie `assertCurrentDomainSeeds`, aber eine veraltete Saat lädt ihr Gebirge ein zweites Mal (Diagnose WI-0223).
 *
 * - Passt die zweite Ladung zur Saat, war die erste ein Ausreißer: Auf der Stage fällt der erzeugte Kamm beim Laden ALLER Gebirge
 *   gelegentlich anders aus (Claudio 2026-10-19, Stage-Jobs 1696 und 2117: etwa eine von fünf Ladungen, Altimont; lokal und für ein
 *   Gebirge allein stabil). Gerechnet wird dann mit der Saat; die Antwort nennt das Gebirge, damit es sichtbar bleibt.
 * - Passt auch die zweite nicht, ist die Saat wirklich veraltet. Die Meldung nennt die Teile, die zwischen beiden Ladungen wechseln.
 */
export async function pruefeSaaten(
    seeds: readonly { id: string; v12_fingerprint: string | null }[],
    jobs: readonly SeedJob[],
    nachladen: (areaPublicId: string) => Promise<SeedJob | undefined>,
): Promise<string[]> {
    const current = new Map(jobs.map((job) => [job.areaPublicId, job]));
    const ausreisser: string[] = [];
    for (const seed of seeds) {
        const job = current.get(seed.id);
        if (job?.fingerprint === seed.v12_fingerprint) continue;
        const stale = new StaleDomainSeedError(seed.id, seed.v12_fingerprint, job);
        if (!job) throw stale;
        const again = await nachladen(job.areaPublicId);
        if (again?.fingerprint === seed.v12_fingerprint) {
            ausreisser.push(job.name ?? seed.id);
            continue;
        }
        const first = mountainInputParts(job);
        const second = again ? mountainInputParts(again) : {};
        const changing = Object.keys(first).filter((key) => first[key] !== second[key]);
        throw new Error(
            `${stale.message}; zweite Ladung ${again ? again.fingerprint.slice(0, 12) : "ohne das Gebirge"}, ` +
                `${changing.length > 0 ? `wechselnde Teile ${changing.join(", ")}` : "alle Teile gleich"}; Teile ${JSON.stringify(first)}`,
            { cause: stale },
        );
    }
    return ausreisser;
}

/** Prüft die Saaten gegen die Aufträge aller Gebirge und gibt die Aufträge zurück (WI-0249 P2: daraus kommt das Netz der Rückennetze). */
async function assertSeedsWithDiagnosis(
    database: Queryable,
    mapDomainId: string,
    seeds: readonly { id: string; v12_fingerprint: string | null }[],
): Promise<MountainJob[]> {
    const jobs = await loadMountainJobs(database, mapDomainId);
    const ausreisser = await pruefeSaaten(
        seeds,
        jobs,
        async (areaPublicId) => (await loadMountainJobs(database, mapDomainId, [areaPublicId]))[0],
    );
    if (ausreisser.length > 0)
        console.warn(
            `Gelände: die Saat von ${ausreisser.join(", ")} passt erst beim zweiten Laden; gerechnet wird mit der Saat (Stage 1696, 2117)`,
        );
    return jobs;
}

export interface DomainPeak {
    id: string;
    name: string;
    x: number;
    y: number;
    h: number | null;
    /** Volcanoes get a round cone with a small caldera instead of a faceted summit. */
    volcano?: boolean;
}
export interface RueckennetzGebirge {
    id: string;
    geometry: AreaGeometry;
    /** Kammhöhe in Schritt: die Kammhöhe der Fläche, mindestens die höchste Zelle ihrer Saat. */
    deckel: number;
    /**
     * Das gezeichnete Netz (WI-0249 P2, `rueckennetzNetz`): Kämme und gesetzte Punkte für das Feld des Formerhalts. Es folgt aus derselben
     * Eingabe wie die Saat (deren Fingerabdruck im Eingabe-Fingerabdruck steht) und zählt darum nicht noch einmal.
     */
    netz?: RueckennetzNetz;
    /** Erosion im Gelände (Typwert `form.gelaendeErosion`, `gelaendeErosion`): 0 bis unter 1; fehlt sie, erodiert das Gebirge voll. */
    erosion?: number;
    /**
     * Erosionsfestigkeit (WI-0249, Fassung 19; Betreiber 2026-10-25): 0 bis 1, nur über 0. Die Erodierbarkeit seiner Zellen mal `1 − festigkeit`,
     * dazu sein Hebungsgewicht in der Rückverteilung (`formerhalt.ts`); 1 lässt die Erosion der Landfläche das Gebirge nicht berühren.
     */
    festigkeit?: number;
    /** Index seiner Saat in `DomainInputs.seeds` (für die Köpfe der Nebengipfel, `stelleKoepfeWieder`); folgt aus den Saaten. */
    saat?: number;
    /**
     * Eigene Höhen an Flüssen und Seen (WI-0249, 0230; Vali wählte A, 2026-10-26; nur Fassung 19): Seespiegel und Stützpunkte der Flüsse, die das
     * Einbrennen der Flüsse und das Ebnen der Seen übernehmen (`finishDomainTerrain`). Sie stehen in der Eingabe der Saat und damit in ihrem
     * Fingerabdruck; fehlen sie, rechnet das Gelände Zeichen für Zeichen wie zuvor.
     */
    wasser?: { fluesse: WasserHoehe[]; seen: WasserHoehe[] };
    /**
     * Punkte mit eigener Höhe (WI-0249, Fassung 19; Vali wählte: Punkt trifft seine Höhe): Stütz- und Talpunkte, Nebengipfel und Mulden, die das
     * Gelände nach Erosion, Brennen und Köpfen weich auf ihre Höhe heftet (`triffEigeneHoehen`); dazu die Stützpunkte der Flüsse mit eigenen
     * Höhen und die Ufer der Seen mit eigener Höhe (WI-0259), an denen das Umland der Wasserhöhe folgt (Bett und See übernehmen Brennen und
     * Seen). Sie folgen aus derselben Eingabe wie die Saat (Fingerabdruck mit `TREFFEN_QUELLE`, mit Flüssen dazu `TREFFEN_FLUSS_QUELLE`, mit
     * Seen `TREFFEN_SEE_QUELLE`); fehlen sie, rechnet das Gelände Zeichen für Zeichen wie zuvor.
     */
    ziele?: TreffZiele;
}
export interface DomainInputs {
    continent: { id: string; geometry: AreaGeometry; fingerprint: string };
    land: AreaGeometry[];
    water: WaterArea[];
    landscapes: MaterialArea[];
    seeds: StoredRaster[];
    generatedLegacySeeds?: { id: string; name: string }[];
    peaks: DomainPeak[];
    /**
     * Je Gipfel jede Gebirgsfläche, in der er liegt, mit deren Grundhöhe (`peak-floor.ts`): nur für den Befund
     * `gelaende/gipfel_unter_grundhoehe`, nicht im Fingerabdruck (es folgt aus Flächen, Gipfeln und Saaten, die schon darin sind).
     */
    peakFloors?: PeakFloor[];
    /**
     * Gebirge mit gezeichneten Kämmen (WI-0247, `rueckennetz-flaechen.ts`): ihre Saat ist die fertige Form, `deckel` die Kammhöhe.
     * Fehlt ohne solche Gebirge; dann rechnet das Gelände Zeichen für Zeichen wie zuvor.
     */
    rueckennetz?: RueckennetzGebirge[];
    /**
     * Angedockte Flächen (OPS-000089, `naht.ts`), nur mit `andock` der Fassung: Sie folgen aus den Flächen, die schon im Fingerabdruck stehen, darum nicht darin.
     */
    naehte?: GebirgsNaht[];
    rivers: RiverInputs;
    fingerprint: string;
}

export async function loadContinentInput(
    database: Queryable,
    mapDomainId: string,
): Promise<{ id: string; geometry: AreaGeometry; fingerprint: string }> {
    const rows = await database<{ id: string; geometry: string }[]>`
        SELECT a.public_id::text AS id,
               ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3), 15) AS geometry
        FROM region_area a
        JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
          AND r.region_layer = 'derographisch' AND r.region_type = 'kontinent' AND r.name = 'Aventurien'
        ORDER BY a.public_id
    `;
    if (rows.length !== 1)
        throw new Error(`Kontinent Aventurien: genau eine aktive Fläche erwartet, ${String(rows.length)} gefunden`);
    const row = rows[0]!;
    const geometry = JSON.parse(row.geometry) as AreaGeometry;
    return {
        id: row.id,
        geometry,
        fingerprint: createHash("sha256").update(`${row.id}|${row.geometry}`).digest("hex"),
    };
}

export async function loadDomainInputs(database: Queryable, mapDomainId: string): Promise<DomainInputs> {
    return (await loadDomainInputsUndAuftraege(database, mapDomainId)).input;
}

/**
 * Die Eingaben samt den Aufträgen der Gebirge, aus denen sie geprüft wurden. Wer in derselben Lesetransaktion auch den Index braucht (`loadDomainInputIndex`),
 * gibt sie dort mit: Das Laden aller Gebirge liest Flächen, Gipfel und Kämme und lief sonst zweimal je Lauf (WI-0283).
 */
export async function loadDomainInputsUndAuftraege(
    database: Queryable,
    mapDomainId: string,
): Promise<{ input: DomainInputs; jobs: MountainJob[] }> {
    const continent = await loadContinentInput(database, mapDomainId);
    const [areas, seeds, peakRows, rivers] = await Promise.all([
        database<{ id: string; layer: "topographie" | "vegetation"; type: string | null; geometry: string }[]>`
            SELECT a.public_id::text AS id, r.region_layer AS layer, r.region_type AS type,
                   ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(a.geom, 'method=structure'), 3), 15) AS geometry
            FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
            WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
              AND r.region_layer IN ('topographie', 'vegetation') ORDER BY a.public_id
        `,
        database<
            {
                cell: number;
                origin_x: number;
                origin_y: number;
                width: number;
                height: number;
                v12_samples: Buffer | null;
                v12_fingerprint: string | null;
                id: string;
                name: string;
                maximalhoehe: number | null;
            }[]
        >`
            SELECT t.cell, t.origin_x, t.origin_y, t.width, t.height, t.v12_samples, t.v12_fingerprint,
                   a.public_id::text AS id, r.name, c.maximalhoehe
            FROM terrain_control c JOIN region_area a ON a.id = c.area_id AND a.is_active
            JOIN region r ON r.id = a.region_id AND r.is_active
            LEFT JOIN terrain_raster t ON t.area_id = c.area_id
            WHERE c.is_active AND a.map_domain_id = ${mapDomainId} AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
            ORDER BY a.public_id
        `,
        database<{ id: string; name: string; x: number; y: number; h: number | null; volcano: boolean }[]>`
            SELECT public_id::text AS id, name, ST_X(geom) AS x, ST_Y(geom) AS y, height_schritt AS h,
                subtype = 'vulkan' AS volcano
            FROM terrain_peak_gelaende WHERE map_domain_id = ${mapDomainId} AND is_active ORDER BY public_id
        `,
        loadRiverInputs(database, mapDomainId),
    ]);
    const floorRows = await database<
        { peak: string; area: string; name: string; maximalhoehe: number | null; flaeche: number }[]
    >`
        SELECT p.public_id::text AS peak, a.public_id::text AS area, r.name, c.maximalhoehe, ST_Area(a.geom) AS flaeche
        FROM terrain_control c JOIN region_area a ON a.id = c.area_id AND a.is_active
        JOIN region r ON r.id = a.region_id AND r.is_active
        JOIN terrain_peak_gelaende p ON p.map_domain_id = a.map_domain_id AND p.is_active AND ST_Contains(a.geom, p.geom)
        WHERE c.is_active AND a.map_domain_id = ${mapDomainId} AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
        ORDER BY a.public_id, p.public_id
    `;
    const jobs = await assertSeedsWithDiagnosis(database, mapDomainId, seeds);
    const landscapes: MaterialArea[] = areas.map((a) => ({
        layer: a.layer,
        type: a.type,
        geometry: JSON.parse(a.geometry),
    }));
    const land = [
        continent.geometry,
        ...landscapes.filter((a) => a.layer === "topographie" && a.type !== "meer").map((a) => a.geometry),
    ];
    const water: WaterArea[] = landscapes
        .filter((a) => a.layer === "topographie" && (a.type === "meer" || a.type === "see"))
        .map((a) => ({ kind: a.type as "meer" | "see", geometry: a.geometry }));
    const rasters: StoredRaster[] = seeds.map((row) => {
        if (!row.v12_samples || !row.v12_fingerprint)
            throw new Error("Domain terrain needs current V12 seeds: derive:terrain first");
        const bytes = row.v12_samples;
        return {
            cell: row.cell,
            originX: row.origin_x,
            originY: row.origin_y,
            width: row.width,
            height: row.height,
            samples: new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
        };
    });
    const hash = createHash("sha256")
        .update(continent.fingerprint)
        .update(JSON.stringify(areas))
        .update(JSON.stringify(peakRows))
        .update(rivers.fingerprint);
    // Dieselbe Regel wie der Lader der Saaten (`terrain/inputs.ts`): Rückennetz mit gezeichneter Linie oder Mulde, mit Köpfen der Fassung
    // auch nur mit Nebengipfeln (WI-0249 P2). Der Auftrag trägt dann `input.rueckennetz`.
    const auftraege = new Map(jobs.map((job) => [job.areaPublicId, job]));
    const rueckennetz: RueckennetzGebirge[] = [];
    seeds.forEach((row, index) => {
        // Die Kammtafel liest der Lader des Netzes (`loadMountainJobs`), nicht der Generator (`compute-height-isolation.test.ts`).
        const job = auftraege.get(row.id);
        if (job?.input.rueckennetz === undefined) return;
        const area = areas.find((a) => a.id === row.id);
        if (!area) return;
        let hoechste = 0;
        for (const sample of rasters[index]!.samples) if (sample > hoechste) hoechste = sample;
        const erosion = gelaendeErosion(job.input);
        // Dieselben Ziele wie die Saat (`rechne.ts`), mit den Flüssen eigener Höhe (WI-0259).
        const ziele = job.input.rueckennetz.punktHoehenAbsolut
            ? eigeneZiele({
                  ...(job.input.kaemme ? { kaemme: job.input.kaemme } : {}),
                  ...(job.input.nebengipfel ? { nebengipfel: job.input.nebengipfel } : {}),
                  ...(job.input.mulden ? { mulden: job.input.mulden } : {}),
                  seen: job.input.seen,
                  fluesse: job.input.fluesse,
                  flussHoehen: job.input.flussHoehen,
                  seeHoehen: job.input.seeHoehen,
                  geometry: job.input.geometry,
              })
            : undefined;
        rueckennetz.push({
            id: row.id,
            geometry: JSON.parse(area.geometry) as AreaGeometry,
            deckel: Math.max(row.maximalhoehe ?? 0, hoechste),
            netz: rueckennetzNetz(job.input),
            saat: index,
            ...(erosion !== undefined ? { erosion } : {}),
            ...(job.erosionsfestigkeit !== undefined ? { festigkeit: job.erosionsfestigkeit } : {}),
            ...(job.input.flussHoehen?.length || job.input.seeHoehen?.length
                ? { wasser: { fluesse: job.input.flussHoehen ?? [], seen: job.input.seeHoehen ?? [] } }
                : {}),
            ...(ziele && ziele.punkte.length > 0 ? { ziele } : {}),
        });
    });
    // Angedockte Flächen (OPS-000089): nur mit `andock` der Fassung, und nur, wo beide Flächen in den Eingaben stehen.
    const naehte: GebirgsNaht[] = [];
    if ((await resolveTerrainRecipe(database, mapDomainId)).mountainMorphology.andock) {
        const formen = new Map(areas.map((a) => [a.id, a.geometry]));
        for (const paar of await ladeGebirgsNaehte(database, mapDomainId)) {
            const a = formen.get(paar.a);
            const b = formen.get(paar.b);
            if (a && b)
                naehte.push({
                    a: JSON.parse(a) as AreaGeometry,
                    b: JSON.parse(b) as AreaGeometry,
                    bFest: paar.bFest,
                });
        }
    }
    // Nur mit Rückennetz: Ohne bleibt der Fingerabdruck der Eingaben, wie er war.
    // Die Erosionsfestigkeit (Fassung 19) wirkt erst im Gelände, nicht in der Saat: Sie steht hier, nur wenn sie über 0 liegt.
    if (rueckennetz.length > 0)
        hash.update(
            JSON.stringify(
                rueckennetz.map((r) =>
                    r.festigkeit === undefined ? [r.id, r.deckel] : [r.id, r.deckel, r.festigkeit],
                ),
            ),
        );
    for (const row of seeds)
        hash.update(
            JSON.stringify([row.cell, row.origin_x, row.origin_y, row.width, row.height, row.v12_fingerprint]),
        ).update(row.v12_samples!);
    const input: DomainInputs = {
        continent,
        land,
        water,
        landscapes,
        seeds: rasters,
        generatedLegacySeeds: seeds.filter((row) => row.maximalhoehe === null).map(({ id, name }) => ({ id, name })),
        peaks: peakRows.map((p) => ({ ...p })),
        peakFloors: floorRows.map((row) => ({
            peakId: row.peak,
            areaId: row.area,
            gebirge: row.name,
            grundhoehe: row.maximalhoehe ?? grundhoeheFor(row.flaeche),
            quelle: row.maximalhoehe === null ? "vorgabe" : "kammhoehe",
        })),
        ...(rueckennetz.length > 0 ? { rueckennetz } : {}),
        ...(naehte.length > 0 ? { naehte } : {}),
        rivers,
        fingerprint: hash.digest("hex"),
    };
    return { input, jobs };
}
