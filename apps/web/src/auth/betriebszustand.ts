import { ref, type Ref } from "vue";
import {
    SYSTEM_REASON_MAX,
    type AdminSystemBrief,
    type AdminSystemOverview,
    type OperationReceipt,
    type SystemLock,
    type SystemMode,
} from "@avesmaps3d/shared";
import { formatList, formatNumber, locale, t, tPlural, type MessageKey } from "../i18n/i18n";
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
import type { ActionResult } from "./verwaltung";

/**
 * Der Eintrag „Betriebszustand“ der Verwaltung (WI-0127 SYS-5; SYS-0001 §6.2, §6.8; Blatt WI-0119 Fassung 2, A1, A4, Z1, Z2, Z6):
 * was die Oberfläche aus `GET /api/admin/system` rechnet und wie sie umschaltet. Reine Funktionen zuerst, damit Vitest sie ohne
 * Browser prüft; darunter der Zustand des Eintrags (`createOperations`).
 *
 * 🔴 **Eingestellt gegen wirksam** (Blatt Z2): eingestellt ist, was in der Datenbank steht; wirksam, was die antwortende Instanz im
 * Speicher hält. Vier Urteile: `gleich` · `zieht_nach` (die Instanz kennt eine ältere Revision, höchstens `NACHZIEHEN_MS` nach dem
 * Umschalten) · `weicht_ab` (länger, oder bei gleicher Revision ein anderer Wert) · `unbekannt` (die Instanz weiß ihren Zustand nicht).
 * 🔴 **„Unbekannt“ ist nie Normal:** weder im Text noch als gewähltes Segment.
 *
 * Alle Zeiten rechnen an der Uhr des Servers (`brief.now`); was seit der Antwort vergangen ist, misst der Browser an seiner eigenen
 * Uhr (`receivedAt`). So verschiebt eine falsch gehende Uhr am Rechner kein „vor … s“.
 */

/** Wie lange eine Instanz nachziehen darf, bevor das Fenster „weicht ab“ sagt: zwei Takte des Speichers (5 s je Takt, SYS-2 B6). */
export const NACHZIEHEN_MS = 10_000;

/** Wie oft der Eintrag nachsieht, solange er offen ist und der Server nicht gleich steht (kein eigener Kanal zum Browser). */
export const NACHSEHEN_MS: Readonly<Record<Exclude<Wirkung, "gleich">, number>> = {
    zieht_nach: 2_000,
    weicht_ab: 10_000,
    unbekannt: 5_000,
};

export type Wirkung = "gleich" | "zieht_nach" | "weicht_ab" | "unbekannt";
export type Ton = "erfolg" | "ruhe" | "warnung" | "gefahr";

export interface WirkungUrteil {
    art: Wirkung;
    /** Die wirksame Stellung dieser Instanz; `null` heißt unbekannt, nie Normal. */
    mode: SystemMode | null;
    /** Wie alt der wirksame Stand beim Antworten war (ms, Uhr des Servers); `null` ohne erfolgreiches Lesen. */
    alterMs: number | null;
    /** Seit wann die Instanz nachzieht oder abweicht (ms bis zur Antwort, Uhr des Servers). */
    seitMs: number | null;
    /** Die Tafel fehlt auf diesem Server noch (Fastify vor `migrate`): Es gilt Normal wie vor SYS-2, geschaltet wird nichts. */
    unprovisioned: boolean;
}

const zeit = (iso: string | null): number | null => {
    if (iso === null) return null;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
};

/** Eingestellt gegen wirksam (Blatt Z2). */
export function wirkung(overview: AdminSystemOverview): WirkungUrteil {
    const { configured, effective, brief } = overview;
    const now = zeit(brief.now) ?? Date.now();
    const gelesen = zeit(effective.readAt);
    const alterMs = gelesen === null ? null : Math.max(0, now - gelesen);
    const unbekannt: WirkungUrteil = { art: "unbekannt", mode: null, alterMs, seitMs: null, unprovisioned: false };
    if (effective.source === "unprovisioned") {
        return { art: "gleich", mode: effective.mode, alterMs, seitMs: null, unprovisioned: true };
    }
    if (effective.source !== "database" || configured === null || effective.revision === null) return unbekannt;
    if (effective.mode === null || effective.mapLock === null || effective.systemLock === null) return unbekannt;
    const umgeschaltet = zeit(configured.updatedAt);
    const seitMs = umgeschaltet === null ? null : Math.max(0, now - umgeschaltet);
    if (effective.revision < configured.revision) {
        const art = seitMs !== null && seitMs <= NACHZIEHEN_MS ? "zieht_nach" : "weicht_ab";
        return { art, mode: effective.mode, alterMs, seitMs, unprovisioned: false };
    }
    const anders =
        effective.revision === configured.revision &&
        (effective.mode !== configured.mode.mode ||
            effective.mapLock !== configured.mapLock.locked ||
            effective.systemLock !== configured.systemLock.locked);
    return { art: anders ? "weicht_ab" : "gleich", mode: effective.mode, alterMs, seitMs, unprovisioned: false };
}

