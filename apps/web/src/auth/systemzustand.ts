import { ref, type Ref } from "vue";
import {
    PLATTE_WARNUNG_FREI,
    SYSTEMZUSTAND_NACHSEHEN_MS,
    type AdminSystemzustand,
    type KomponentenZustand,
    type SystemKomponente,
    type SystemPlatte,
    type SystemProzess,
} from "@avesmaps3d/shared";
import { formatDecimal, formatNumber, isMessageKey, locale, t, tPlural } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { getJson, type Fetcher } from "./api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";

/**
 * Der Eintrag „Systemzustand“ der Systemsteuerung (WI-0127 SYS-8, SYS-0001 §6.3; Blatt WI-0119 A7, A9, Z7). Was die Oberfläche rechnet,
 * steht hier; wie es aussieht, in `verwaltung-systemzustand.vue`.
 *
 * - Komponenten als Tafel mit Statuspunkt in vier Zuständen: gesund · Warnung · ausgefallen · **unbekannt** (grauer Punkt, „Messwert
 *   fehlt“, nie eine Null). Am Telefon wandern Seit und Version unter den Namen.
 * - Auslastung mit Verlauf über 24 h, Datenbank, was auf der Platte liegt. Die Schwelle „Platte unter 15 % frei“ ist Anzeige, keine
 *   Prüfung.
 * - Der Eintrag fragt alle 30 s neu, solange er offen ist.
 */

export type Ton = "erfolg" | "ruhe" | "warnung" | "gefahr";

const TON: Record<KomponentenZustand, Ton> = {
    gesund: "erfolg",
    warnung: "warnung",
    ausgefallen: "gefahr",
    unbekannt: "ruhe",
};
export const zustandTon = (zustand: KomponentenZustand): Ton => TON[zustand];

const zeit = (iso: string, now: Date): string => relativeTime(new Date(iso), now, locale.value, "zeitpunkt");
const nachschlagen = (prefix: string, value: string): string | null => {
    const key = `${prefix}.${value}`;
    return isMessageKey(key) ? t(key) : null;
};

/** Bytes lesbar: „7,7 GB“, „410 MB“, „12 KB“; `null` heißt „unbekannt“. */
export function bytes(value: number | null): string {
    if (value === null) return t("admin.health.unknown");
    const GB = 1024 ** 3;
    const MB = 1024 ** 2;
    // Wie im Blatt: „157 GB“, „14,6 GB“, „2 GB“ (keine Null hinter dem Komma); eine leere Auslagerung ist „0“.
    if (value === 0) return "0";
    if (value >= GB) return t("admin.health.gb", { n: formatDecimal(value / GB, value >= 100 * GB ? 0 : 1) });
    if (value >= MB) return t("admin.health.mb", { n: formatNumber(value / MB, 0) });
    if (value >= 1024) return t("admin.health.kb", { n: formatNumber(value / 1024, 0) });
    return t("admin.health.b", { n: formatNumber(value, 0) });
}

export interface KomponentenZeile {
    id: SystemKomponente["id"];
    name: string;
    /** Was die Komponente für die Karte tut, in Alltagssprache (Betreiber 2026-10-11: „nicht alle betreiber kennen jedes framework“). */
    aufgabe: string;
    zustand: string;
    ton: Ton;
    seit: string;
    version: string;
}

/**
 * Eine Zeile der Tafel (Blatt A7): gesund heißt je Komponente „läuft“, „bereit“, „erreichbar“, „aktuell“; sonst der Zustand, bei bekannter
 * Zeit mit dem Grund dahinter. Die Spalte „Seit“ nennt die Zeit oder, wo keine bekannt ist, den Grund („Messwert fehlt“).
 */
export function komponentenZeile(komponente: SystemKomponente, now: Date): KomponentenZeile {
    const grund = komponente.hinweis === null ? null : nachschlagen("admin.health.hint", komponente.hinweis);
    const wort =
        komponente.zustand === "gesund"
            ? t(`admin.health.ok.${komponente.id}`)
            : t(`admin.health.state.${komponente.zustand}`);
    const zustand =
        komponente.zustand !== "gesund" && grund !== null && komponente.seit !== null ? `${wort}: ${grund}` : wort;
    return {
        id: komponente.id,
        name: t(`admin.health.component.${komponente.id}`),
        aufgabe: t(`admin.health.task.${komponente.id}`),
        zustand,
        ton: zustandTon(komponente.zustand),
        seit: komponente.seit !== null ? t("admin.health.since", { time: zeit(komponente.seit, now) }) : (grund ?? "–"),
        version: komponente.version ?? "–",
    };
}

/**
 * Der Schemastand als ein Satz (Betreiber 2026-10-14). `null` heißt: nichts zu sagen — ein Release ohne das Feld, oder
 * alles ist eingespielt und die Zeile bliebe Rauschen.
 *
 * 🔴 Diese Zeile beantwortet die Frage, an der eine ganze Nacht verging: Fehlt ein Feature, oder lief nur `migrate`
 * nicht? Vorher sah beides gleich aus — eine leere Statistik, ein Knopf ohne Wirkung.
 */
