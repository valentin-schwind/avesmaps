import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Role } from "@avesmaps3d/shared";
import { loadAuthConfig } from "../../apps/server/src/auth/config.ts";
import { createSession } from "../../apps/server/src/auth/session-store.ts";
import { createDatabase } from "../../apps/server/src/database.ts";

/**
 * Die angemeldeten Personen des Release-Tors (WI-0264, Teil `kern-echt`): legt in der Datenbank des Laufs drei Personen an, gibt ihnen
 * Zugang in der lokalen Umgebung (`development`) und je eine Sitzung über das echte `createSession`, und schreibt die Token in Dateien:
 *
 * - `--token-datei` selbst: „Tor-Editor“ (`editor`), die Person der Fälle. Die Browserfälle lesen sie über `WELT_TOKEN_DATEI`
 *   (`apps/web/e2e/welt.ts`, `meldeAn`).
 * - daneben `…-editor2.txt`: „Tor-Zweiter“ (`editor`), der fremde Bearbeiter, etwa für eine Sperre, die nicht die eigene ist.
 * - daneben `…-admin.txt`: „Tor-Admin“ (`admin`), für die Systemsteuerung und für Form und Gebirge.
 *
 * - Ist `MEDIA_ROOT` gesetzt, bekommt die Welt auch die acht persistenten Beispielbilder der Reisebilder (WI-0272 S4, `photobox/beispiele.ts`): erst die Freigaberegeln der
 *   Rolle `photobox` (nur diese), dann `legeBeispieleAn` gegen den Medienordner. Scheitert das, steht eine Zeile auf stderr und der Exit bleibt 0: Der Tor-Fall der Reisebilder
 *   meldet es (ein Fehler hier darf die Welt der übrigen Fälle nicht kosten).
 *
 * 🔴 NUR für Wegwerf-Datenbanken (Korpus des Release-Laufs, eigene Welt). Das Werkzeug weigert sich, wenn die Datenbank nicht nach einer
 * Wegwerf-Datenbank aussieht (Port der Entwicklungsdatenbank aus der `.env`) — eine Person mit Sitzung in der echten Datenbank wäre ein
 * Zugang, den niemand vergeben hat.
 *
 *   node scripts/dev/tor-welt.ts --database-url <url> --token-datei <pfad>/welt-token.txt
 */
const { values } = parseArgs({
    options: {
        "database-url": { type: "string" },
        "token-datei": { type: "string" },
    },
});

const url = values["database-url"];
const datei = values["token-datei"];
if (url === undefined || datei === undefined) {
    console.error("tor-welt: --database-url und --token-datei sind Pflicht");
    process.exit(2);
}
const entwicklung = process.env["DATABASE_URL"];
if (entwicklung !== undefined && new URL(entwicklung).port === new URL(url).port) {
    console.error(
        "tor-welt: Das ist der Port der Entwicklungsdatenbank. Nur Wegwerf-Datenbanken bekommen eine Tor-Person.",
    );
    process.exit(2);
}

/** Die Datei eines weiteren Tokens neben der Hauptdatei (`welt-token.txt` → `welt-token-admin.txt`). */
function nebenDatei(haupt: string, wer: string): string {
    return haupt.replace(/(\.txt)?$/u, `-${wer}.txt`);
}

const PERSONEN: readonly { name: string; rolle: Role; datei: string }[] = [
    { name: "Tor-Editor", rolle: "editor", datei },
    { name: "Tor-Zweiter", rolle: "editor", datei: nebenDatei(datei, "editor2") },
    { name: "Tor-Admin", rolle: "admin", datei: nebenDatei(datei, "admin") },
];

