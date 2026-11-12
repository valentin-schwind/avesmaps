import {
    SYSTEM_STATUS_MAX_AGE_MS,
    type AdminSystemzustand,
    type KomponentenZustand,
    type SystemKomponente,
    type SystemMigrationen,
    type SystemPlatte,
    type SystemProzess,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { migrationVersionen } from "../db/migrate.ts";
import { dirigentPlant } from "../jobs/gemeinsame-reihe.ts";
import type { WorkerBeat } from "../jobs/lebenszeichen.ts";
import type { StandLage } from "../jobs/stand-datei.ts";
import type { RouteRunnerStatus, ThreadSpeicher } from "../routing/runner.ts";
import { osMesswerte, platteVon, type OsMesswerte } from "./messwerte.ts";
import { isMissingTable } from "./state-row.ts";
import { backupZustand, type BackupStatusReader, type StatusFileRead, type SystemStatusFile } from "./status-files.ts";
import { leseVerlauf } from "./stichprobe.ts";

/**
 * Das Lesemodell des Eintrags „Systemzustand“ (WI-0127 SYS-8, SYS-0001 §3.6, §3.7, §6.3): Komponenten, Auslastung, Verlauf, Datenbank,
 * Platte, Tür und Dienste. Was diese Instanz selbst weiß, misst sie; was nur root sieht (Platten, Dienste, Tür von außen, Größen), kommt
 * aus Claudios `system.json`, und nur, solange die Datei nicht älter als 15 min ist. 🔴 Nichts davon ist je 0, wenn es unbekannt ist.
 *
 * Die Datei gilt für den ganzen Host, beschreibt auf oberster Ebene aber die Stage: Welche Tür und welche Dienste für DIESE Umgebung
 * gelten, entscheidet `fuerUmgebung` ganz am Anfang, danach rechnet alles mit einer Datei.
 */

export interface SystemzustandQuellen {
    database: Queryable;
    mapDomainId: string;
    releaseId: string;
    startedAt: string;
    routing: RouteRunnerStatus | undefined;
    /** Heap und Graph des Routing-Threads (`RouteRunner.speicher`); ohne Worker `null`. */
    routingSpeicher?: ThreadSpeicher | null;
    /** Das letzte frische Lebenszeichen des Jobs-Workers (`jobs/lebenszeichen.ts`); ohne eines bleibt sein Speicher unbekannt. */
    jobsLebenszeichen?: WorkerBeat | undefined;
    datei: StatusFileRead<SystemStatusFile>;
    sicherung: BackupStatusReader;
    tileRoot: string | undefined;
    mediaRoot: string | undefined;
    martinUrl: string | undefined;
    now: Date;
    messen?: () => Promise<OsMesswerte>;
    probeMartin?: (url: string) => Promise<boolean>;
    /**
     * Ob diese Instanz Production ist (`AVESMAPS_ENV=production`). Dann gelten Tür und Dienste `fastify`/`martin` aus dem Abschnitt
     * `production` der `system.json`, nicht die der Stage (`fuerUmgebung`). Ohne Wert: Stage, also die oberste Ebene.
     */
    production?: boolean;
    /** Für Tests: die Migrationen, die dieses Release mitbringt. Sonst das Verzeichnis neben dem Server. */
    migrationen?: () => Promise<string[]>;
    /**
     * Der Stand der gemeinsamen Warteschlange (WI-0163) und wie diese Umgebung darin heißt. Die Komponente „Warteschlange“ zeigt den
     * Dirigenten aus dem Stand; ohne Stand-Datei ist sie „unbekannt“.
     */
    warteschlange?: { lage: StandLage; umgebung: WarteschlangeUmgebung } | undefined;
}

const komponente = (
    id: SystemKomponente["id"],
    zustand: KomponentenZustand,
    hinweis: string | null,
    extra: { seit?: string | null; version?: string | null } = {},
): SystemKomponente => ({ id, zustand, seit: extra.seit ?? null, version: extra.version ?? null, hinweis });

/** Die Datei gilt nur, wenn sie gelesen und frisch ist; sonst ihr Zustand für die Anzeige. */
export function dateiZustand(
    datei: StatusFileRead<SystemStatusFile>,
    now: Date,
): { zustand: AdminSystemzustand["datei"]["zustand"]; frisch: SystemStatusFile | null } {
    if (datei.art === "fehlt") return { zustand: "nicht_eingerichtet", frisch: null };
    if (datei.art === "unlesbar") return { zustand: "unlesbar", frisch: null };
    const stand = datei.stand.stand === null ? Number.NaN : Date.parse(datei.stand.stand);
    if (!Number.isFinite(stand) || now.getTime() - stand > SYSTEM_STATUS_MAX_AGE_MS)
        return { zustand: "veraltet", frisch: null };
    return { zustand: "aktuell", frisch: datei.stand };
}

/** Der Routenrechner wie `/health/routing`: bereit gesund, lädt oder kalt (lädt mit der ersten Route) Warnung, gescheitert ausgefallen. */
export function routingKomponente(status: RouteRunnerStatus | undefined, now: Date): SystemKomponente {
    if (status === undefined) return komponente("routing", "unbekannt", "not_configured");
    const seit = new Date(now.getTime() - status.ageMs).toISOString();
    const zustand: KomponentenZustand =
        status.state === "ready" ? "gesund" : status.state === "failed" ? "ausgefallen" : "warnung";
    return komponente("routing", zustand, status.state, { seit, version: status.revision ?? null });
}

/** Ein Dienst aus `system.json`: `active` gesund, `inactive`/`failed` ausgefallen, sonst Warnung; ohne frische Datei unbekannt. */
export function dienstKomponente(
    id: SystemKomponente["id"],
    name: string,
    datei: SystemStatusFile | null,
    dateiHinweis: string,
): SystemKomponente {
    if (datei === null) return komponente(id, "unbekannt", dateiHinweis);
    const dienst = datei.dienste.find((entry) => entry.name === name);
    if (dienst === undefined) return komponente(id, "unbekannt", "not_listed");
    const zustand: KomponentenZustand =
        dienst.zustand === "active"
            ? "gesund"
            : dienst.zustand === "inactive" || dienst.zustand === "failed"
              ? "ausgefallen"
              : "warnung";
    return komponente(id, zustand, dienst.zustand, { seit: datei.stand });
}

/** Die Tür von außen: jede Probe bekam, was sie erwartete → gesund; sonst ausgefallen; ohne Proben unbekannt. */
export function tuerKomponente(datei: SystemStatusFile | null, dateiHinweis: string): SystemKomponente {
    if (datei === null) return komponente("nginx", "unbekannt", dateiHinweis);
    const proben = datei.tuer?.proben ?? [];
    if (proben.length === 0) return komponente("nginx", "unbekannt", "no_probe");
    const ok = proben.every((probe) => probe.erwartet !== null && probe.erwartet === probe.bekommen);
    return komponente("nginx", ok ? "gesund" : "ausgefallen", ok ? "door_ok" : "door_mismatch", {
        seit: datei.tuer?.at ?? null,
    });
}

/** Die Dienste, die je Umgebung einen eigenen Zustand haben; jeder andere (`nginx`, `postgresql`, `backup_timer`) gilt host-weit. */
const JE_UMGEBUNG = new Set(["fastify", "martin"]);

/**
 * Die Datei aus der Sicht DIESER Umgebung (Claudio, `handovers/2026-10-14-systemzustand-production-abschnitt-an-claudia.md`):
 * `system.json` ist EINE Datei für den ganzen Host, und ihre oberste Ebene beschreibt die Stage (`stage.avesmaps.de`, 302/200/401).
 * Für Production schreibt Claudios Zeitgeber einen eigenen Abschnitt mit eigener Tür und eigenen Diensten `fastify`/`martin`. Alles
 * dahinter (Tür, Dienste, Martin-Rückfall, Antwortfelder) liest die projizierte Datei und braucht die Umgebung selbst nicht zu kennen.
 *
 * Host-weit bleiben `nginx`, `postgresql`, `backup_timer`, Platten und Größen: Die gelten für beide Umgebungen.
 *
 * 🔴 Fehlt der Abschnitt, bleibt die Tür in Production „unbekannt“ und ist nie die der Stage; fehlt dort ein Dienst, heißt er „nicht
 * gemeldet“ und nicht, was er auf der Stage tut. Eine grüne Kachel, die die falsche Domäne beschreibt, ist schlimmer als „unbekannt“.
 */
export function fuerUmgebung(datei: SystemStatusFile | null, production: boolean): SystemStatusFile | null {
    if (datei === null || !production) return datei;
    const eigene = datei.production;
    return {
        ...datei,
        tuer: eigene?.tuer ?? null,
        dienste: [
            ...datei.dienste.filter((dienst) => !JE_UMGEBUNG.has(dienst.name)),
            ...(eigene?.dienste ?? []).filter((dienst) => JE_UMGEBUNG.has(dienst.name)),
        ],
    };
}

const SCHWERE: Record<KomponentenZustand, number> = { ausgefallen: 3, warnung: 2, unbekannt: 1, gesund: 0 };

/**
 * „Nginx und Tür“ (Blatt A7): das Schwerere aus dem Dienst und der Probe von außen; beide gesund, dann gesund. Der Dienst `nginx` gilt
 * host-weit, die Tür je Umgebung — die bringt `fuerUmgebung` schon mit.
 */
export function nginxUndTuer(datei: SystemStatusFile | null, dateiHinweis: string): SystemKomponente {
    const dienst = dienstKomponente("nginx", "nginx", datei, dateiHinweis);
    const tuer = tuerKomponente(datei, dateiHinweis);
    return SCHWERE[tuer.zustand] > SCHWERE[dienst.zustand] ? tuer : dienst.zustand === "gesund" ? tuer : dienst;
}

async function sicherungKomponente(reader: BackupStatusReader, now: Date): Promise<SystemKomponente> {
    const gelesen = await reader.read();
    if (gelesen.art === "fehlt") return komponente("sicherung", "unbekannt", "backup_not_set_up");
    if (gelesen.art === "unlesbar") return komponente("sicherung", "unbekannt", "unreadable");
    const zustand = backupZustand(gelesen.stand, now);
    const map: Record<typeof zustand, KomponentenZustand> = {
        aktuell: "gesund",
        laeuft: "gesund",
        ueberfaellig: "warnung",
        fehlgeschlagen: "ausgefallen",
        unbekannt: "unbekannt",
    };
    return komponente("sicherung", map[zustand], zustand, { seit: gelesen.stand.letzteErfolgreiche });
}

async function postgresKomponente(database: Queryable): Promise<SystemKomponente> {
    try {
        const [row] = await database<{ version: string; postgis: string | null; seit: Date | null }[]>`
            SELECT current_setting('server_version') AS version,
                   (SELECT extversion FROM pg_extension WHERE extname = 'postgis') AS postgis,
                   pg_postmaster_start_time() AS seit
        `;
        const version =
            row === undefined ? null : row.postgis === null ? row.version : `${row.version} · PostGIS ${row.postgis}`;
        return komponente("postgresql", "gesund", null, { version, seit: row?.seit?.toISOString() ?? null });
    } catch {
        return komponente("postgresql", "ausgefallen", "unreachable");
    }
}

/**
 * Der Dirigent aus seinem Stand (WI-0163): frisch und plant diese Umgebung gesund; frisch, aber nicht für diese Umgebung eine Warnung;
 * zu alt oder nie geschrieben ausgefallen; unlesbar unbekannt. Seit wann: der Zeitpunkt des Stands.
 */
export function dirigentKomponente(
    lage: Exclude<StandLage, { zustand: "nicht_eingerichtet" }>,
    umgebung: WarteschlangeUmgebung,
): SystemKomponente {
    const seit = { seit: lage.stand?.at ?? null };
    if (lage.zustand === "fehlt") return komponente("jobs", "ausgefallen", "dirigent_missing");
    if (lage.zustand === "unlesbar") return komponente("jobs", "unbekannt", "dirigent_unreadable");
    if (lage.zustand !== "ok") return komponente("jobs", "ausgefallen", "dirigent_stale", seit);
    return dirigentPlant(lage, umgebung) === true
        ? komponente("jobs", "gesund", "dirigent_active", { ...seit, version: lage.stand.dirigent.release })
        : komponente("jobs", "warnung", "dirigent_not_here", seit);
}

/**
 * Die Komponente „Warteschlange“ (WI-0163). 🔴 Sie kommt allein aus dem Stand des Dirigenten: Seit es ihn gibt, sendet kein Worker
 * mehr ein Lebenszeichen, und die Planersperre in `pg_locks` sagt nichts über DIESE Datenbank (die Abfrage filtert nicht nach ihr).
 * Ohne Stand-Datei (`QUEUE_STAND_FILE`) ist sie darum „unbekannt“ (nicht eingerichtet), nie „gesund“ aus einer Vermutung.
 */
function jobsKomponente(warteschlange: SystemzustandQuellen["warteschlange"]): SystemKomponente {
    if (warteschlange === undefined || warteschlange.lage.zustand === "nicht_eingerichtet") {
        return komponente("jobs", "unbekannt", "not_configured");
    }
    return dirigentKomponente(warteschlange.lage, warteschlange.umgebung);
}

/** Martin über Loopback (`MARTIN_URL`, `/health`); ohne Adresse aus `system.json`, sonst unbekannt. */
async function martinKomponente(
    url: string | undefined,
    datei: SystemStatusFile | null,
    dateiHinweis: string,
    probe: (url: string) => Promise<boolean>,
): Promise<SystemKomponente> {
    if (url === undefined || url === "") {
        const ausDatei = dienstKomponente("martin", "martin", datei, dateiHinweis);
        return ausDatei.zustand === "unbekannt" && datei === null
            ? komponente("martin", "unbekannt", "not_configured")
            : ausDatei;
    }
    return (await probe(url))
        ? komponente("martin", "gesund", "probe_ok")
        : komponente("martin", "ausgefallen", "probe_failed");
}

export async function probeMartin(url: string): Promise<boolean> {
    try {
        const response = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(2_000) });
        return response.ok;
    } catch {
        return false;
    }
}

