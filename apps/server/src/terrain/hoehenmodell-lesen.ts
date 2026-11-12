import type {
    AdminHoehenmodell,
    HoehenmodellEntwurf,
    HoehenmodellFassung,
    HoehenmodellLandschaft,
    HoehenmodellMessung,
    HoehenmodellProfil,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";
import { readTerrainChoice } from "./auswahl.ts";
import type { GipfelUnterGrundhoehe } from "./domain/peak-floor.ts";
import { domainInputFingerprint } from "./domain/fingerprint.ts";
import { loadDomainInputs } from "./domain/inputs.ts";
import { PROVISIONAL_INPUT_PREFIX } from "./domain/provisional.ts";
import { AVENTURIA_TERRAIN_RECIPES, AVENTURIA_TERRAIN_SELECTION, type TerrainRecipe } from "./domain/recipes.ts";
import {
    abnahmen,
    istAbgenommen,
    istRegional,
    reglerWerte,
    rueckwegZiel,
    unterschied,
    zahlWerte,
    type Abnahme,
} from "./hoehenmodell.ts";
import { leseTest } from "./hoehenmodell-test.ts";

/**
 * Das Lesemodell des Eintrags „Höhenmodell“ (WI-0127 SYS-13, SYS-0001 §9c.3): eingestellt gegen wirksam wie im Betriebszustand, die
 * laufende Kette, das Ziel des Rückwegs, die Fassungen mit Unterschied, Reglern, Tafel und Kreis, die Entwürfe mit ihrer Messung.
 *
 * „Wirksam“ ist die Fassung am veröffentlichten Master (`recipe_version`, Migration 0100). Ein Master von vorher trägt sie nicht; dann wird
 * sie aus dem Eingabe-Fingerabdruck erschlossen (die Fassung ist Teil davon), einmal je Master und Instanz.
 */

const ERSCHLOSSEN = new Map<string, number | null>();

async function erschliesse(
    db: Queryable,
    domain: string,
    master: string,
    inputFingerprint: string,
): Promise<number | null> {
    const key = `${domain}:${master}`;
    if (ERSCHLOSSEN.has(key)) return ERSCHLOSSEN.get(key) ?? null;
    const input = await loadDomainInputs(db, domain);
    const stored = inputFingerprint.startsWith(PROVISIONAL_INPUT_PREFIX)
        ? inputFingerprint.slice(PROVISIONAL_INPUT_PREFIX.length)
        : inputFingerprint;
    let found: number | null = null;
    for (const [version, recipe] of AVENTURIA_TERRAIN_RECIPES) {
        if (domainInputFingerprint(input.fingerprint, undefined, recipe) === stored) found = version;
    }
    ERSCHLOSSEN.set(key, found);
    return found;
}

async function wirksam(db: Queryable, domain: string): Promise<AdminHoehenmodell["wirksam"]> {
    let rows: {
        fingerprint: string;
        input_fingerprint: string;
        recipe_version: number | null;
        created_at: Date;
        provisional: boolean;
    }[];
    try {
        rows = await db`
            SELECT t.fingerprint, t.input_fingerprint, t.recipe_version, d.created_at, t.provisional
              FROM terrain_dem d
              JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
             WHERE d.map_domain_id = ${domain} AND d.is_current
        `;
    } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code !== "42703" && !isMissingTable(error)) throw error;
        return { version: null, gerechnetAm: null, vorlaeufig: false };
    }
    const [row] = rows;
    if (!row) return { version: null, gerechnetAm: null, vorlaeufig: false };
    const version = row.recipe_version ?? (await erschliesse(db, domain, row.fingerprint, row.input_fingerprint));
    return { version, gerechnetAm: row.created_at.toISOString(), vorlaeufig: row.provisional };
}

async function kette(db: Queryable, domain: string): Promise<AdminHoehenmodell["kette"]> {
    const [row] = await db<
        {
            public_id: string;
            kind: string;
            state: "QUEUED" | "RUNNING";
            phase: string | null;
            progress: number | null;
            wait_reason: string | null;
        }[]
    >`
        SELECT public_id::text AS public_id, kind, state, phase, progress::float8 AS progress, wait_reason
          FROM job
         WHERE map_domain_id = ${domain} AND state IN ('QUEUED', 'RUNNING')
           AND kind IN ('terrain_full', 'terrain_local', 'dem_publish', 'display_heights', 'routing_reload')
         ORDER BY (state = 'RUNNING') DESC, (kind = 'terrain_full') DESC, queued_at
         LIMIT 1
    `;
    return row === undefined
        ? null
        : {
              jobId: row.public_id,
              art: row.kind,
              state: row.state,
              phase: row.phase,
              progress: row.progress,
              waitReason: row.wait_reason,
          };
}

function landschaften(recipe: TerrainRecipe): HoehenmodellLandschaft[] {
    return Object.entries(recipe.topographie).map(([art, value]) => {
        const regel = value as unknown as Omit<HoehenmodellLandschaft, "art">;
        return {
            art,
            upliftWeight: regel.upliftWeight,
            erodibility: regel.erodibility,
            diffusivity: regel.diffusivity,
            runoff: regel.runoff,
            channelBias: regel.channelBias,
        };
    });
}