/** Der Ton einer Stellung am Statuspunkt: Normal grün, Eingeschränkt gelb (Blatt Z2 „Übernommen“). */
export function modeTon(mode: SystemMode | null): Ton {
    if (mode === null) return "ruhe";
    return mode === "normal" ? "erfolg" : "warnung";
}

/** Der Ton des Urteils „wirksam“: abweichend rot, nachziehend gelb, unbekannt grau, sonst der Ton der Stellung. */
export function wirkungTon(urteil: WirkungUrteil): Ton {
    if (urteil.art === "weicht_ab") return "gefahr";
    if (urteil.art === "zieht_nach") return "warnung";
    if (urteil.art === "unbekannt") return "ruhe";
    return modeTon(urteil.mode);
}

/** Wie lange etwas her ist: unter einer Minute in Sekunden („vor 6 s“, Blatt A1), sonst wie die übrige Verwaltung. */
export function vorText(ms: number, now: Date = new Date()): string {
    const sekunden = Math.max(0, Math.round(ms / 1000));
    if (sekunden < 60) return t("admin.system.secondsAgo", { n: sekunden });
    return relativeTime(new Date(now.getTime() - ms), now, locale.value);
}

/** Wie lange etwas schon so ist, ohne „vor“: „4 s“, „2 Min.“ (Blatt Z2 „seit 4 s“, „weicht seit 2 min ab“). */
export function dauerText(ms: number): string {
    const sekunden = Math.max(0, Math.round(ms / 1000));
    if (sekunden < 60) return t("admin.system.seconds", { n: sekunden });
    const minuten = Math.round(sekunden / 60);
    if (minuten < 60) return t("admin.system.minutes", { n: minuten });
    return t("admin.system.hours", { n: Math.round(minuten / 60) });
}

/** Der Name der Stellung; `null` heißt unbekannt. */
export function modeName(mode: SystemMode | null): string {
    return mode === null ? t("admin.system.unknown") : t(`admin.system.mode.${mode}`);
}

/** Der Stand rechts in der Schiene: die eingestellte Stellung, „unbekannt“, wenn der Server seinen Zustand nicht weiß. */
export function schienenWert(overview: AdminSystemOverview | null): string | undefined {
    if (overview === null) return undefined;
    const urteil = wirkung(overview);
    if (urteil.art === "unbekannt") return t("admin.system.unknown");
    if (urteil.unprovisioned) return modeName(urteil.mode);
    return overview.configured === null ? t("admin.system.unknown") : modeName(overview.configured.mode.mode);
}

/** Wer zuletzt geschaltet hat: eine Person, die Kommandozeile (`cli:<Benutzer>`) oder, ohne beides, die Einrichtung. */
export function werText(setting: { by: { displayName: string } | null; byLabel: string | null }): string {
    if (setting.by !== null) return setting.by.displayName;
    if (setting.byLabel !== null) {
        const user = setting.byLabel.startsWith("cli:") ? setting.byLabel.slice(4) : setting.byLabel;
        return t("admin.system.byCli", { user });
    }
    return t("admin.system.bySetup");
}

/** „seit heute, 14:05 · Rondrikan“, mit dem Grund in Anführungszeichen, wenn einer dasteht. */
export function seitText(
    setting: {
        since: string | null;
        by: { displayName: string } | null;
        byLabel: string | null;
        reason: string | null;
    },
    now: Date,
): string {
    const teile: string[] = [];
    if (setting.since !== null) {
        const wann = relativeTime(new Date(setting.since), now, locale.value, "zeitpunkt");
        if (wann !== "") teile.push(t("admin.system.since", { time: wann }));
    }
    teile.push(werText(setting));
    if (setting.reason !== null && setting.reason !== "")
        teile.push(t("admin.system.quoted", { text: setting.reason }));
    return teile.join(" · ");
}

// --- Kurzstatus „Betrieb im Moment“ --------------------------------------------------------------------------------------------

export interface StatusZeile {
    id: "karte" | "anmeldung" | "routen" | "warteschlange";
    ton: Ton;
    text: string;
}

