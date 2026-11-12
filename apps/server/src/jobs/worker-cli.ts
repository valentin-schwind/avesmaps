import { AVENTURIA, getJobsConfig } from "@avesmaps3d/shared";
import { abgleicheModes, pickupJobKinds, skippedJobKinds } from "../abgleiche/ausfuehrung.ts";
import { createDatabase, sessionLimits } from "../database.ts";
import { lokalerAusfuehrer, sudoAusfuehrer } from "./dirigent/ausfuehrer.ts";
import { Dirigent, type DirigentLog } from "./dirigent/dirigent.ts";
import { dirigentKonfiguration, type DirigentKonfiguration } from "./dirigent/konfiguration.ts";
import { Quelle } from "./dirigent/quelle.ts";
import { knowsKind } from "./kinds.ts";
import { jobsProfileName } from "./profile.ts";

/**
 * Der Dirigent der gemeinsamen Warteschlange als eigener Prozess (WI-0163 §5.3): lokal `npm run jobs:worker` (der Name bleibt), auf
 * der Stage die Unit, die ihn ruft, auf dem VPS später der Host-Dirigent von Claudio. Er liest die Schlangen aller Umgebungen,
 * startet den nächsten Auftrag über den Ausführer und schreibt den Stand; gerechnet wird im Ausführer, nie hier.
 *
 * Umgebung (Einzelheiten `dirigent/konfiguration.ts`): `DIRIGENT_UMGEBUNGEN` mit `DIRIGENT_DB_<UMGEBUNG>`, sonst `AVESMAPS_ENV` mit
 * `JOBS_DATABASE_URL`/`DATABASE_URL`; `DIRIGENT_AUSFUEHRER` (`lokal`, `sudo`); `QUEUE_STAND_FILE`; `JOBS_PROFILE` (das Profil des
 * HOSTS: Speicher, Threads, Parallelität); `JOBS_DOMAIN`; `JOBS_INSTANCE`; `RELEASE_ID`.
 *
 * 🔴 **`ABGLEICHE` gilt nur mit dem Ausführer `lokal`** (wie bisher beim Worker, WI-0127 SYS-14): Übersprungene Arten startet er
 * nicht, Abholarten warten sichtbar mit `waits_pickup`; dazu startet er dort nur Arten, die der eigene Katalog kennt. Das ist der Übergang auf der Stage, bis Claudio den Host-Dirigenten mit
 * `sudo` anlegt; dann entscheidet der Wrapper, wer eine Art ausführt (App oder Korridor), und `ABGLEICHE` hat hier nichts zu sagen.
 *
 * SIGTERM und SIGINT: kein neuer Start; `lokal` löst die Ausführer ab und wartet auf sie, `sudo` lässt sie laufen.
 */

function errorFields(fields: Record<string, unknown>): Record<string, unknown> {
    const { err, ...rest } = fields;
    return {
        ...rest,
        ...(err instanceof Error
            ? { error: err.name, detail: err.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "<verbindung>") }
            : {}),
    };
}

function line(level: string, fields: Record<string, unknown>, message: string): string {
    return `${JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...errorFields(fields) })}\n`;
}

const log: DirigentLog = {
    info: (fields, message) => void process.stdout.write(line("info", fields, message)),
    warn: (fields, message) => void process.stdout.write(line("warn", fields, message)),
    error: (fields, message) => void process.stderr.write(line("error", fields, message)),
};

let konfiguration: DirigentKonfiguration;
let abgleiche: { uebersprungen: ReadonlySet<string>; abholung: ReadonlySet<string> } | undefined;
try {
    konfiguration = dirigentKonfiguration(process.env);
    // `ABGLEICHE` nur lokal; ein ungültiger Wert hält den Start an wie bisher.
    const modes = konfiguration.ausfuehrer === "lokal" ? abgleicheModes(process.env) : undefined;
    abgleiche =
        modes === undefined ? undefined : { uebersprungen: skippedJobKinds(modes), abholung: pickupJobKinds(modes) };
} catch (error) {
    log.error({ err: error }, "dirigent: Konfiguration ungültig");
    process.exit(1);
}

const profile = jobsProfileName(process.env);
const config = getJobsConfig(profile);
const mapDomainId = process.env["JOBS_DOMAIN"] ?? AVENTURIA.mapDomain;

// Je Umgebung eine kleine eigene Verbindung: die Sitzung der Planersperre und eine für die Abfragen; LISTEN hält postgres.js
// auf einer dritten. Kurzer Verbindungsaufbau, damit eine nicht erreichbare Umgebung den Takt nicht lange aufhält.
const verbindungen = konfiguration.umgebungen.map((entry) => ({
    umgebung: entry.umgebung,
    database: createDatabase(entry.url, {
        max: 2,
        connectTimeoutS: 3,
        timeouts: { statementMs: 15_000, lockMs: 5_000, idleInTransactionMs: 60_000 },
    }),
}));
const quellen = verbindungen.map(
    ({ umgebung, database }) => new Quelle({ umgebung, database, eigeneVerbindung: true, mapDomainId, log }),
);

const ausfuehrerEnv = new Map(konfiguration.umgebungen.map((entry) => [entry.umgebung, entry.ausfuehrerEnv]));
const ausfuehrer =
    konfiguration.ausfuehrer === "sudo"
        ? sudoAusfuehrer()
        : lokalerAusfuehrer({ umgebungEnv: (umgebung) => ausfuehrerEnv.get(umgebung) ?? {} });

const dirigent = new Dirigent({
    quellen,
    ausfuehrer,
    config,
    standDatei: konfiguration.standDatei,
    instanz: process.env["JOBS_INSTANCE"],
    release: process.env["RELEASE_ID"] ?? "dev",
    log,
    // Nur lokal: Übersprungene und Abholarten aus `ABGLEICHE`, und nur Arten, die der eigene Katalog kennt (derselbe Stand führt aus).
    ...(abgleiche === undefined ? {} : { ...abgleiche, kenntArt: knowsKind }),
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        if (stopping) return;
        stopping = true;
        log.info({ signal, ausfuehrer: ausfuehrer.art }, "dirigent: wird beendet");
        void dirigent
            .stop()
            .catch((error: unknown) => log.error({ err: error }, "dirigent: Beenden gescheitert"))
            .finally(() => process.exit(0));
    });
}

log.info(
    {
        profile,
        instance: dirigent.id,
        domain: mapDomainId,
        umgebungen: konfiguration.umgebungen.map((entry) => entry.umgebung),
        ausfuehrer: ausfuehrer.art,
        standDatei: konfiguration.standDatei ?? null,
    },
    "dirigent: gestartet",
);
// Die Grenzen, die in den Sitzungen wirklich gelten, einmal ins Journal (wie beim Worker bis WI-0163).
await Promise.all(
    verbindungen.map(async ({ umgebung, database }) => {
        try {
            log.info({ umgebung, ...(await sessionLimits(database)) }, "dirigent: Sitzungsgrenzen");
        } catch (error) {
            log.warn({ umgebung, err: error }, "dirigent: Sitzungsgrenzen nicht lesbar");
        }
    }),
);
dirigent.start();
