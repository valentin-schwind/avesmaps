import { HOEHENMODELL_REGLER, type HoehenmodellProfil, type HoehenmodellUnterschied } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { vollerLaufEtikett } from "../jobs/terrain-chain.ts";
import { isMissingTable } from "../system/state-row.ts";
import { readTerrainChoice } from "./auswahl.ts";
import {
    AVENTURIA_TERRAIN_RECIPES,
    AVENTURIA_TERRAIN_SELECTION,
    fassungsName,
    parseTerrainRecipe,
    type TerrainRecipe,
} from "./domain/recipes.ts";

/**
 * Die Handlungen am Höhenmodell (WI-0127 SYS-13, SYS-0001 §9c, Entscheide §9c.11 und §9c.12): die EINE Stelle für die Routen der
 * Systemsteuerung und die Kommandozeile (`gelaende-waehlen`). Jede läuft in der Transaktion, in der ihr Aufrufer auch das Protokoll
 * schreibt (Protokollpflicht, SYS-0001 §9d.2).
 *
 * - **Wählen** setzt die Auswahl dieser Umgebung (`terrain_recipe_choice`) und reiht die volle Kette ein (`terrain_chain_enqueue`): Ein
 *   Wechsel rechnet die ganze Karte neu (§9c.11). Auf Production (Profil `abgenommen`) nur Fassungen aus `accepted` der Datei (Frage 5 B).
 * - **Zurück** wählt die vorige Fassung, wenn sie abgenommen ist; auch auf Production und unter Sperre (Frage 4 A, Schreibklasse
 *   `security`); gerechnet wird, wenn die Kartensperre fällt (der Job wartet mit einer Person als Auslöser, SYS-4).
 * - **Abnehmen** hängt eine Abnahme an (`terrain_recipe_acceptance`).
 */

export const TERRAIN_TARGET = (domain: string): string => `terrain:${domain}`;

type Tree = Record<string, unknown>;

function lies(recipe: unknown, pfad: readonly string[]): unknown {
    let node: unknown = recipe;
    for (const key of pfad) {
        if (typeof node !== "object" || node === null) return undefined;
        node = (node as Tree)[key];
    }
    return node;
}

/** Der Wert eines Reglers in einer Fassung; `null`, wenn es ihn dort nicht gibt (Radius in Fassung 17). */
export function reglerWert(recipe: TerrainRecipe, id: string): number | null {
    const regler = HOEHENMODELL_REGLER.find((entry) => entry.id === id);
    if (!regler) return null;
    const value = lies(recipe, regler.pfad);
    return typeof value === "number" ? value : null;
}

export function reglerWerte(recipe: TerrainRecipe): Record<string, number | null> {
    return Object.fromEntries(HOEHENMODELL_REGLER.map((regler) => [regler.id, reglerWert(recipe, regler.id)]));
}

/** Ist die Rückverteilung regional (Fassung 18)? Nur dann rechnen Gipfel- und Gebirgsänderungen lokal (§9c.11). */
export const istRegional = (recipe: TerrainRecipe): boolean => recipe.generator.uplift?.kind === "regional";

/** Die Zahl aller Zahlenwerte einer Fassung (für „nur lesbar: … Werte“). */
export function zahlWerte(value: unknown): number {
    if (typeof value === "number") return 1;
    if (Array.isArray(value)) return value.reduce((sum: number, entry) => sum + zahlWerte(entry), 0);
    if (typeof value === "object" && value !== null)
        return Object.entries(value as Tree)
            .filter(([key]) => key !== "version")
            .reduce((sum, [, entry]) => sum + zahlWerte(entry), 0);
    return 0;
}

