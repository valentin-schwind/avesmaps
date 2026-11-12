import {
    ABGLEICH_QUELLEN,
    AVENTURIA,
    abgleichNimmtAuftraege,
    type AbgleichAusfuehrung,
    type AbgleichAusfuehrungen,
    type AbgleichQuelle,
    type HoehenmodellProfil,
    type SystemLock,
    type SystemMode,
} from "@avesmaps3d/shared";
import { ausfuehrungFuer } from "../abgleiche/ausfuehrung.ts";
import { readHoehenmodell } from "../terrain/hoehenmodell-lesen.ts";
import { TERRAIN_TARGET, waehleFassung } from "../terrain/hoehenmodell.ts";
import { SYNC_EVENT, assertExecutes, enqueueAbgleich } from "../abgleiche/start.ts";
import { lockAdministration } from "../auth/admin-guard.ts";
import { recordEvent } from "../auth/audit.ts";
import type { CliIo } from "../auth/cli-commands.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseEigeneAnweisung, wirksam } from "../jobs/gemeinsame-reihe.ts";
import { leseUebernahme, uebernimm } from "../map-series/uebernahme.ts";
import { createWarteschlangeStandLeser, type StandLage } from "../jobs/stand-datei.ts";
import { SYSTEM_STATE_REF, changeLock, changeMode, changeQueuePause, isLocked } from "./state-changes.ts";
import { isMissingTable, readStateRow, stateView } from "./state-row.ts";

/**
 * Der Betriebszustand auf der Kommandozeile (WI-0127 SYS-2, SYS-0001 §4.7; E3 A: jeder Schalter auch auf dem VPS; Claudio 2026-10-09
 * Punkt 6). Läuft über `npm run auth -- <Befehl>`, auf dem VPS über Claudios Werkzeug `avesmaps3d-auth <env>` ohne Änderung daran.
 *
 * 🔴 Ohne Sitzung: root ist der Ausweis. Der Rückweg aus JEDER Selbstaussperrung ist `betrieb-normal` plus `sperre-loesen`; beide
 * wirken auf allen Instanzen binnen einer Sekunde (`NOTIFY` der Migration 0087). Jede Änderung steht genau einmal im Protokoll, als
 * `cli:<Systembenutzer>`, unter derselben Verwaltungssperre wie die Oberfläche. Steht schon alles so, ändert sich nichts, und es
 * entsteht kein Eintrag (Exit 0).
 */
export const SYSTEM_COMMANDS = [
    "betrieb-zeigen",
    "betrieb-normal",
    "betrieb-einschraenken",
    "sperre-setzen",
    "sperre-loesen",
    "warteschlange-pausieren",
    "warteschlange-fort",
    "abgleich-starten",
    "abgleich-zeigen",
    "gelaende-zeigen",
    "gelaende-waehlen",
    "kartenserie-uebernehmen",
] as const;
export type SystemCommand = (typeof SYSTEM_COMMANDS)[number];

export function isSystemCommand(command: string): command is SystemCommand {
    return (SYSTEM_COMMANDS as readonly string[]).includes(command);
}

export const SYSTEM_USAGE = `  betrieb-zeigen                                         Stellung, Sperren, Revision
  betrieb-normal                                         zurück auf Normal (Rückweg aus jeder Selbstaussperrung)
  betrieb-einschraenken --grund <Text>                   eingeschränkter Betrieb
  sperre-setzen --art karte|system --grund <Text>        eine Sperre setzen
  sperre-loesen [--art karte|system]                     eine Sperre lösen, ohne --art beide
  warteschlange-pausieren --grund <Text>                 die Warteschlange pausieren; laufende Jobs laufen zu Ende (WI-0160)
  warteschlange-fort                                     die Warteschlange fortsetzen (Rückweg ohne Verwaltung)
  abgleich-starten --quelle legacy|medien                einen Abgleich einreihen (Legacy-Zug, Medien aus Legacy; SYS-14)
  abgleich-zeigen --quelle <quelle>                      Exit 0, wenn diese Umgebung die Quelle ausführt, sonst 3 (Cutoff)
  gelaende-zeigen                                        Höhenmodell: gewählte und wirksame Fassung, Fassungen, Abnahmen (SYS-13)
  gelaende-waehlen --fassung <n> --grund <Text>          eine Fassung wählen; rechnet die ganze Karte neu (SYS-13)
  kartenserie-uebernehmen --eingabe <datei>              eine von der Stage kopierte Kartenserie übernehmen (WI-0220, Korridor)`;

