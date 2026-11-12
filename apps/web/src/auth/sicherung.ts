import { ref, type Ref } from "vue";
import {
    SICHERUNG_ABHOLEN_S,
    type AdminSicherung,
    type OperationReceipt,
    type SicherungAufbewahrung,
    type SicherungWiederherstellung,
    type SicherungZustand,
    type WiederherstellungSicherung,
    type WiederherstellungUmfang,
} from "@avesmaps3d/shared";
import { isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "./api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";
import { statusName } from "./kanal";
import type { ActionResult } from "./verwaltung";

/**
 * Der Eintrag „Backups“ der Systemsteuerung (WI-0127 SYS-9, SYS-0001 §6.5, §9e). Was die Oberfläche rechnet, steht hier; wie es aussieht,
 * in `verwaltung-backup.vue`.
 *
 * - Die Karte „Sicherung“ mit dem Zustand rechts (nicht eingerichtet · läuft · aktuell · überfällig · fehlgeschlagen · unbekannt) und den
 *   Feldern aus Claudios Statusdatei, darunter die Teile als Liste mit Kreis (● außer Haus geprüft, ◐ nur hier).
 * - „⊕ Sicherung jetzt“ nur mit `run_backup`: Der Server legt den Auftrag ab, Claudios Seite holt ihn ab und drosselt. Danach sagt die
 *   Zeile unter dem Knopf, was geschieht: angefordert, noch nicht abgeholt (nach 60 s), läuft, fertig, oder warum Claudios Seite den
 *   Auftrag verworfen hat (lief schon, zu früh).
 * - „↶ Wiederherstellung beantragen“ nur mit `request_restore` (Stufe S, WI-0124 K5): Der Antrag wird ein Vorgang für Claudio im Kanal;
 *   darunter steht der offene Antrag mit OPS-Nummer und Stand. Aus der App wird nie zurückgespielt.
 * - Kein Kanal zum Browser: Solange ein Auftrag liegt, eine Sicherung läuft oder die eigene noch keine Antwort hat, sieht der Eintrag alle
 *   paar Sekunden nach (der Server liest die Statusdatei höchstens alle 30 s neu).
 */

/** Wie oft nachgesehen wird, solange etwas geschieht. */
export const NACHSEHEN_MS = 5000;
/** So lange wartet die Anzeige nach dem eigenen Klick auf eine Antwort von Claudios Seite. */
export const EIGENE_WARTEN_MS = 10 * 60_000;

export type Ton = "erfolg" | "ruhe" | "warnung" | "gefahr";

const TON: Record<SicherungZustand, Ton> = {
    nicht_eingerichtet: "ruhe",
    laeuft: "ruhe",
    aktuell: "erfolg",
    ueberfaellig: "warnung",
    fehlgeschlagen: "gefahr",
    unbekannt: "warnung",
};

export function zustandTon(zustand: SicherungZustand): Ton {
    return TON[zustand];
}

export function zustandName(zustand: SicherungZustand): string {
    return t(`admin.backup.state.${zustand}`);
}

const zeit = (iso: string, now: Date): string => relativeTime(new Date(iso), now, locale.value, "zeitpunkt");
const nachschlagen = (prefix: string, value: string): string => {
    const key = `${prefix}.${value}`;
    return isMessageKey(key) ? t(key) : value;
};

export function teilName(kind: string): string {
    return nachschlagen("admin.backup.part", kind);
}

/** Die Felder der Karte als Paare (Beschriftung, Wert); `null` und Fehlendes heißen „unbekannt“, nie 0. */
export function felder(stand: AdminSicherung, now: Date): { id: string; name: string; wert: string }[] {
    const unbekannt = t("admin.backup.unknown");
    const lauf = stand.letzterLauf;
    let letzte = stand.letzteErfolgreiche === null ? t("admin.backup.none") : zeit(stand.letzteErfolgreiche, now);
    if (stand.letzteErfolgreiche !== null && lauf?.result === "ok" && lauf.trigger !== null) {
        letzte = `${letzte} · ${t(`admin.backup.trigger.${lauf.trigger}`)}`;
    }
    const ausser = stand.ausserHaus;
    const ausserText =
        ausser.eingerichtet === null
            ? unbekannt
            : !ausser.eingerichtet
              ? t("admin.backup.offsite.off")
              : ausser.geprueftAm === null
                ? t("admin.backup.offsite.unchecked")
                : t("admin.backup.offsite.checked", { time: zeit(ausser.geprueftAm, now) });
    const probe = stand.probelauf;
    const probeText =
        probe === null
            ? t("admin.backup.drill.none")
            : probe.result === null || probe.at === null
              ? unbekannt
              : t(`admin.backup.drill.${probe.result}`, { time: zeit(probe.at, now) });
    return [
        { id: "letzte", name: t("admin.backup.field.last"), wert: letzte },
        { id: "ausser-haus", name: t("admin.backup.field.offsite"), wert: ausserText },
        { id: "probelauf", name: t("admin.backup.field.drill"), wert: probeText },
        {
            id: "naechster",
            name: t("admin.backup.field.next"),
            wert: stand.naechsterLauf === null ? unbekannt : zeit(stand.naechsterLauf, now),
        },
        { id: "aufbewahrung", name: t("admin.backup.field.retention"), wert: aufbewahrungText(stand.aufbewahrung) },
    ];
}

export function aufbewahrungText(aufbewahrung: SicherungAufbewahrung | null): string {
    if (aufbewahrung === null) return t("admin.backup.unknown");
    const zahl = (value: number | null): string => (value === null ? "?" : String(value));
    return t("admin.backup.retention", {
        local: zahl(aufbewahrung.local),
        daily: zahl(aufbewahrung.daily),
        weekly: zahl(aufbewahrung.weekly),
        monthly: zahl(aufbewahrung.monthly),
    });
}

/** Der Satz zu einem gescheiterten Lauf: der Fehlercode mit Namen, sonst so, wie Claudios Seite ihn nennt. */
export function fehlerSatz(stand: AdminSicherung, now: Date): string | null {
    const lauf = stand.letzterLauf;
    if (stand.zustand !== "fehlgeschlagen" || lauf === null) return null;
    const wann = lauf.finishedAt ?? lauf.startedAt;
    const grund = lauf.errorCode === null ? "" : nachschlagen("admin.backup.error", lauf.errorCode);
    const satz =
        wann === null ? t("admin.backup.failedUnknownTime") : t("admin.backup.failed", { time: zeit(wann, now) });
    return grund === "" ? satz : `${satz} · ${grund}`;
}

/**
 * Was unter dem Knopf steht (§9e „Anzeige“): ein liegender Auftrag (nach 60 s „noch nicht abgeholt“), eine laufende Sicherung, oder die
 * Antwort auf den eigenen Auftrag aus dieser Sitzung. `null`: nichts zu sagen.
 */
export function anstossSatz(
    stand: AdminSicherung,
    eigene: string | null,
    now: Date,
): { text: string; ton: "leise" | "gut" | "warnung" } | null {
    const wartend = stand.anstossen.wartend;
    if (wartend !== null) {
        const seit = (now.getTime() - Date.parse(wartend.requestedAt)) / 1000;
        if (Number.isFinite(seit) && seit >= SICHERUNG_ABHOLEN_S) {
            return { text: t("admin.backup.notPickedUp", { time: zeit(wartend.requestedAt, now) }), ton: "warnung" };
        }
        return { text: t("admin.backup.requested"), ton: "leise" };
    }
    const lauf = stand.letzterLauf;
    if (lauf?.result === "running") {
        const start = lauf.startedAt === null ? "" : zeit(lauf.startedAt, now);
        const eigenerLauf = eigene !== null && lauf.operationId === eigene;
        return {
            text: t(eigenerLauf ? "admin.backup.runningOwn" : "admin.backup.running", { time: start }),
            ton: "leise",
        };
    }
    if (eigene === null) return null;
    if (lauf?.operationId === eigene && lauf.result !== null && lauf.finishedAt !== null) {
        return lauf.result === "ok"
            ? { text: t("admin.backup.doneOwn", { time: zeit(lauf.finishedAt, now) }), ton: "gut" }
            : { text: t("admin.backup.failedOwn", { time: zeit(lauf.finishedAt, now) }), ton: "warnung" };
    }
    const antwort = stand.anstossen.letzteAntwort;
    if (antwort?.operationId === eigene && antwort.result !== null && antwort.result !== "angenommen") {
        return { text: t(`admin.backup.answer.${antwort.result}`), ton: "warnung" };
    }
    return { text: t("admin.backup.pickedUp"), ton: "leise" };
}

/** Warum „Sicherung jetzt“ gesperrt ist, als Satz; `undefined`, wenn er geht. */
export function sperrSatz(stand: AdminSicherung, darf: boolean): string | undefined {
    if (!darf) return t("admin.backup.readOnly", { recht: t("auth.capability.run_backup") });
    if (!stand.anstossen.moeglich) return t("admin.backup.notHere");
    if (stand.anstossen.wartend !== null) return t("admin.backup.pending");
    if (stand.zustand === "laeuft") return t("admin.backup.alreadyRunning");
    return undefined;
}

/** Welche Sicherung ein Antrag meint, als Auswahl: die letzte erfolgreiche mit ihrer Zeit, oder eine ältere (im Grund). */
export function sicherungWahl(
    stand: AdminSicherung | null,
    now: Date,
): { wert: WiederherstellungSicherung; text: string }[] {
    const letzte = stand?.letzteErfolgreiche ?? null;
    return [
        {
            wert: "letzte",
            text:
                letzte === null
                    ? t("admin.restore.latestUnknown")
                    : t("admin.restore.latest", { time: zeit(letzte, now) }),
        },
        { wert: "aelter", text: t("admin.restore.older") },
    ];
}

/** Die Zeile zum offenen Antrag: wann beantragt und wie es im Kanal steht („wartet auf Claudio“, solange er neu ist). */
export function antragSatz(antrag: SicherungWiederherstellung, now: Date): { zeile: string; stand: string } {
    return {
        zeile: t("admin.restore.line", { time: zeit(antrag.beantragtAt, now) }),
        stand:
            antrag.status === "neu"
                ? t("admin.restore.waiting")
                : t("admin.restore.status", { status: statusName(antrag.status) }),
    };
}

export interface AntragEingabe {
    sicherung: WiederherstellungSicherung;
    umfang: WiederherstellungUmfang;
    grund: string;
}

export interface SicherungDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Die Bestätigung der Lesewege, geteilt mit den übrigen Einträgen des Fensters. */
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    clock?: () => number;
}

