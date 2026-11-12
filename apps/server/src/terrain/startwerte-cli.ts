import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import type { GebirgsNetzStand } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase, type Database, type Queryable } from "../database.ts";
import { mapOperation, type MapAuditEntry } from "../editor/map-operation.ts";
import { gebirgSchreiben, leseGebirgsZusatz } from "./gebirge-editor.ts";
import { grundhoeheFor } from "./inputs.ts";
import {
    alsAenderung,
    klassifiziereStartwerte,
    ohneStartwerte,
    protokollStaende,
    type GebirgsProtokoll,
    type StartwertPunkt,
} from "./startwerte.ts";

/**
 * Startwerte an den Punkten der Gebirgsnetze bereinigen (WI-0249; Vali wählte 2026-10-26: Startwerte 2.300 gelten nicht als eigene Höhe und
 * werden auf der Stage an den Punkten entfernt). Kriterium und Klassen: `apps/server/src/terrain/startwerte.ts`.
 *
 * 🔴 Map Mutation Guard: Ohne `--ausfuehren` liest das Werkzeug nur (eine Transaktion `read only`), auch in Production (Zählung). Schreiben
 * geht nur auf der Stage (`AVESMAPS_ENV=staging`), nur mit dem Wortlaut der Freigabe (`--freigabe`), der Zahl aus dem Trockenlauf
 * (`--erwartet`, sonst Abbruch ohne Schreiben) und einer Sicherung (`--sicherung`), je Gebirge als Operation `area.gebirge_startwerte` mit
 * Fachprotokoll (Akteur Agent Claudio), Revision (409 für offene Entwürfe dagegen) und Gelände im Umkreis danach. Keine Migration.
 *
 * 🔴 Kein ↺ in „Änderungen“ (WI-0265 B8c): Das ist ein Betreiberlauf mit eigenem Rückweg (`--zurueckspielen` mit Sicherung und Freigabe), kein Handgriff eines Editors; ein ↺ spielte die Startwerte ohne
 * diese Freigabe wieder ein. Der Name der Operation steht darum in `SYSTEMLAUF_OPERATIONEN` (`editor/ruecknahme-arten.ts`), in keiner Familie des Katalogs; die Liste zeigt sie als `nicht_ruecknehmbar` (Grund `art`).
 *
 *   node apps/server/src/terrain/startwerte-cli.ts                                   # Trockenlauf: Zahlen und Beispiele
 *   node apps/server/src/terrain/startwerte-cli.ts --bericht <datei.json>            # dazu jeder Punkt als JSON
 *   node apps/server/src/terrain/startwerte-cli.ts --ausfuehren --erwartet <n> --freigabe "<Wortlaut>" --sicherung <datei.json>
 *   node apps/server/src/terrain/startwerte-cli.ts --zurueckspielen <sicherung.json> --freigabe "<Wortlaut>"   # Rückweg: Netze der Sicherung
 */
const { values } = parseArgs({
    options: {
        domain: { type: "string", default: "aventuria" },
        bericht: { type: "string" },
        ausfuehren: { type: "boolean", default: false },
        erwartet: { type: "string" },
        freigabe: { type: "string" },
        sicherung: { type: "string" },
        zurueckspielen: { type: "string" },
    },
});

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}
// Ohne benannte Umgebung (`AVESMAPS_ENV`) gibt es keine Anmeldung und kein Schreiben; lesen geht.
const umgebung = config.auth?.environment ?? "unbenannt";
const schreibt = values.ausfuehren || values.zurueckspielen !== undefined;
if (schreibt) {
    if (umgebung !== "staging") {
        console.error(`Schreiben nur auf der Stage (Umgebung hier: ${umgebung}). Nichts geschrieben.`);
        process.exit(2);
    }
    if ((values.freigabe ?? "").trim() === "") {
        console.error("Ohne --freigabe (Wortlaut der Freigabe des Betreibers) wird nichts geschrieben.");
        process.exit(2);
    }
}

interface Flaeche {
    area_id: string;
    public_id: string;
    region_public_id: string;
    name: string;
    flaeche: number;
    maximalhoehe: number | null;
    revision: string | null;
}

interface Befund {
    flaeche: Flaeche;
    kammhoehe: number;
    netz: GebirgsNetzStand;
    punkte: StartwertPunkt[];
}