/** Die geänderten Werte zwischen zwei Fassungen, als Pfad mit altem und neuem Wert (Blätter, ohne `version`). */
export function unterschied(alt: unknown, neu: unknown, pfad: string[] = []): HoehenmodellUnterschied[] {
    const leaf = (value: unknown) => typeof value !== "object" || value === null || Array.isArray(value);
    if (leaf(alt) || leaf(neu)) {
        return JSON.stringify(alt) === JSON.stringify(neu)
            ? []
            : [{ pfad: pfad.join("."), alt: alt ?? null, neu: neu ?? null }];
    }
    const keys = [...new Set([...Object.keys(alt as Tree), ...Object.keys(neu as Tree)])].filter(
        (key) => !(pfad.length === 0 && key === "version"),
    );
    return keys.flatMap((key) => unterschied((alt as Tree)[key], (neu as Tree)[key], [...pfad, key]));
}

const invalid = (message: string): ApiError => new ApiError(400, "terrain_draft_invalid", message);

/**
 * Ein Rezept aus einer Fassung mit geänderten Reglern (§9c.12 Frage 2 „A plus“): nur die freigegebenen Regler, in ihren Grenzen; die
 * Rückverteilung nur in einer regionalen Fassung. Das ganze Rezept prüft danach dasselbe Schema wie die Dateien (`parseTerrainRecipe`).
 */
export function mitAenderungen(basis: TerrainRecipe, aenderungen: Readonly<Record<string, number>>): TerrainRecipe {
    const recipe = structuredClone(basis) as unknown as Tree;
    const ids = Object.keys(aenderungen);
    if (ids.length === 0) throw invalid("Ein Entwurf ändert mindestens einen Regler.");
    for (const id of ids) {
        const regler = HOEHENMODELL_REGLER.find((entry) => entry.id === id);
        if (!regler) throw invalid(`Der Regler ${id} ist nicht freigegeben.`);
        const value = aenderungen[id]!;
        if (!Number.isFinite(value)) throw invalid(`${id}: keine Zahl.`);
        if (regler.ganz && !Number.isInteger(value)) throw invalid(`${id}: nur ganze Zahlen.`);
        // Grobe Grenzen hier; die genauen (etwa „größer als 0“) prüft das Schema am ganzen Rezept.
        if (value < regler.min) throw invalid(`${id}: kleiner als erlaubt.`);
        if (regler.max !== null && value > regler.max) throw invalid(`${id}: größer als erlaubt.`);
        if (regler.nurRegional && !istRegional(basis))
            throw invalid(`${id}: Fassung ${String(basis.version)} hat keine regionale Rückverteilung.`);
        let node = recipe;
        for (const key of regler.pfad.slice(0, -1)) {
            const next = node[key];
            if (typeof next !== "object" || next === null) throw invalid(`${id}: gibt es in dieser Fassung nicht.`);
            node = next as Tree;
        }
        node[regler.pfad.at(-1)!] = value;
    }
    try {
        return parseTerrainRecipe(recipe);
    } catch (error) {
        throw invalid(error instanceof Error ? error.message : "Das Rezept ist ungültig.");
    }
}

export interface Abnahme {
    am: Date;
    wer: string | null;
    grund: string | null;
}

/** Die jüngste Abnahme je Fassung in dieser Umgebung; fehlt die Tafel (vor 0100), keine. */
export async function abnahmen(db: Queryable, domain: string): Promise<Map<number, Abnahme>> {
    try {
        const rows = await db<{ version: number; accepted_at: Date; wer: string | null; reason: string | null }[]>`
            SELECT DISTINCT ON (a.version) a.version, a.accepted_at, COALESCE(p.display_name, a.accepted_by_label) AS wer, a.reason
              FROM terrain_recipe_acceptance a
              LEFT JOIN avesmaps_auth.person p ON p.id = a.accepted_by
             WHERE a.map_domain_id = ${domain}
             ORDER BY a.version, a.accepted_at DESC, a.id DESC
        `;
        return new Map(rows.map((row) => [row.version, { am: row.accepted_at, wer: row.wer, grund: row.reason }]));
    } catch (error) {
        if (isMissingTable(error)) return new Map();
        throw error;
    }
}

/** Abgenommen: in dieser Umgebung vermerkt oder in `accepted` der Datei (auf Stage abgenommen). */
export const istAbgenommen = (version: number, vermerkt: ReadonlyMap<number, Abnahme>): boolean =>
    vermerkt.has(version) || AVENTURIA_TERRAIN_SELECTION.accepted.includes(version);

