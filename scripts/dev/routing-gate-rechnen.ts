// Rechnet für den Release-Test die Fälle des Routing-Gates mit dem Code EINES Stands gegen die Datenbank aus `DATABASE_URL` (WI-0248,
// `release-routing.ts`). Nur lesend; nichts wird abgeleitet oder geändert.
//
//   node scripts/dev/routing-gate-rechnen.ts revision <Wurzel> <Ausgabe.json>
//       Routing-Revision des Korpus nach dem Code der Wurzel, ihr Kurzschlüssel und die Fälle des Gates dieses Stands.
//   node scripts/dev/routing-gate-rechnen.ts faelle <Wurzel> <Fälle.json> <Ausgabe.json>
//       Die übergebenen Fälle (die des Kandidaten) mit dem Code der Wurzel (dem Stand der Basislinie): je Fall Name und Ergebnis.
//
// 🪤 Der Stand wird über seine Wurzel geladen (dynamischer Import, wie `wegwerf-db-saat.ts`), nicht über den Ort dieses Skripts: Dieses Skript gehört
// zum Werkzeugklon des Runners, die Wurzel ist der Kandidat oder der Code der Basislinie. Die Pakete löst Node vom Stand aus auf.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Nur die Form, die dieses Skript braucht: Der Code der Basislinie ist ein älterer Stand, sein Modul muss nur dazu passen.
interface Dienst {
    readonly data: { readonly network: { readonly nodes: { readonly size: number } }; readonly revision: unknown };
}
interface GateRun {
    openGateService(datenbank: unknown): Promise<Dienst>;
    loadGateFiles(): { readonly cases: readonly unknown[] };
    runCases(
        dienst: Dienst,
        faelle: readonly unknown[],
    ): Promise<readonly { readonly case: { readonly id: string; readonly label: string }; readonly result: unknown }[]>;
}
interface Datenbank {
    createDatabase(url: string, optionen: { max: number }): { end(optionen: { timeout: number }): Promise<void> };
}
interface Revision {
    revisionKey(revision: unknown): string;
}

const [modus, wurzel, ...rest] = process.argv.slice(2);
const url = process.env["DATABASE_URL"];
if ((modus !== "revision" && modus !== "faelle") || wurzel === undefined || url === undefined || url === "") {
    process.stderr.write(
        "Aufruf: node routing-gate-rechnen.ts revision <Wurzel> <Ausgabe.json> | faelle <Wurzel> <Fälle.json> <Ausgabe.json> mit DATABASE_URL\n",
    );
    process.exit(2);
}
const ausgabe = modus === "revision" ? rest[0] : rest[1];
if (ausgabe === undefined || (modus === "faelle" && rest[0] === undefined)) {
    process.stderr.write("Ausgabedatei fehlt\n");
    process.exit(2);
}

const lade = (pfad: string): Promise<unknown> => import(pathToFileURL(join(wurzel, pfad)).href);
const gate = (await lade("apps/server/src/routing/corpus-gate-run.ts")) as GateRun;
const { createDatabase } = (await lade("apps/server/src/database.ts")) as Datenbank;
const datenbank = createDatabase(url, { max: 2 });
try {
    const dienst = await gate.openGateService(datenbank);
    const knoten = dienst.data.network.nodes.size;
    if (knoten < 100) throw new Error(`die Datenbank enthält keine Routingdaten (${String(knoten)} Knoten)`);
    if (modus === "revision") {
        const { revisionKey } = (await lade("apps/server/src/routing/revision.ts")) as Revision;
        const dateien = gate.loadGateFiles();
        writeFileSync(
            ausgabe,
            JSON.stringify({
                revision: dienst.data.revision,
                schluessel: revisionKey(dienst.data.revision),
                faelle: dateien.cases,
            }),
        );
        process.stdout.write(
            `Routing-Revision ${revisionKey(dienst.data.revision)}, ${String(dateien.cases.length)} Fälle\n`,
        );
    } else {
        const faelle = JSON.parse(readFileSync(rest[0] as string, "utf8")) as unknown[];
        const laeufe = await gate.runCases(dienst, faelle);
        writeFileSync(
            ausgabe,
            JSON.stringify({
                revision: dienst.data.revision,
                faelle: Object.fromEntries(
                    laeufe.map((lauf) => [lauf.case.id, { label: lauf.case.label, result: lauf.result }]),
                ),
            }),
        );
        process.stdout.write(`${String(laeufe.length)} Fälle mit dem Code aus ${wurzel} gerechnet\n`);
    }
} finally {
    await datenbank.end({ timeout: 5 });
}