async function lies(db: Queryable): Promise<Befund[]> {
    const flaechen = await db<Flaeche[]>`
        SELECT a.id::text AS area_id, a.public_id::text AS public_id, r.public_id::text AS region_public_id, r.name,
               ST_Area(a.geom) AS flaeche, c.maximalhoehe, c.revision::text AS revision
          FROM region_area a
          JOIN region r ON r.id = a.region_id AND r.is_active
          LEFT JOIN terrain_control c ON c.area_id = a.id AND c.is_active
         WHERE a.is_active AND a.map_domain_id = ${values.domain!}
           AND r.region_layer = 'topographie' AND r.region_type = 'gebirge'
           AND (EXISTS (SELECT 1 FROM terrain_ridge_edge e WHERE e.area_id = a.id)
                OR EXISTS (SELECT 1 FROM terrain_ridge_point p WHERE p.area_id = a.id))
         ORDER BY r.name, a.public_id
    `;
    const netze = await leseGebirgsZusatz(
        db,
        flaechen.map((f) => f.area_id),
    );
    const befunde: Befund[] = [];
    for (const flaeche of flaechen) {
        const zeilen = await db<
            { changes: { gebirge?: { before?: GebirgsProtokoll["vorher"]; after?: GebirgsProtokoll["nachher"] } } }[]
        >`
            SELECT e.changes FROM map_audit_event e
             WHERE e.action = 'area.gebirge' AND e.region_area_public_id = ${flaeche.public_id}::uuid
             ORDER BY e.id
        `;
        const grund = grundhoeheFor(Number(flaeche.flaeche));
        const kammhoehe = flaeche.maximalhoehe ?? grund;
        const netz = netze.get(flaeche.area_id)!.netz;
        const verlauf = protokollStaende(
            zeilen.map((z) => ({ vorher: z.changes.gebirge?.before ?? {}, nachher: z.changes.gebirge?.after ?? {} })),
            flaeche.maximalhoehe,
            grund,
        );
        befunde.push({ flaeche, kammhoehe, netz, punkte: klassifiziereStartwerte({ netz, kammhoehe }, verlauf) });
    }
    return befunde;
}

const zahl = (befunde: readonly Befund[], klasse: StartwertPunkt["klasse"]): number =>
    befunde.reduce((a, b) => a + b.punkte.filter((p) => p.klasse === klasse).length, 0);

function berichte(befunde: readonly Befund[]): void {
    const mit = befunde.filter((b) => b.punkte.length > 0);
    console.log(
        `Umgebung ${umgebung}, Domäne ${values.domain!}: ${String(befunde.length)} Gebirgsflächen mit Netz, ${String(mit.length)} mit eigenen Punkthöhen.`,
    );
    console.log(
        `Punkte mit eigener Höhe: Startwert ${String(zahl(befunde, "startwert"))}, eigen ${String(zahl(befunde, "eigen"))}, unklar ${String(zahl(befunde, "unklar"))}.`,
    );
    for (const b of mit) {
        const z = (k: StartwertPunkt["klasse"]) => b.punkte.filter((p) => p.klasse === k).length;
        console.log(
            `  ${b.flaeche.name} (${b.flaeche.public_id}, Kammhöhe ${String(b.kammhoehe)}): Startwert ${String(z("startwert"))}, eigen ${String(z("eigen"))}, unklar ${String(z("unklar"))}`,
        );
        for (const p of b.punkte.filter((q) => q.klasse !== "startwert").slice(0, 3))
            console.log(`      ${p.klasse}: ${p.art} ${p.x.toFixed(3)} | ${p.y.toFixed(3)} h ${String(p.h)}`);
    }
    if (values.bericht) {
        mkdirSync(dirname(values.bericht), { recursive: true });
        writeFileSync(
            values.bericht,
            JSON.stringify(
                befunde.map((b) => ({ flaeche: b.flaeche, kammhoehe: b.kammhoehe, punkte: b.punkte })),
                null,
                1,
            ),
        );
        console.log(`Bericht: ${values.bericht}`);
    }
}