export interface Sicherung {
    stand: Ref<AdminSicherung | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    busy: Ref<boolean>;
    /** Die `operation_id` des eigenen Auftrags aus dieser Sitzung, solange die Anzeige auf seine Antwort wartet. */
    eigene: Ref<string | null>;
    /** Das Ergebnis des letzten Klicks: ein Fehler. */
    ergebnis: Ref<ActionResult | null>;
    load(): Promise<void>;
    start(): Promise<ActionResult>;
    /** „Wiederherstellung beantragen“ läuft. */
    antragBusy: Ref<boolean>;
    /** Das Ergebnis des letzten Antrags: ein Fehler. */
    antragErgebnis: Ref<ActionResult | null>;
    beantragen(eingabe: AntragEingabe): Promise<ActionResult>;
    /** Solange der Eintrag offen ist: nachsehen, solange etwas geschieht. */
    follow(on: boolean): void;
}

export function createSicherung(deps: SicherungDeps = {}): Sicherung {
    const stand = ref<AdminSicherung | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref(false);
    const eigene = ref<string | null>(null);
    const ergebnis = ref<ActionResult | null>(null);
    const antragBusy = ref(false);
    const antragErgebnis = ref<ActionResult | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    const clock = deps.clock ?? Date.now;
    let eigeneSeit = 0;
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;

    /** Ist die eigene Sicherung noch offen (keine Antwort, kein fertiger Lauf mit ihrer Kennung)? */
    function eigeneOffen(s: AdminSicherung): boolean {
        const mine = eigene.value;
        if (mine === null || clock() - eigeneSeit > EIGENE_WARTEN_MS) return false;
        const lauf = s.letzterLauf;
        if (lauf?.operationId === mine && lauf.finishedAt !== null) return false;
        const antwort = s.anstossen.letzteAntwort;
        return !(antwort?.operationId === mine && antwort.result !== null && antwort.result !== "angenommen");
    }

    function geschiehtEtwas(s: AdminSicherung | null): boolean {
        return s !== null && (s.anstossen.wartend !== null || s.zustand === "laeuft" || eigeneOffen(s));
    }

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        if (!following || unconfirmed.value !== null || !geschiehtEtwas(stand.value)) return;
        timer = setTimer(() => {
            timer = undefined;
            void load();
        }, NACHSEHEN_MS);
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminSicherung>("/api/admin/system/backup", deps.fetcher),
                reads.ask,
            );
            if (mine !== ticket) return;
            stand.value = body;
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            if (mine === ticket) {
                loadProblems.value = formProblems(error);
                unconfirmed.value = neededConfirmation(error);
            }
        } finally {
            if (mine === ticket) {
                loading.value = false;
                planen();
            }
        }
    }

    async function start(): Promise<ActionResult> {
        if (busy.value) return { ok: false, problems: [] };
        busy.value = true;
        ergebnis.value = null;
        const operationId = newOperationId();
        let result: ActionResult;
        try {
            await withConfirmation(
                () => postJson<OperationReceipt>("/api/admin/system/backup/start", { operationId }, deps.fetcher),
                ask,
            );
            eigene.value = operationId;
            eigeneSeit = clock();
            result = { ok: true, problems: [] };
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            result =
                failure?.code === "reauth_required" || failure?.code === "assurance_required"
                    ? { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] }
                    : { ok: false, problems: formProblems(error) };
            ergebnis.value = result;
        }
        busy.value = false;
        await load();
        return result;
    }

    /** Der Antrag verlangt Stufe S: Fehlt die frische Bestätigung, fragt `ask` nach dem Passkey und schickt dann noch einmal. */
    async function beantragen(eingabe: AntragEingabe): Promise<ActionResult> {
        if (antragBusy.value) return { ok: false, problems: [] };
        antragBusy.value = true;
        antragErgebnis.value = null;
        const body = { operationId: newOperationId(), ...eingabe, grund: eingabe.grund.trim() };
        let result: ActionResult;
        try {
            await withConfirmation(
                () => postJson<OperationReceipt>("/api/admin/system/backup/wiederherstellung", body, deps.fetcher),
                ask,
            );
            result = { ok: true, problems: [] };
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            result =
                failure?.code === "reauth_required" || failure?.code === "assurance_required"
                    ? { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] }
                    : { ok: false, problems: formProblems(error) };
            antragErgebnis.value = result;
        }
        antragBusy.value = false;
        await load();
        return result;
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        busy,
        eigene,
        ergebnis,
        load,
        start,
        antragBusy,
        antragErgebnis,
        beantragen,
        follow(on: boolean): void {
            following = on;
            planen();
        },
    };
}
