import { createHash } from "node:crypto";
import { AVENTURIA, AVENTURIA_POLITICAL_CARTOGRAPHY, borderNameAllowed } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { deriveBandRuns } from "./derive-band-runs.ts";
import { deriveClaimShapes } from "./derive-claims.ts";
import {
    copyInnerEdges,
    createInnerBorderTables,
    deleteInnerEdges,
    deriveInnerBorders,
} from "./derive-inner-borders.ts";
import { planeTeillauf, type AbleitungsBild, type DeriveAbdruck, type TeilPlan } from "./derive-plan.ts";
import {
    assignAreasToBands,
    displayedTerritories,
    type AreaNode,
    type AssignmentResult,
    type DisplayedTerritory,
    type TerritoryNode,
} from "./resolve.ts";

/**
 * Leitet die Flächen, Grenzen, Namensanker und Hauptstadtzeiger der Herrschaftsgebiete ab (WI-0062, ADR-0014).
 *
 * 🔴 Derived Data, jederzeit wiederholbar, nie Wahrheit. Sie entsteht aus `territory` und `territory_area` und stirbt
 * mit ihnen - eine verwaiste Hülle ist so nicht mehr möglich (MCS-022). Eine Transaktion: entweder steht die neue
 * Ableitung ganz, oder die alte bleibt.
 *
 * Je Band (Legacy-Zoom, 0 bis `maxBand` der Tafel):
 *  1. Jede im Anzeigejahr geltende Fläche bekommt ihr Anzeigegebiet (`resolve.ts`, Legacys Regel).
 *  2. Die Flächen eines Anzeigegebiets werden vereinigt (`ST_UnaryUnion`; ungültige Flächen zuvor mit MakeValid
 *     repariert, nur die ungültigen). Der Name steht am Pol der Unzugänglichkeit des größten Teils.
 *  3. Hüllen: für jeden Vorfahren die Vereinigung aller gezeigten Nachfahren. Ihr Umriss ist die Außengrenze; die
 *     gemeinsamen Kanten der direkten Kinder eines Elters sind seine Innengrenzen, je Kante EINE Linie
 *     (`derive-inner-borders.ts`: die Flächen werden zu überlappungsfreien Zellen, dann zählt die Kante zwischen zwei Zellen).
 *  4. Namen entlang der Außengrenze (Nachtrag 2026-09-29, Legacy `drawTerritoryBorderLabels`): der Umriss des größten
 *     Teils einer Hülle mit gezeigten Nachfahren, wenn ihr Name nicht zu den ausgenommenen gehört, als Grenzart `name`.
 *  5. Schraffur umstrittener Gebiete (Nachtrag 2026-09-30, `derive-claims.ts`): die Flächen der Gebiete mit Anspruch, und
 *     die Füllung ohne sie.
 *  6. Durchläufe gleicher Zeilen über benachbarte Bänder (`derive-band-runs.ts`), damit die Kachel sie nur einmal trägt.
 *
 * 🔴 **Teillauf (WI-0283, `teilweise`, nur der Auftrag nach einer Editoränderung):** Dieselben Anweisungen, beschränkt auf das, was sich laut Vergleich mit dem
 * Abdruck des letzten Laufs ändert (`derive-plan.ts`). Der volle Lauf bleibt für Züge, Importe und die Kommandozeile, ohne passenden Abdruck, bei breiten
 * Änderungen und spätestens einmal am Tag.
 *
 * 🔴 Alle Bänder werden abgeleitet und tragen ihre Nummer in der Kachel: Welches Band die Karte zeigt, folgt allein dem
 * Kamerazoom (Stil, `politicalBandForCameraZoom`), nie dem Zoom einer Kachel.
 *
 * 🔴 Alle Hüllen sind RECHTSLÄUFIG ausgerichtet (Außenring im Uhrzeigersinn, Löcher dagegen): das Innere der Hülle liegt in
 * Laufrichtung immer RECHTS. Darauf verlassen sich zwei Stellen des Stils - die Außengrenze, die Legacy INNEN an die Grenze
 * legt (`line-offset` nach rechts), und der Name, der auf der Innenseite steht (`text-offset` nach rechts).
 *
 * Das Anzeigejahr steht in der Kartografie (`displayYearBf`), nicht hier. Die Revision (zwölf Zeichen SHA-256) hängt
 * an Jahr, Gebietsattributen, Flächen (Prüfsumme der Geometrie) und der Version dieser Ableitung: gleiche Eingaben,
 * gleiche Revision, und ein Lauf ohne Änderung rechnet nichts.
 */

/** Wer den Algorithmus ändert, erhöht die Zahl: die Revision ändert sich, die Kacheln werden neu geholt. */
export const TERRITORY_DERIVE_VERSION = 4;

export interface TerritoryDeriveOptions {
    mapDomainId?: string;
    /** Für Tests; sonst die zentrale Einstellung der Kartografie. */
    displayYearBf?: number;
    /** Rechnet auch bei unveränderter Revision, immer voll. */
    force?: boolean;
    /** Nur den betroffenen Bereich rechnen, wenn der Abdruck des letzten Laufs dazu passt (WI-0283); sonst voll. */
    teilweise?: boolean;
    /** Die Uhr, für Tests. */
    nowMs?: number;
}

export interface BandDeriveReport {
    band: number;
    shapes: number;
    outer: number;
    inner: number;
    notShownNoBand: number;
    notShownOwnBand: number;
    /** Rechenzeit dieses Bandes in der Transaktion (WI-0229 S0). */
    ms: number;
}

export interface TerritoryDeriveReport {
    revision: string;
    /** Hat die Revision gewechselt (oder gab es keine)? */
    revisionChanged: boolean;
    computed: boolean;
    /** Wie gerechnet wurde; `null` ohne Rechnung. */
    modus: "voll" | "teil" | null;
    /** Warum ein angefragter Teillauf voll rechnete (`derive-plan.ts`). */
    vollGrund: string | null;
    /** Im Teillauf: geänderte Formen über alle Bänder. */
    geaenderteFormen: number;
    yearBf: number;
    territories: number;
    areas: number;
    /** Im Anzeigejahr geltende Flächen, die ein Band nicht zeigt, nach Band. */
    bands: BandDeriveReport[];
    /** Flächen, die im Anzeigejahr gar nicht gelten. */
    notCurrent: number;
    /** Flächen, die ungültig sind und beim Lesen repariert wurden. */
    repairedAreas: number;
    capitals: number;
    ms: number;
    /**
     * Die Abschnitte eines Laufs in Millisekunden, die Schritte je Band über alle Bänder summiert (WI-0229 S0: wohin die 46 s gehen, bevor
     * die Ableitung schneller wird). Ohne Rechnung nur `lesen` und `zuordnen`.
     */
    phasesMs: Record<string, number>;
    rssMb: number;
}

