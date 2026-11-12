import type postgres from "postgres";
import { JOB_NOTIFY_CHANNEL, type JobsConfig, type WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { isDatabaseUnavailable, type Database, type Queryable } from "../../database.ts";
import { anzeigenamen } from "../ausloeser.ts";
import { readEditorFreeze } from "../editor-freeze.ts";
import { JOB_KIND_CATALOG } from "../kinds.ts";
import { isRolloutActive, listQueued, listRunning, loadPendingDependencies, loadRssP95History } from "../store.ts";
import type { PauseAnweisung, QuelleLage } from "./plan.ts";
import { Planersperre } from "./planersperre.ts";

/**
 * Eine Umgebung aus Sicht des Dirigenten (WI-0163 §1.2, §5.3): eigene kleine Verbindung, Planersperre, und je Takt ein Bild ihrer
 * Schlange. 🔴 **NUR LESEN.** Jede Abfrage hier ist ein `SELECT` auf `job`, `job_dependency` oder `system_state` — genau das, was
 * die Leserolle `avesmaps3d_<env>_queue_read` darf. Die Planersperre ist ein Advisory Lock und LISTEN ein Abonnement; beides
 * braucht kein Recht an einer Tafel und schreibt nichts.
 *
 * - **Planersperre** (`planersperre.ts`) mit DEMSELBEN Schlüssel wie der Worker bis WI-0163 (`avesmaps3d:job-worker`, Domäne):
 *   Während des Übergangs schließen alter Worker und Dirigent einander aus. Ohne Sperre liest er die Umgebung trotzdem (ihre
 *   Aufträge stehen in der Reihe, ihre Läufe belegen den Host), plant sie aber nicht.
 * - **Pause**: die letzte Anweisung dieser Umgebung. Der Zeitpunkt ist `queue_changed_at` (Migration 0133); 🪤 Production liegt
 *   ein Release zurück: Fehlt die Spalte, gilt `queue_paused_since` (WI-0160 setzt sie bei jedem Schalten), und ohne Zeitpunkt —
 *   nie geschaltet, oder gar keine Spalte `queue_paused` (vor 0130) — gibt es keine Anweisung. Welche Spalten es gibt, sagt der
 *   Katalog (`pg_attribute`, für jede Rolle lesbar), nicht ein Fehler im Takt: Sonst stünde im Log der Production-Datenbank alle
 *   zwei Sekunden ein `42703`. Geprüft wird beim Start und dann alle zehn Minuten (eine Migration kommt ohne Neustart).
 * - **Nicht erreichbar**: Die Lage sagt `erreichbar: false` und trägt die zuletzt gelesene Pause-Anweisung weiter (ein Ausfall
 *   der Datenbank schaltet nicht still um). Die anderen Umgebungen hält das nicht auf.
 * - **Wecken**: LISTEN auf `JOB_NOTIFY_CHANNEL` (neuer Auftrag, Ende eines Laufs) und `avesmaps_system_changed` (Pause, Sperre).
 * - **Namen** (WI-0293; Betreiber 2026-11-09: „Ja, Namen zeigen“): die Anzeigenamen der Auslöser aus `avesmaps_auth.person`, nur Kennung
 *   und Anzeigename (Spaltenrecht aus `auth-grants.psql`, das Claudio einspielt). Ob die Rolle das darf, sagt der Katalog
 *   (`has_column_privilege`), nicht ein Fehler im Takt; geprüft beim Start und dann alle zehn Minuten. Ohne Recht bleibt die Karte leer.
 */

/**
 * Der Kanal des Betriebszustands (Migration 0087; `SYSTEM_CHANNEL` in `system/state-store.ts`). 🪤 Hier abgeschrieben statt
 * importiert: `state-store.ts` zieht über die Anmeldung Fastify nach, und der Dirigent ist ein Werkzeugpfad ohne Fastify. Dass beide
 * gleich bleiben, prüft `apps/server/test/jobs-dirigent.test.ts`.
 */
export const SYSTEM_CHANGED_CHANNEL = "avesmaps_system_changed";

const SPALTEN_NEU_PRUEFEN_MS = 10 * 60_000;

export interface QuelleLog {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
}

/** Was der Dirigent von einer Umgebung braucht; `Quelle` ist die echte, Tests können eine eigene geben. */
export interface QuelleLeser {
    readonly umgebung: WarteschlangeUmgebung;
    lies(config: JobsConfig, nowMs: number): Promise<QuelleLage>;
    /** Weckt den Dirigenten bei NOTIFY. */
    hoeren(wecker: () => void): void;
    /** Hört auf zu wecken (beim Beenden zuerst). */
    abmelden(): Promise<void>;
    /** Gibt die Planersperre frei und schließt die eigene Verbindung. */
    schliessen(): Promise<void>;
}

export interface QuelleOptionen {
    umgebung: WarteschlangeUmgebung;
    database: Database;
    /** Schließt `schliessen()` die Verbindung? Ja, wenn sie eigens für diese Quelle angelegt wurde (`worker-cli.ts`). */
    eigeneVerbindung: boolean;
    mapDomainId: string;
    /** Schlüssel der Planersperre; ohne Angabe die Kartendomäne wie beim Worker. Tests nehmen einen eigenen. */
    plannerScope?: string;
    log?: QuelleLog;
}

interface PauseZeile {
    queue_paused: boolean;
    changed_at: Date | null;
    queue_paused_since: Date | null;
    queue_paused_by: string | null;
    queue_paused_by_label: string | null;
    queue_paused_reason: string | null;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

const sqlState = (error: unknown): string | undefined => {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : undefined;
};

/**
 * Darf diese Verbindung Kennung und Anzeigename der Personen lesen (WI-0293)? Aus dem Katalog, ohne Fehler: `to_regclass` auf ein Schema
 * ohne USAGE würfe selbst einen, darum über `pg_class`. Fehlt Schema oder Tafel, heißt es nein.
 */
export async function darfNamenLesen(db: Queryable): Promise<boolean> {
    const [row] = await db<{ darf: boolean }[]>`
        SELECT COALESCE((
            SELECT has_schema_privilege(n.oid, 'USAGE')
                   AND has_column_privilege(c.oid, 'id', 'SELECT')
                   AND has_column_privilege(c.oid, 'display_name', 'SELECT')
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'avesmaps_auth' AND c.relname = 'person'
        ), false) AS darf
    `;
    return row?.darf === true;
}

export class Quelle implements QuelleLeser {
    readonly umgebung: WarteschlangeUmgebung;
    private readonly database: Database;
    private readonly eigeneVerbindung: boolean;
    private readonly planersperre: Planersperre;
    private readonly log: QuelleLog | undefined;
    private wecker: (() => void) | undefined;
    private abos: postgres.ListenMeta[] = [];
    private hoert = false;
    private abonniertGerade = false;
    private letztePause: PauseAnweisung | null = null;
    private spalten: { paused: boolean; changedAt: boolean } | undefined;
    private spaltenGeprueftMs = 0;
    private pauseUnlesbar = false;
    private namenRecht: boolean | undefined;
    private namenGeprueftMs = 0;

    constructor(options: QuelleOptionen) {
        this.umgebung = options.umgebung;
        this.database = options.database;
        this.eigeneVerbindung = options.eigeneVerbindung;
        this.log = options.log;
        this.planersperre = new Planersperre(options.database, options.plannerScope ?? options.mapDomainId);
    }

    hoeren(wecker: () => void): void {
        this.wecker = wecker;
        void this.abonnieren();
    }

    /** Hört sie schon? Ein NOTIFY vor dem LISTEN geht verloren; dann findet der nächste Takt den Auftrag. */
    hoertZu(): boolean {
        return this.hoert;
    }

    private async abonnieren(): Promise<void> {
        const wecker = this.wecker;
        if (wecker === undefined || this.hoert || this.abonniertGerade) return;
        this.abonniertGerade = true;
        try {
            for (const kanal of [JOB_NOTIFY_CHANNEL, SYSTEM_CHANGED_CHANNEL]) {
                this.abos.push(await this.database.listen(kanal, () => wecker()));
            }
            this.hoert = true;
        } catch {
            // Ohne LISTEN genügt der Takt; der nächste erfolgreiche Lesevorgang versucht es neu.
            await this.abmelden();
        } finally {
            this.abonniertGerade = false;
        }
    }

    async abmelden(): Promise<void> {
        const abos = this.abos;
        this.abos = [];
        this.hoert = false;
        for (const abo of abos) {
            try {
                await abo.unlisten();
            } catch {
                // schon geschlossen
            }
        }
    }

    async lies(config: JobsConfig, nowMs: number): Promise<QuelleLage> {
        const planer = await this.planersperre.sichern();
        try {
            const db = this.database;
            const [queued, running, rolloutAktiv, halt, pause] = await Promise.all([
                listQueued(db),
                listRunning(db),
                isRolloutActive(db),
                readEditorFreeze(db),
                this.liesPause(nowMs),
            ]);
            const lernend = [...new Set(queued.map((job) => job.kind))].filter(
                (kind) => JOB_KIND_CATALOG[kind]?.learnsFromHistory,
            );
            const [offen, rssVerlauf, namen] = await Promise.all([
                loadPendingDependencies(
                    db,
                    queued.map((job) => job.id),
                ),
                loadRssP95History(db, lernend, config.historyMinRuns),
                this.liesNamen(
                    [...queued, ...running].map((job) => job.actorRef),
                    nowMs,
                ),
            ]);
            this.letztePause = pause;
            if (!this.hoert) void this.abonnieren();
            return {
                umgebung: this.umgebung,
                erreichbar: true,
                planer,
                queued,
                running,
                offeneAbhaengigkeiten: new Set(offen.keys()),
                rssVerlauf,
                rolloutAktiv,
                editorHalt: halt.held,
                pause,
                namen,
            };
        } catch (error) {
            return {
                umgebung: this.umgebung,
                erreichbar: false,
                planer,
                queued: [],
                running: [],
                offeneAbhaengigkeiten: new Set(),
                rssVerlauf: {},
                rolloutAktiv: false,
                editorHalt: false,
                pause: this.letztePause,
                fehler: error,
            };
        }
    }

    /** Die Anzeigenamen der Auslöser; ohne Recht (oder bei einem Fehler) eine leere Karte, nie ein Abbruch des Takts. */
    private async liesNamen(refs: readonly (string | null)[], nowMs: number): Promise<ReadonlyMap<string, string>> {
        try {
            if (this.namenRecht === undefined || nowMs - this.namenGeprueftMs >= SPALTEN_NEU_PRUEFEN_MS) {
                this.namenRecht = await darfNamenLesen(this.database);
                this.namenGeprueftMs = nowMs;
            }
        } catch {
            return new Map();
        }
        return this.namenRecht ? anzeigenamen(this.database, refs) : new Map();
    }

    /** Welche der Spalten der Pause gibt es in dieser Datenbank? Aus dem Katalog, ohne Fehler. */
    private async pauseSpalten(): Promise<{ paused: boolean; changedAt: boolean }> {
        const rows = await this.database<{ name: string }[]>`
            SELECT attname::text AS name
              FROM pg_attribute
             WHERE attrelid = to_regclass('system_state') AND attnum > 0 AND NOT attisdropped
               AND attname IN ('queue_paused', 'queue_changed_at')
        `;
        const namen = new Set(rows.map((row) => row.name));
        return { paused: namen.has("queue_paused"), changedAt: namen.has("queue_changed_at") };
    }

    /**
     * Die letzte Anweisung dieser Umgebung, oder `null`. Lässt sich die Zeile sonst nicht lesen (etwa ein fehlendes Recht), bleibt
     * die zuletzt gelesene Anweisung stehen: Eine Pause bremst nur, ein Lesefehler soll sie aber auch nicht still aufheben.
     */
    private async liesPause(nowMs: number): Promise<PauseAnweisung | null> {
        try {
            if (this.spalten === undefined || nowMs - this.spaltenGeprueftMs >= SPALTEN_NEU_PRUEFEN_MS) {
                this.spalten = await this.pauseSpalten();
                this.spaltenGeprueftMs = nowMs;
            }
            if (!this.spalten.paused) return null;
            const geaendert = this.spalten.changedAt
                ? this.database`queue_changed_at`
                : this.database`queue_paused_since`;
            const [row] = await this.database<PauseZeile[]>`
                SELECT queue_paused, ${geaendert} AS changed_at, queue_paused_since, queue_paused_by::text AS queue_paused_by,
                       queue_paused_by_label, queue_paused_reason
                  FROM system_state
                 WHERE id = 1
            `;
            this.meldePauseLesbar(true);
            if (row === undefined || row.changed_at === null) return null;
            return {
                paused: row.queue_paused,
                changedAt: iso(row.changed_at),
                since: iso(row.queue_paused_since),
                by: row.queue_paused_by,
                byLabel: row.queue_paused_by_label,
                reason: row.queue_paused_reason,
            };
        } catch (error) {
            const code = sqlState(error);
            // Spalte doch nicht da (zwischen zwei Prüfungen zurückgerollt): beim nächsten Takt neu nachsehen.
            if (code === "42703") {
                this.spalten = undefined;
                return null;
            }
            // Keine Tafel `system_state` (vor 0087): keine Anweisung.
            if (code === "42P01") return null;
            // Die Datenbank ist weg: Das ist keine Frage der Pause, die ganze Umgebung ist nicht erreichbar.
            if (isDatabaseUnavailable(error)) throw error;
            this.meldePauseLesbar(false, error);
            return this.letztePause;
        }
    }

    private meldePauseLesbar(lesbar: boolean, error?: unknown): void {
        if (lesbar === !this.pauseUnlesbar) return;
        this.pauseUnlesbar = !lesbar;
        if (lesbar) this.log?.info({ umgebung: this.umgebung }, "dirigent: Pause wieder lesbar");
        else
            this.log?.warn(
                { umgebung: this.umgebung, err: error },
                "dirigent: Pause nicht lesbar (Recht der Leserolle an system_state?), es gilt die zuletzt gelesene Anweisung",
            );
    }

    async schliessen(): Promise<void> {
        await this.abmelden();
        await this.planersperre.freigeben();
        if (this.eigeneVerbindung) await this.database.end({ timeout: 5 });
    }
}