export interface SystemCliContext {
    database: Database;
    environment: AuthEnvironment;
    actorLabel: string;
    io: CliIo;
    art?: string | undefined;
    grund?: string | undefined;
    quelle?: string | undefined;
    /** Wie diese Instanz Abgleiche ausführt (`ABGLEICHE`); ohne Wert `aus`. */
    abgleiche?: AbgleichAusfuehrung | AbgleichAusfuehrungen | undefined;
    /** Die Fassung für `gelaende-waehlen`. */
    fassung?: string | undefined;
    /** Die Eingabe für `kartenserie-uebernehmen` (JSON der Übernahme, vom Korridor geschrieben). */
    eingabe?: string | undefined;
    /** Wo die Kacheln liegen (`TILE_ROOT`); nur `kartenserie-uebernehmen` braucht es. */
    tileRoot?: string | undefined;
    /** Das Profil des Höhenmodells (`HOEHENMODELL`); ohne Wert `voll`. */
    hoehenmodell?: HoehenmodellProfil | undefined;
    /**
     * Der Stand der gemeinsamen Warteschlange (`QUEUE_STAND_FILE`, WI-0163). Mit frischem Stand vergleichen `warteschlange-pausieren`
     * und `-fort` mit der WIRKSAMEN Pause über alle Umgebungen, wie die Route; ohne ihn mit der eigenen Zeile.
     */
    queueStandFile?: string | undefined;
}

const LOCK_BY_NAME: Record<string, SystemLock> = { karte: "map", system: "system" };
const LOCK_NAME: Record<SystemLock, string> = { map: "Kartensperre", system: "Systemsperre" };
const MODE_NAME: Record<SystemMode, string> = { normal: "Normal", restricted: "Eingeschränkt" };
const SPREAD = "Jede Instanz übernimmt es binnen einer Sekunde.";

function setterLine(setter: {
    since: string | null;
    by: { displayName: string } | null;
    byLabel: string | null;
    reason: string | null;
}): string {
    const parts = [
        setter.since === null ? undefined : `seit ${setter.since}`,
        setter.by?.displayName ?? setter.byLabel ?? undefined,
        setter.reason === null ? undefined : `Grund: ${setter.reason}`,
    ].filter((part): part is string => part !== undefined);
    return parts.length === 0 ? "" : ` · ${parts.join(" · ")}`;
}

async function show(context: SystemCliContext): Promise<number> {
    const row = await readStateRow(context.database);
    if (row === undefined) {
        context.io.err("Die Zeile system_state fehlt: Der Betriebszustand ist unbekannt.");
        return 1;
    }
    const view = await stateView(context.database, row);
    context.io.out(`Betrieb: ${MODE_NAME[view.mode.mode]}${setterLine(view.mode)}`);
    for (const lock of ["map", "system"] as const) {
        const setting = lock === "map" ? view.mapLock : view.systemLock;
        context.io.out(`${LOCK_NAME[lock]}: ${setting.locked ? "gesetzt" : "offen"}${setterLine(setting)}`);
    }
    context.io.out(`Warteschlange: ${view.queuePause.paused ? "pausiert" : "läuft"}${setterLine(view.queuePause)}`);
    const gemeinsam = await gemeinsamerStand(context);
    if (gemeinsam !== undefined) context.io.out(gemeinsam.zeile);
    context.io.out(`Revision ${String(view.revision)} · Inhaltsrevision ${String(view.contentRevision)}`);
    return 0;
}

/**
 * Die gemeinsame Warteschlange an der Kommandozeile (WI-0163): die wirksame Pause über alle Umgebungen aus dem frischen Stand des
 * Dirigenten, als Zeile für `betrieb-zeigen` und als Vergleichswert für Pausieren und Fortsetzen. `undefined` ohne Stand-Datei.
 */