/** Je `state` die eigenen Verbindungen, dazu alle und die Grenzen; `null` ohne Funktion, ohne Recht oder ohne die Rolle `avesmaps3d_stats`. */
export async function verbindungen(database: Queryable): Promise<AdminSystemzustand["datenbank"]["verbindungen"]> {
    try {
        const [row] = await database<
            { c: { own?: Record<string, number>; total?: number; max?: number; reserved?: number } | null }[]
        >`
            SELECT connection_counts() AS c
        `;
        const c = row?.c;
        if (c === null || c === undefined || typeof c.total !== "number" || typeof c.max !== "number") return null;
        return { belegt: c.total, erlaubt: c.max, reserviert: c.reserved ?? 0, eigene: c.own ?? {} };
    } catch {
        return null;
    }
}

async function datenbank(database: Queryable): Promise<AdminSystemzustand["datenbank"]> {
    let groesse: number | null = null;
    let tabellen: { name: string; bytes: number }[] = [];
    try {
        const [row] = await database<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
        groesse = row === undefined ? null : Number(row.bytes);
        const rows = await database<{ name: string; bytes: string }[]>`
            SELECT c.relname AS name, pg_total_relation_size(c.oid)::text AS bytes
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm', 'p')
             ORDER BY pg_total_relation_size(c.oid) DESC
             LIMIT 5
        `;
        tabellen = rows.map((entry) => ({ name: entry.name, bytes: Number(entry.bytes) }));
    } catch {
        // Datenbank weg: Größe und Tabellen unbekannt, die Komponente sagt „ausgefallen“.
    }
    return { groesse, verbindungen: await verbindungen(database), tabellen };
}

