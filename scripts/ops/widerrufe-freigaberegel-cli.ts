import { parseArgs } from "node:util";
import { loadConfig } from "../../apps/server/src/config.ts";
import { createDatabase } from "../../apps/server/src/database.ts";

/**
 * Widerruft EINE Freigaberegel in `publication_rule` (WI-0063 Gate G1; `media-rules.ts`: „Widerruf und Änderung sind eine
 * Betriebsmaßnahme per Skript bis WI-0068"). Ein Widerruf schaltet alle betroffenen Medien mit einer Zeile ab; die
 * veröffentlichten Dateien nimmt erst der nächste `migrate:media-files` weg (er zählt sie als „Entscheidung gedreht").
 *
 * 🔴 Eine einmal widerrufene Regel wird vom Import NIE neu angelegt (`seedPublicationRules` prüft auf „gibt es eine Zeile",
 * nicht auf „gibt es eine aktive Zeile"). Der Widerruf ist also dauerhaft, bis ihn jemand von Hand zurücknimmt.
 *
 * Ohne `--operator-said` rechnet das Werkzeug nur und schreibt nichts.
 *
 * Seit Migration 0092 kann eine Regel auch die Entstehung nennen (Betreiber 2026-10-10: die Klassenregeln für Wappen und Ortsbilder
 * gelten KI-generierten eigenen Werken). Ohne `--entstehung` ist die Regel ohne Entstehung gemeint.
 *
 *   npm run ops:widerrufe-regel -- --basis fan_policy --rolle map_preview
 *   npm run ops:widerrufe-regel -- --basis fan_policy --rolle map_preview --operator-said "<Zitat>"
 *   npm run ops:widerrufe-regel -- --basis own_work --entstehung ai_generated --rolle header
 */
const { values } = parseArgs({
    options: {
        basis: { type: "string" },
        rolle: { type: "string" },
        entstehung: { type: "string" },
        "operator-said": { type: "string" },
        zuruecknehmen: { type: "boolean", default: false },
    },
});

const basis = values.basis;
const rolle = values.rolle;
const entstehung = values.entstehung ?? null;
if (basis === undefined || rolle === undefined) {
    console.error(
        'usage: --basis <rights_basis> --rolle <role> [--entstehung <creation_method>] [--operator-said "<Zitat>"] [--zuruecknehmen]',
    );
    process.exit(1);
}
const regelName = [basis, entstehung, rolle].filter((part) => part !== null).join(" / ");

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const sql = createDatabase(config.databaseUrl, { max: 1 });
try {
    const zeilen = await sql<
        { id: string; scope_text: string; operator_quote: string; decided_on: string; revoked_on: string | null }[]
    >`
        SELECT id::text, scope_text, operator_quote, decided_on::text, revoked_on::text
        FROM publication_rule
        WHERE rights_basis = ${basis} AND role = ${rolle} AND license_key IS NULL
          AND creation_method IS NOT DISTINCT FROM ${entstehung}
        ORDER BY id
    `;

    if (zeilen.length === 0) {
        console.error(`Keine Regel für (${regelName}). Nichts zu tun.`);
        process.exit(2);
    }
    if (zeilen.length > 1) {
        // Mehrere Zeilen waeren ein Befund, kein Fall fuer ein blindes UPDATE.
        console.error(`${String(zeilen.length)} Regeln für (${regelName}) — mehrdeutig, nichts geändert.`);
        process.exit(2);
    }

    const regel = zeilen[0];
    if (regel === undefined) process.exit(2);
    const ziel = values.zuruecknehmen ? null : "heute";
    console.log(`Regel      ${regelName}`);
    console.log(`entschieden ${regel.decided_on}: „${regel.operator_quote}"`);
    console.log(`Umfang     ${regel.scope_text}`);
    console.log(`Stand      ${regel.revoked_on === null ? "aktiv" : `widerrufen am ${regel.revoked_on}`}`);
    console.log(`Ziel       ${ziel === null ? "wieder aktiv" : "widerrufen"}`);

    if ((regel.revoked_on === null) === values.zuruecknehmen) {
        console.log("\nSchon auf dem gewünschten Stand — nichts zu tun.");
        process.exit(0);
    }

    const zitat = values["operator-said"];
    if (zitat === undefined) {
        console.log("\nNUR GERECHNET — ohne --operator-said wird nichts geschrieben.");
        process.exit(0);
    }
    console.log(`\nFreigabe (Betreiberzitat): „${zitat}"`);

    if (values.zuruecknehmen) {
        await sql`UPDATE publication_rule SET revoked_on = NULL WHERE id = ${regel.id}::bigint`;
        console.log("Regel wieder aktiv.");
    } else {
        await sql`UPDATE publication_rule SET revoked_on = CURRENT_DATE WHERE id = ${regel.id}::bigint`;
        console.log("Regel widerrufen.");
    }
    console.log(
        "🔴 Die veröffentlichten Dateien nimmt erst `migrate:media-files` weg (Spalte „Entscheidung gedreht“).",
    );
} finally {
    await sql.end();
}