/** Ein Netz je Gebirge schreiben, als Operation mit Fachprotokoll; `grund` steht in der Zusammenfassung. */
async function schreibeNetz(
    db: Database,
    b: Pick<Befund, "flaeche">,
    netz: GebirgsNetzStand,
    grund: string,
): Promise<void> {
    await mapOperation(
        db,
        { kind: "agent", label: "claudio", approvalRef: values.freigabe!, environment: "staging" },
        {
            operationId: randomUUID(),
            operation: "area.gebirge_startwerte",
            mapDomainId: values.domain!,
            body: { area: b.flaeche.public_id, grund },
        },
        async (tx) => {
            const geschrieben = await gebirgSchreiben(tx, b.flaeche.public_id, {
                netz: alsAenderung(netz),
                ...(b.flaeche.revision === null ? {} : { baseRevision: Number(b.flaeche.revision) }),
            });
            const entries: MapAuditEntry[] =
                geschrieben.aenderungen.length === 0
                    ? []
                    : [
                          {
                              action: "area.gebirge",
                              regionId: b.flaeche.region_public_id,
                              areaId: b.flaeche.public_id,
                              changes: {
                                  gebirge: {
                                      before: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.alt])),
                                      after: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.neu])),
                                  },
                              },
                          },
                      ];
            return {
                receipt: { affected: geschrieben.affected, derivedWork: [], warnings: [] },
                entries,
                summary: `${b.flaeche.name}: ${grund}`,
            };
        },
    );
}

const db = createDatabase(config.databaseUrl, { max: 1 });
try {
    if (values.zurueckspielen !== undefined) {
        const sicherung = JSON.parse(readFileSync(values.zurueckspielen, "utf8")) as {
            flaeche: Flaeche;
            netz: GebirgsNetzStand;
        }[];
        // Die Revision von heute (die Bereinigung hat sie gezählt); geschrieben wird das Netz der Sicherung.
        const heute = new Map((await lies(db)).map((b) => [b.flaeche.public_id, b.flaeche]));
        for (const eintrag of sicherung) {
            const flaeche = heute.get(eintrag.flaeche.public_id) ?? eintrag.flaeche;
            await schreibeNetz(db, { flaeche }, eintrag.netz, "Startwerte aus der Sicherung zurückgespielt");
            console.log(`zurückgespielt: ${flaeche.name}`);
        }
    } else {
        const befunde = await db.begin("read only", (tx) => lies(tx));
        berichte(befunde);
        if (values.ausfuehren) {
            const n = zahl(befunde, "startwert");
            if (String(n) !== values.erwartet) {
                console.error(
                    `Der Trockenlauf zählt ${String(n)} Startwerte, erwartet ${values.erwartet ?? "(fehlt)"}: nichts geschrieben.`,
                );
                process.exitCode = 2;
            } else if (!values.sicherung) {
                console.error("Ohne --sicherung wird nichts geschrieben.");
                process.exitCode = 2;
            } else {
                const betroffen = befunde.filter((b) => b.punkte.some((p) => p.klasse === "startwert"));
                mkdirSync(dirname(values.sicherung), { recursive: true });
                writeFileSync(
                    values.sicherung,
                    JSON.stringify(
                        betroffen.map((b) => ({ flaeche: b.flaeche, kammhoehe: b.kammhoehe, netz: b.netz })),
                    ),
                );
                console.log(`Sicherung: ${values.sicherung} (${String(betroffen.length)} Gebirge)`);
                for (const b of betroffen) {
                    const weg = b.punkte.filter((p) => p.klasse === "startwert").length;
                    await schreibeNetz(db, b, ohneStartwerte(b.netz, b.punkte), `${String(weg)} Startwerte entfernt`);
                    console.log(`bereinigt: ${b.flaeche.name} (${String(weg)})`);
                }
                // Postflight: derselbe Trockenlauf danach muss null Startwerte zählen.
                const danach = await db.begin("read only", (tx) => lies(tx));
                const rest = zahl(danach, "startwert");
                console.log(
                    `Postflight: Startwerte danach ${String(rest)} (soll 0), eigen ${String(zahl(danach, "eigen"))}, unklar ${String(zahl(danach, "unklar"))}.`,
                );
                if (rest !== 0) process.exitCode = 3;
            }
        }
    }
} finally {
    await db.end();
}