async function verlauf(database: Queryable, now: Date): Promise<AdminSystemzustand["verlauf"]> {
    try {
        return await leseVerlauf(database, now);
    } catch (error) {
        if (isMissingTable(error)) return [];
        return [];
    }
}

/**
 * Der Speicher je Prozess (WI-0127 §22): Fastify misst sich selbst; der Routing-Worker ist ein Thread darin (Heap und Graph, kein eigenes
 * RSS); der Jobs-Worker ist ein eigener Prozess und meldet sich mit seinem Lebenszeichen, ohne eines ist er unbekannt.
 */
export function prozesse(
    rss: number,
    routing: ThreadSpeicher | null | undefined,
    jobs: WorkerBeat | undefined,
): SystemProzess[] {
    return [
        { id: "fastify", rss },
        { id: "routing", rss: null, imProzess: "fastify", heap: routing?.heap ?? null, graph: routing?.graph ?? null },
        jobs === undefined
            ? { id: "jobs", rss: null }
            : { id: "jobs", rss: jobs.rss, kinder: { ...jobs.kinder }, stand: jobs.gemessen },
    ];
}

/**
 * Der Schemastand: was die Datenbank kennt gegen das, was dieses Release mitbringt.
 *
 * 🔴 **Eine abweichende Zahl ist die häufigste Ursache für „das Feature tut nichts“.** Fehlt `migrate`, bleibt die
 * Besucherstatistik leer und der Freigabe-Knopf wirkungslos — beides ohne eine Zeile, die sagt, woran es liegt
 * (Betreiber 2026-10-14, nach einer Nacht Suche an der falschen Stelle).
 *
 * 🪤 Gezählt wird, was dem RELEASE fehlt, nicht der Unterschied in beide Richtungen: Eine Datenbank, die weiter ist
 * als der laufende Code, ist der Normalfall während eines Rückwegs und kein Fehler.
 */
