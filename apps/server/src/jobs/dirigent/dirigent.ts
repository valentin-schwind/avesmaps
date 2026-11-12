import { hostname } from "node:os";
import type { JobsConfig, WaitReason, WarteschlangePause, WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { readSystemMemory, type MemoryProbe } from "../memory.ts";
import { AUFTRAG_EXIT } from "../ausfuehrer.ts";
import type { Ausfuehrer } from "./ausfuehrer.ts";
import {
    plane,
    type Gestartet,
    type QuelleLage,
    type ReiheEintrag,
    type RueckstellGrund,
    type Rueckstellung,
} from "./plan.ts";
import type { QuelleLeser } from "./quelle.ts";
import { HaengtZaehler, type HaengtGrund } from "./haengt.ts";
import { baueStand, schreibeStand } from "./stand.ts";

/**
 * Der Dirigent (WI-0163 §1.2, §5.3; Betreiber 2026-10-15: „eine gemeinsame queue … und du musst nur einen worker betreiben,
 * richtig?“): EIN Prozess je Host. Je Takt liest er die Schlangen aller Umgebungen (`quelle.ts`, nur lesend), ordnet sie zu einer
 * Reihe und entscheidet (`plan.ts`), startet den nächsten Auftrag über den Ausführer (`ausfuehrer.ts`) und schreibt den Stand
 * (`stand.ts`). 🔴 Er schreibt in KEINE Datenbank: kein Wartegrund, kein Claim, keine Lease. Was ein Auftrag tut, tut der
 * Ausführer mit den Rechten seiner Umgebung.
 *
 * - **Takt** nach `config.tickS`, sofort bei NOTIFY und wenn ein Ausführer endet; nie zwei Takte zugleich (ein Wecken während
 *   eines Takts holt einen weiteren danach nach).
 * - **Zustandslos** bis auf das, was nur er wissen kann: welche Ausführer er gestartet hat und welche zuletzt abgelehnt haben.
 *   Ein Neustart verliert das, und das ist harmlos: Was läuft, steht als `RUNNING` in den Tafeln; ein doppelter Start endet beim
 *   Claim mit Exit 0.
 * - **Antwort des Ausführers**: Exit 3 (die Umgebung kann den Auftrag noch nicht ausführen) und 2 (Aufruffehler) stellen ihn
 *   fünf Minuten zurück (`waits_executor`), Exit 75 eine Minute (`waits_domain_lock`: der Ausführer meldet damit, dass ein Zug
 *   die Sperre der Domäne exklusiv hält, `jobs/ausfuehrer.ts`), Exit 76 eine Minute (`waits_memory`: das Speichertor des Wrappers
 *   auf dem VPS hat vor dem Übernehmen abgelehnt). Endet ein Ausführer anders und steht die Zeile danach
 *   unverändert wartend da (gleicher Versuch), hat er sie nicht übernommen: eine Minute `waits_executor`, statt ihn in jedem
 *   Takt neu zu starten.
 * - 🔴 **Hängt** ein Auftrag (WI-0179, `haengt.ts`): Weist der Ausführer denselben Versuch `HAENGT_AB_ABLEHNUNGEN`-mal hintereinander
 *   mit demselben Grund ab (Exit 3, Exit 2, „unverändert“), steht er mit `haengt` im Stand und im Log als Fehler. Die App seiner
 *   Umgebung meldet ihn den Betreibern einmal; hier ändert sich am Zurückstellen nichts, und geschrieben wird weiter nur die Datei.
 * - 🔴 **Speicher und Kartensperre hält allein die Zulassung hier** (`plan.ts`): Der Ausführer (`runOne`) prüft keins von beiden.
 * - **Pflege** je Umgebung, in der er plant, alle zehn Minuten (`--pflege`: abgelaufene Leases einsammeln, Aufbewahrung); sieht
 *   ein Takt eine `RUNNING`-Zeile mit abgelaufener Lease, sofort, höchstens aber alle 30 Sekunden (ein Ausführer, der die Pflege
 *   nicht kann, würde sonst in jedem Takt neu gestartet). Ein hängender Lauf hielte sonst den Platz der Schweren bis zu zehn
 *   Minuten.
 * - **Log** je Wechsel (Erreichbarkeit, Planer, Pause, Wartegrund eines Auftrags), nie je Takt.
 */

export interface DirigentLog {
    info(fields: Record<string, unknown>, message: string): void;
    warn(fields: Record<string, unknown>, message: string): void;
    error(fields: Record<string, unknown>, message: string): void;
}

const stillesLog: DirigentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Exit 3 und 2: Die Umgebung kann den Auftrag (noch) nicht ausführen. Fünf Minuten, dann ein neuer Versuch. */
export const FEHLT_WARTEN_MS = 5 * 60_000;
/** Exit 75: vorübergehend nicht (die Sperre der Domäne hält ein Zug). */
export const SPAETER_WARTEN_MS = 60_000;
/** Der Ausführer endete, ohne die Zeile zu übernehmen: nicht im Takt neu starten. */
export const UNVERAENDERT_WARTEN_MS = 60_000;
export const PFLEGE_ALLE_MS = 10 * 60_000;
/** Eine abgelaufene Lease holt die Pflege sofort vor, aber nicht öfter als so. */
export const PFLEGE_FRUEHESTENS_MS = 30_000;

export interface DirigentOptionen {
    quellen: readonly QuelleLeser[];
    ausfuehrer: Ausfuehrer;
    /** Das Profil des Hosts (`JOBS_PROFILE`). */
    config: JobsConfig;
    /** `QUEUE_STAND_FILE`; ohne Wert schreibt er keinen Stand. */
    standDatei?: string | undefined;
    instanz?: string | undefined;
    release?: string | null | undefined;
    memory?: MemoryProbe;
    log?: DirigentLog;
    /** Kürzer als der Profilwert, für Tests. */
    taktMs?: number;
    pflegeAlleMs?: number;
    pflegeFruehestensMs?: number;
    /** Nur mit dem Ausführer `lokal` (`ABGLEICHE`): Arten, die er nicht startet, und davon die, die Claudios Abholer holt. */
    uebersprungen?: ReadonlySet<string>;
    abholung?: ReadonlySet<string>;
    /** Nur mit dem Ausführer `lokal`: startet nur Arten, die der eigene Katalog kennt (`knowsKind`, siehe `plan.ts`). */
    kenntArt?: (kind: string, version: number) => boolean;
}

export interface TaktBericht {
    starts: Gestartet[];
    pause: WarteschlangePause | null;
}

const LEERER_TAKT: TaktBericht = { starts: [], pause: null };

const schluessel = (umgebung: WarteschlangeUmgebung, id: number): string => `${umgebung}#${String(id)}`;

interface Laufend {
    eintrag: Gestartet;
    ende: Promise<void>;
}

interface Beendet {
    eintrag: Gestartet;
    code: number | null;
    atMs: number;
}

export class Dirigent {
    private readonly quellen: readonly QuelleLeser[];
    private readonly ausfuehrer: Ausfuehrer;
    private readonly config: JobsConfig;
    private readonly standDatei: string | undefined;
    private readonly instanz: string;
    private readonly release: string | null;
    private readonly memory: MemoryProbe;
    private readonly log: DirigentLog;
    private readonly taktMs: number;
    private readonly pflegeAlleMs: number;
    private readonly pflegeFruehestensMs: number;
    private readonly uebersprungen: ReadonlySet<string>;
    private readonly abholung: ReadonlySet<string>;
    private readonly kenntArt: ((kind: string, version: number) => boolean) | undefined;

    private readonly laufende = new Map<string, Laufend>();
    private beendete: Beendet[] = [];
    private readonly rueckstellungen = new Map<string, Rueckstellung>();
    private readonly haengend = new HaengtZaehler();
    private readonly pflegeZuletzt = new Map<WarteschlangeUmgebung, number>();
    private readonly pflegeLaeuft = new Set<WarteschlangeUmgebung>();
    private readonly pflegeCode = new Map<WarteschlangeUmgebung, number | null>();
    private readonly erreichbarGemeldet = new Map<WarteschlangeUmgebung, boolean>();
    private readonly planerGemeldet = new Map<WarteschlangeUmgebung, boolean>();
    private pauseGemeldet: boolean | undefined;
    private readonly wartegrundGemeldet = new Map<string, WaitReason | null>();
    private standFehler = false;
    private verworfenGemeldet = 0;

    private takt_: Promise<TaktBericht> | undefined;
    private nochmal = false;
    private weckenGeplant = false;
    private gestartet = false;
    private stoppt = false;
    private timer: ReturnType<typeof setInterval> | undefined;

    constructor(options: DirigentOptionen) {
        this.quellen = options.quellen;
        this.ausfuehrer = options.ausfuehrer;
        this.config = options.config;
        this.standDatei = options.standDatei;
        this.instanz = options.instanz ?? `${hostname()}:${String(process.pid)}`;
        this.release = options.release ?? null;
        this.memory = options.memory ?? readSystemMemory;
        this.log = options.log ?? stillesLog;
        this.taktMs = options.taktMs ?? Math.round(options.config.tickS * 1000);
        this.pflegeAlleMs = options.pflegeAlleMs ?? PFLEGE_ALLE_MS;
        this.pflegeFruehestensMs = options.pflegeFruehestensMs ?? PFLEGE_FRUEHESTENS_MS;
        this.uebersprungen = options.uebersprungen ?? new Set();
        this.abholung = options.abholung ?? new Set();
        this.kenntArt = options.kenntArt;
    }

    get id(): string {
        return this.instanz;
    }

    /** Wie viele Ausführer dieser Dirigent gerade laufen hat. */
    laufendeAnzahl(): number {
        return this.laufende.size;
    }

    start(): void {
        if (this.gestartet) return;
        this.gestartet = true;
        this.timer = setInterval(() => void this.takt(), this.taktMs);
        for (const quelle of this.quellen) quelle.hoeren(() => this.wecken());
        void this.takt();
    }

    /** Ein Takt jetzt, statt zu warten (NOTIFY, ein Ausführer ist fertig). */
    wecken(): void {
        if (!this.gestartet || this.stoppt || this.weckenGeplant) return;
        this.weckenGeplant = true;
        setTimeout(() => {
            this.weckenGeplant = false;
            void this.takt();
        }, 0);
    }

    /** Ein Takt: lesen, planen, starten, Stand schreiben, pflegen. Läuft schon einer, kommt danach ein weiterer. */
    takt(): Promise<TaktBericht> {
        if (this.takt_ !== undefined) {
            this.nochmal = true;
            return Promise.resolve(LEERER_TAKT);
        }
        const laufend = this.einTakt().finally(() => {
            this.takt_ = undefined;
            if (this.nochmal) {
                this.nochmal = false;
                this.wecken();
            }
        });
        this.takt_ = laufend;
        return laufend;
    }

    private async einTakt(): Promise<TaktBericht> {
        try {
            // Was VOR dem Lesen lief, zählt in diesem Takt als laufend, auch wenn es während des Lesens endet: Die Lesung kann
            // die Zeile noch wartend zeigen, und sonst startete dieser Takt sie ein zweites Mal.
            const lesenAbMs = Date.now();
            const gestartet = [...this.laufende.values()].map((laufend) => laufend.eintrag);
            const lagen = await Promise.all(this.quellen.map((quelle) => quelle.lies(this.config, lesenAbMs)));
            const nowMs = Date.now();
            this.meldeLagen(lagen);
            this.werteBeendeteAus(lagen, lesenAbMs, nowMs);
            for (const geloest of this.haengend.abgleichen(lagen)) {
                this.log.info(
                    geloest,
                    "dirigent: der hängende Auftrag wartet nicht mehr (übernommen, fertig oder abgebrochen)",
                );
            }
            for (const [key, rueckstellung] of this.rueckstellungen) {
                if (rueckstellung.bisMs <= nowMs) this.rueckstellungen.delete(key);
            }
            const memAvailableMb = this.memory()?.availableMb ?? null;
            const plan = plane({
                nowMs,
                config: this.config,
                memAvailableMb,
                quellen: lagen,
                gestartet,
                rueckstellungen: [...this.rueckstellungen.values()],
                uebersprungen: this.uebersprungen,
                abholung: this.abholung,
                ...(this.kenntArt === undefined ? {} : { kenntArt: this.kenntArt }),
            });
            this.meldePause(plan.pause);
            this.meldeWartegruende(plan.reihe, memAvailableMb);
            const starts = this.stoppt ? [] : plan.starts;
            for (const eintrag of starts) this.starte(eintrag);
            await this.schreibeStand(nowMs, plan.pause, plan.reihe, lagen);
            if (!this.stoppt) this.pflege(lagen, nowMs);
            return { starts, pause: plan.pause };
        } catch (error) {
            this.log.error({ err: error }, "dirigent: Takt gescheitert");
            return LEERER_TAKT;
        }
    }

    // --- Starten und Antwort des Ausführers ------------------------------------------------------------------------

    private starte(eintrag: Gestartet): void {
        const key = schluessel(eintrag.umgebung, eintrag.id);
        const ende = this.ausfuehrer.start(eintrag.umgebung, eintrag.id, eintrag.kind).then(
            (code) => this.beende(eintrag, code),
            (error: unknown) => {
                this.log.error(
                    { err: error, umgebung: eintrag.umgebung, job: eintrag.publicId },
                    "dirigent: Ausführer nicht gestartet",
                );
                this.beende(eintrag, null);
            },
        );
        this.laufende.set(key, { eintrag, ende });
        this.log.info(
            { umgebung: eintrag.umgebung, job: eintrag.publicId, kind: eintrag.kind, ausfuehrer: this.ausfuehrer.art },
            "dirigent: Auftrag gestartet",
        );
    }

    private beende(eintrag: Gestartet, code: number | null): void {
        this.laufende.delete(schluessel(eintrag.umgebung, eintrag.id));
        const nowMs = Date.now();
        const felder = { umgebung: eintrag.umgebung, job: eintrag.publicId, kind: eintrag.kind, code };
        switch (code) {
            case AUFTRAG_EXIT.ausfuehrungFehlt:
                this.rueckstelle(eintrag, "waits_executor", nowMs + FEHLT_WARTEN_MS);
                this.log.warn(
                    felder,
                    "dirigent: die Umgebung kann diesen Auftrag noch nicht ausführen, neuer Versuch in fünf Minuten",
                );
                this.zaehleAblehnung(eintrag, "exit_3", code, nowMs);
                break;
            case AUFTRAG_EXIT.aufruf:
                this.rueckstelle(eintrag, "waits_executor", nowMs + FEHLT_WARTEN_MS);
                this.log.error(felder, "dirigent: Aufruffehler des Ausführers, neuer Versuch in fünf Minuten");
                this.zaehleAblehnung(eintrag, "exit_2", code, nowMs);
                break;
            case AUFTRAG_EXIT.voruebergehend:
                this.loeseHaengend(eintrag);
                this.rueckstelle(eintrag, "waits_domain_lock", nowMs + SPAETER_WARTEN_MS);
                this.log.info(
                    felder,
                    "dirigent: vorübergehend nicht (Sperre der Domäne), neuer Versuch in einer Minute",
                );
                break;
            case AUFTRAG_EXIT.speichertor:
                this.loeseHaengend(eintrag);
                this.rueckstelle(eintrag, "waits_memory", nowMs + SPAETER_WARTEN_MS);
                this.log.info(felder, "dirigent: Speichertor des Wrappers, neuer Versuch in einer Minute");
                break;
            case AUFTRAG_EXIT.ok:
                this.log.info(felder, "dirigent: Ausführer fertig");
                this.beendete.push({ eintrag, code, atMs: nowMs });
                break;
            default:
                this.log.warn(felder, "dirigent: Ausführer endete mit Fehler");
                this.beendete.push({ eintrag, code, atMs: nowMs });
        }
        this.wecken();
    }

    /** Eine Ablehnung zählen (`haengt.ts`); erreicht die Serie die Schwelle, einmal als Fehler ins Log. */
    private zaehleAblehnung(eintrag: Gestartet, grund: HaengtGrund, code: number | null, nowMs: number): void {
        const { ablehnungen, jetztHaengend } = this.haengend.zaehle(eintrag, grund, code, nowMs);
        if (!jetztHaengend) return;
        this.log.error(
            { umgebung: eintrag.umgebung, job: eintrag.publicId, kind: eintrag.kind, code, grund, ablehnungen },
            "dirigent: Auftrag hängt, der Ausführer weist ihn immer wieder gleich ab; die App seiner Umgebung meldet ihn den Betreibern",
        );
    }

    private loeseHaengend(eintrag: Gestartet): void {
        if (this.haengend.loese(eintrag.umgebung, eintrag.id))
            this.log.info(
                { umgebung: eintrag.umgebung, job: eintrag.publicId, kind: eintrag.kind },
                "dirigent: der hängende Auftrag kommt wieder beim Ausführer an",
            );
    }

    private rueckstelle(eintrag: Gestartet, grund: RueckstellGrund, bisMs: number): void {
        this.rueckstellungen.set(schluessel(eintrag.umgebung, eintrag.id), {
            umgebung: eintrag.umgebung,
            id: eintrag.id,
            grund,
            bisMs,
        });
    }

    /**
     * Steht ein Auftrag, dessen Ausführer endete, unverändert wartend da (gleicher Versuch), hat der Ausführer ihn nicht übernommen.
     * Geprüft nur mit einer Lesung, die NACH dem Ende begann.
     */
    private werteBeendeteAus(lagen: readonly QuelleLage[], lesenAbMs: number, nowMs: number): void {
        const offen: Beendet[] = [];
        for (const beendet of this.beendete) {
            if (beendet.atMs >= lesenAbMs) {
                offen.push(beendet);
                continue;
            }
            const lage = lagen.find((entry) => entry.umgebung === beendet.eintrag.umgebung);
            if (lage === undefined || !lage.erreichbar) continue;
            const zeile = lage.queued.find((job) => job.id === beendet.eintrag.id);
            if (zeile === undefined || zeile.attempt !== beendet.eintrag.attempt) {
                this.loeseHaengend(beendet.eintrag);
                continue;
            }
            this.rueckstelle(beendet.eintrag, "waits_executor", nowMs + UNVERAENDERT_WARTEN_MS);
            this.log.warn(
                { umgebung: beendet.eintrag.umgebung, job: beendet.eintrag.publicId, code: beendet.code },
                "dirigent: der Ausführer endete, ohne den Auftrag zu übernehmen; neuer Versuch in einer Minute",
            );
            this.zaehleAblehnung(beendet.eintrag, "unveraendert", beendet.code, nowMs);
        }
        this.beendete = offen;
    }

    // --- Pflege ----------------------------------------------------------------------------------------------------

    private pflege(lagen: readonly QuelleLage[], nowMs: number): void {
        for (const lage of lagen) {
            const { umgebung } = lage;
            if (!lage.erreichbar || !lage.planer || this.pflegeLaeuft.has(umgebung)) continue;
            const zuletzt = this.pflegeZuletzt.get(umgebung);
            const abgelaufen = lage.running.some(
                (job) => job.leaseExpiresAt !== null && job.leaseExpiresAt.getTime() < nowMs,
            );
            const faellig =
                zuletzt === undefined ||
                nowMs - zuletzt >= this.pflegeAlleMs ||
                (abgelaufen && nowMs - zuletzt >= this.pflegeFruehestensMs);
            if (!faellig) continue;
            this.pflegeZuletzt.set(umgebung, nowMs);
            this.pflegeLaeuft.add(umgebung);
            this.ausfuehrer
                .pflege(umgebung)
                .then(
                    (code) => this.meldePflege(umgebung, code),
                    (error: unknown) => {
                        this.log.warn({ err: error, umgebung }, "dirigent: Pflege nicht gestartet");
                    },
                )
                .finally(() => {
                    this.pflegeLaeuft.delete(umgebung);
                    this.wecken();
                });
        }
    }

    private meldePflege(umgebung: WarteschlangeUmgebung, code: number | null): void {
        const vorher = this.pflegeCode.get(umgebung);
        this.pflegeCode.set(umgebung, code);
        if (vorher === code) return;
        if (code === AUFTRAG_EXIT.ok) {
            if (vorher !== undefined) this.log.info({ umgebung }, "dirigent: Pflege läuft wieder");
        } else {
            this.log.warn({ umgebung, code }, "dirigent: Pflege endete nicht mit Exit 0");
        }
    }

    // --- Stand und Log -----------------------------------------------------------------------------------------------

    private async schreibeStand(
        nowMs: number,
        pause: WarteschlangePause,
        reihe: readonly ReiheEintrag[],
        lagen: readonly QuelleLage[],
    ): Promise<void> {
        if (this.standDatei === undefined) return;
        try {
            const { stand, verworfen } = baueStand({
                nowMs,
                dirigent: { instanz: this.instanz, release: this.release, taktS: this.taktMs / 1000 },
                pause,
                umgebungen: lagen.map((lage) => ({
                    name: lage.umgebung,
                    erreichbar: lage.erreichbar,
                    planer: lage.planer,
                })),
                reihe,
                haengt: (umgebung, id) => this.haengend.haengt(umgebung, id),
                name: (umgebung, actorRef) =>
                    lagen.find((lage) => lage.umgebung === umgebung)?.namen?.get(actorRef.trim().toLowerCase()) ?? null,
            });
            if (verworfen !== this.verworfenGemeldet) {
                this.verworfenGemeldet = verworfen;
                if (verworfen > 0)
                    this.log.warn(
                        { verworfen },
                        "dirigent: Aufträge passen nicht in den Vertrag des Stands und fehlen darin",
                    );
            }
            await schreibeStand(this.standDatei, stand);
            if (this.standFehler) this.log.info({ datei: this.standDatei }, "dirigent: Stand wieder geschrieben");
            this.standFehler = false;
        } catch (error) {
            if (!this.standFehler)
                this.log.error({ err: error, datei: this.standDatei }, "dirigent: Stand nicht geschrieben");
            this.standFehler = true;
        }
    }

    private meldeLagen(lagen: readonly QuelleLage[]): void {
        for (const lage of lagen) {
            const { umgebung } = lage;
            if (this.erreichbarGemeldet.get(umgebung) !== lage.erreichbar) {
                this.erreichbarGemeldet.set(umgebung, lage.erreichbar);
                if (lage.erreichbar) this.log.info({ umgebung }, "dirigent: Umgebung erreichbar");
                else
                    this.log.warn(
                        { umgebung, err: lage.fehler },
                        "dirigent: Umgebung nicht erreichbar, die anderen laufen weiter",
                    );
            }
            // Ohne Verbindung sagt die Planersperre nichts: erst wieder melden, wenn die Umgebung lesbar ist.
            if (lage.erreichbar && this.planerGemeldet.get(umgebung) !== lage.planer) {
                this.planerGemeldet.set(umgebung, lage.planer);
                if (lage.planer) this.log.info({ umgebung }, "dirigent: plant diese Umgebung (Planersperre gehalten)");
                else
                    this.log.warn(
                        { umgebung },
                        "dirigent: plant diese Umgebung nicht, die Planersperre hält ein anderer",
                    );
            }
        }
    }

    /**
     * Warum ein Auftrag wartet, je Wechsel einmal im Log (WI-0283): Der Dirigent schreibt keinen Wartegrund in die Tafel, und der Stand zeigt nur
     * das Jetzt. Ohne diese Zeile stand eine Pause von 31 Minuten am 2026-11-05 in keinem Protokoll (Claudio).
     */
    private meldeWartegruende(reihe: readonly ReiheEintrag[], memAvailableMb: number | null): void {
        const noch = new Set<string>();
        for (const { umgebung, job, platz, wartegrund, schwer } of reihe) {
            if (platz === null) continue;
            const key = schluessel(umgebung, job.id);
            noch.add(key);
            if (this.wartegrundGemeldet.get(key) === wartegrund) continue;
            this.wartegrundGemeldet.set(key, wartegrund);
            if (wartegrund !== null)
                this.log.info(
                    { umgebung, job: job.publicId, kind: job.kind, wartegrund, schwer, memAvailableMb },
                    "dirigent: Auftrag wartet",
                );
        }
        for (const key of this.wartegrundGemeldet.keys()) if (!noch.has(key)) this.wartegrundGemeldet.delete(key);
    }

    private meldePause(pause: WarteschlangePause): void {
        if (pause.paused === this.pauseGemeldet) return;
        this.pauseGemeldet = pause.paused;
        if (pause.paused)
            this.log.warn(
                { umgebung: pause.umgebung, since: pause.since },
                "dirigent: Warteschlange pausiert, es startet kein neuer Auftrag; laufende laufen zu Ende",
            );
        else this.log.info({ umgebung: pause.umgebung }, "dirigent: Warteschlange läuft");
    }

    // --- Beenden -------------------------------------------------------------------------------------------------------

    /**
     * SIGTERM: kein neuer Takt, kein neuer Start. `lokal`: die Ausführer ablösen und auf sie warten (ihr Drain gibt die Aufträge
     * ohne Versuchszähler zurück), erst dann die Planersperren frei. `sudo`: nichts beenden, sofort frei; die Aufträge laufen in
     * Claudios Scope weiter, und der nächste Dirigent sieht sie als `RUNNING`.
     */
    async stop(): Promise<void> {
        this.stoppt = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
        await Promise.all(this.quellen.map((quelle) => quelle.abmelden()));
        await this.takt_;
        await this.ausfuehrer.beenden();
        if (this.ausfuehrer.art === "lokal")
            await Promise.all([...this.laufende.values()].map((laufend) => laufend.ende));
        await Promise.all(this.quellen.map((quelle) => quelle.schliessen()));
    }
}