/**
 * Die Zeile „Warteschlange“ des Kurzstatus. 🔴 Ist sie pausiert (WI-0160), sagt die Zeile ZUERST das: „Warteschlange pausiert:
 * 3 warten“, in Warnton. Sonst wäre „0 laufen, 3 warten“ dieselbe Zeile wie an einem Tag, an dem etwas klemmt — und genau diese
 * Verwechslung war der Ärger des Betreibers.
 */
function warteschlange(queue: AdminSystemBrief["queue"], paused: boolean): StatusZeile {
    if (queue === null) return { id: "warteschlange", ton: "ruhe", text: t("admin.system.brief.queueUnknown") };
    const laufen = tPlural("admin.system.brief.running", queue.running, { n: formatNumber(queue.running, 0) });
    const warten = tPlural("admin.system.brief.queued", queue.queued, { n: formatNumber(queue.queued, 0) });
    if (paused) {
        return { id: "warteschlange", ton: "warnung", text: t("admin.system.brief.queuePaused", { warten }) };
    }
    return {
        id: "warteschlange",
        ton: queue.running + queue.queued > 0 ? "warnung" : "erfolg",
        text: t("admin.system.brief.queue", { laufen, warten }),
    };
}

/** Die vier Zeilen des Kurzstatus (Blatt A1): Karte, Anmeldung, Routenrechner, Warteschlange. */
export function kurzstatus(brief: AdminSystemBrief, queuePaused = false): StatusZeile[] {
    const routen: Record<AdminSystemBrief["routing"], { ton: Ton; key: MessageKey }> = {
        ready: { ton: "erfolg", key: "admin.system.brief.routingReady" },
        warming: { ton: "warnung", key: "admin.system.brief.routingWarming" },
        cold: { ton: "warnung", key: "admin.system.brief.routingWarming" },
        failed: { ton: "gefahr", key: "admin.system.brief.routingFailed" },
    };
    const anmeldung: Record<AdminSystemBrief["login"], { ton: Ton; key: MessageKey }> = {
        ready: { ton: "erfolg", key: "admin.system.brief.loginReady" },
        failed: { ton: "gefahr", key: "admin.system.brief.loginFailed" },
        off: { ton: "ruhe", key: "admin.system.brief.loginOff" },
    };
    return [
        brief.map === "ready"
            ? { id: "karte", ton: "erfolg", text: t("admin.system.brief.mapReady") }
            : { id: "karte", ton: "gefahr", text: t("admin.system.brief.mapFailed") },
        { id: "anmeldung", ton: anmeldung[brief.login].ton, text: t(anmeldung[brief.login].key) },
        { id: "routen", ton: routen[brief.routing].ton, text: t(routen[brief.routing].key) },
        warteschlange(brief.queue, queuePaused),
    ];
}

// --- Umschalten -----------------------------------------------------------------------------------------------------------------

/** Die offene Frage im Eintrag: eine Stellung, eine Sperre oder die Warteschlange, mit dem Ziel. */
export type Frage =
    | { art: "mode"; ziel: SystemMode }
    | { art: "lock"; lock: SystemLock; ziel: boolean }
    | { art: "queue"; ziel: boolean };

/** Wo eine Antwort steht: am Hauptschalter, an ihrer Sperre oder an der Warteschlange. */
export type Ort = "mode" | "queue" | SystemLock;

export function ortVon(frage: Frage): Ort {
    return frage.art === "lock" ? frage.lock : frage.art;
}

/**
 * Einschränken, Sperren und Pausieren brauchen einen Grund (er steht im Protokoll); zurückschalten, lösen und fortsetzen nicht
 * (SYS-0001 §6.2, für die Warteschlange WI-0160).
 */
export function grundPflicht(frage: Frage): boolean {
    return frage.art === "mode" ? frage.ziel === "restricted" : frage.ziel;
}

/** Warum der Grund so nicht geht (1 bis 300 Zeichen, gezählt wie der Server: Zeichen, nicht UTF-16-Einheiten); sonst `undefined`. */
export function grundProblem(text: string, pflicht: boolean): MessageKey | undefined {
    const laenge = [...text.trim()].length;
    if (pflicht && laenge === 0) return "admin.system.reason.missing";
    if (laenge > SYSTEM_REASON_MAX) return "admin.system.reason.tooLong";
    return undefined;
}

/**
 * Was gegen das Einschränken spricht, bevor der Server gefragt wird (Schutzregeln, SYS-0001 §4.5): Wer einschränkt, muss selbst
 * hineinkommen, und mindestens ein Inhaber braucht einen Passkey. Der Server prüft dasselbe noch einmal (409); hier steht es
 * schon an der Frage, statt erst nach dem Passkey.
 */
