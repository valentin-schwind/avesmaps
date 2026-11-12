import type { HoehenmodellTestWerte } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { isMissingTable } from "../system/state-row.ts";
import { AVENTURIA_TERRAIN_RECIPES, AVENTURIA_TERRAIN_SELECTION, type TerrainRecipe } from "./domain/recipes.ts";
import { mitTest } from "./domain/recipe-test.ts";
import { hoehenmodellProfil } from "./hoehenmodell-profil.ts";

/**
 * Welche Fassung des Geländerezepts in dieser Umgebung gilt (WI-0127 SYS-13, SYS-0001 §9c.4 Option C, Betreiber 2026-10-10 „nach
 * Empfehlung“). Die Fassungen bleiben geprüfte Dateien (`config/terrain/aventuria/<n>.json`), überall gleich; GEWÄHLT wird je Umgebung in
 * der Datenbank (`terrain_recipe_choice`, Migration 0100), in der Systemsteuerung oder mit `gelaende-waehlen`.
 *
 * - **Eine Stelle** für Ableitung, Aktivierung, lokalen Job, Prüfer und Kommandozeile: Wer das Rezept braucht, fragt hier.
 * - **Rückfall:** Fehlt die Tafel (Fastify vor `migrate`) oder die Zeile, gilt `active` aus der Datei wie bisher. Nennt die Zeile eine
 *   Fassung, die dieses Release nicht kennt, gilt ebenfalls die Datei, und `unbekannt` sagt es.
 * - 🔴 Der Zug ändert die Auswahl nie (AGENTS.md, Betreiber 2026-10-10: „nur die entscheidung darf nicht nachträglich kompromittiert
 *   werden“); er rechnet I11 mit der gewählten Fassung.
 */
export interface TerrainChoice {
    version: number;
    /** Die Fassung vor der letzten Wahl: das Ziel des Rückwegs, wenn sie abgenommen ist. */
    previousVersion: number | null;
    revision: number;
    chosenAt: Date | null;
    chosenBy: string | null;
    chosenByLabel: string | null;
    reason: string | null;
    /** `auswahl`: die Zeile dieser Umgebung; `datei`: die Vorgabe `active` (keine Zeile, keine Tafel, unbekannte Fassung). */
    quelle: "auswahl" | "datei";
    /** Eine gewählte Fassung, die dieses Release nicht kennt (die Datei gilt dann). */
    unbekannt: number | null;
}

interface ChoiceRow {
    version: number;
    previous_version: number | null;
    revision: number;
    chosen_at: Date | null;
    chosen_by: string | null;
    chosen_by_label: string | null;
    reason: string | null;
}

const ausDatei = (unbekannt: number | null = null): TerrainChoice => ({
    version: AVENTURIA_TERRAIN_SELECTION.recipe.version,
    previousVersion: null,
    revision: 0,
    chosenAt: null,
    chosenBy: null,
    chosenByLabel: null,
    reason: null,
    quelle: "datei",
    unbekannt,
});

export async function readTerrainChoice(db: Queryable, domain: string): Promise<TerrainChoice> {
    let row: ChoiceRow | undefined;
    try {
        [row] = await db<ChoiceRow[]>`
            SELECT version, previous_version, revision, chosen_at, chosen_by::text AS chosen_by, chosen_by_label, reason
              FROM terrain_recipe_choice WHERE map_domain_id = ${domain}
        `;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
        return ausDatei();
    }
    if (row === undefined) return ausDatei();
    if (!AVENTURIA_TERRAIN_RECIPES.has(row.version)) return ausDatei(row.version);
    return {
        version: row.version,
        previousVersion: row.previous_version,
        revision: row.revision,
        chosenAt: row.chosen_at,
        chosenBy: row.chosen_by,
        chosenByLabel: row.chosen_by_label,
        reason: row.reason,
        quelle: "auswahl",
        unbekannt: null,
    };
}

/**
 * Das Rezept der gewählten Fassung dieser Umgebung, bei einer offenen Fassung mit ihren Werten aus `terrain_recipe_test` (WI-0240,
 * „19 (Test)“). Alle, die rechnen, holen es hier: voller und lokaler Lauf, Gebirgssaaten mit den Presets, Aktivieren, Prüfung.
 */
export async function resolveTerrainRecipe(db: Queryable, domain: string): Promise<TerrainRecipe> {
    const choice = await readTerrainChoice(db, domain);
    return mitTestWerten(
        db,
        domain,
        AVENTURIA_TERRAIN_RECIPES.get(choice.version) ?? AVENTURIA_TERRAIN_SELECTION.recipe,
    );
}

/** Die Werte von „19 (Test)“ dieser Fassung; `null`: keine Zeile oder die Tafel fehlt (vor Migration 0210). */
export async function leseTestWerte(
    db: Queryable,
    domain: string,
    version: number,
): Promise<HoehenmodellTestWerte | null> {
    try {
        const [row] = await db<{ werte: HoehenmodellTestWerte }[]>`
            SELECT werte FROM terrain_recipe_test WHERE map_domain_id = ${domain} AND version = ${version}
        `;
        return row?.werte ?? null;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
        return null;
    }
}

/**
 * Die Datei einer Fassung mit ihren Testwerten (WI-0240). 🔴 Nur, solange die Fassung offen ist (nicht unter `accepted` der Auswahldatei)
 * und nie auf Production (Profil `abgenommen`): Dort gilt allein die Datei, auch wenn eine Zeile mitgekommen wäre. Nach der Abnahme in
 * dieser Umgebung bleiben die (gesperrten) Werte wirksam, bis ihr Stand als Datei ausgerollt ist; der ist dann derselbe Inhalt.
 */
export async function mitTestWerten(
    db: Queryable,
    domain: string,
    datei: TerrainRecipe,
    profil = hoehenmodellProfil(process.env),
): Promise<TerrainRecipe> {
    if (profil !== "voll" || AVENTURIA_TERRAIN_SELECTION.accepted.includes(datei.version)) return datei;
    const werte = await leseTestWerte(db, domain, datei.version);
    if (werte === null) return datei;
    try {
        return mitTest(datei, werte);
    } catch (error) {
        // Ein gespeicherter Wert, den dieses Release nicht mehr annimmt (etwa ein Regler, den es nicht mehr gibt): Die Datei gilt, der
        // Reiter „Höhenmodell“ zeigt die Werte weiter an, und die nächste Änderung ersetzt sie.
        console.warn(
            `terrain_recipe_test ${String(datei.version)} ignoriert: ${error instanceof Error ? error.message : String(error)}`,
        );
        return datei;
    }
}
