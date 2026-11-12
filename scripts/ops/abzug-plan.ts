import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ABZUG_QUELLEN, istSichererMedienPfad, type AbzugQuelle } from "@avesmaps3d/shared";
import { leseKatalog } from "../../apps/server/src/abzug/katalog.ts";
import { baueAbzugPlan, psqlSkript } from "../../apps/server/src/abzug/plan.ts";
import { ladeRegeln } from "../../apps/server/src/abzug/regeln.ts";
import { createDatabase } from "../../apps/server/src/database.ts";

/**
 * Der Exportplan des Abzugs für lokal (WI-0251): `node scripts/ops/abzug-plan.ts --quelle staging|production`.
 *
 * Er liest die Regeln (`config/abzug/regeln.json`) und das tatsächliche Schema der Datenbank (`DATABASE_URL`, nur `pg_catalog`, in einer
 * lesenden Transaktion) und gibt aus, was Claudios Export ausführt: je Tafel ein `COPY (SELECT …) TO STDOUT (FORMAT binary)` mit den Spalten
 * der Datei (Personenfelder als `NULL` oder Platzhalter), in der Reihenfolge, in der lokal geladen wird (Eltern vor Kindern), dazu die zwei
 * Abfragen für den Kopf des Manifests. 🔴 Er schreibt nichts in eine Datenbank und ruft kein Netz; weicht das Schema von den Regeln ab (eine
 * Tafel ohne Einordnung, eine Spalte, die es nicht gibt), endet er mit Status 1 und nennt die Befunde, statt etwas Halbes auszugeben.
 *
 *   --quelle staging|production   welche Umgebung (steht im Plan und im Manifest)
 *   --psql                        statt JSON ein psql-Skript: eine lesende Transaktion, je Tafel ein `\copy … TO 'tafeln/<tafel>.bin'`
 *   --ziel <datei>                in eine Datei schreiben statt auf die Standardausgabe
 *   --regeln <datei>              andere Regeln (nur Tests)
 *   --nur-regeln                  nur die Regeln gegen das Schema prüfen (Status 0 oder 1), nichts ausgeben
 *   --medien                      statt des Plans die Mediendateien: je Zeile von `media_file` `pfad<TAB>groesse<TAB>sha256` (und `FEHLT`, wenn
 *                                 `MEDIA_ROOT` gesetzt ist und die Datei dort nicht liegt), dazu auf der Fehlerausgabe die Zählung je Speicher-
 *                                 klasse mit der Gesamtgröße. So lässt sich vor dem ersten Lauf abschätzen, wie groß der Abzug wird.
 *
 * Mediendateien: Zu jeder Zeile der Medientafel (`medien` im Plan) gehört die Datei `<MEDIA_ROOT>/<pfad>` der Quelle; der Export legt sie als
 * `medien/<pfad>` ins Tar. Die Liste kommt aus derselben lesenden Transaktion wie die Tafeln (im psql-Skript als `medien-liste.csv`).
 *
 * Das Format des Abzugs steht in `packages/shared/src/system/abzug.ts`, der Vertrag mit Claudio im Handover vom 2026-10-24.
 */
const { values } = parseArgs({
    options: {
        quelle: { type: "string" },
        psql: { type: "boolean", default: false },
        ziel: { type: "string" },
        regeln: { type: "string" },
        "nur-regeln": { type: "boolean", default: false },
        medien: { type: "boolean", default: false },
    },
});

const quelle = values.quelle;
if (quelle === undefined || !(ABZUG_QUELLEN as readonly string[]).includes(quelle)) {
    console.error(`Aufruf: --quelle ${ABZUG_QUELLEN.join("|")} [--psql] [--ziel <datei>] [--nur-regeln]`);
    process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
    console.error("DATABASE_URL ist nicht gesetzt (eine lesende Rolle genügt; es wird nur das Schema gelesen)");
    process.exit(2);
}

const db = createDatabase(url, { max: 1, connectTimeoutS: 10 });
try {
    const katalog = await db.begin("read only", async (tx) => await leseKatalog(tx));
    const geladen = ladeRegeln(values.regeln);
    const plan = baueAbzugPlan(katalog, geladen, quelle as AbzugQuelle);
    if (values["nur-regeln"]) {
        console.error(`Regeln passen zum Schema: ${String(plan.tafeln.length)} Tafeln kommen mit.`);
    } else if (values.medien) {
        const zeilen = await db.begin("read only", async (tx) => {
            return await tx.unsafe<{ pfad: string; groesse: string; sha256: string }[]>(plan.medien.abfrage);
        });
        const wurzel = (process.env["MEDIA_ROOT"] ?? "").trim();
        const jeKlasse = new Map<string, { zeilen: number; bytes: number; fehlt: number }>();
        let unzulaessig = 0;
        const ausgabe: string[] = [];
        for (const zeile of zeilen) {
            const klasse =
                plan.medien.verzeichnisse.find((anfang) => zeile.pfad.startsWith(`${anfang}/`)) ?? "(andere)";
            const summe = jeKlasse.get(klasse) ?? { zeilen: 0, bytes: 0, fehlt: 0 };
            summe.zeilen += 1;
            summe.bytes += Number(zeile.groesse);
            const sicher = istSichererMedienPfad(zeile.pfad);
            if (!sicher) unzulaessig += 1;
            const ziel = wurzel !== "" && sicher ? join(wurzel, ...zeile.pfad.split("/")) : undefined;
            const fehlt = ziel !== undefined && !(existsSync(ziel) && statSync(ziel).isFile());
            if (fehlt) summe.fehlt += 1;
            jeKlasse.set(klasse, summe);
            const marken = [...(fehlt ? ["FEHLT"] : []), ...(sicher ? [] : ["UNZULAESSIG"])];
            ausgabe.push([zeile.pfad, zeile.groesse, zeile.sha256, ...marken].join("\t"));
        }
        const text = ausgabe.length === 0 ? "" : `${ausgabe.join("\n")}\n`;
        if (values.ziel !== undefined) writeFileSync(values.ziel, text, "utf8");
        else process.stdout.write(text);
        const mb = (bytes: number): string => `${(bytes / 1024 ** 2).toFixed(1)} MB`;
        for (const [klasse, summe] of [...jeKlasse].sort(([a], [b]) => a.localeCompare(b))) {
            console.error(
                `${klasse}: ${String(summe.zeilen)} Zeilen, ${mb(summe.bytes)}${wurzel === "" ? "" : `, ${String(summe.fehlt)} ohne Datei in MEDIA_ROOT`}`,
            );
        }
        const gesamt = [...jeKlasse.values()].reduce((summe, k) => summe + k.bytes, 0);
        console.error(
            `zusammen: ${String(zeilen.length)} Zeilen, ${mb(gesamt)} laut Zeilen${unzulaessig > 0 ? `, ${String(unzulaessig)} mit unzulässigem Pfad (der Export stoppt dort)` : ""}${wurzel === "" ? "; MEDIA_ROOT nicht gesetzt, Dateien nicht geprüft" : ""}`,
        );
    } else {
        const text = values.psql ? psqlSkript(plan) : `${JSON.stringify(plan, null, 2)}\n`;
        if (values.ziel !== undefined) writeFileSync(values.ziel, text, "utf8");
        else process.stdout.write(text);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
} finally {
    await db.end({ timeout: 5 });
}