export function schutzProblem(
    frage: Frage,
    overview: AdminSystemOverview,
    personId: string | undefined,
): MessageKey | undefined {
    if (frage.art !== "mode" || frage.ziel !== "restricted") return undefined;
    const holders = overview.restrictedAccessHolders;
    if (personId === undefined || !holders.some((holder) => holder.person.id === personId)) {
        return "admin.system.error.wouldLockOutSelf";
    }
    if (!holders.some((holder) => holder.hasPasskey)) return "admin.system.error.noHolder";
    return undefined;
}

/** Höchstens so viele Namen stehen in der Folge; der Rest wird gezählt. */
export const NAMEN_HOECHSTENS = 6;

/** „Rondrikan und Hesindiane (beide mit Passkey)“: wer im eingeschränkten Betrieb hineinkommt (Blatt A4, SYS-0001 §4.5). */
export function inhaberText(holders: AdminSystemOverview["restrictedAccessHolders"]): string {
    if (holders.length === 0) return t("admin.system.holders.none");
    const namen = (liste: typeof holders): string => {
        const gezeigt = liste.slice(0, NAMEN_HOECHSTENS).map((holder) => holder.person.displayName);
        const rest = liste.length - gezeigt.length;
        return formatList(rest > 0 ? [...gezeigt, t("admin.system.holders.more", { n: rest })] : gezeigt);
    };
    const mit = holders.filter((holder) => holder.hasPasskey);
    const ohne = holders.filter((holder) => !holder.hasPasskey);
    if (ohne.length === 0) {
        const alle =
            holders.length === 1
                ? t("admin.system.holders.withPasskeyOne")
                : holders.length === 2
                  ? t("admin.system.holders.withPasskeyTwo")
                  : t("admin.system.holders.withPasskeyAll");
        return `${namen(holders)} ${alle}`;
    }
    if (mit.length === 0) return t("admin.system.holders.noneWithPasskey", { namen: namen(ohne) });
    return t("admin.system.holders.mixed", { mit: namen(mit), ohne: namen(ohne) });
}

/**
 * Der Rückweg ohne Verwaltung (Blatt A1): die zwei Befehle der Kommandozeile. Auf dem VPS heißt das Werkzeug
 * `avesmaps3d-auth <staging|production>` (Runbook `docs/operations/notzugang-anmeldung.md`), lokal `npm run auth --`.
 */
export function rueckwegBefehle(environment: string | null | undefined): [string, string] {
    const vorne =
        environment === "development" || environment === null || environment === undefined
            ? "npm run auth --"
            : `avesmaps3d-auth ${environment}`;
    return [`${vorne} betrieb-normal`, `${vorne} sperre-loesen`];
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface OperationsDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Die Bestätigung der Lesewege, geteilt mit der übrigen Verwaltung desselben Fensters (`verwaltung.ts`). */
    reads?: ReadConfirmation;
    /** Für Tests: eigene Zeitgeber. */
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    /** Für Tests: die Uhr des Browsers. */
    now?: () => number;
}

export interface Operations {
    overview: Ref<AdminSystemOverview | null>;
    /** Wann die letzte Antwort ankam, an der Uhr des Browsers. */
    receivedAt: Ref<number>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    /** Ohne Bestätigung leer geblieben: was fehlt; dann sieht der Eintrag auch nicht von selbst nach. */
    unconfirmed: Ref<Need | null>;
    /** Der Knopf in der Zeile: das Fenster „Kurz bestätigen“ erneut, danach lädt alles neu, was darauf wartet. */
    confirmAgain(): void;
    frage: Ref<Frage | null>;
    grund: Ref<string>;
    busy: Ref<boolean>;
    /** Die Antwort der letzten Handlung, an ihrem Ort. */
    ergebnis: Ref<{ ort: Ort; result: ActionResult } | null>;
    load(): Promise<void>;
    ask(frage: Frage): void;
    setGrund(text: string): void;
    cancel(): void;
    confirm(): Promise<ActionResult>;
    /** Solange der Eintrag offen ist: nachsehen, bis der Server gleich steht (es gibt keinen Kanal zum Browser). */
    follow(on: boolean): void;
}

/** Wie lange bis zum nächsten Nachsehen, oder `null`, wenn der Server gleich steht. */
export function naechstesNachsehen(overview: AdminSystemOverview | null): number | null {
    if (overview === null) return null;
    const art = wirkung(overview).art;
    return art === "gleich" ? null : NACHSEHEN_MS[art];
}