export function schemastandZeile(stand: AdminSystemzustand["migrationen"]): { text: string; warnung: boolean } | null {
    if (stand === undefined) return null;
    if (stand.zustand === "unlesbar") return { text: t("admin.health.schema.unreadable"), warnung: true };
    if (stand.zustand === "fehlend") {
        return {
            text: t("admin.health.schema.missing", {
                anzahl: String(stand.fehlend),
                da: stand.eingespielt ?? "–",
                soll: stand.erwartet ?? "–",
            }),
            warnung: true,
        };
    }
    return { text: t("admin.health.schema.ok", { da: stand.eingespielt ?? "–" }), warnung: false };
}

/** Was in der Schiene rechts steht: das Schwerste mit Zahl („1 ausgefallen“, „2 unbekannt“); alles gesund: nichts. */
export function schienenWert(stand: AdminSystemzustand | null): string | undefined {
    if (stand === null) return undefined;
    for (const zustand of ["ausgefallen", "warnung", "unbekannt"] as const) {
        const n = stand.komponenten.filter((entry) => entry.zustand === zustand).length;
        if (n > 0) return t(`admin.health.rail.${zustand}`, { n });
    }
    return undefined;
}

const dezimal = (value: number): string => formatNumber(value, 2);

/** Ein Anteil als „37 %“ (gerundet, geschütztes Leerzeichen). Die Last kann über 100 % gehen: Dann warten Prozesse auf einen Kern. */
export const prozent = (anteil: number): string => `${formatNumber(Math.round(anteil * 100), 0)}\u00a0%`;

export interface Auslastung {
    /** `prozent`: die Auslastung jetzt, neben dem Verlauf (Betreiber 2026-10-11); `null`, wenn sie fehlt. */
    prozessor: { haupt: string; zusatz: string; prozent: string | null };
    /** `prozesse`: eine Zeile je Prozess (WI-0127 §22). */
    speicher: { haupt: string; zusatz: string; prozesse: string[]; prozent: string | null };
    platten: { name: string; text: string; ton: Ton | null }[];
    laufzeit: string;
}

/** Die Zeilen der Karte „Auslastung“: Haupttext, leiser Zusatz, Ton; Werte, die fehlen, heißen „unbekannt“. */
export function auslastung(stand: AdminSystemzustand, now: Date): Auslastung {
    const a = stand.auslastung;
    const unbekannt = t("admin.health.unknown");
    const prozessor = {
        haupt:
            a.last === null
                ? unbekannt
                : `${dezimal(a.last.eins)} · ${dezimal(a.last.fuenf)} · ${dezimal(a.last.fuenfzehn)}`,
        zusatz:
            a.last === null
                ? t("admin.health.load.none")
                : t("admin.health.load.detail", { n: a.kerne === null ? "?" : String(a.kerne) }),
        // Die Last der letzten Minute je Kern: 1,0 auf jedem Kern ist 100 %.
        prozent: a.last === null || a.kerne === null || a.kerne <= 0 ? null : prozent(a.last.eins / a.kerne),
    };
    const s = a.speicher;
    const frei = s.gesamt === null || s.belegt === null ? null : Math.max(0, s.gesamt - s.belegt);
    const prozesse = a.prozesse.map((entry) => prozessZeile(entry));
    const speicher = {
        haupt:
            s.belegt === null || s.gesamt === null
                ? unbekannt
                : t("admin.health.mem.used", { used: bytes(s.belegt), total: bytes(s.gesamt) }),
        zusatz: [
            frei === null ? null : t("admin.health.mem.free", { free: bytes(frei) }),
            s.auslagerung === null
                ? t("admin.health.mem.swapUnknown")
                : t("admin.health.mem.swap", { used: bytes(s.auslagerung), total: bytes(s.auslagerungGesamt) }),
        ]
            .filter((part): part is string => part !== null)
            .join(", "),
        prozesse,
        prozent: s.belegt === null || s.gesamt === null || s.gesamt <= 0 ? null : prozent(s.belegt / s.gesamt),
    };
    const platten = a.platten.map((platte) => plattenZeile(platte));
    const tage = a.laufzeit.system === null ? null : a.laufzeit.system;
    const fastify = stand.komponenten.find((entry) => entry.id === "fastify")?.seit ?? null;
    const laufzeit = [
        tage === null
            ? t("admin.health.uptime.serverUnknown")
            : t("admin.health.uptime.server", { dauer: dauer(tage) }),
        fastify === null ? null : t("admin.health.uptime.fastify", { time: zeit(fastify, now) }),
    ]
        .filter((part): part is string => part !== null)
        .join(" · ");
    return { prozessor, speicher, platten, laufzeit };
}

/**
 * Eine Zeile je Prozess (WI-0127 §22): „Fastify 480 MB“; der Routing-Worker als Thread darin mit Heap und Graph; der Jobs-Worker mit den
 * Jobs, die er gerade rechnen lässt. Was fehlt, heißt „unbekannt“.
 */
