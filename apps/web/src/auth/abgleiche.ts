import { ref, type Ref } from "vue";
import { ABGLEICH_KATEGORIE } from "@avesmaps3d/shared";
import type {
    AbgleichKreis,
    AbgleichQuelle,
    AbgleichZeile,
    AdminAbgleiche,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { formatList, isMessageKey, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { haengtGrund, warteText } from "../status/gemeinsam-view";
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
 * Der Eintrag „Abgleiche“ unter „Redaktion & Integrationen“ (WI-0127 SYS-14, SYS-0001 §9b). Betreiber 2026-10-10: „du kannst "Zieh mal"
 * auch in die verwaltung tun, dann brauch ichs dir nicht sagen“. Was die Oberfläche rechnet, steht hier; wie es aussieht, in
 * `verwaltung-abgleiche.vue`.
 *
 * - Je Quelle eine Zeile in Legacys Listenform: Name mit Kreis, darunter die Unterzeile („Letzter Abgleich: heute, 14:05 · …“, Legacys
 *   „Letzte Sync: …“), rechts „⇄ Jetzt abgleichen“ nur mit `run_legacy_sync`. Ein Druck fragt an der Stelle nach; erst „Jetzt
 *   abgleichen“ reiht ein. Stufe V: kein frischer Passkey, die Verwaltung kennt den zweiten Faktor der Sitzung ohnehin.
 * - Kein Kanal zum Browser: Solange ein Auftrag wartet oder läuft und der Eintrag offen ist, sieht der Eintrag alle paar Sekunden nach.
 */

/** Die Reihenfolge der Kreise in der Legende (Fuß): wie in jeder Liste von leer nach voll. */
export const KREIS_LEGENDE: readonly AbgleichKreis[] = ["leer", "halb", "voll"];

/** Wie oft nachgesehen wird, solange ein Auftrag wartet oder läuft. */
export const NACHSEHEN_MS = 3000;

export function kreisName(kreis: AbgleichKreis): string {
    return t(`admin.sync.circle.${kreis}`);
}

export function quelleName(quelle: AbgleichQuelle): string {
    return t(`admin.sync.source.${quelle}`);
}

/**
 * Die Beschriftung des Knopfes einer Zeile. Alle Zeilen tragen „⇄ Jetzt abgleichen“; eine Quelle darf ihren eigenen Satz haben
 * (`admin.sync.start.<quelle>`).
 *
 * 🔴 Das gibt es für den Production-Zug, weil der Betreiber den Knopf wörtlich benannt hat (2026-10-14: „ich will auf der stage
 * den button "Production-Zug holen"“). Es bricht die gemeinsame Form der Liste nicht: Keine Umgebung zeigt `production` und
 * `legacy` zugleich — zieht eine Umgebung von Production, sind die Legacy-Zeilen dort verborgen.
 */
export function startName(quelle: AbgleichQuelle): string {
    return eigenerSatz("admin.sync.start", quelle);
}

/** Dasselbe für den Knopf in der Rückfrage: „Jetzt abgleichen“, beim Production-Zug „Jetzt holen“. */
export function bestaetigenName(quelle: AbgleichQuelle): string {
    return eigenerSatz("admin.sync.askAction", quelle);
}

/** Der Satz einer Quelle, sonst der gemeinsame. */
function eigenerSatz(basis: "admin.sync.start" | "admin.sync.askAction", quelle: AbgleichQuelle): string {
    const key = `${basis}.${quelle}`;
    return isMessageKey(key) ? t(key) : t(basis);
}

/** Was eine Zeile in ihrer Unterzeile sagt, samt Ton (Legacys Listen: leise, gut, Warnung). */
export interface Unterzeile {
    text: string;
    /** `fehler`: der Auftrag hängt (WI-0179), er kommt nicht von selbst weiter. */
    ton: "leise" | "gut" | "warnung" | "fehler";
}

/** Ein Teil, der entfiel: die Teile der Medien mit Namen, ein Schritt des Zugs so, wie der Zug ihn nennt („I24 Wiki-Linkziele“). */
function lueckeName(luecke: string): string {
    const key = `admin.sync.gap.${luecke}`;
    return isMessageKey(key) ? t(key) : luecke;
}

function wer(ausgeloest: { art: "person" | "ablauf"; name: string | null }): string {
    if (ausgeloest.art === "person" && ausgeloest.name !== null) return t("admin.sync.by", { name: ausgeloest.name });
    return t("admin.sync.byProcess");
}

function zeitpunkt(iso: string, now: Date): string {
    return relativeTime(new Date(iso), now, locale.value, "zeitpunkt");
}

/**
 * Der Satz zum Warten eines Auftrags: aus den Sätzen der Statusseite, sonst der allgemeine.
 *
 * 🔴 **Hier wird nichts mehr abgeleitet** (WI-0160). Vorher stand hier eine zweite Semantik: `korridor` ergab „wartet auf die
 * Abholung“, ein fehlender Planer einen eigenen Satz — dieselbe Frage, anders beantwortet als auf der Statusseite, und in
 * Production zwangsläufig lückenhaft, weil dort kein Planer einen Grund schreibt. Den Grund rechnet jetzt der Server an EINER
 * Stelle (`apps/server/src/jobs/wartegrund.ts`), auch ohne Planer; die Oberfläche übersetzt ihn nur noch.
 */
export function warteSatz(waitReason: string | null): string {
    // Dieselbe Stelle wie die Reihe (WI-0293): Ein sammelnder Auftrag sagt „noch unbekannt“ statt eines wörtlichen `{time}`.
    return warteText(waitReason);
}

/**
 * Der Fortschritt eines laufenden Abgleichs in Prozent, für den Balken unter der Zeile (Betreiber 2026-10-10: „grob reicht, einfach ein
 * fortschrittsbalken, der abschätzen kann wieviel erledigt ist“). Grob: aus dem Schritt, nicht aus Datensätzen (`abgleiche/job.ts`).
 * Ohne laufenden Auftrag oder ohne Angabe `null`.
 */
export function fortschritt(zeile: AbgleichZeile): number | null {
    const laufend = zeile.laufend;
    if (laufend === null || laufend.state !== "RUNNING" || laufend.progress === null) return null;
    return Math.round(Math.min(1, Math.max(0, laufend.progress)) * 100);
}

export function unterzeile(zeile: AbgleichZeile, now: Date): Unterzeile {
    const laufend = zeile.laufend;
    if (laufend !== null) {
        if (laufend.state === "QUEUED") {
            // Mit dem Stand des Dirigenten (WI-0163) der Platz in der gemeinsamen Reihe aller Umgebungen.
            const platz = laufend.platz ?? null;
            const teile = [t("admin.sync.queued")];
            if (platz !== null) teile.push(t("status.row.position", { n: platz }));
            // Hinter einem laufenden Abgleich dieser Umgebung nennt die Zeile ihn (Betreiber 2026-10-17); den Namen rechnet der Server.
            const hinter = laufend.hinter ?? null;
            teile.push(
                hinter !== null ? t("admin.sync.behind", { name: quelleName(hinter) }) : warteSatz(laufend.waitReason),
            );
            return { text: teile.join(" · "), ton: haengtGrund(laufend.waitReason) ? "fehler" : "warnung" };
        }
        const teile = [t("admin.sync.running", { time: zeitpunkt(laufend.startedAt ?? laufend.queuedAt, now) })];
        if (laufend.phase !== null) teile.push(t("admin.sync.phase", { phase: laufend.phase }));
        if (laufend.progress !== null) teile.push(`${String(Math.round(laufend.progress * 100))} %`);
        if (zeile.wartetDanach === true) teile.push(t("admin.sync.thenAgain"));
        return { text: teile.join(" · "), ton: "leise" };
    }
    const letzter = zeile.letzter;
    if (letzter === null) return { text: t("admin.sync.never"), ton: "leise" };
    const wann = zeitpunkt(letzter.finishedAt, now);
    if (letzter.state === "FAILED") {
        const teile = [t("admin.sync.failed", { time: wann })];
        if (letzter.fehler !== null) teile.push(letzter.fehler);
        return { text: teile.join(" · "), ton: "warnung" };
    }
    if (letzter.state === "CANCELLED") {
        // 🔴 Der Satz des Abholers gehört in die Zeile (Claudio 2026-10-13): Bei „Knopf, dann alles automatisch“ steht kein
        // Mensch mehr zwischen Stage und Production, und „Zuletzt abgebrochen: heute, 20:27“ allein sagt niemandem, warum.
        const teile = [t("admin.sync.cancelled", { time: wann })];
        if (letzter.fehler !== null) teile.push(letzter.fehler);
        return { text: teile.join(" · "), ton: "warnung" };
    }
    const teile = [t("admin.sync.last", { time: wann }), wer(letzter.ausgeloest)];
    const luecken = letzter.luecken ?? [];
    if (luecken.length > 0) teile.push(t("admin.sync.gaps", { teile: formatList(luecken.map(lueckeName)) }));
    return { text: teile.join(" · "), ton: luecken.length > 0 ? "warnung" : "gut" };
}

/** Die Ausführung einer Zeile; ein älterer Server ohne das Feld (vor SYS-14b) sagt sie nur oben im Stand. */
function ausfuehrungVon(zeile: AbgleichZeile, stand?: AdminAbgleiche): string {
    return (zeile as { ausfuehrung?: string }).ausfuehrung ?? stand?.ausfuehrung ?? "aus";
}

/** Trägt diese Zeile eine Kategorie des Zugs (WI-0141)? Dann braucht ihr Knopf das eigene Recht. */
export function istKategoriezeile(quelle: AbgleichQuelle): boolean {
    return ABGLEICH_KATEGORIE[quelle] !== null;
}

/** Welches Recht der Knopf einer Zeile braucht: eine Stelle für den Satz und für die Prüfung. */
export function rechtFuer(quelle: AbgleichQuelle): "sync" | "zug" | "production" {
    if (quelle === "production") return "production";
    return istKategoriezeile(quelle) ? "zug" : "sync";
}

const RECHT_NAME = {
    sync: "auth.capability.run_legacy_sync",
    zug: "auth.capability.run_legacy_zug",
    production: "auth.capability.run_production_pull",
} as const;

/** Wer welches Recht hat; ein einzelnes `boolean` (ältere Aufrufer, Tests) gilt für alle drei. */
export interface AbgleichRechte {
    sync: boolean;
    zug: boolean;
    production: boolean;
}

/**
 * Warum der Knopf einer Zeile gesperrt ist, als Satz; `undefined`, wenn er geht.
 *
 * Eine Kategoriezeile (WI-0141) verlangt `run_legacy_zug` statt `run_legacy_sync`: Sie ersetzt die Tafeln der Lesekarte, der
 * Server fragt dafür den frischen Passkey ab. Der Production-Zug (WI-0144) verlangt `run_production_pull`, weil er die Daten,
 * Kacheln und Medien der ganzen Umgebung ersetzt. Welches Recht der Satz nennt, entscheidet also die Zeile.
 */
export function sperrSatz(
    stand: AdminAbgleiche,
    zeile: AbgleichZeile,
    darf: boolean | AbgleichRechte,
): string | undefined {
    const art = rechtFuer(zeile.quelle);
    const recht = typeof darf === "boolean" ? darf : darf[art];
    if (!recht) return t("admin.sync.readOnly", { recht: t(RECHT_NAME[art]) });
    const ausfuehrung = ausfuehrungVon(zeile, stand);
    // Eine Kategorie, deren Weg noch nicht ganz steht, trägt ihren eigenen Satz: `aus` hieße „diese Umgebung gleicht nichts
    // ab“ und wäre eine Unwahrheit, solange die anderen Kategorien gehen (Betreiberregel 2026-10-13).
    if (ausfuehrung === "noch_nicht") return t("admin.sync.notYet");
    // `verborgen` schickt der Server nicht mit (WI-0144); kommt die Zeile doch, sagt sie dasselbe wie `aus` statt zu gehen.
    if (ausfuehrung === "aus" || ausfuehrung === "verborgen") return t("admin.sync.unavailable");
    // Je Zeile wartet höchstens ein Auftrag; hinter einem laufenden darf einer einreihen (Betreiber 2026-10-17: „dafür ist die doch
    // da? dass man wartet?“). Der Production-Zug bleibt allein: Er sperrt sich auch, solange er läuft.
    if (zeile.laufend?.state === "QUEUED" || zeile.wartetDanach === true) return t("admin.sync.alreadyQueued");
    if (zeile.laufend !== null && zeile.quelle === "production") return t("admin.sync.alreadyRunning");
    return undefined;
}

export interface AbgleicheDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Die Bestätigung der Lesewege, geteilt mit den übrigen Einträgen des Fensters. */
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface Abgleiche {
    stand: Ref<AdminAbgleiche | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Die Quelle, an deren Zeile gerade gefragt wird. */
    frage: Ref<AbgleichQuelle | null>;
    busy: Ref<boolean>;
    /** Das Ergebnis der letzten Handlung an ihrer Zeile: ein Fehler oder ein Hinweis der Quittung (`planner_inactive`). */
    ergebnis: Ref<{ quelle: AbgleichQuelle; result: ActionResult } | null>;
    load(): Promise<void>;
    ask(quelle: AbgleichQuelle): void;
    cancel(): void;
    confirm(): Promise<ActionResult>;
    /** Solange der Eintrag offen ist: nachsehen, solange ein Auftrag wartet oder läuft. */
    follow(on: boolean): void;
}

function laeuftEtwas(stand: AdminAbgleiche | null): boolean {
    return stand?.zeilen.some((zeile) => zeile.laufend !== null) ?? false;
}

export function createAbgleiche(deps: AbgleicheDeps = {}): Abgleiche {
    const stand = ref<AdminAbgleiche | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const frage = ref<AbgleichQuelle | null>(null);
    const busy = ref(false);
    const ergebnis = ref<{ quelle: AbgleichQuelle; result: ActionResult } | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    let ticket = 0;
    let following = false;
    let timer: unknown = undefined;

    function planen(): void {
        if (timer !== undefined) clearTimer(timer);
        timer = undefined;
        if (!following || unconfirmed.value !== null || !laeuftEtwas(stand.value)) return;
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
                () => getJson<AdminAbgleiche>("/api/admin/system/abgleiche", deps.fetcher),
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

    async function confirm(): Promise<ActionResult> {
        const quelle = frage.value;
        if (quelle === null || busy.value) return { ok: false, problems: [] };
        busy.value = true;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            const receipt = await withConfirmation(
                () =>
                    postJson<OperationReceipt>(
                        "/api/admin/system/abgleiche/start",
                        { operationId: newOperationId(), quelle },
                        deps.fetcher,
                    ),
                ask,
            );
            const hinweis = receipt.warnings.find((warning) => warning.code === "planner_inactive");
            result = { ok: true, problems: hinweis === undefined ? [] : [{ key: "admin.sync.waitNoPlanner" }] };
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            result =
                failure?.code === "reauth_required" || failure?.code === "assurance_required"
                    ? { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] }
                    : { ok: false, problems: formProblems(error) };
        }
        frage.value = null;
        if (!result.ok || result.problems.length > 0) ergebnis.value = { quelle, result };
        busy.value = false;
        await load();
        return result;
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        frage,
        busy,
        ergebnis,
        load,
        ask(quelle): void {
            frage.value = quelle;
            ergebnis.value = null;
        },
        cancel(): void {
            frage.value = null;
        },
        confirm,
        follow(on): void {
            following = on;
            planen();
        },
    };
}