/**
 * Der Zustand des Eintrags. Neu geladen wird beim Öffnen, nach jeder eigenen Handlung (auch nach einer Ablehnung: dann zeigt der
 * Eintrag den Stand, der sie erklärt) und, solange der Eintrag offen ist und der Server nicht gleich steht, in kurzen Abständen.
 *
 * 🪤 Kein eigener Kanal: `/ws` trägt nur die Ereignisse der Warteschlange, und der Weckruf `avesmaps_system_changed` endet an den
 * Instanzen (SYS-2). Wer anderswo umschaltet, erscheint hier beim nächsten Öffnen oder Nachsehen.
 */
export function createOperations(deps: OperationsDeps = {}): Operations {
    const overview = ref<AdminSystemOverview | null>(null);
    const receivedAt = ref(0);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const frage = ref<Frage | null>(null);
    const grund = ref("");
    const busy = ref(false);
    const ergebnis = ref<{ ort: Ort; result: ActionResult } | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const now = deps.now ?? Date.now;
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        // Unbestätigt sieht der Eintrag nicht von selbst nach: Jedes Nachsehen endete wieder ohne Bestätigung.
        if (!following || unconfirmed.value !== null) return;
        const ms = naechstesNachsehen(overview.value);
        if (ms !== null) {
            timer = setTimer(() => {
                timer = undefined;
                void load();
            }, ms);
        }
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminSystemOverview>("/api/admin/system", deps.fetcher),
                reads.ask,
            );
            if (mine !== ticket) return;
            overview.value = body;
            receivedAt.value = now();
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

    function send(body: Record<string, unknown>, url: string): Promise<OperationReceipt> {
        const sent = { operationId: newOperationId(), ...body };
        return withConfirmation(() => postJson<OperationReceipt>(url, sent, deps.fetcher), ask);
    }

    function problems(error: unknown): ActionResult {
        const failure = error instanceof ApiFailure ? error : undefined;
        if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
            // Die Bestätigung wurde abgebrochen (oder ging nicht): nichts hat sich geändert, und das Neuladen fragt nicht gleich wieder.
            reads.decline();
            return { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
        }
        if (failure?.code === "edit_conflict") {
            const by = (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
            const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
            return { ok: false, problems: formProblems(error), conflict: { by, at } };
        }
        return { ok: false, problems: formProblems(error) };
    }

    async function confirm(): Promise<ActionResult> {
        const offen = frage.value;
        const stand = overview.value;
        if (offen === null || stand === null || busy.value) return { ok: false, problems: [] };
        const fehlt = grundProblem(grund.value, grundPflicht(offen));
        if (fehlt !== undefined) return { ok: false, problems: [{ key: fehlt }] };
        if (stand.configured === null) return { ok: false, problems: [{ key: "admin.system.error.unknown" }] };
        const reason = grund.value.trim();
        const baseRevision = stand.configured.revision;
        busy.value = true;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            await (offen.art === "mode"
                ? send(
                      { baseRevision, mode: offen.ziel, ...(reason === "" ? {} : { reason }) },
                      "/api/admin/system/mode",
                  )
                : offen.art === "queue"
                  ? send(
                        { baseRevision, paused: offen.ziel, ...(reason === "" ? {} : { reason }) },
                        "/api/admin/system/queue",
                    )
                  : send(
                        { baseRevision, lock: offen.lock, locked: offen.ziel, ...(reason === "" ? {} : { reason }) },
                        "/api/admin/system/lock",
                    ));
            result = { ok: true, problems: [] };
        } catch (error) {
            result = problems(error);
        }
        // Ein Konflikt oder ein schon erreichter Stand schließt die Frage: Der neue Stand steht gleich da. Sonst bleibt sie offen,
        // damit der Grund nicht verloren geht (abgebrochener Passkey, Server kurz ohne Zustand).
        const schliessen =
            result.ok || result.conflict !== undefined || result.problems[0]?.key === "auth.form.noChange";
        if (schliessen) {
            frage.value = null;
            grund.value = "";
        }
        if (!result.ok) ergebnis.value = { ort: ortVon(offen), result };
        busy.value = false;
        await load();
        return result;
    }

    return {
        overview,
        receivedAt,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        frage,
        grund,
        busy,
        ergebnis,
        load,
        ask(next): void {
            frage.value = next;
            grund.value = "";
            ergebnis.value = null;
        },
        setGrund(text): void {
            grund.value = text;
        },
        cancel(): void {
            frage.value = null;
            grund.value = "";
        },
        confirm,
        follow(on): void {
            following = on;
            planen();
        },
    };
}