interface TerritoryRow {
    id: number;
    publicId: string;
    name: string;
    parentId: number | null;
    parentPublicId: string | null;
    minZoom: number | null;
    maxZoom: number | null;
    validFromBf: number | null;
    validToBf: number | null;
    color: string;
    opacity: string;
    sortOrder: number;
    territoryType: string | null;
    capital: string | null;
    /** Aus Legacy importiert (`source_system = 'legacy'`): nur diese vergleicht der Prüfer mit Legacys Werten (`legacyBandDifferences`). */
    legacy: boolean;
}

interface AreaRow {
    id: number;
    publicId: string;
    territoryId: number;
    territoryPublicId: string;
    validFromBf: number | null;
    validToBf: number | null;
    minZoom: number | null;
    maxZoom: number | null;
    geomHash: string;
    isValid: boolean;
    legacy: boolean;
}

/** Ein aktiver Anspruch: das Gebiet `territory` wird von `claimant` beansprucht (Reihenfolge = Streifenfolge). */
interface ClaimRow {
    territoryPublicId: string;
    claimantPublicId: string;
    sortOrder: number;
}

export interface DeriveInputs {
    territories: TerritoryRow[];
    areas: AreaRow[];
    claims: ClaimRow[];
}

/** Was die Grenzen außer den Eingaben bestimmt; steht auch in der Revision. */
export function ableitungsKonfig(): string {
    const names = AVENTURIA_POLITICAL_CARTOGRAPHY.borderName;
    const unique = AVENTURIA_POLITICAL_CARTOGRAPHY.innerUnique;
    return JSON.stringify([
        names.fromBand,
        names.excludeNamePattern,
        names.minPoints,
        names.smoothing,
        names.coincidenceUnits,
        unique.toleranceUnits,
        unique.share,
        unique.coincidenceUnits,
        unique.minLengthUnits,
    ]);
}

/** Liest die Eingaben der Ableitung: Gebiete und Flächen (mit Prüfsumme der Geometrie). */
export async function readDeriveInputs(database: Queryable, mapDomainId: string): Promise<DeriveInputs> {
    const territories = await database<TerritoryRow[]>`
        SELECT t.id::int AS id, t.public_id::text AS "publicId", t.name, t.parent_id::int AS "parentId",
               p.public_id::text AS "parentPublicId", t.min_zoom AS "minZoom", t.max_zoom AS "maxZoom",
               t.valid_from_bf AS "validFromBf", t.valid_to_bf AS "validToBf", t.color, t.opacity::text AS opacity,
               t.sort_order AS "sortOrder", t.territory_type AS "territoryType",
               t.capital_place_public_id::text AS capital, t.source_system = 'legacy' AS legacy
        FROM territory t
        LEFT JOIN territory p ON p.id = t.parent_id
        WHERE t.map_domain_id = ${mapDomainId} AND t.is_active
        ORDER BY t.public_id
    `;
    const areas = await database<AreaRow[]>`
        SELECT a.id::int AS id, a.public_id::text AS "publicId", a.territory_id::int AS "territoryId",
               t.public_id::text AS "territoryPublicId", a.valid_from_bf AS "validFromBf", a.valid_to_bf AS "validToBf",
               a.min_zoom AS "minZoom", a.max_zoom AS "maxZoom",
               encode(sha256(ST_AsEWKB(a.geom)), 'hex') AS "geomHash", a.is_valid AS "isValid",
               a.source_system = 'legacy' AS legacy
        FROM territory_area a
        JOIN territory t ON t.id = a.territory_id
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active AND t.is_active
        ORDER BY a.public_id
    `;
    const claims = await database<ClaimRow[]>`
        SELECT o.public_id::text AS "territoryPublicId", c.public_id::text AS "claimantPublicId", tc.sort_order AS "sortOrder"
        FROM territory_claim tc
        JOIN territory o ON o.id = tc.territory_id AND o.is_active
        JOIN territory c ON c.id = tc.claimant_id AND c.is_active
        WHERE tc.is_active AND o.map_domain_id = ${mapDomainId}
        ORDER BY o.public_id, tc.sort_order, c.public_id
    `;
    return { territories: [...territories], areas: [...areas], claims: [...claims] };
}

export function toTerritoryNodes(rows: readonly TerritoryRow[]): TerritoryNode[] {
    return rows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        name: row.name,
        parentId: row.parentId,
        minZoom: row.minZoom,
        maxZoom: row.maxZoom,
        validFromBf: row.validFromBf,
        validToBf: row.validToBf,
    }));
}

export function toAreaNodes(rows: readonly AreaRow[]): AreaNode[] {
    return rows.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        territoryId: row.territoryId,
        validFromBf: row.validFromBf,
        validToBf: row.validToBf,
        minZoom: row.minZoom,
        maxZoom: row.maxZoom,
    }));
}

/**
 * Die Revision: alles, was das Ergebnis bestimmt, in fester Reihenfolge; zwölf Zeichen SHA-256. Die Farbe steht nicht darin (EDIT-0003
 * T51, WI-0209 D4): Sie geht in kein abgeleitetes Ergebnis ein, Füllung und Schraffur liest die Kachelsicht live
 * (`0059_territory_claim_hatch_bands.sql`). Eine reine Farbänderung macht die Ableitung darum nicht veraltet.
 */