/** Das Ziel des Rückwegs: die vorige Fassung, wenn sie abgenommen ist und dieses Release sie kennt. */
export async function rueckwegZiel(db: Queryable, domain: string): Promise<number | null> {
    const choice = await readTerrainChoice(db, domain);
    const ziel = choice.previousVersion;
    if (ziel === null || ziel === choice.version || !AVENTURIA_TERRAIN_RECIPES.has(ziel)) return null;
    return istAbgenommen(ziel, await abnahmen(db, domain)) ? ziel : null;
}

export interface Handelnde {
    personId: string | null;
    label: string;
    actorRef: string;
}

/**
 * Wählt eine Fassung und reiht die volle Kette ein. `baseRevision` (Oberfläche) prüft gegen die gesehene Revision; die Kommandozeile
 * lässt sie weg. `rueckweg` überspringt die Prüfung des Profils (Production darf zurück, §9c.8).
 */
export async function waehleFassung(
    tx: Queryable,
    input: {
        domain: string;
        version: number;
        reason: string;
        actor: Handelnde;
        profil: HoehenmodellProfil;
        baseRevision?: number | undefined;
        rueckweg?: boolean;
        /** Gilt die Abkühlzeit für diese Person (`brauchtAbkuehlzeit`)? Der Rückweg kennt sie nicht. */
        abkuehlen?: boolean;
        conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
    },
): Promise<{ from: number; to: number; revision: number; job: string }> {
    if (!AVENTURIA_TERRAIN_RECIPES.has(input.version)) {
        throw new ApiError(
            400,
            "terrain_version_unknown",
            `Fassung ${String(input.version)} gibt es in diesem Release nicht.`,
        );
    }
    if (
        input.profil === "abgenommen" &&
        input.rueckweg !== true &&
        !AVENTURIA_TERRAIN_SELECTION.accepted.includes(input.version)
    ) {
        throw new ApiError(
            409,
            "terrain_not_accepted",
            "Noch nicht freigegeben. Erst auf der Stage abnehmen, mit dem nächsten Release lässt sie sich hier aktivieren.",
        );
    }
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps3d:terrain-choice:${input.domain}`}))`;
    const current = await readTerrainChoice(tx, input.domain);
    if (input.baseRevision !== undefined && input.baseRevision !== current.revision) {
        throw input.conflict
            ? await input.conflict({ revision: current.revision, changedAt: current.chosenAt ?? new Date() })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    if (current.version === input.version) {
        throw new ApiError(409, "terrain_already_active", `Fassung ${String(input.version)} ist schon gewählt.`);
    }
    if (input.abkuehlen === true && input.rueckweg !== true) await pruefeAbkuehlzeit(tx, input.domain);
    const [row] = await tx<{ revision: number }[]>`
        INSERT INTO terrain_recipe_choice (map_domain_id, version, previous_version, revision, chosen_at, chosen_by, chosen_by_label, reason)
        VALUES (${input.domain}, ${input.version}, ${current.version}, 1, now(), ${input.actor.personId}::uuid, ${input.actor.label},
                ${input.reason})
        ON CONFLICT (map_domain_id) DO UPDATE SET
            version = EXCLUDED.version, previous_version = terrain_recipe_choice.version,
            revision = terrain_recipe_choice.revision + 1, chosen_at = now(), chosen_by = EXCLUDED.chosen_by,
            chosen_by_label = EXCLUDED.chosen_by_label, reason = EXCLUDED.reason
        RETURNING revision
    `;
    const label = vollerLaufEtikett(fassungsName(input.version), input.rueckweg === true ? "zurück" : undefined);
    const [job] = await tx<{ job: string }[]>`
        SELECT terrain_chain_enqueue(${input.domain}, ${input.actor.actorRef}, ${label})::text AS job
    `;
    return { from: current.version, to: input.version, revision: row!.revision, job: job!.job };
}

/**
 * Die Abkühlzeit in Production (WI-0279; Claudio 2026-11-03): „Höchstens eine wartende Kette“ verhindert keine Folge aus Wählen, Rechnen, Zurück,
 * Rechnen. Jede Runde kostet dort 6 Minuten bei 2 GB neben Foundry, und die Kacheln fallen aus dem Zwischenspeicher. Darum liegen zwischen zwei
 * vollen Läufen 30 Minuten, wenn nicht ein Betreiber auslöst. Der Rückweg bleibt frei: Er ist der Ausweg aus einer falschen Fassung, und die Folge
 * endet trotzdem am nächsten Wählen.
 */
export const ABKUEHLZEIT_MINUTEN = 30;

export function brauchtAbkuehlzeit(session: { environment: string; role: string }): boolean {
    return session.environment === "production" && session.role !== "operator";
}

async function pruefeAbkuehlzeit(tx: Queryable, domain: string): Promise<void> {
    const [zeile] = await tx<{ ab: Date | null }[]>`
        SELECT max(queued_at) + make_interval(mins => ${ABKUEHLZEIT_MINUTEN}) AS ab FROM job
         WHERE kind = 'terrain_full' AND map_domain_id = ${domain} AND state <> 'CANCELLED'
        HAVING max(queued_at) + make_interval(mins => ${ABKUEHLZEIT_MINUTEN}) > now()
    `;
    if (zeile?.ab) {
        throw new ApiError(
            409,
            "terrain_cooldown",
            `Zwischen zwei vollen Läufen in Production liegen ${String(ABKUEHLZEIT_MINUTEN)} Minuten.`,
            { ab: zeile.ab.toISOString() },
        );
    }
}

/**
 * „Gelände neu rechnen“ (Betreiber 2026-10-17, Topographie F8 „Du, mit Knopf“; EDIT-0003 T46): die gewählte Fassung, die volle Kette noch
 * einmal, etwa nach Änderungen an Gipfeln, Gebirgen oder Landschaften. Höchstens EINE wartende Kette: Wartet schon eine, ist es 409 mit
 * ihrer Kennung (sie rechnet ohnehin mit dem neuesten Stand); läuft eine, reiht sich die neue dahinter.
 */
export async function rechneNeu(
    tx: Queryable,
    input: { domain: string; actor: Handelnde; abkuehlen?: boolean },
): Promise<{ version: number; job: string }> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`avesmaps3d:terrain-choice:${input.domain}`}))`;
    const [wartend] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id FROM job
         WHERE kind = 'terrain_full' AND map_domain_id = ${input.domain} AND state = 'QUEUED'
         LIMIT 1
    `;
    if (wartend !== undefined) {
        throw new ApiError(409, "terrain_chain_waiting", "Eine Geländerechnung wartet schon.", {
            job: wartend.public_id,
        });
    }
    if (input.abkuehlen === true) await pruefeAbkuehlzeit(tx, input.domain);
    const current = await readTerrainChoice(tx, input.domain);
    const label = vollerLaufEtikett(fassungsName(current.version), "neu gerechnet");
    const [job] = await tx<{ job: string }[]>`
        SELECT terrain_chain_enqueue(${input.domain}, ${input.actor.actorRef}, ${label})::text AS job
    `;
    return { version: current.version, job: job!.job };
}

export async function nimmAb(
    tx: Queryable,
    input: { domain: string; version: number; reason: string; actor: Handelnde },
): Promise<void> {
    if (!AVENTURIA_TERRAIN_RECIPES.has(input.version)) {
        throw new ApiError(
            400,
            "terrain_version_unknown",
            `Fassung ${String(input.version)} gibt es in diesem Release nicht.`,
        );
    }
    await tx`
        INSERT INTO terrain_recipe_acceptance (map_domain_id, version, accepted_by, accepted_by_label, reason)
        VALUES (${input.domain}, ${input.version}, ${input.actor.personId}::uuid, ${input.actor.label}, ${input.reason})
    `;
}
