import { parseArgs } from "node:util";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { bereinigeTitel, findeTitelMitAuszeichnung, type TitelFund } from "./titel-bereinigen.ts";

/**
 * Titel mit Auszeichnung im Bestand bereinigen (Regel und Ablauf: `titel-bereinigen.ts`; Fund aus OPS-000091, Vali 2026-11-07: „Daten-Lauf“).
 *
 * 🔴 Map Mutation Guard: Ohne `--ausfuehren` nur lesen (`read only`). Schreiben nur mit `--freigabe "<Wortlaut>"` (Akteur Agent Claudio,
 * `approvalRef`) und `--erwartet <n>` (Zahl der Titel aus dem Trockenlauf, ohne die leeren; sonst nichts geschrieben). `--nur <kennung,…>` grenzt auf
 * die freigegebenen Gegenstände ein (`public_id`, durch Komma getrennt). Die Kartensperre (`system_state.map_lock`) hält den Lauf an.
 *
 *   node apps/server/dist/inhalte/titel-bereinigen-cli.js
 *   node apps/server/dist/inhalte/titel-bereinigen-cli.js --nur <kennung,…> --ausfuehren --erwartet <n> --freigabe "<Wortlaut>"
 */
const { values } = parseArgs({
    options: {
        ausfuehren: { type: "boolean", default: false },
        erwartet: { type: "string" },
        freigabe: { type: "string" },
        nur: { type: "string" },
    },
});

function abbruch(text: string, code = 2): never {
    console.error(text);
    process.exit(code);
}

const WORT: Record<TitelFund["art"], string> = { quelle: "quelle", werk: "werk  ", asset: "asset " };

const config = loadConfig();
if (!config.databaseUrl) abbruch("DATABASE_URL ist nicht gesetzt", 1);
const umgebung = config.auth?.environment;
const nur = values.nur
    ?.split(",")
    .map((kennung) => kennung.trim())
    .filter((kennung) => kennung !== "");
if (nur !== undefined && nur.some((kennung) => !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(kennung)))
    abbruch("--nur nimmt Kennungen (public_id), durch Komma getrennt.");
if (values.ausfuehren) {
    if (umgebung === undefined)
        abbruch("Schreiben nur in einer benannten Umgebung (AVESMAPS_ENV). Nichts geschrieben.");
    if ((values.freigabe ?? "").trim() === "")
        abbruch("Ohne --freigabe (Wortlaut der Freigabe des Betreibers) wird nichts geschrieben.");
    if (!/^[0-9]{1,4}$/u.test(values.erwartet ?? ""))
        abbruch("Ohne --erwartet <n> (Zahl der Titel aus dem Trockenlauf) wird nichts geschrieben.");
}

const db = createDatabase(config.databaseUrl, { max: 1 });
try {
    const funde = await db.begin("read only", (tx) => findeTitelMitAuszeichnung(tx, nur));
    for (const fund of funde) {
        const herkunft = fund.herkunft === null ? "" : `, Herkunft ${fund.herkunft}`;
        console.log(
            `${WORT[fund.art]}  ${fund.kennung}  „${fund.vorher}“  →  ${fund.leer ? "LEER, bleibt" : `„${fund.nachher}“`}  (Revision ${String(fund.revision)}${herkunft})`,
        );
    }
    const zuSchreiben = funde.filter((fund) => !fund.leer);
    const zahl = (art: TitelFund["art"]): number => zuSchreiben.filter((fund) => fund.art === art).length;
    console.log(
        `titel     ${String(zuSchreiben.length)} zu bereinigen: ${String(zahl("quelle"))} Quellen, ${String(zahl("werk"))} Werke, ${String(zahl("asset"))} Assets; ${String(funde.length - zuSchreiben.length)} blieben leer`,
    );
    if (!values.ausfuehren) {
        console.log("TROCKENLAUF: nichts geschrieben");
    } else if (String(zuSchreiben.length) !== values.erwartet) {
        console.error(
            `Der Trockenlauf zählt ${String(zuSchreiben.length)} Titel, erwartet ${values.erwartet ?? "?"}: nichts geschrieben.`,
        );
        process.exitCode = 2;
    } else {
        const [sperre] = await db<{ map_lock: boolean }[]>`SELECT map_lock FROM system_state WHERE id = 1`;
        if (sperre?.map_lock !== false)
            abbruch("Die Karte ist gesperrt (SYS-4) oder der Zustand ist unbekannt: nichts geschrieben.", 3);
        const actor: MapActor & { kind: "agent" } = {
            kind: "agent",
            label: "claudio",
            approvalRef: values.freigabe!.trim().slice(0, 300),
            environment: umgebung!,
        };
        const ergebnis = await bereinigeTitel(db, actor, zuSchreiben);
        for (const fund of ergebnis.geschrieben) {
            const operation = ergebnis.operationen.get(fund.kennung);
            console.log(
                `geschrieben  ${WORT[fund.art]}  ${fund.kennung}  „${fund.nachher}“${operation === undefined ? "" : `, Operation ${operation}`}`,
            );
        }
        for (const { fund, grund } of ergebnis.fehler)
            console.error(`FEHLER    ${WORT[fund.art]}  ${fund.kennung}: ${grund}`);
        if (ergebnis.journal !== null)
            console.log(`journal   migration_run ${ergebnis.journal} (Asset-Namen vorher und nachher)`);
        console.log(
            `ergebnis  ${String(ergebnis.geschrieben.length)} Titel bereinigt, ${String(ergebnis.fehler.length)} Fehler`,
        );
        if (ergebnis.fehler.length > 0) process.exitCode = 1;
    }
} finally {
    await db.end();
}