async function gemeinsamerStand(
    context: SystemCliContext,
): Promise<{ lage: StandLage; wirksam: { paused: boolean } | undefined; zeile: string } | undefined> {
    const leser = createWarteschlangeStandLeser(context.queueStandFile, context.environment, { ttlMs: 0 });
    if (!leser.eingerichtet) return undefined;
    const lage = await leser.lage();
    const pause = wirksam(lage, context.environment, await leseEigeneAnweisung(context.database));
    if (pause === undefined) {
        return {
            lage,
            wirksam: undefined,
            zeile: `Warteschlange wirksam: unbekannt (Stand des Dirigenten: ${lage.zustand})`,
        };
    }
    const teile = [
        pause.since === null ? undefined : `seit ${pause.since}`,
        pause.umgebung === null ? undefined : `auf ${pause.umgebung}`,
        pause.reason === null ? undefined : `Grund: ${pause.reason}`,
    ].filter((teil): teil is string => teil !== undefined);
    const zustand = pause.paused ? "pausiert" : "läuft";
    return {
        lage,
        wirksam: { paused: pause.paused },
        zeile: `Warteschlange wirksam: ${zustand}${pause.paused && teile.length > 0 ? ` · ${teile.join(" · ")}` : ""}`,
    };
}

async function setMode(context: SystemCliContext, mode: SystemMode, reason?: string): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    try {
        const change = await database.begin(async (tx) => {
            await lockAdministration(tx, environment);
            const outcome = await changeMode(tx, {
                environment,
                mode,
                reason,
                actor: { kind: "cli", label: actorLabel },
            });
            await recordEvent(tx, {
                environment,
                action: "system.mode_changed",
                actorKind: "cli",
                actorLabel,
                targetRef: SYSTEM_STATE_REF,
                details: { from: outcome.from, to: outcome.to, reason: outcome.reason },
            });
            return outcome;
        });
        for (const warning of change.warnings) io.err(`Warnung: ${warning.message}`);
        io.out(
            `Betrieb: ${MODE_NAME[change.to]} (vorher ${MODE_NAME[change.from]}), Revision ${String(change.revision)}. ${SPREAD}`,
        );
        return 0;
    } catch (error) {
        if (error instanceof ApiError && error.code === "no_change") {
            io.out(`Der Betrieb steht schon auf ${MODE_NAME[mode]}. Nichts geändert.`);
            return 0;
        }
        throw error;
    }
}

async function setLocks(
    context: SystemCliContext,
    locks: readonly SystemLock[],
    locked: boolean,
    reason?: string,
): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    const changed = await database.begin(async (tx) => {
        await lockAdministration(tx, environment);
        const row = await readStateRow(tx, { forUpdate: true });
        if (row === undefined) throw new ApiError(503, "system_state_unknown", "Die Zeile system_state fehlt.");
        const done: { lock: SystemLock; revision: number }[] = [];
        for (const lock of locks) {
            if (isLocked(row, lock) === locked) continue;
            const outcome = await changeLock(tx, {
                environment,
                lock,
                locked,
                reason,
                actor: { kind: "cli", label: actorLabel },
            });
            await recordEvent(tx, {
                environment,
                action: "system.lock_changed",
                actorKind: "cli",
                actorLabel,
                targetRef: SYSTEM_STATE_REF,
                details: { lock, from: outcome.from, to: outcome.to, reason: outcome.reason },
            });
            done.push({ lock, revision: outcome.revision });
        }
        return done;
    });
    if (changed.length === 0) {
        const names = locks.map((lock) => LOCK_NAME[lock]).join(" und ");
        io.out(`${names}: ${locked ? "schon gesetzt" : "schon offen"}. Nichts geändert.`);
        return 0;
    }
    for (const { lock, revision } of changed) {
        io.out(`${LOCK_NAME[lock]}: ${locked ? "gesetzt" : "gelöst"}, Revision ${String(revision)}.`);
    }
    io.out(SPREAD);
    return 0;
}

