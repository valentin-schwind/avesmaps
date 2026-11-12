import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Value } from "@sinclair/typebox/value";
import { NewsSeed, istNewsRubrik, type NewsSeed as NewsSeedTyp } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";

/**
 * Spielt den Startbestand der Neuigkeiten ein (WI-0139 N3): Legacys 103 Einträge vom 22.04. bis 10.10.2026, die Claudio einmal lesend
 * über `legacy.avesmaps.de` abgerufen hat (`config/news/legacy-seed.json`, Format `NewsSeed` in `packages/shared/src/news.ts`).
 *
 * 🔴 **Warum ein Werkzeug und nicht die Migration:** Eine Migration läuft in jeder Umgebung und wäre damit eine Datenlieferung an
 * Production, die niemand einzeln verantwortet. Das Werkzeug läuft, wenn der Betreiber es will, und sagt vorher, was es täte.
 *
 * 🔴 **Wiederholbar:** Jeder Eintrag trägt die Quelle `legacy:<datum>:<reihe>`; ein zweiter Lauf legt nichts doppelt an. Der Bestand ist
 * damit auch nach einem Neuaufsetzen der Datenbank derselbe — Legacy kann jederzeit wegfallen.
 *
 * Die Einträge kommen **sichtbar** herein, nicht als Entwurf: Sie standen in Legacy jahrelang öffentlich, es gibt nichts abzunehmen.
 * Nur was die tägliche Routine künftig schreibt, ist ein Entwurf (Betreiber 2026-10-13: „erst entwurf, wie empfohlen“).
 *
 * Beispiele:
 *   npm run migrate:news -- --dry-run      (nimmt `config/news/legacy-seed.json`)
 *   npm run migrate:news
 *   npm run migrate:news -- --file <andere Datei>
 *
 * 🪤 Pfade gelten ab der Wurzel des Repositorys, nicht ab `apps/server`: Das Werkzeug läuft über `npm run` im Workspace, und ein
 * `--file config/news/...` hätte sonst dort gesucht, wo nichts liegt.
 */

/** Die Wurzel des Repositorys: vier Ebenen über dieser Datei. */
const WURZEL = resolve(import.meta.dirname, "../../../..");
/** Der Startbestand, den Claudio einmal aus Legacy gelesen hat; es gibt genau einen. */
const VORGABE = "config/news/legacy-seed.json";

interface Lauf {
    gelesen: number;
    neu: number;
    schonDa: number;
    befunde: string[];
}

export async function spieleSeedEin(
    database: ReturnType<typeof createDatabase>,
    seed: NewsSeedTyp,
    trocken: boolean,
): Promise<Lauf> {
    const lauf: Lauf = { gelesen: seed.eintraege.length, neu: 0, schonDa: 0, befunde: [] };
    // Die Reihe innerhalb eines Tages: aus der Datei, sonst die Reihenfolge der Datei selbst.
    const proTag = new Map<string, number>();
    for (const [index, eintrag] of seed.eintraege.entries()) {
        const naechste = proTag.get(eintrag.datum) ?? 0;
        const reihe = eintrag.reihe ?? naechste;
        proTag.set(eintrag.datum, Math.max(naechste, reihe + 1));
        if (!istNewsRubrik(eintrag.rubrik)) {
            // Melden, nicht anhalten: Eine unbekannte Rubrik steht in der Anzeige ohne Marke da (AGENTS.md, „Blockierende Prüfungen“).
            lauf.befunde.push(`Zeile ${String(index + 1)}: unbekannte Rubrik „${eintrag.rubrik}“`);
        }
        const quelle = `legacy:${eintrag.datum}:${String(reihe)}`;
        if (trocken) {
            const [vorhanden] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM public.news_entry WHERE quelle = ${quelle} AND titel = ${eintrag.titel}
            `;
            if ((vorhanden?.n ?? 0) > 0) lauf.schonDa += 1;
            else lauf.neu += 1;
            continue;
        }
        const angelegt = await database<{ id: string }[]>`
            INSERT INTO public.news_entry
                (datum, titel, text, rubrik, reihe, zustand, herkunft, quelle, freigegeben_at)
            VALUES (${eintrag.datum}::date, ${eintrag.titel.trim()}, ${eintrag.text.trim()}, ${eintrag.rubrik}, ${reihe},
                    'sichtbar', 'legacy', ${quelle}, ${seed.gelesenAt}::timestamptz)
            ON CONFLICT (quelle, titel) DO NOTHING
            RETURNING id
        `;
        if (angelegt.length > 0) lauf.neu += 1;
        else lauf.schonDa += 1;
    }
    return lauf;
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            file: { type: "string" },
            "dry-run": { type: "boolean", default: false },
        },
    });
    const gewuenscht = values.file ?? VORGABE;
    const datei = isAbsolute(gewuenscht) ? gewuenscht : resolve(WURZEL, gewuenscht);
    const roh: unknown = JSON.parse(await readFile(datei, "utf8"));
    if (!Value.Check(NewsSeed, roh)) {
        console.error(`${datei} passt nicht zum Format NewsSeed (packages/shared/src/news.ts).`);
        for (const fehler of [...Value.Errors(NewsSeed, roh)].slice(0, 5)) {
            console.error(`  ${fehler.path}: ${fehler.message}`);
        }
        process.exit(1);
    }
    const config = loadConfig();
    if (config.databaseUrl === undefined) {
        console.error("DATABASE_URL fehlt.");
        process.exit(1);
    }
    const database = createDatabase(config.databaseUrl, { max: 2 });
    try {
        const lauf = await spieleSeedEin(database, roh, values["dry-run"] === true);
        const wort = values["dry-run"] === true ? "wäre neu" : "angelegt";
        console.log(`${String(lauf.gelesen)} gelesen · ${String(lauf.neu)} ${wort} · ${String(lauf.schonDa)} schon da`);
        for (const befund of lauf.befunde) console.log(`BEFUND ${befund}`);
    } finally {
        await database.end({ timeout: 5 });
    }
}

// Im Release liegt nur dist/migration/news-cli.js (Claudio 2026-10-13, §4): beide Endungen starten main(), ein Import nicht.
if (/news-cli\.[jt]s$/u.test(process.argv[1] ?? "")) await main();