const database = createDatabase(url, { max: 1 });
try {
    const config = loadAuthConfig({ ...process.env, AVESMAPS_ENV: "development", AUTH_INSECURE_COOKIE: "1" });
    for (const person of PERSONEN) {
        const token = await database.begin(async (tx) => {
            const [zeile] = await tx<{ id: string }[]>`
                INSERT INTO avesmaps_auth.person (display_name, status, created_via)
                VALUES (${person.name}, 'active', 'system') RETURNING id
            `;
            const personId = zeile!.id;
            await tx`
                INSERT INTO avesmaps_auth.person_access (person_id, environment, role)
                VALUES (${personId}, 'development', ${person.rolle})
            `;
            const sitzung = await createSession(tx, config, {
                personId,
                environment: "development",
                method: "passkey",
                assurance: "strong",
                passkeyConfirmed: true,
            });
            return sitzung.token;
        });
        writeFileSync(person.datei, `${token}\n`, { encoding: "utf8", mode: 0o600 });
        process.stdout.write(`tor-welt: ${person.name} (${person.rolle}) angemeldet, Token in ${person.datei}\n`);
    }
    await legeBeispielbilderAn(url);
} finally {
    await database.end({ timeout: 5 });
}

/**
 * Die Module der Beispielbilder, zur Laufzeit geladen und nur in dieser Gestalt bekannt. 🪤 Ein statischer Import zöge `http/api-error.ts` in die Typprüfung der Werkzeuge
 * (`tsconfig.tools.json`): Deren Erweiterung von `fastify` findet sie dort nicht (TS2664), und der Typcheck der Wurzel wäre rot. Node führt die Dateien direkt aus.
 */
interface BeispielModule {
    beispiele: {
        legeBeispieleAn(
            db: unknown,
            store: unknown,
            umgebung: "development",
        ): Promise<{ angelegt: number; vorhanden: number; ohneOrt: string[]; unveroeffentlicht: string[] }>;
    };
    speicher: { MediaStore: new (wurzel: string) => unknown };
    regeln: {
        PUBLICATION_RULE_SEEDS: readonly { role: string }[];
        seedPublicationRules(tx: unknown, seeds: readonly { role: string }[]): Promise<unknown>;
    };
}

async function ladeBeispielModule(): Promise<BeispielModule> {
    const wurzel = new URL("../../apps/server/src/", import.meta.url).href;
    const lade = (pfad: string): Promise<unknown> => import(wurzel + pfad);
    return {
        beispiele: (await lade("photobox/beispiele.ts")) as BeispielModule["beispiele"],
        speicher: (await lade("media/storage.ts")) as BeispielModule["speicher"],
        regeln: (await lade("migration/media-rules.ts")) as BeispielModule["regeln"],
    };
}

/**
 * Die Beispielbilder der Reisebilder in die Welt (siehe oben). Eigene Verbindung mit mehreren Plätzen: Die Operationen der Medien nutzen die Datenbank auch neben ihren Transaktionen.
 * Jeder Fehler wird zu einer Zeile auf stderr; der Prozess endet trotzdem mit 0.
 */
async function legeBeispielbilderAn(datenbankUrl: string): Promise<void> {
    const medienWurzel = process.env["MEDIA_ROOT"];
    if (medienWurzel === undefined || medienWurzel === "") return;
    const medien = createDatabase(datenbankUrl, { max: 3 });
    try {
        const module = await ladeBeispielModule();
        await medien.begin((tx) =>
            module.regeln.seedPublicationRules(
                tx,
                module.regeln.PUBLICATION_RULE_SEEDS.filter((regel) => regel.role === "photobox"),
            ),
        );
        const ergebnis = await module.beispiele.legeBeispieleAn(
            medien,
            new module.speicher.MediaStore(medienWurzel),
            "development",
        );
        process.stdout.write(
            `tor-welt: Beispielbilder ${String(ergebnis.angelegt)} angelegt, ${String(ergebnis.vorhanden)} vorhanden, ohne Ort: ${ergebnis.ohneOrt.join(", ") || "-"}, nicht öffentlich: ${ergebnis.unveroeffentlicht.join(", ") || "-"}\n`,
        );
    } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);
        process.stderr.write(`tor-welt: Beispielbilder nicht angelegt (${grund.split("\n")[0] ?? grund})\n`);
    } finally {
        await medien.end({ timeout: 5 });
    }
}