export function prozessZeile(entry: SystemProzess): string {
    const name = t(`admin.health.component.${entry.id}`);
    if (entry.imProzess !== undefined) {
        const heap = entry.heap ?? null;
        const graph = entry.graph ?? null;
        return heap === null && graph === null
            ? t("admin.health.mem.threadUnknown", { name })
            : t("admin.health.mem.thread", { name, heap: bytes(heap), graph: bytes(graph) });
    }
    const zeile = `${name} ${bytes(entry.rss)}`;
    const kinder = entry.kinder;
    if (entry.rss === null || kinder === undefined || kinder.anzahl === 0) return zeile;
    return tPlural("admin.health.mem.child", kinder.anzahl, {
        zeile,
        n: String(kinder.anzahl),
        rss: bytes(kinder.rss),
    });
}

/** Eine Dauer in Sekunden als „23 Tagen“, „5 Stunden“, „12 Minuten“ (für „Server seit …“). */
export function dauer(sekunden: number): string {
    const tage = Math.floor(sekunden / 86_400);
    if (tage >= 1) return t(tage === 1 ? "admin.health.uptime.day" : "admin.health.uptime.days", { n: tage });
    const stunden = Math.floor(sekunden / 3600);
    if (stunden >= 1)
        return t(stunden === 1 ? "admin.health.uptime.hour" : "admin.health.uptime.hours", { n: stunden });
    const minuten = Math.max(1, Math.floor(sekunden / 60));
    return t(minuten === 1 ? "admin.health.uptime.minute" : "admin.health.uptime.minutes", { n: minuten });
}

/** „157 GB frei von 232 GB (68 %)“ und der Name des Datenträgers; unter 15 % frei: Warnung (nur Anzeige). */
export function plattenZeile(platte: SystemPlatte): { name: string; text: string; ton: Ton | null } {
    const name =
        platte.quelle === "anwendung" ? (nachschlagen("admin.health.disk", platte.id) ?? platte.id) : platte.id;
    if (platte.frei === null || platte.gesamt === null || platte.gesamt === 0) {
        return { name, text: t("admin.health.unknown"), ton: "ruhe" };
    }
    const anteil = platte.frei / platte.gesamt;
    return {
        name,
        text: t("admin.health.disk.free", {
            free: bytes(platte.frei),
            total: bytes(platte.gesamt),
            pct: formatNumber(anteil * 100, 0),
        }),
        ton: anteil < PLATTE_WARNUNG_FREI ? "warnung" : null,
    };
}

export interface Verlauf {
    last: (number | null)[];
    speicher: (number | null)[];
    lastSatz: string;
    speicherSatz: string;
}

/** Die Linien des Verlaufs (Last; Arbeitsspeicher als Anteil) und ihr Satz für Vorleser. */
export function verlauf(stand: AdminSystemzustand): Verlauf {
    const last = stand.verlauf.map((punkt) => punkt.last1);
    const gesamt = stand.auslastung.speicher.gesamt;
    const speicher = stand.verlauf.map((punkt) =>
        punkt.belegt === null || gesamt === null || gesamt === 0 ? null : punkt.belegt / gesamt,
    );
    const zahlen = last.filter((value): value is number => value !== null);
    const lastSatz =
        zahlen.length === 0
            ? t("admin.health.history.none")
            : t("admin.health.history.load", {
                  now: dezimal(zahlen.at(-1)!),
                  max: dezimal(Math.max(...zahlen)),
              });
    const anteile = speicher.filter((value): value is number => value !== null);
    const speicherSatz =
        anteile.length === 0
            ? t("admin.health.history.none")
            : t("admin.health.history.mem", {
                  now: formatNumber(anteile.at(-1)! * 100, 0),
                  max: formatNumber(Math.max(...anteile) * 100, 0),
              });
    return { last, speicher, lastSatz, speicherSatz };
}

/** Die Verbindungen als „14 von 100 belegt“; ohne `connection_counts()` „unbekannt“. */
export function verbindungenText(stand: AdminSystemzustand): string {
    const v = stand.datenbank.verbindungen;
    return v === null
        ? t("admin.health.unknown")
        : t("admin.health.db.connections", { used: v.belegt, max: v.erlaubt });
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface SystemzustandDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
    setTimer?: (callback: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

export interface Systemzustand {
    stand: Ref<AdminSystemzustand | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    load(): Promise<void>;
    /** Solange der Eintrag offen ist: alle 30 s neu fragen. */
    follow(on: boolean): void;
}

export function createSystemzustand(deps: SystemzustandDeps = {}): Systemzustand {
    const stand = ref<AdminSystemzustand | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
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
        if (!following || unconfirmed.value !== null) return;
        timer = setTimer(() => {
            timer = undefined;
            void load();
        }, SYSTEMZUSTAND_NACHSEHEN_MS);
    }

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminSystemzustand>("/api/admin/system/health", deps.fetcher),
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

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        load,
        follow(on: boolean): void {
            following = on;
            planen();
        },
    };
}
