import {
    flacheRezeptWerte,
    GEBIRGSTYPEN,
    technikWerte,
    rueckennetzTyp,
    type Gebirgstyp,
    type HoehenmodellProfil,
    type HoehenmodellTest,
    type HoehenmodellTestWerte,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "../system/state-row.ts";
import { mitTestWerten, readTerrainChoice } from "./auswahl.ts";
import { bereinigt, mitTest, TestWerteFehler } from "./domain/recipe-test.ts";
import {
    AVENTURIA_TERRAIN_RECIPES,
    AVENTURIA_TERRAIN_SELECTION,
    fassungsName,
    recipeFingerprint,
    type TerrainRecipe,
} from "./domain/recipes.ts";
import { abnahmen, reglerWerte, type Abnahme, type Handelnde } from "./hoehenmodell.ts";

/**
 * „19 (Test)“ in der Systemsteuerung (WI-0240; Betreiber 2026-10-19: „ergänz denen namen der 19 mit (Test). alle änderungen die wir mit
 * test machen soll automatisch passieren wenn wir was machen oder wenn jemand auf aktivieren geklickt haben. wir ändern eigenschaften von
 * test 19 live auf der stage bis das modell brauchbare ergebnisse liefert.“). Die Werte über der Datei stehen in `terrain_recipe_test`
 * (Migration 0210); wie sie über die Datei kommen: `domain/recipe-test.ts`, wo: `resolveTerrainRecipe` (`auswahl.ts`).
 *
 * - **Setzen** ersetzt die Werte (bereinigt: was der Datei gleicht, fällt weg), gegen die gesehene Revision, mit einem Eintrag im Verlauf.
 *   Ist die Fassung gewählt und wirkt die Änderung, reiht es die volle Kette ein (`terrain_chain_enqueue`; ein wartender Lauf nimmt es
 *   mit). Sonst rechnet „Aktivieren“ mit den Werten. Typwerte des Rückennetzes wirken nur auf Gebirge mit gezeichneten Kämmen: Ändern sich
 *   nur sie und hat kein Gebirge dieses Typs einen Kamm, läuft nichts (`wirkt`, Hauptorchestrierung 2026-10-20).
 * - **Nur die offene Fassung** (die jüngste, nicht unter `accepted` der Datei), nur auf Profil `voll`; nach der Abnahme in dieser Umgebung
 *   gesperrt (`sperreTest`).
 * - **Stand**: das wirksame Rezept als JSON, für den Weg ins Repository (`19.json`). Mit demselben Inhalt rechnet die Datei bytegleich, und
 *   der Master der Stage bleibt gültig (`recipeFingerprint`, WI-0239).
 */

/** Die offene Fassung: die jüngste, die nicht unter `accepted` der Auswahldatei steht; `null`, wenn alle abgenommen sind. */
export function offeneFassung(): TerrainRecipe | null {
    const versionen = [...AVENTURIA_TERRAIN_RECIPES.keys()];
    const juengste = Math.max(...versionen);
    return AVENTURIA_TERRAIN_SELECTION.accepted.includes(juengste) ? null : AVENTURIA_TERRAIN_RECIPES.get(juengste)!;
}

interface TestZeile {
    werte: HoehenmodellTestWerte;
    revision: number;
    geaendert_am: Date;
    wer: string | null;
    grund: string | null;
    gesperrt_am: Date | null;
}

async function leseZeile(
    db: Queryable,
    domain: string,
    version: number,
    sperren: boolean,
): Promise<TestZeile | undefined> {
    if (sperren) {
        // Erst die Zeile sperren (ohne Join: FOR UPDATE auf der äußeren Seite eines LEFT JOIN geht nicht), dann lesen.
        await db`SELECT 1 FROM terrain_recipe_test WHERE map_domain_id = ${domain} AND version = ${version} FOR UPDATE`;
    }
    const [row] = await db<TestZeile[]>`
        SELECT t.werte, t.revision, t.geaendert_am, COALESCE(p.display_name, t.geaendert_von_label) AS wer, t.grund, t.gesperrt_am
          FROM terrain_recipe_test t
          LEFT JOIN avesmaps_auth.person p ON p.id = t.geaendert_von
         WHERE t.map_domain_id = ${domain} AND t.version = ${version}
    `;
    return row;
}

const geschlossen = (version: number): ApiError =>
    new ApiError(409, "terrain_test_closed", `Fassung ${String(version)} ist abgenommen; ihre Werte stehen fest.`);

/** Die Werte von „19 (Test)“ setzen; gibt die neue Revision und, wenn die Fassung gewählt ist, den eingereihten vollen Lauf zurück. */
export async function setzeTestWerte(
    tx: Queryable,
    input: {
        domain: string;
        werte: HoehenmodellTestWerte;
        baseRevision: number;
        reason: string;
        actor: Handelnde;
        profil: HoehenmodellProfil;
        conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
    },
): Promise<{ version: number; revision: number; job: string | null }> {
    if (input.profil !== "voll")
        throw new ApiError(409, "terrain_test_unavailable", "Auf dieser Umgebung gibt es keine Testwerte.");
    const datei = offeneFassung();
    if (datei === null)
        throw new ApiError(409, "terrain_test_closed", "Es gibt keine offene Fassung; jede ist abgenommen.");
    const version = datei.version;
    if ((await abnahmen(tx, input.domain)).has(version)) throw geschlossen(version);
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps3d:terrain-test:${input.domain}`}))`;
    const vorher = await leseZeile(tx, input.domain, version, true);
    if (vorher?.gesperrt_am != null) throw geschlossen(version);
    const revision = vorher?.revision ?? 0;
    if (input.baseRevision !== revision) {
        throw input.conflict
            ? await input.conflict({ revision, changedAt: vorher?.geaendert_am ?? new Date() })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    let werte: HoehenmodellTestWerte;
    try {
        werte = bereinigt(datei, input.werte);
        mitTest(datei, werte);
    } catch (error) {
        if (error instanceof TestWerteFehler) throw new ApiError(400, "terrain_test_invalid", error.message);
        throw error;
    }
    const [row] = await tx<{ revision: number }[]>`
        INSERT INTO terrain_recipe_test (map_domain_id, version, werte, revision, geaendert_am, geaendert_von, geaendert_von_label, grund)
        VALUES (${input.domain}, ${version}, ${tx.json(werte as never)}, 1, now(), ${input.actor.personId}::uuid, ${input.actor.label},
                ${input.reason})
        ON CONFLICT (map_domain_id, version) DO UPDATE SET
            werte = EXCLUDED.werte, revision = terrain_recipe_test.revision + 1, geaendert_am = now(),
            geaendert_von = EXCLUDED.geaendert_von, geaendert_von_label = EXCLUDED.geaendert_von_label, grund = EXCLUDED.grund
        RETURNING revision
    `;
    await tx`
        INSERT INTO terrain_recipe_test_event (map_domain_id, version, revision, vorher, nachher, von, von_label, grund)
        VALUES (${input.domain}, ${version}, ${row!.revision}, ${tx.json((vorher?.werte ?? {}) as never)}, ${tx.json(werte as never)},
                ${input.actor.personId}::uuid, ${input.actor.label}, ${input.reason})
    `;
    const gewaehlt = (await readTerrainChoice(tx, input.domain)).version === version;
    if (!gewaehlt || !(await wirkt(tx, input.domain, datei, vorher?.werte ?? {}, werte)))
        return { version, revision: row!.revision, job: null };
    const label = `Gelände voll: ${fassungsName(version)}, Werte geändert`;
    const [job] = await tx<{ job: string }[]>`
        SELECT terrain_chain_enqueue(${input.domain}, ${input.actor.actorRef}, ${label})::text AS job
    `;
    return { version, revision: row!.revision, job: job!.job };
}

/**
 * Wirkt die Änderung auf das Gelände? Ja, wenn sich das Rezept ohne die Typwerte des Rückennetzes ändert (`recipeFingerprint`), oder wenn
 * sich die Typwerte eines Gebirgstyps ändern, von dem ein Gebirge gezeichnete Kämme hat (ohne Typ rechnet es als Kettengebirge).
 */
async function wirkt(
    db: Queryable,
    domain: string,
    datei: TerrainRecipe,
    vorher: HoehenmodellTestWerte,
    nachher: HoehenmodellTestWerte,
): Promise<boolean> {
    let alt: TerrainRecipe;
    try {
        alt = mitTest(datei, vorher);
    } catch {
        return true;
    }
    const neu = mitTest(datei, nachher);
    if (recipeFingerprint(alt) !== recipeFingerprint(neu)) return true;
    const geaendert = GEBIRGSTYPEN.filter(
        (typ) =>
            JSON.stringify(rueckennetzTyp(alt.gebirgsPresets ?? null, typ)) !==
            JSON.stringify(rueckennetzTyp(neu.gebirgsPresets ?? null, typ)),
    );
    if (geaendert.length === 0) return false;
    const mitNetz = await db<{ typ: string | null }[]>`
        SELECT DISTINCT c.gebirgstyp AS typ
          FROM terrain_control c
         WHERE c.map_domain_id = ${domain} AND c.is_active
           AND (EXISTS (SELECT 1 FROM terrain_ridge_edge e WHERE e.area_id = c.area_id)
             OR EXISTS (SELECT 1 FROM terrain_valley_edge v WHERE v.area_id = c.area_id)
             OR EXISTS (SELECT 1 FROM terrain_hollow_point p WHERE p.area_id = c.area_id))
    `;
    return mitNetz.some((zeile) => geaendert.includes((zeile.typ ?? "kettengebirge") as Gebirgstyp));
}

/** Nach der Abnahme der offenen Fassung in dieser Umgebung: ihre Werte stehen fest (gerufen von „Abnehmen“). */
export async function sperreTest(tx: Queryable, domain: string, version: number): Promise<void> {
    try {
        await tx`
            UPDATE terrain_recipe_test SET gesperrt_am = now()
             WHERE map_domain_id = ${domain} AND version = ${version} AND gesperrt_am IS NULL
        `;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
}

/** Das wirksame Rezept der offenen Fassung als Inhalt einer Datei (für den Weg ins Repository); `null` ohne offene Fassung. */
export async function testStand(
    db: Queryable,
    domain: string,
    profil: HoehenmodellProfil,
): Promise<TerrainRecipe | null> {
    const datei = offeneFassung();
    if (datei === null || profil !== "voll") return null;
    return mitTestWerten(db, domain, datei, profil);
}

/**
 * Fassung und Stand des veröffentlichten Masters (`recipe_fingerprint`, Migration 0209); leer vor den Spalten (42703).
 * 🔴 Die Spalte direkt lesen, nie die ganze Zeile in JSON wandeln: Das nahm `samples` mit (Master als bytea, über 256 MB als Hex)
 * und scheiterte auf der Stage mit „string too long to represent as jsonb string“ (Koordination 2026-10-19, Job 2355).
 */
async function masterStand(db: Queryable, domain: string): Promise<{ version: number | null; stand: string | null }> {
    try {
        const [row] = await db<{ recipe_version: number | null; stand: string | null }[]>`
            SELECT t.recipe_version, t.recipe_fingerprint AS stand
              FROM terrain_dem d
              JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
             WHERE d.map_domain_id = ${domain} AND d.is_current
        `;
        return { version: row?.recipe_version ?? null, stand: row?.stand ?? null };
    } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code !== "42703" && !isMissingTable(error)) throw error;
        return { version: null, stand: null };
    }
}

/**
 * Mit welcher Revision der Master gerechnet ist: der Stand des Masters gegen den Inhalt jeder Revision im Verlauf (0: die Datei). Ein
 * Stand, der nicht mehr im Verlauf steht, und ein Master aus einer anderen Fassung ergeben `null`.
 */
export function gerechnetMit(
    datei: TerrainRecipe,
    master: { version: number | null; stand: string | null },
    verlauf: readonly { revision: number; werte: HoehenmodellTestWerte }[],
): number | null {
    if (master.version !== datei.version || master.stand === null) return null;
    if (recipeFingerprint(datei) === master.stand) return 0;
    for (const eintrag of verlauf) {
        try {
            if (recipeFingerprint(mitTest(datei, eintrag.werte)) === master.stand) return eintrag.revision;
        } catch (error) {
            if (!(error instanceof TestWerteFehler)) throw error;
        }
    }
    return null;
}

/** Der Teil „test“ des Lesemodells (WI-0240); fehlt auf Production und ohne offene Fassung. */
export async function leseTest(
    db: Queryable,
    domain: string,
    profil: HoehenmodellProfil,
    vermerkt?: ReadonlyMap<number, Abnahme>,
): Promise<HoehenmodellTest | undefined> {
    const datei = offeneFassung();
    if (datei === null || profil !== "voll") return undefined;
    const version = datei.version;
    let zeile: TestZeile | undefined;
    let verlauf: HoehenmodellTest["verlauf"] = [];
    try {
        zeile = await leseZeile(db, domain, version, false);
        const ereignisse = await db<
            {
                revision: number;
                am: Date;
                wer: string | null;
                grund: string | null;
                vorher: HoehenmodellTestWerte;
                nachher: HoehenmodellTestWerte;
            }[]
        >`
            SELECT e.revision, e.am, COALESCE(p.display_name, e.von_label) AS wer, e.grund, e.vorher, e.nachher
              FROM terrain_recipe_test_event e
              LEFT JOIN avesmaps_auth.person p ON p.id = e.von
             WHERE e.map_domain_id = ${domain} AND e.version = ${version}
             ORDER BY e.id DESC
             LIMIT 20
        `;
        verlauf = ereignisse.map((e) => ({
            revision: e.revision,
            am: e.am.toISOString(),
            wer: e.wer,
            grund: e.grund,
            vorher: e.vorher,
            werte: e.nachher,
        }));
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    const werte = zeile?.werte ?? {};
    const wirksam = await mitTestWerten(db, domain, datei, profil);
    const abgenommen = (vermerkt ?? (await abnahmen(db, domain))).has(version);
    const gerechnet = gerechnetMit(datei, await masterStand(db, domain), verlauf);
    return {
        version,
        name: fassungsName(version),
        werte,
        revision: zeile?.revision ?? 0,
        gerechnet,
        geaendertAm: zeile?.geaendert_am.toISOString() ?? null,
        wer: zeile?.wer ?? null,
        grund: zeile?.grund ?? null,
        gesperrt: abgenommen || zeile?.gesperrt_am != null,
        regler: reglerWerte(wirksam),
        reglerDatei: reglerWerte(datei),
        rezept: flacheRezeptWerte(wirksam),
        rezeptDatei: flacheRezeptWerte(datei),
        technik: technikWerte(datei),
        presets: wirksam.gebirgsPresets ?? null,
        presetsDatei: datei.gebirgsPresets ?? null,
        verlauf,
    };
}