/**
 * Die Warteschlange pausieren oder fortsetzen (WI-0160), ohne Sitzung: dieselbe Stelle wie die Route (`changeQueuePause`), unter
 * derselben Verwaltungssperre, mit genau einem Protokollereignis `system.queue_changed` als `cli:<Systembenutzer>`.
 *
 * 🔴 `warteschlange-fort` ist der Rückweg ohne Verwaltung. Pausiert jemand und die Oberfläche ist nicht erreichbar, wirft root die
 * Warteschlange hier wieder an — dasselbe Argument wie bei `betrieb-normal` und `sperre-loesen` (E3 A).
 */
async function setQueuePause(context: SystemCliContext, paused: boolean, reason?: string): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    // Wie die Route (WI-0163): Mit frischem Stand zählt die WIRKSAME Pause über alle Umgebungen.
    const gemeinsam = await gemeinsamerStand(context);
    try {
        const change = await database.begin(async (tx) => {
            await lockAdministration(tx, environment);
            const outcome = await changeQueuePause(tx, {
                paused,
                reason,
                actor: { kind: "cli", label: actorLabel },
                wirksam: gemeinsam?.wirksam,
            });
            await recordEvent(tx, {
                environment,
                action: "system.queue_changed",
                actorKind: "cli",
                actorLabel,
                targetRef: SYSTEM_STATE_REF,
                details: { from: outcome.from, to: outcome.to, reason: outcome.reason },
            });
            return outcome;
        });
        io.out(
            `Warteschlange: ${paused ? "pausiert" : "läuft wieder"}, Revision ${String(change.revision)}. ${SPREAD}`,
        );
        if (paused) io.out("Laufende Jobs laufen zu Ende; es wird keiner mehr übernommen.");
        if (gemeinsam !== undefined) {
            io.out(
                "Gilt für alle Umgebungen dieses Servers: Der Dirigent nimmt die jüngste Anweisung, mit seinem nächsten Takt.",
            );
        }
        return 0;
    } catch (error) {
        if (error instanceof ApiError && error.code === "no_change") {
            io.out(`Die Warteschlange ${paused ? "ist schon pausiert" : "läuft schon"}. Nichts geändert.`);
            return 0;
        }
        throw error;
    }
}

/**
 * Einen Abgleich einreihen (WI-0127 SYS-14), ohne Sitzung: dieselbe Stelle wie die Route (`enqueueAbgleich`), unter derselben
 * Verwaltungssperre, mit genau einem Protokollereignis `system.sync_requested` als `cli:<Systembenutzer>` (SYS-0001 §9d.2,
 * Protokollpflicht). Läuft schon einer oder führt diese Umgebung keine aus: Exit 1, nichts eingereiht, kein Eintrag.
 */
/**
 * Die zweite Sperre nach dem Cutoff (CUTOFF-2026-11-02, Claudio): Der Dirigent führt einen eingereihten Auftrag aus, ohne `ABGLEICHE`
 * zu lesen. Darum fragt der Abholer vor dem Übernehmen hier nach, ob diese Umgebung die Quelle noch ausführt; nur Exit 0 darf
 * übernehmen. Liest nur `ABGLEICHE`, schreibt nichts und steht darum nicht im Protokoll.
 */
function pruefeAbgleich(context: SystemCliContext, quelle: AbgleichQuelle): number {
    const modus = ausfuehrungFuer(context.abgleiche, quelle);
    if (abgleichNimmtAuftraege(modus)) {
        context.io.out(`${quelle}: ${modus}, Aufträge werden ausgeführt.`);
        return 0;
    }
    context.io.err(`${quelle}: ${modus}, auf dieser Umgebung wird kein Auftrag ausgeführt. Nichts übernommen.`);
    return 3;
}

async function startSync(context: SystemCliContext, quelle: AbgleichQuelle): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    assertExecutes(ausfuehrungFuer(context.abgleiche, quelle));
    const { jobId } = await database.begin(async (tx) => {
        await lockAdministration(tx, environment);
        const queued = await enqueueAbgleich(tx, { quelle, actorRef: actorLabel });
        await recordEvent(tx, {
            environment,
            action: SYNC_EVENT,
            actorKind: "cli",
            actorLabel,
            targetRef: `job:${queued.jobId}`,
            details: { source: quelle, job: queued.jobId },
        });
        return queued;
    });
    io.out(`Abgleich ${quelle} eingereiht als Auftrag ${jobId}. Den Fortschritt zeigt die Statusseite.`);
    return 0;
}