function fassungen(gilt: number, vermerkt: ReadonlyMap<number, Abnahme>): HoehenmodellFassung[] {
    let vorige: TerrainRecipe | null = null;
    const list: HoehenmodellFassung[] = [];
    for (const [version, recipe] of AVENTURIA_TERRAIN_RECIPES) {
        const abnahme = vermerkt.get(version);
        list.push({
            version,
            regional: istRegional(recipe),
            unterschied: vorige === null ? [] : unterschied(vorige, recipe),
            regler: reglerWerte(recipe),
            landschaften: landschaften(recipe),
            werte: zahlWerte(recipe),
            abnahme:
                abnahme === undefined ? null : { am: abnahme.am.toISOString(), wer: abnahme.wer, grund: abnahme.grund },
            inDatei: AVENTURIA_TERRAIN_SELECTION.accepted.includes(version),
            kreis: istAbgenommen(version, vermerkt) ? "voll" : "halb",
            gilt: version === gilt,
        });
        vorige = recipe;
    }
    return list;
}

async function entwuerfe(db: Queryable, domain: string): Promise<HoehenmodellEntwurf[]> {
    try {
        const rows = await db<
            {
                id: string;
                base_version: number;
                changes: Record<string, number>;
                reason: string;
                created_at: Date;
                wer: string | null;
                job: string | null;
                state: HoehenmodellMessung["state"] | null;
                phase: string | null;
                progress: number | null;
                result: Record<string, unknown> | null;
                error_summary: string | null;
            }[]
        >`
            SELECT d.id::text AS id, d.base_version, d.changes, d.reason, d.created_at,
                   COALESCE(p.display_name, d.created_by_label) AS wer,
                   j.public_id::text AS job, j.state, j.phase, j.progress::float8 AS progress, j.result, j.error_summary
              FROM terrain_recipe_draft d
              LEFT JOIN avesmaps_auth.person p ON p.id = d.created_by
              LEFT JOIN job j ON j.public_id = d.measure_job
             WHERE d.map_domain_id = ${domain} AND d.state = 'entwurf'
             ORDER BY d.created_at DESC
             LIMIT 20
        `;
        return rows.map((row) => ({
            id: row.id,
            basis: row.base_version,
            aenderungen: row.changes,
            grund: row.reason,
            angelegt: row.created_at.toISOString(),
            wer: row.wer,
            messung:
                row.job === null || row.state === null
                    ? null
                    : {
                          jobId: row.job,
                          state: row.state,
                          phase: row.phase,
                          progress: row.progress,
                          ergebnis: row.state === "SUCCEEDED" ? row.result : null,
                          fehler: row.error_summary,
                      },
            kreis: row.state === "SUCCEEDED" ? "halb" : "leer",
        }));
    } catch (error) {
        if (isMissingTable(error)) return [];
        throw error;
    }
}

/**
 * Die Gipfel unter der Grundhöhe am veröffentlichten Master (`report.gipfelUnterGrundhoehe`, `terrain/domain/peak-floor.ts`); `null`,
 * solange der Master älter ist als diese Messung oder keiner veröffentlicht ist.
 */
async function gipfel(db: Queryable, domain: string): Promise<AdminHoehenmodell["gipfel"]> {
    try {
        const [row] = await db<{ gipfel: GipfelUnterGrundhoehe[] | null }[]>`
            SELECT t.report -> 'gipfelUnterGrundhoehe' AS gipfel
              FROM terrain_dem d
              JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
             WHERE d.map_domain_id = ${domain} AND d.is_current
        `;
        return (
            (row?.gipfel ?? null)?.map(({ gebirge, grundhoehe, quelle, gipfel: liste }) => ({
                gebirge,
                grundhoehe,
                quelle,
                gipfel: liste.map(({ id, name, hoehe, gelaende, ringsum }) => ({ id, name, hoehe, gelaende, ringsum })),
            })) ?? null
        );
    } catch (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
}

export async function readHoehenmodell(
    db: Queryable,
    domain: string,
    profil: HoehenmodellProfil,
): Promise<AdminHoehenmodell> {
    const choice = await readTerrainChoice(db, domain);
    let wer = choice.chosenByLabel;
    if (choice.chosenBy !== null) {
        const [person] = await db<{ display_name: string }[]>`
            SELECT display_name FROM avesmaps_auth.person WHERE id = ${choice.chosenBy}::uuid
        `;
        wer = person?.display_name ?? wer;
    }
    const vermerkt = await abnahmen(db, domain);
    const [jetzt, aktiv, ziel, entwurfsListe, gipfelListe, test] = await Promise.all([
        wirksam(db, domain),
        kette(db, domain),
        rueckwegZiel(db, domain),
        entwuerfe(db, domain),
        gipfel(db, domain),
        // „19 (Test)“ mit ihren Werten (WI-0240); fehlt auf Production und ohne offene Fassung.
        leseTest(db, domain, profil, vermerkt),
    ]);
    return {
        now: new Date().toISOString(),
        profil,
        eingestellt: {
            version: choice.version,
            quelle: choice.quelle,
            seit: choice.chosenAt?.toISOString() ?? null,
            wer,
            grund: choice.reason,
            revision: choice.revision,
            unbekannt: choice.unbekannt,
        },
        wirksam: jetzt,
        kette: aktiv,
        rueckweg: ziel,
        fassungen: fassungen(choice.version, vermerkt),
        entwuerfe: entwurfsListe,
        gipfel: gipfelListe,
        ...(test === undefined ? {} : { test }),
    };
}