export function territoryRevision(inputs: DeriveInputs, yearBf: number, maxBand: number): string {
    const names = AVENTURIA_POLITICAL_CARTOGRAPHY.borderName;
    const unique = AVENTURIA_POLITICAL_CARTOGRAPHY.innerUnique;
    const canonical = JSON.stringify({
        version: TERRITORY_DERIVE_VERSION,
        year: yearBf,
        maxBand,
        // Was die Namen an den Grenzen bestimmt: ab welchem Band, welche Namen fehlen, wie klein eine Hülle sein darf.
        borderName: [
            names.fromBand,
            names.excludeNamePattern,
            names.minPoints,
            names.smoothing,
            names.coincidenceUnits,
        ],
        // Wann zwei Innengrenzstücke dieselbe Grenze sind (`derive-inner-borders.ts`).
        innerUnique: [unique.toleranceUnits, unique.share, unique.coincidenceUnits, unique.minLengthUnits],
        territories: inputs.territories.map((t) => [
            t.publicId,
            t.parentPublicId,
            t.name,
            t.opacity,
            t.minZoom,
            t.maxZoom,
            t.validFromBf,
            t.validToBf,
            t.sortOrder,
            t.territoryType,
            t.capital,
        ]),
        areas: inputs.areas.map((a) => [
            a.publicId,
            a.territoryPublicId,
            a.validFromBf,
            a.validToBf,
            a.minZoom,
            a.maxZoom,
            a.geomHash,
        ]),
        // Wer wen beansprucht, in welcher Reihenfolge: die Schraffur hängt daran (ihre Farben liest die Kachelsicht live).
        claims: inputs.claims.map((c) => [c.territoryPublicId, c.claimantPublicId, c.sortOrder]),
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/** Ein Mitglied einer Hülle: das gezeigte Gebiet `member` gehört im Band zur Hülle des Vorfahren `owner` (auch sich selbst). */
export interface HullMember {
    band: number;
    owner: number;
    parent: number | null;
    depth: number;
    member: number;
}

/** Die Kette jedes gezeigten Gebiets: Hüllen (Vorfahr → Mitglied) mit Elter und Tiefe des Vorfahren. */
export function hullMembers(displayed: readonly DisplayedTerritory[]): HullMember[] {
    const rows: HullMember[] = [];
    for (const shown of displayed) {
        shown.chainIds.forEach((owner, depth) => {
            rows.push({
                band: shown.band,
                owner,
                parent: depth === 0 ? null : (shown.chainIds[depth - 1] as number),
                depth,
                member: shown.territoryId,
            });
        });
    }
    return rows;
}

/**
 * Die Vorfahren jeder Hülle im Band: (Band, Hülle, Vorfahr), einmal je Paar. Wo die Grenze einer Hülle mit der ihres
 * Vorfahren zusammenfällt (das Kind grenzt an den Rand des Elters), trägt sie den Namen des Vorfahren schon, auf derselben
 * Seite: dort bekommt das Kind keinen (sonst stünden zwei Namen übereinander).
 */
/**
 * Was ein Band rechnet, in einem Schlüssel je Band (WI-0229 S2): die Zuordnung der Flächen, die gezeigten Gebiete mit Elter und Tiefe,
 * die Hüllen, die Namenseigner und ihre Vorfahren – alles, wovon die Abfragen eines Bandes außer seiner Nummer abhängen. Gleicht der
 * Schlüssel dem des vorigen Bandes, schreibt das Band dieselben Zeilen (der Lauf ist deterministisch, S1) und wird kopiert statt gerechnet;
 * heute die Bänder 7 und 8 aus 6.
 */
export function bandKeys(
    maxBand: number,
    parts: {
        assignments: readonly { band: number; areaId: number; territoryId: number }[];
        displayed: readonly { band: number; territoryId: number; parentId: number | null; depth: number }[];
        members: readonly HullMember[];
        nameOwners: readonly { band: number; owner: number }[];
        ancestors: readonly { band: number; owner: number; ancestor: number }[];
    },
): string[] {
    const je = (): (string | number | null)[][][] => Array.from({ length: maxBand + 1 }, () => []);
    const zeilen = [je(), je(), je(), je(), je()];
    for (const a of parts.assignments) zeilen[0]![a.band]?.push([a.areaId, a.territoryId]);
    for (const d of parts.displayed) zeilen[1]![d.band]?.push([d.territoryId, d.parentId, d.depth]);
    for (const m of parts.members) zeilen[2]![m.band]?.push([m.owner, m.parent, m.depth, m.member]);
    for (const o of parts.nameOwners) zeilen[3]![o.band]?.push([o.owner]);
    for (const a of parts.ancestors) zeilen[4]![a.band]?.push([a.owner, a.ancestor]);
    const sortiert = (liste: (string | number | null)[][]): string =>
        liste
            .map((zeile) => JSON.stringify(zeile))
            .sort()
            .join(";");
    return Array.from({ length: maxBand + 1 }, (_, band) => zeilen.map((teil) => sortiert(teil[band]!)).join("|"));
}

export function hullAncestors(members: readonly HullMember[]): { band: number; owner: number; ancestor: number }[] {
    const chains = new Map<string, HullMember[]>();
    for (const row of members) {
        const key = `${String(row.band)}/${String(row.member)}`;
        const chain = chains.get(key) ?? [];
        chain.push(row);
        chains.set(key, chain);
    }
    const pairs = new Map<string, { band: number; owner: number; ancestor: number }>();
    for (const chain of chains.values()) {
        chain.sort((a, b) => a.depth - b.depth);
        chain.forEach((row, index) => {
            for (const ancestor of chain.slice(0, index)) {
                pairs.set(`${String(row.band)}/${String(row.owner)}/${String(ancestor.owner)}`, {
                    band: row.band,
                    owner: row.owner,
                    ancestor: ancestor.owner,
                });
            }
        });
    }
    return [...pairs.values()].sort((a, b) => a.band - b.band || a.owner - b.owner || a.ancestor - b.ancestor);
}

/**
 * Welche Hüllen einen Namen entlang ihrer Außengrenze tragen (Legacy `labelable`): ab dem Band der Tafel, nur Hüllen mit
 * gezeigten Nachfahren (Legacy beschriftet nur abgeleitete Außenhüllen, kein Reich ohne Kinder), und nur, wenn der Name
 * nicht zu den ausgenommenen gehört (`Baronie …`, `Junkertum …`).
 */
export function borderNameOwners(
    members: readonly HullMember[],
    namesById: ReadonlyMap<number, string>,
): { band: number; owner: number }[] {
    const config = AVENTURIA_POLITICAL_CARTOGRAPHY.borderName;
    const owners = new Map<string, { band: number; owner: number }>();
    for (const row of members) {
        if (row.band < config.fromBand || row.member === row.owner) continue;
        const name = namesById.get(row.owner);
        if (name === undefined || !borderNameAllowed(name, config.excludeNamePattern)) continue;
        owners.set(`${String(row.band)}/${String(row.owner)}`, { band: row.band, owner: row.owner });
    }
    return [...owners.values()].sort((a, b) => a.band - b.band || a.owner - b.owner);
}

/** Die Rechnung ohne Datenbank: Zuordnung, gezeigte Gebiete. Der Prüfer rechnet sie unabhängig noch einmal. */
export function computeDerivation(
    inputs: DeriveInputs,
    yearBf: number,
    maxBand: number,
): { result: AssignmentResult; displayed: DisplayedTerritory[]; nodes: TerritoryNode[] } {
    const nodes = toTerritoryNodes(inputs.territories);
    const result = assignAreasToBands(nodes, toAreaNodes(inputs.areas), yearBf, maxBand);
    return { result, displayed: displayedTerritories(result.assignments, nodes, yearBf), nodes };
}

/** Das Bild je Band aus den Eingaben; der Teillauf rechnet es für den Abdruck und für heute gleich. */
function ableitungsBild(inputs: DeriveInputs, yearBf: number, maxBand: number): AbleitungsBild {
    const { result, displayed } = computeDerivation(inputs, yearBf, maxBand);
    const members = hullMembers(displayed);
    return {
        assignments: result.assignments,
        displayed,
        members,
        nameOwners: borderNameOwners(members, new Map(inputs.territories.map((t) => [t.id, t.name]))),
        ancestors: hullAncestors(members),
    };
}

export async function deriveTerritories(
    database: Database,
    options: TerritoryDeriveOptions = {},
): Promise<TerritoryDeriveReport> {
    const started = Date.now();
    const phasesMs: Record<string, number> = {};
    let mark = performance.now();
    /** Die Zeit seit der letzten Marke kommt zum Abschnitt `name`; zurück kommt sie selbst (für die Zeit je Band). */
    const messe = (name: string): number => {
        const now = performance.now();
        const ms = now - mark;
        mark = now;
        phasesMs[name] = Math.round((phasesMs[name] ?? 0) + ms);
        return ms;
    };
    const mapDomainId = options.mapDomainId ?? AVENTURIA.mapDomain;
    const yearBf = options.displayYearBf ?? AVENTURIA_POLITICAL_CARTOGRAPHY.displayYearBf;

    const inputs = await readDeriveInputs(database, mapDomainId);
    messe("lesen");
    // Immer bis `maxBand` der Tafel (WI-0209 D2): Die Übergangsregel `deriveMaxBand` (WI-0188, bis 6, solange ein Legacy-Gebiet
    // bei 6 endete) fiel mit dem Schreibweg für Zoomspannen; ein Gebiet darf jetzt bewusst bei 6 enden. 🔴 Production bekommt
    // diesen Stand erst nach der Datenänderung 6 → 8 (EDIT-0005 §1.2, E2); sonst zeigten Band 7 und 8 dort nur Gebiete ohne Obergrenze.
    const maxBand = AVENTURIA_POLITICAL_CARTOGRAPHY.maxBand;
    const revision = territoryRevision(inputs, yearBf, maxBand);
    const [state] = await database<
        { derived_revision: string | null; derived_year_bf: number | null; shapes: number }[]
    >`
        SELECT s.derived_revision, s.derived_year_bf,
               (SELECT count(*)::int FROM territory_shape sh JOIN territory t ON t.id = sh.territory_id
                 WHERE t.map_domain_id = ${mapDomainId}) AS shapes
        FROM (SELECT ${mapDomainId}::text AS id) d
        LEFT JOIN territory_state s ON s.map_domain_id = d.id
    `;
    const revisionChanged = state?.derived_revision !== revision;
    const { result, displayed } = computeDerivation(inputs, yearBf, maxBand);

    const repairedAreas = inputs.areas.filter((area) => !area.isValid).length;
    const bandReports: BandDeriveReport[] = Array.from({ length: maxBand + 1 }, (_, band) => ({
        band,
        shapes: 0,
        outer: 0,
        inner: 0,
        notShownNoBand: result.notShown.filter((n) => n.band === band && n.reason === "no_band").length,
        notShownOwnBand: result.notShown.filter((n) => n.band === band && n.reason === "own_band").length,
        ms: 0,
    }));
    const base: TerritoryDeriveReport = {
        revision,
        revisionChanged,
        computed: false,
        modus: null,
        vollGrund: null,
        geaenderteFormen: 0,
        yearBf,
        territories: inputs.territories.length,
        areas: inputs.areas.length,
        bands: bandReports,
        notCurrent: result.notCurrent,
        repairedAreas,
        capitals: 0,
        ms: 0,
        phasesMs,
        rssMb: 0,
    };
    if (!options.force && !revisionChanged && (state?.shapes ?? 0) > 0 && state?.derived_year_bf === yearBf) {
        // Nichts hat sich geändert: nichts rechnen, nichts schreiben.
        messe("zuordnen");
        return { ...base, ms: Date.now() - started, rssMb: Math.round(process.memoryUsage().rss / 1e6) };
    }

    const memberRows = hullMembers(displayed);
    const nameOwners = borderNameOwners(memberRows, new Map(inputs.territories.map((t) => [t.id, t.name])));
    const nameAncestors = hullAncestors(memberRows);
    const keys = bandKeys(maxBand, {
        assignments: result.assignments,
        displayed,
        members: memberRows,
        nameOwners,
        ancestors: nameAncestors,
    });
    const nameConfig = AVENTURIA_POLITICAL_CARTOGRAPHY.borderName;
    const konfig = ableitungsKonfig();
    const nowMs = options.nowMs ?? Date.now();

    // Teillauf oder voller Lauf: Ein Zweifel führt zum vollen Lauf (`derive-plan.ts`).
    let plan: TeilPlan | null = null;
    let vollGrund: string | null = null;
    let vollAm = new Date(nowMs).toISOString();
    if (options.teilweise === true && options.force !== true) {
        const [zeile] = await database<{ abdruck: DeriveAbdruck | null; kanten: boolean }[]>`
            SELECT s.derive_inputs AS abdruck,
                   EXISTS (
                       SELECT 1 FROM territory_inner_edge e JOIN territory t ON t.id = e.owner_id
                       WHERE t.map_domain_id = ${mapDomainId}
                   ) AS kanten
            FROM territory_state s WHERE s.map_domain_id = ${mapDomainId}
        `;
        const ergebnis = planeTeillauf({
            abdruck: zeile?.abdruck ?? null,
            kantenDa: zeile?.kanten ?? false,
            derivedRevision: state?.derived_revision ?? null,
            version: TERRITORY_DERIVE_VERSION,
            konfig,
            yearBf,
            maxBand,
            nowMs,
            neu: {
                inputs,
                bild: {
                    assignments: result.assignments,
                    displayed,
                    members: memberRows,
                    nameOwners,
                    ancestors: nameAncestors,
                },
            },
            bildVon: (alt) => ableitungsBild(alt, yearBf, maxBand),
        });
        if (ergebnis.art === "teil") {
            plan = ergebnis.plan;
            vollAm = zeile!.abdruck!.vollAm;
        } else {
            vollGrund = ergebnis.grund;
        }
    }
    const teilPlan = plan;
    /** Gebiete mit geänderten Zeilen: nur ihre Bandläufe rechnet der Teillauf neu. */
    const beruehrt = new Set<number>();

    let capitals = 0;
    messe("zuordnen");
    await database.begin(async (tx) => {
        // Ein Kern, kein Gather (WI-0229, Claudio 2026-10-19): Die Ableitung ist eine leichte Art neben einem Gelände mit drei Threads; mit
        // parallelen Workern belegte eine ihrer Abfragen bis zu drei Kerne mit dem Gewicht von PostgreSQL.
        await tx`SET LOCAL max_parallel_workers_per_gather = 0`;
        // Die Fremdschlüssel auf `territory` und `territory_area` erst beim Commit prüfen (Migration 0204; Stage 2026-10-19: Speichern eines
        // Gebiets kam mit 503, solange die Ableitung lief). Sofort geprüft hielt jede eingefügte Zeile `FOR KEY SHARE` auf ihr Gebiet, die
        // ganze Transaktion lang; so hält die Sperre nur die Prüfung am Ende lang.
        await tx`SET CONSTRAINTS ALL DEFERRED`;
        // Zuerst weg mit dem Alten (nur diese Kartendomäne). Die Reihenfolge folgt den Fremdschlüsseln. Der Teillauf löscht je Band nur, was er neu schreibt.
        if (teilPlan === null) {
            await tx`
                DELETE FROM territory_claim_shape WHERE territory_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
            `;
            await tx`
                DELETE FROM territory_border WHERE territory_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
            `;
            await tx`
                DELETE FROM territory_shape WHERE territory_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
            `;
            await deleteInnerEdges(tx, mapDomainId);
        }
        await tx`
            DELETE FROM territory_display_area WHERE territory_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
        `;
        await tx`
            DELETE FROM territory_capital_band tcb
            WHERE NOT EXISTS (
                SELECT 1 FROM place p WHERE p.public_id = tcb.place_public_id AND p.map_domain_id <> ${mapDomainId}
            )
        `;

        const assignmentBands = result.assignments.map((a) => a.band);
        const assignmentAreas = result.assignments.map((a) => a.areaId);
        const assignmentTerritories = result.assignments.map((a) => a.territoryId);
        await tx`
            INSERT INTO territory_display_area (band, area_id, territory_id)
            SELECT * FROM unnest(${assignmentBands}::smallint[], ${assignmentAreas}::bigint[], ${assignmentTerritories}::bigint[])
        `;

        await tx`
            CREATE TEMPORARY TABLE derive_shape_meta (
                band smallint NOT NULL, territory_id bigint NOT NULL, parent_id bigint, depth smallint NOT NULL,
                PRIMARY KEY (band, territory_id)
            ) ON COMMIT DROP
        `;
        await tx`
            INSERT INTO derive_shape_meta (band, territory_id, parent_id, depth)
            SELECT * FROM unnest(
                ${displayed.map((d) => d.band)}::smallint[],
                ${displayed.map((d) => d.territoryId)}::bigint[],
                ${displayed.map((d) => d.parentId)}::bigint[],
                ${displayed.map((d) => d.depth)}::smallint[]
            )
        `;
        await tx`
            CREATE TEMPORARY TABLE derive_member (
                band smallint NOT NULL, owner_id bigint NOT NULL, parent_id bigint, depth smallint NOT NULL,
                member_id bigint NOT NULL
            ) ON COMMIT DROP
        `;
        await tx`
            INSERT INTO derive_member (band, owner_id, parent_id, depth, member_id)
            SELECT * FROM unnest(
                ${memberRows.map((m) => m.band)}::smallint[],
                ${memberRows.map((m) => m.owner)}::bigint[],
                ${memberRows.map((m) => m.parent)}::bigint[],
                ${memberRows.map((m) => m.depth)}::smallint[],
                ${memberRows.map((m) => m.member)}::bigint[]
            )
        `;
        await tx`
            CREATE TEMPORARY TABLE derive_hull (
                band smallint NOT NULL, owner_id bigint NOT NULL, parent_id bigint, depth smallint NOT NULL,
                geom geometry NOT NULL, PRIMARY KEY (band, owner_id)
            ) ON COMMIT DROP
        `;

        await tx`
            CREATE TEMPORARY TABLE derive_name_owner (
                band smallint NOT NULL, owner_id bigint NOT NULL, PRIMARY KEY (band, owner_id)
            ) ON COMMIT DROP
        `;
        await tx`
            INSERT INTO derive_name_owner (band, owner_id)
            SELECT * FROM unnest(
                ${nameOwners.map((o) => o.band)}::smallint[],
                ${nameOwners.map((o) => o.owner)}::bigint[]
            )
        `;

        await tx`
            CREATE TEMPORARY TABLE derive_hull_ancestor (
                band smallint NOT NULL, owner_id bigint NOT NULL, ancestor_id bigint NOT NULL,
                PRIMARY KEY (band, owner_id, ancestor_id)
            ) ON COMMIT DROP
        `;
        await tx`
            INSERT INTO derive_hull_ancestor (band, owner_id, ancestor_id)
            SELECT * FROM unnest(
                ${nameAncestors.map((a) => a.band)}::smallint[],
                ${nameAncestors.map((a) => a.owner)}::bigint[],
                ${nameAncestors.map((a) => a.ancestor)}::bigint[]
            )
        `;

        // Die gepufferten Außengrenzen der Vorfahren, einmal je Band und Menge von Vorfahren statt einmal je Gebiet (WI-0229 B):
        // Geschwister teilen ihre Vorfahren, und Vereinigen und Puffern der Grenzen eines Reichs waren der teure Teil der Namenslinien.
        // Dieselben Eingaben in derselben Reihenfolge, also dieselben Bytes wie vorher.
        await tx`
            CREATE TEMPORARY TABLE derive_ancestor_buffer (
                band smallint NOT NULL, ancestors bigint[] NOT NULL, lines geometry, buf geometry, PRIMARY KEY (band, ancestors)
            ) ON COMMIT DROP
        `;
        await createInnerBorderTables(tx);
        // Die Außengrenzen vor dem Teillauf: Nur wo sich die eines Vorfahren geändert hat, kann das die Namenslinie eines Nachfahren ändern.
        await tx`
            CREATE TEMPORARY TABLE derive_alte_aussen (
                territory_id bigint PRIMARY KEY, geom geometry NOT NULL
            ) ON COMMIT DROP
        `;
        messe("vorbereiten");

        // 🔴 Zwei Läufe mit denselben Eingaben schreiben dieselben Bytes (WI-0229 S1): Jedes Geometrie-Aggregat hat eine feste
        // Reihenfolge (`ORDER BY` nach Kennung), jede Auswahl „das größte Teil“ einen festen Gleichstand (`d.path`), und der
        // Gleichstand der Innengrenzen hängt an Paar und Stück, nicht an der Einfügefolge. Sonst folgte die Punktfolge dem Plan.
        let vorigesBandGeaendert = false;
        for (let band = 0; band <= maxBand; band += 1) {
            let bandMs = 0;
            const aenderung = teilPlan?.bands[band] ?? null;
            const bandGeaendert =
                aenderung === null || aenderung.formen.length + aenderung.huellen.length + aenderung.namen.length > 0;
            if (aenderung !== null) {
                for (const id of [...aenderung.formen, ...aenderung.huellen, ...aenderung.namen]) beruehrt.add(id);
            }
            if (band > 0 && keys[band] === keys[band - 1]) {
                // Der Teillauf kopiert nur, wenn sich hier oder im vorigen Band etwas geändert hat, und dann das ganze Band: gemessen 0,1 s (WI-0229 S2).
                if (aenderung === null || bandGeaendert || vorigesBandGeaendert) {
                    await copyBand(tx, mapDomainId, band, aenderung !== null);
                    vorigesBandGeaendert = true;
                }
                bandMs += messe("kopieren");
                const kopiert = bandReports[band];
                if (kopiert) kopiert.ms = Math.round(bandMs);
                continue;
            }
            vorigesBandGeaendert = bandGeaendert;
            if (!bandGeaendert) continue;
            const formen = aenderung?.formen ?? [];
            const huellen = aenderung?.huellen ?? [];
            if (aenderung !== null) {
                await tx`DELETE FROM derive_alte_form`;
                await tx`
                    INSERT INTO derive_alte_form (territory_id, geom)
                    SELECT territory_id, geom FROM territory_shape
                    WHERE band = ${band} AND territory_id = ANY(${formen}::bigint[])
                `;
                await tx`
                    DELETE FROM territory_claim_shape
                    WHERE band = ${band}
                      AND (
                          display_territory_id = ANY(${formen}::bigint[])
                          OR territory_id IN (
                              SELECT a.territory_id
                              FROM territory_display_area da
                              JOIN territory_area a ON a.id = da.area_id
                              WHERE da.band = ${band} AND da.territory_id = ANY(${formen}::bigint[])
                          )
                      )
                `;
                await tx`DELETE FROM territory_shape WHERE band = ${band} AND territory_id = ANY(${formen}::bigint[])`;
            }
            // ---- 2. Flächen und Namensanker ------------------------------------------------------------------------
            await tx`
                INSERT INTO territory_shape (band, territory_id, parent_id, depth, source_count, area, geom, render_geom, label_geom)
                SELECT g.band, g.territory_id, m.parent_id, m.depth, g.n, ST_Area(g.geom), g.geom,
                       map_domain_to_render(${mapDomainId}, g.geom)::geometry(MultiPolygon, 3857),
                       (ST_MaximumInscribedCircle(big.geom)).center
                FROM (
                    SELECT da.band, da.territory_id, count(*)::int AS n,
                           ST_Multi(ST_CollectionExtract(ST_UnaryUnion(ST_Collect(territory_area_valid(a.geom) ORDER BY a.id)), 3)) AS geom
                    FROM territory_display_area da
                    JOIN territory_area a ON a.id = da.area_id
                    WHERE da.band = ${band}
                    ${aenderung === null ? tx`` : tx`AND da.territory_id = ANY(${formen}::bigint[])`}
                    GROUP BY da.band, da.territory_id
                ) g
                JOIN derive_shape_meta m ON m.band = g.band AND m.territory_id = g.territory_id
                CROSS JOIN LATERAL (SELECT d.geom FROM ST_Dump(g.geom) d ORDER BY ST_Area(d.geom) DESC, d.path LIMIT 1) big
                WHERE NOT ST_IsEmpty(g.geom)
            `;
            bandMs += messe("formen");

            // ---- 2b. Schraffur umstrittener Gebiete und die Füllung ohne sie (an den Formen dieses Bandes) -------------
            await deriveClaimShapes(tx, mapDomainId, band, aenderung === null ? null : formen);
            bandMs += messe("schraffur");

            // ---- 3. Hüllen, Außen- und Innengrenzen ----------------------------------------------------------------
            await tx`
                INSERT INTO derive_hull (band, owner_id, parent_id, depth, geom)
                SELECT mem.band, mem.owner_id, mem.parent_id, mem.depth, ST_UnaryUnion(ST_Collect(s.geom ORDER BY mem.member_id))
                FROM derive_member mem
                JOIN territory_shape s ON s.band = mem.band AND s.territory_id = mem.member_id
                WHERE mem.band = ${band}
                ${aenderung === null ? tx`` : tx`AND mem.owner_id = ANY(${huellen}::bigint[])`}
                GROUP BY mem.band, mem.owner_id, mem.parent_id, mem.depth
            `;
            bandMs += messe("huellen");
            if (aenderung !== null) {
                await tx`DELETE FROM derive_alte_aussen`;
                await tx`
                    INSERT INTO derive_alte_aussen (territory_id, geom)
                    SELECT territory_id, geom FROM territory_border
                    WHERE band = ${band} AND kind = 'outer' AND territory_id = ANY(${huellen}::bigint[])
                `;
                await tx`
                    DELETE FROM territory_border
                    WHERE band = ${band} AND kind = 'outer' AND territory_id = ANY(${huellen}::bigint[])
                `;
            }
            await tx`
                INSERT INTO territory_border (band, kind, level, territory_id, geom, render_geom)
                SELECT h.band, 'outer', h.depth, h.owner_id, x.ln,
                       map_domain_to_render(${mapDomainId}, x.ln)::geometry(MultiLineString, 3857)
                FROM derive_hull h
                CROSS JOIN LATERAL (
                    SELECT ST_Multi(ST_CollectionExtract(ST_Boundary(ST_ForcePolygonCW(h.geom)), 2)) AS ln
                ) x
                WHERE h.band = ${band}
                  AND (h.depth = 0 OR EXISTS (
                        SELECT 1 FROM derive_member m
                        WHERE m.band = h.band AND m.owner_id = h.owner_id AND m.member_id <> h.owner_id
                      ))
                  AND NOT ST_IsEmpty(x.ln)
            `;
            bandMs += messe("aussengrenzen");
            // Im Teillauf: die Namenslinien neu, deren Gebiet sich geändert hat, und die, an deren Umriss sich die Außengrenze eines Vorfahren geändert hat.
            let namen = aenderung?.namen ?? [];
            if (aenderung !== null) {
                const [dazu] = await tx<{ ids: string[] | null }[]>`
                    WITH geaenderte_aussen AS (
                        SELECT COALESCE(a.territory_id, n.territory_id) AS owner_id
                        FROM derive_alte_aussen a
                        FULL JOIN (
                            SELECT territory_id, geom FROM territory_border
                            WHERE band = ${band} AND kind = 'outer' AND territory_id = ANY(${huellen}::bigint[])
                        ) n ON n.territory_id = a.territory_id
                        WHERE a.geom IS NULL OR n.geom IS NULL OR ST_AsEWKB(a.geom) <> ST_AsEWKB(n.geom)
                    ), rahmen AS (
                        SELECT ST_Expand(ST_Extent(g.geom)::geometry, ${nameConfig.coincidenceUnits}::float8) AS geom
                        FROM (
                            SELECT geom FROM derive_alte_form
                            UNION ALL
                            SELECT s.geom FROM territory_shape s WHERE s.band = ${band} AND s.territory_id = ANY(${formen}::bigint[])
                        ) g
                    )
                    SELECT array_agg(DISTINCT o.owner_id::text) AS ids
                    FROM derive_name_owner o
                    JOIN derive_hull_ancestor v ON v.band = o.band AND v.owner_id = o.owner_id
                    JOIN geaenderte_aussen g ON g.owner_id = v.ancestor_id
                    JOIN territory_border ob ON ob.band = o.band AND ob.kind = 'outer' AND ob.territory_id = o.owner_id
                    CROSS JOIN rahmen
                    WHERE o.band = ${band} AND ob.geom && rahmen.geom
                `;
                namen = [...new Set([...namen, ...(dazu?.ids ?? []).map(Number)])];
                for (const id of namen) beruehrt.add(id);
                const fehlendeHuellen = namen.filter((id) => !huellen.includes(id));
                if (fehlendeHuellen.length > 0)
                    await tx`
                        INSERT INTO derive_hull (band, owner_id, parent_id, depth, geom)
                        SELECT mem.band, mem.owner_id, mem.parent_id, mem.depth, ST_UnaryUnion(ST_Collect(s.geom ORDER BY mem.member_id))
                        FROM derive_member mem
                        JOIN territory_shape s ON s.band = mem.band AND s.territory_id = mem.member_id
                        WHERE mem.band = ${band} AND mem.owner_id = ANY(${fehlendeHuellen}::bigint[])
                        GROUP BY mem.band, mem.owner_id, mem.parent_id, mem.depth
                    `;
                await tx`
                    DELETE FROM territory_border
                    WHERE band = ${band} AND kind = 'name' AND territory_id = ANY(${namen}::bigint[])
                `;
            }
            // ---- 4. Die Namen entlang der Außengrenze: der Umriss des größten Teils, rechtsläufig ------------------
            // Wo die Grenze mit der eines Vorfahren zusammenfällt (Kind am Rand des Elters), fällt das Stück weg: der
            // Vorfahr trägt seinen Namen dort schon, auf derselben Seite. Geglättet wird nach dem Schneiden, die Enden
            // der Stücke bleiben stehen.
            await tx`
                INSERT INTO derive_ancestor_buffer (band, ancestors, lines, buf)
                SELECT k.band, k.ancestors, u.lines, ST_Buffer(u.lines, ${nameConfig.coincidenceUnits}::float8, 1)
                FROM (
                    SELECT DISTINCT band, ancestors
                    FROM (
                        SELECT band, array_agg(ancestor_id ORDER BY ancestor_id) AS ancestors
                        FROM derive_hull_ancestor
                        WHERE band = ${band}
                        ${aenderung === null ? tx`` : tx`AND owner_id = ANY(${namen}::bigint[])`}
                        GROUP BY band, owner_id
                    ) je
                ) k
                CROSS JOIN LATERAL (
                    SELECT ST_Union(ob.geom ORDER BY ob.territory_id) AS lines
                    FROM territory_border ob
                    WHERE ob.band = k.band AND ob.territory_id = ANY (k.ancestors) AND ob.kind = 'outer'
                ) u
            `;
            await tx`
                INSERT INTO territory_border (band, kind, level, territory_id, geom, render_geom, label_name)
                SELECT h.band, 'name', h.depth, h.owner_id, y.ln,
                       map_domain_to_render(${mapDomainId}, y.ln)::geometry(MultiLineString, 3857), t.name
                FROM derive_hull h
                JOIN derive_name_owner o ON o.band = h.band AND o.owner_id = h.owner_id
                JOIN territory t ON t.id = h.owner_id
                CROSS JOIN LATERAL (
                    -- Der Umriss des größten Teils; die Stützpunkte zählt Legacy am ungeglätteten Ring (ring.length < 8).
                    SELECT ring.line, ST_NPoints(ring.line) AS points
                    FROM (
                        SELECT ST_ExteriorRing(d.geom) AS line
                        FROM ST_Dump(ST_ForcePolygonCW(h.geom)) d ORDER BY ST_Area(d.geom) DESC, d.path LIMIT 1
                    ) ring
                ) x
                LEFT JOIN derive_ancestor_buffer anc
                  ON anc.band = h.band
                 AND anc.ancestors = (
                         SELECT array_agg(a.ancestor_id ORDER BY a.ancestor_id)
                         FROM derive_hull_ancestor a
                         WHERE a.band = h.band AND a.owner_id = h.owner_id
                     )
                CROSS JOIN LATERAL (
                    SELECT ST_CollectionExtract(
                               CASE WHEN anc.lines IS NULL THEN x.line ELSE ST_Difference(x.line, anc.buf) END, 2
                           ) AS raw, anc.lines IS NULL AS whole
                ) c
                CROSS JOIN LATERAL (
                    SELECT ST_Multi(CASE WHEN ${nameConfig.smoothing}::int > 0 AND NOT ST_IsEmpty(c.raw)
                                         THEN ST_ChaikinSmoothing(c.raw, ${nameConfig.smoothing}::int, NOT c.whole)
                                         ELSE c.raw END) AS ln
                ) y
                WHERE h.band = ${band} AND x.points >= ${nameConfig.minPoints} AND NOT ST_IsEmpty(y.ln)
                ${aenderung === null ? tx`` : tx`AND h.owner_id = ANY(${namen}::bigint[])`}
            `;
            bandMs += messe("namenslinien");
            // ---- 5. Die Innengrenzen: die Kante zwischen zwei überlappungsfreien Zellen, genau einmal ------------------
            const kantenEigner = await deriveInnerBorders(tx, mapDomainId, band, aenderung === null ? null : formen);
            if (aenderung !== null) for (const id of kantenEigner) beruehrt.add(id);
            bandMs += messe("innengrenzen");
            const bandReport = bandReports[band];
            if (bandReport) bandReport.ms = Math.round(bandMs);
        }

        // ---- Durchläufe gleicher Zeilen über benachbarte Bänder: die Kachel liefert sie einmal, nicht je Band -------------
        await deriveBandRuns(tx, mapDomainId, teilPlan === null ? null : [...beruehrt]);
        messe("bandlaeufe");

        // ---- Hauptstädte der gezeigten Gebiete -----------------------------------------------------------------------
        const inserted = await tx<{ place_public_id: string }[]>`
            INSERT INTO territory_capital_band (place_public_id, bands)
            SELECT t.capital_place_public_id, string_agg(DISTINCT s.band::text, '' ORDER BY s.band::text)
            FROM territory_shape s
            JOIN territory t ON t.id = s.territory_id
            WHERE t.map_domain_id = ${mapDomainId} AND t.capital_place_public_id IS NOT NULL
            GROUP BY t.capital_place_public_id
            ON CONFLICT (place_public_id) DO UPDATE SET bands = EXCLUDED.bands
            RETURNING place_public_id::text
        `;
        capitals = inserted.length;
        messe("hauptstaedte");

        const abdruck: DeriveAbdruck = {
            version: TERRITORY_DERIVE_VERSION,
            konfig,
            revision,
            yearBf,
            maxBand,
            vollAm,
            inputs,
        };
        await tx`
            INSERT INTO territory_state (map_domain_id, derived_revision, derived_year_bf, derived_at, derive_inputs)
            VALUES (${mapDomainId}, ${revision}, ${yearBf}, now(), ${tx.json(JSON.parse(JSON.stringify(abdruck)))})
            ON CONFLICT (map_domain_id) DO UPDATE SET
                derived_revision = EXCLUDED.derived_revision,
                derived_year_bf = EXCLUDED.derived_year_bf,
                derived_at = EXCLUDED.derived_at,
                derive_inputs = EXCLUDED.derive_inputs
        `;
        messe("zustand");
    });
    messe("festschreiben");

    const counts = await database<{ band: number; shapes: number; outer: number; inner: number }[]>`
        SELECT b.band::int AS band,
               (SELECT count(*)::int FROM territory_shape s WHERE s.band = b.band) AS shapes,
               (SELECT count(*)::int FROM territory_border x WHERE x.band = b.band AND x.kind = 'outer') AS outer,
               (SELECT count(*)::int FROM territory_border x WHERE x.band = b.band AND x.kind = 'inner') AS inner
        FROM generate_series(0, ${maxBand}) AS b(band)
    `;
    for (const row of counts) {
        const report = bandReports[row.band];
        if (report) {
            report.shapes = row.shapes;
            report.outer = row.outer;
            report.inner = row.inner;
        }
    }
    messe("zaehlen");
    return {
        ...base,
        computed: true,
        modus: teilPlan === null ? "voll" : "teil",
        vollGrund,
        geaenderteFormen: teilPlan?.formen ?? 0,
        capitals,
        ms: Date.now() - started,
        rssMb: Math.round(process.memoryUsage().rss / 1e6),
    };
}

/**
 * Ein Band, dessen Schlüssel dem des vorigen gleicht (`bandKeys`), bekommt dessen Zeilen mit seiner Nummer (WI-0229 S2): Formen samt
 * Füllung ohne Schraffur, Schraffurflächen und alle Grenzlinien. Die Durchläufe über die Bänder setzt danach `deriveBandRuns` für alle.
 */
async function copyBand(tx: Queryable, mapDomainId: string, band: number, ersetzen: boolean): Promise<void> {
    if (ersetzen) {
        const domaene = tx`territory_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})`;
        await tx`DELETE FROM territory_claim_shape WHERE band = ${band} AND ${domaene}`;
        await tx`DELETE FROM territory_border WHERE band = ${band} AND ${domaene}`;
        await tx`DELETE FROM territory_shape WHERE band = ${band} AND ${domaene}`;
        await tx`
            DELETE FROM territory_inner_edge
            WHERE band = ${band} AND owner_id IN (SELECT id FROM territory WHERE map_domain_id = ${mapDomainId})
        `;
    }
    await copyInnerEdges(tx, mapDomainId, band);
    // Die Durchläufe gehen mit: Im Teillauf rechnet sie nur für berührte Gebiete neu, und die übrigen bleiben im selben Durchlauf wie das vorige Band.
    await tx`
        INSERT INTO territory_shape (band, territory_id, parent_id, depth, source_count, area, geom, render_geom, label_geom,
                                     fill_render_geom, hatched, run_from, run_to)
        SELECT ${band}, s.territory_id, s.parent_id, s.depth, s.source_count, s.area, s.geom, s.render_geom, s.label_geom,
               s.fill_render_geom, s.hatched, s.run_from, s.run_to
        FROM territory_shape s
        JOIN territory t ON t.id = s.territory_id
        WHERE s.band = ${band - 1} AND t.map_domain_id = ${mapDomainId}
    `;
    await tx`
        INSERT INTO territory_claim_shape (band, territory_id, display_territory_id, geom, render_geom)
        SELECT ${band}, c.territory_id, c.display_territory_id, c.geom, c.render_geom
        FROM territory_claim_shape c
        JOIN territory t ON t.id = c.territory_id
        WHERE c.band = ${band - 1} AND t.map_domain_id = ${mapDomainId}
    `;
    await tx`
        INSERT INTO territory_border (band, kind, level, territory_id, geom, render_geom, label_name, run_from, run_to)
        SELECT ${band}, b.kind, b.level, b.territory_id, b.geom, b.render_geom, b.label_name, b.run_from, b.run_to
        FROM territory_border b
        JOIN territory t ON t.id = b.territory_id
        WHERE b.band = ${band - 1} AND t.map_domain_id = ${mapDomainId}
        ORDER BY b.kind, b.territory_id
    `;
}