/** Das Höhenmodell (SYS-13): gewählte und wirksame Fassung, Fassungen mit Abnahme, das Ziel des Rückwegs. */
async function showTerrain(context: SystemCliContext): Promise<number> {
    const view = await readHoehenmodell(context.database, AVENTURIA.mapDomain, context.hoehenmodell ?? "voll");
    const { io } = context;
    const quelle = view.eingestellt.quelle === "auswahl" ? "Auswahl dieser Umgebung" : "Vorgabe der Datei";
    io.out(
        `Gewählt: Fassung ${String(view.eingestellt.version)} (${quelle})${view.eingestellt.wer ? `, ${view.eingestellt.wer}` : ""}`,
    );
    io.out(`Wirksam: ${view.wirksam.version === null ? "unbekannt" : `Fassung ${String(view.wirksam.version)}`}`);
    for (const fassung of view.fassungen) {
        const stand = fassung.abnahme
            ? `abgenommen ${fassung.abnahme.am}`
            : fassung.inDatei
              ? "abgenommen (Datei)"
              : "nicht abgenommen";
        io.out(
            `  Fassung ${String(fassung.version)}${fassung.gilt ? " (gilt)" : ""}: ${fassung.regional ? "regional" : "domainweit"}, ${stand}`,
        );
    }
    io.out(`Rückweg: ${view.rueckweg === null ? "keiner" : `Fassung ${String(view.rueckweg)}`}`);
    if (view.kette)
        io.out(`Kette: ${view.kette.art} ${view.kette.state}${view.kette.phase ? ` (${view.kette.phase})` : ""}`);
    return 0;
}

/** Eine Fassung wählen, ohne Sitzung: dieselbe Stelle wie die Route (`waehleFassung`), genau ein Ereignis als `cli:<Systembenutzer>`. */
async function chooseTerrain(context: SystemCliContext, version: number, reason: string): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    const chosen = await database.begin(async (tx) => {
        await lockAdministration(tx, environment);
        const result = await waehleFassung(tx, {
            domain: AVENTURIA.mapDomain,
            version,
            reason,
            actor: { personId: null, label: actorLabel, actorRef: actorLabel },
            profil: context.hoehenmodell ?? "voll",
        });
        await recordEvent(tx, {
            environment,
            action: "system.terrain_activated",
            actorKind: "cli",
            actorLabel,
            targetRef: TERRAIN_TARGET(AVENTURIA.mapDomain),
            details: { from: result.from, to: result.to, reason, rueckweg: false, job: result.job },
        });
        return result;
    });
    io.out(
        `Fassung ${String(chosen.to)} gewählt (vorher ${String(chosen.from)}); die ganze Karte wird neu gerechnet (Job ${chosen.job}).`,
    );
    return 0;
}

/**
 * Eine Kartenserie übernehmen (WI-0220 Schnitt 4, Weg „von Stage übernehmen“): Claudios Korridor hat Fassung und Quelle schon in
 * diese Umgebung kopiert und ruft den Befehl mit der Eingabe des Auftrags. Einstellungen, Zeiger und genau ein Ereignis als
 * `cli:<Systembenutzer>`, unter derselben Verwaltungssperre wie die Oberfläche.
 */
async function uebernimmKartenserie(context: SystemCliContext, datei: string): Promise<number> {
    const { database, environment, actorLabel, io } = context;
    const tileRoot = context.tileRoot?.trim();
    if (!tileRoot) {
        io.err("TILE_ROOT fehlt: Ohne Kachelablage gibt es nichts zu übernehmen.");
        return 2;
    }
    const eingabe = await leseUebernahme(datei);
    const ergebnis = await uebernimm(database, eingabe, {
        tileRoot,
        protokoll: async (tx, { vorher, revision }) => {
            await lockAdministration(tx, environment);
            await recordEvent(tx, {
                environment,
                action: "system.map_series_changed",
                actorKind: "cli",
                actorLabel,
                targetRef: `map:series:${eingabe.serie}`,
                details: {
                    series: eingabe.serie,
                    aktion: "uebernahme",
                    from: vorher,
                    to: revision,
                },
            });
        },
    });
    io.out(
        `KARTENSERIE ÜBERNOMMEN ${eingabe.serie} ${ergebnis.revision} (vorher ${ergebnis.vorher ?? "keine"}${ergebnis.weggeraeumt.length > 0 ? `, weggeräumt ${ergebnis.weggeraeumt.join(" ")}` : ""})`,
    );
    return 0;
}