export async function migrationenStand(
    database: Queryable,
    lies: () => Promise<string[]> = migrationVersionen,
): Promise<SystemMigrationen> {
    const erwartet = await lies().catch(() => [] as string[]);
    try {
        const zeilen = await database<{ version: string }[]>`SELECT version FROM schema_migration`;
        const da = new Set(zeilen.map((zeile) => zeile.version));
        const fehlend = erwartet.filter((version) => !da.has(version));
        const eingespielt = [...da].sort().at(-1) ?? null;
        return {
            zustand: fehlend.length === 0 ? "vollstaendig" : "fehlend",
            eingespielt,
            erwartet: erwartet.at(-1) ?? null,
            fehlend: fehlend.length,
        };
    } catch {
        // Fehlt die Tafel oder das Recht, sagt die Zeile „unlesbar“ — der Systemzustand bleibt im Übrigen stehen.
        return { zustand: "unlesbar", eingespielt: null, erwartet: erwartet.at(-1) ?? null, fehlend: 0 };
    }
}

export async function readSystemzustand(q: SystemzustandQuellen): Promise<AdminSystemzustand> {
    const { zustand, frisch: gelesen } = dateiZustand(q.datei, q.now);
    // 🔴 Production liest den eigenen Abschnitt der Datei; ohne ihn bleibt seine Tür unbekannt, statt die der Stage zu zeigen.
    const frisch = fuerUmgebung(gelesen, q.production === true);
    const dateiHinweis =
        zustand === "nicht_eingerichtet" ? "not_set_up" : zustand === "veraltet" ? "stale" : "unreadable";
    const messwerte = await (q.messen ?? (() => osMesswerte()))();
    const [postgres, jobs, sicherung, martin, db, punkte, tiles, media, migrationen] = await Promise.all([
        postgresKomponente(q.database),
        jobsKomponente(q.warteschlange),
        sicherungKomponente(q.sicherung, q.now),
        martinKomponente(q.martinUrl, frisch, dateiHinweis, q.probeMartin ?? probeMartin),
        datenbank(q.database),
        verlauf(q.database, q.now),
        platteVon(q.tileRoot),
        platteVon(q.mediaRoot),
        migrationenStand(q.database, q.migrationen),
    ]);
    const platten: SystemPlatte[] = [
        ...(tiles === null ? [] : [{ id: "kacheln", quelle: "anwendung" as const, ...tiles }]),
        ...(media === null ? [] : [{ id: "medien", quelle: "anwendung" as const, ...media }]),
        ...(frisch?.disks ?? []).map((disk) => ({
            id: disk.mount,
            quelle: "datei" as const,
            gesamt: disk.gesamt,
            frei: disk.frei,
        })),
    ];
    return {
        now: q.now.toISOString(),
        migrationen,
        datei: {
            zustand,
            stand: q.datei.art === "gelesen" ? q.datei.stand.stand : null,
            host: q.datei.art === "gelesen" ? q.datei.stand.host : null,
            neueresFormat: q.datei.art === "gelesen" && q.datei.stand.neueresFormat,
        },
        komponenten: [
            komponente("fastify", "gesund", null, {
                seit: q.startedAt,
                version: `Release ${q.releaseId} · Node ${process.versions.node}`,
            }),
            routingKomponente(q.routing, q.now),
            jobs,
            postgres,
            martin,
            nginxUndTuer(frisch, dateiHinweis),
            sicherung,
        ],
        auslastung: {
            last: messwerte.last,
            kerne: messwerte.kerne,
            speicher: messwerte.speicher,
            prozesse: prozesse(messwerte.rss, q.routingSpeicher, q.jobsLebenszeichen),
            laufzeit: messwerte.laufzeit,
            platten,
        },
        verlauf: punkte,
        datenbank: db,
        groessen: frisch?.groessen ?? null,
        tuer: frisch?.tuer ?? null,
        dienste: frisch?.dienste ?? [],
    };
}
