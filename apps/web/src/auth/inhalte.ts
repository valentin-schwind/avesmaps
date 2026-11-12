import { ref, type Ref } from "vue";
import {
    LICENSE_SWITCH_PREFIX,
    SERIES_SWITCH_PREFIX,
    type AdminContentSwitchRow,
    type AdminContentSwitches,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { formatNumber, isMessageKey, locale, t } from "../i18n/i18n";
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
import { kartenserienKatalog } from "../map/kartenserien-stand";

/**
 * Der Eintrag „Inhalte“ der Systemsteuerung (WI-0127 SYS-10, SYS-0001 §6.4; Blatt WI-0119 A2, A5, Z8). Was die Oberfläche rechnet,
 * steht hier; wie es aussieht, in `verwaltung-inhalte.vue`.
 *
 * - Tafeln je Gruppe: Bilder nach Art, Infopanel (Vorkommen je Art als eine Zeile mit vier Kästchen), Karte; dazu die Karte „Notaus nach
 *   Rechten“ mit zwei Listen (Rechtsgrund, Lizenz) und je Zeile der Zahl der Bilder, die Besucher gerade sehen.
 * - Umlegen am Kästchen: kein Dialog, kein Grund (Blatt B, abgenommen); der Browser fragt den Passkey, danach steht in der Spalte „Stand“
 *   „aus seit … · Person“.
 */

const BASIS = "/api/admin/system/content-switches";
const nachschlagen = (key: string): string | null => (isMessageKey(key) ? t(key) : null);

/** Der Name eines Schalters: fest aus der Sprachtafel, Lizenzfamilien und Serien mit Rückfall auf die Kennung. */
export function schalterName(key: string): string {
    if (key.startsWith(LICENSE_SWITCH_PREFIX)) {
        const family = key.slice(LICENSE_SWITCH_PREFIX.length);
        return nachschlagen(`admin.content.license.${family}`) ?? family.toUpperCase();
    }
    if (key.startsWith(SERIES_SWITCH_PREFIX)) {
        const id = key.slice(SERIES_SWITCH_PREFIX.length);
        // Neue Serien (WI-0220) haben keinen Namen in der Sprachtafel: dann der Name aus dem Katalog der Systemsteuerung.
        const katalogName = kartenserienKatalog().series.find((s) => s.id === id)?.label;
        return t("admin.content.series", { name: nachschlagen(`admin.content.seriesName.${id}`) ?? katalogName ?? id });
    }
    return nachschlagen(`admin.content.name.${key}`) ?? key;
}

/** Die Unterzeile unter dem Namen („an Orten und Gebieten …“); `null`, wo es keine gibt. */
export const schalterUnter = (key: string): string | null => nachschlagen(`admin.content.sub.${key}`);

/** „Was Besucher dann sehen“; Serien teilen einen Satz. */
export function folgeSatz(key: string): string | null {
    if (key.startsWith(SERIES_SWITCH_PREFIX)) return t("admin.content.visitor.series");
    return nachschlagen(`admin.content.visitor.${key}`);
}

/** Die Spalte „Stand“: nur bei „aus“, mit Zeit und Person („aus seit 09.10., 18:20 · Rondrikan“). */
export function standText(row: AdminContentSwitchRow, now: Date): string | null {
    if (row.enabled || row.changedAt === null) return row.enabled ? null : t("admin.content.offUnknown");
    const zeit = relativeTime(new Date(row.changedAt), now, locale.value, "zeitpunkt");
    // Bilder: „564 ausgeblendet seit …“ (Blatt A2); Abschnitte und Serien: „aus seit …“.
    const satz =
        row.hidden === undefined
            ? t("admin.content.offSince", { time: zeit })
            : t("admin.content.hiddenSince", { count: formatNumber(row.hidden, 0), time: zeit });
    return [satz, row.changedBy].filter((part) => part !== null).join(" · ");
}

/** Was in der Schiene rechts steht: wie viele Schalter aus sind („2 aus“); keiner: nichts. */
export function schienenWert(stand: AdminContentSwitches | null): string | undefined {
    if (stand === null) return undefined;
    const aus = stand.rows.filter((row) => !row.enabled).length;
    return aus === 0 ? undefined : t("admin.content.rail", { n: aus });
}

export interface InhalteGruppen {
    art: AdminContentSwitchRow[];
    rechte: AdminContentSwitchRow[];
    lizenzen: AdminContentSwitchRow[];
    panel: AdminContentSwitchRow[];
    vorkommen: AdminContentSwitchRow[];
    karte: AdminContentSwitchRow[];
    betrieb: AdminContentSwitchRow[];
}

/** Die Zeilen in die Tafeln des Blatts: Vorkommen (`panel.lore.*`) als eigene Zeile, Lizenzen getrennt von den Rechtsgründen. */
export function gruppen(stand: AdminContentSwitches): InhalteGruppen {
    const rows = stand.rows;
    return {
        art: rows.filter((row) => row.group === "media_role"),
        rechte: rows.filter((row) => row.group === "media_rights" && !row.key.startsWith(LICENSE_SWITCH_PREFIX)),
        lizenzen: rows.filter((row) => row.key.startsWith(LICENSE_SWITCH_PREFIX)),
        panel: rows.filter((row) => row.group === "panel" && !row.key.startsWith("panel.lore.")),
        vorkommen: rows.filter((row) => row.key.startsWith("panel.lore.")),
        karte: rows.filter((row) => row.group === "map"),
        betrieb: rows.filter((row) => row.group === "betrieb"),
    };
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface InhalteDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
}

export interface Inhalte {
    stand: Ref<AdminContentSwitches | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Der Schlüssel, der gerade umgeschaltet wird. */
    busy: Ref<string | null>;
    /** Die Antwort der letzten Umschaltung, an ihrem Schlüssel. */
    ergebnis: Ref<{ key: string; result: ActionResult } | null>;
    load(): Promise<void>;
    schalte(key: string, enabled: boolean): Promise<ActionResult>;
}

export function createInhalte(deps: InhalteDeps = {}): Inhalte {
    const stand = ref<AdminContentSwitches | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<string | null>(null);
    const ergebnis = ref<{ key: string; result: ActionResult } | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(() => getJson<AdminContentSwitches>(BASIS, deps.fetcher), reads.ask);
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
            if (mine === ticket) loading.value = false;
        }
    }

    async function schalte(key: string, enabled: boolean): Promise<ActionResult> {
        const s = stand.value;
        if (s === null || s.revision === null || busy.value !== null) return { ok: false, problems: [] };
        busy.value = key;
        ergebnis.value = null;
        let result: ActionResult;
        try {
            const body = { operationId: newOperationId(), baseRevision: s.revision, key, enabled };
            await withConfirmation(() => postJson<OperationReceipt>(BASIS, body, deps.fetcher), ask);
            result = { ok: true, problems: [] };
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
                reads.decline();
                result = { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
            } else if (failure?.code === "edit_conflict") {
                const by =
                    (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
                const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
                result = { ok: false, problems: formProblems(error), conflict: { by, at } };
            } else {
                result = { ok: false, problems: formProblems(error) };
            }
            ergebnis.value = { key, result };
        }
        busy.value = null;
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
        ergebnis,
        load,
        schalte,
    };
}