/** Ein Fehler, der heißt „diese Instanz ist noch nicht so weit“: Migration oder Recht fehlt. Nichts ist geändert (die Transaktion rollte zurück). */
function notReady(error: unknown): string | undefined {
    if (isMissingTable(error)) return "Migration 0087 fehlt (Tabelle system_state).";
    if ((error as { code?: unknown } | null)?.code === "42501") {
        return "Der Datenbankrolle fehlt ein Recht: system-grants.psql und auth-grants.psql nach der Migration anwenden.";
    }
    return undefined;
}

export async function runSystemCommand(command: SystemCommand, context: SystemCliContext): Promise<number> {
    const { io } = context;
    const reason = context.grund?.trim() ?? "";
    const lock = context.art === undefined ? undefined : LOCK_BY_NAME[context.art];
    if (context.art !== undefined && lock === undefined) {
        io.err(`Unbekannte Sperre: ${context.art} (karte oder system).`);
        return 2;
    }
    try {
        switch (command) {
            case "betrieb-zeigen":
                return await show(context);
            case "betrieb-normal":
                return await setMode(context, "normal");
            case "betrieb-einschraenken":
                if (reason === "") {
                    io.err("betrieb-einschraenken braucht --grund.");
                    return 2;
                }
                return await setMode(context, "restricted", reason);
            case "sperre-setzen":
                if (lock === undefined || reason === "") {
                    io.err("sperre-setzen braucht --art karte|system und --grund.");
                    return 2;
                }
                return await setLocks(context, [lock], true, reason);
            case "sperre-loesen":
                return await setLocks(context, lock === undefined ? ["map", "system"] : [lock], false);
            case "warteschlange-pausieren":
                if (reason === "") {
                    io.err("warteschlange-pausieren braucht --grund.");
                    return 2;
                }
                return await setQueuePause(context, true, reason);
            case "warteschlange-fort":
                return await setQueuePause(context, false);
            case "gelaende-zeigen":
                return await showTerrain(context);
            case "gelaende-waehlen": {
                const version = Number(context.fassung);
                if (context.fassung === undefined || !Number.isInteger(version) || version < 1 || reason === "") {
                    io.err("gelaende-waehlen braucht --fassung <n> und --grund.");
                    return 2;
                }
                return await chooseTerrain(context, version, reason);
            }
            case "kartenserie-uebernehmen": {
                if (context.eingabe === undefined || context.eingabe.trim() === "") {
                    io.err("kartenserie-uebernehmen braucht --eingabe <datei>.");
                    return 2;
                }
                return await uebernimmKartenserie(context, context.eingabe);
            }
            case "abgleich-starten": {
                const quelle = context.quelle;
                if (quelle === undefined || !(ABGLEICH_QUELLEN as readonly string[]).includes(quelle)) {
                    io.err(`abgleich-starten braucht --quelle ${ABGLEICH_QUELLEN.join("|")}.`);
                    return 2;
                }
                return await startSync(context, quelle as AbgleichQuelle);
            }
            case "abgleich-zeigen": {
                const quelle = context.quelle;
                if (quelle === undefined || !(ABGLEICH_QUELLEN as readonly string[]).includes(quelle)) {
                    io.err(`abgleich-zeigen braucht --quelle ${ABGLEICH_QUELLEN.join("|")}.`);
                    return 2;
                }
                return pruefeAbgleich(context, quelle as AbgleichQuelle);
            }
        }
    } catch (error) {
        const missing = notReady(error);
        if (missing !== undefined) {
            io.err(`${missing} Nichts geändert.`);
            return 1;
        }
        if (error instanceof ApiError) {
            io.err(`${error.message} Nichts geändert.`);
            return 1;
        }
        throw error;
    }
}
