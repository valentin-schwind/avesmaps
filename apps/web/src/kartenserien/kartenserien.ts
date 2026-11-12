import { ref, type Ref } from "vue";
import {
    KARTENSERIEN_PRODUCTION_URL,
    KARTENSERIEN_URL,
    type AdminKartenserie,
    type AdminKartenserien,
    type KartenserieAktion,
    type KartenserieAuftrag,
    type KartenserieStufe,
    type OperationReceipt,
    kartenserieKachelzahl,
} from "@avesmaps3d/shared";
import { formatNumber, locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import type { ActionResult } from "../auth/verwaltung";
import { label } from "../auth/verwaltung-text";
import { ladeKartenserien } from "../map/kartenserien-stand";
import type { HochladenStand } from "./hochladen";

/**
 * Der Reiter „Kartenserien“ im Browser (WI-0220 Schnitt 2; Vorlage Fassung 4, Betreiber 2026-10-18 abgenommen): laden, eine
 * Handlung schreiben (Passkey, Stufe S), danach neu laden, und den Katalog der Karte nachziehen, damit Fächer und Karte ohne
 * Neuladen folgen. Wie es aussieht, steht in `verwaltung-kartenserien.vue`.
 */

export interface KartenserienDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
}

export interface Kartenserien {
    stand: Ref<AdminKartenserien | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Die Serie, an der gerade geschrieben wird. */
    busy: Ref<string | null>;
    /** Die Antwort des letzten Schreibwegs, an ihrer Serie. */
    ergebnis: Ref<{ id: string; result: ActionResult } | null>;
    load(): Promise<void>;
    /** Eine Handlung; `true`, wenn sie durchging (die Meldung steht sonst an der Serie). */
    handle(id: string, aktion: KartenserieAktion): Promise<boolean>;
    /** „Nach Production übernehmen“ (Schnitt 4, nur die Betreiber); `true`, wenn der Auftrag eingereiht ist. */
    uebernehmen(id: string): Promise<boolean>;
}

export function createKartenserien(deps: KartenserienDeps = {}): Kartenserien {
    const stand = ref<AdminKartenserien | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const busy = ref<string | null>(null);
    const ergebnis = ref<{ id: string; result: ActionResult } | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminKartenserien>(KARTENSERIEN_URL, deps.fetcher),
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
            if (mine === ticket) loading.value = false;
        }
    }

    /** Ein Schreibweg an einer Serie: Passkey, danach neu laden; scheitert er, steht die Meldung an der Serie. */
    async function schreibe(id: string, senden: () => Promise<unknown>): Promise<boolean> {
        busy.value = id;
        ergebnis.value = null;
        try {
            await withConfirmation(senden, ask);
            await load();
            // Fächer und Karte lesen denselben Katalog (`map/kartenserien-stand.ts`): nachziehen, ohne die Seite neu zu laden.
            void ladeKartenserien(deps.fetcher);
            return true;
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            let result: ActionResult;
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
            ergebnis.value = { id, result };
            await load();
            return false;
        } finally {
            busy.value = null;
        }
    }

    async function handle(id: string, aktion: KartenserieAktion): Promise<boolean> {
        const s = stand.value;
        if (s === null || s.revision === null) return false;
        const body = { operationId: newOperationId(), baseRevision: s.revision, id, aktion };
        return schreibe(id, () => postJson<OperationReceipt>(KARTENSERIEN_URL, body, deps.fetcher));
    }

    async function uebernehmen(id: string): Promise<boolean> {
        const body = { operationId: newOperationId(), id };
        return schreibe(id, () => postJson<OperationReceipt>(KARTENSERIEN_PRODUCTION_URL, body, deps.fetcher));
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
        handle,
        uebernehmen,
    };
}

/** Die Kacheln einer Pyramide bis zur höchsten eigenen Stufe: 1 + 4 + 16 + … (32k mit Stufe 6: 5.461). */
export function kachelZahl(maxNativeZoom: number): number {
    let summe = 0;
    for (let z = 0; z <= maxNativeZoom; z += 1) summe += 4 ** z;
    return summe;
}

/** Der Satz unter dem Wahlschalter „Wer sieht die Serie im Fächer?“. */
export function stufenSatz(eintrag: AdminKartenserie): string {
    if (eintrag.stufe === "niemand") return t("admin.kartenserien.sicht.satz.niemand");
    if (eintrag.stufe === "editoren")
        return eintrag.serie.labelsInImage
            ? t("admin.kartenserien.sicht.satz.editorenBild")
            : t("admin.kartenserien.sicht.satz.editoren");
    if (eintrag.istVorgabe) return t("admin.kartenserien.sicht.satz.alleVorgabe");
    return eintrag.serie.labelsInImage
        ? t("admin.kartenserien.sicht.satz.alleBild")
        : t("admin.kartenserien.sicht.satz.alle");
}

/**
 * Warum eine Stufe gerade nicht wählbar ist; `undefined`, wenn sie geht. Dieselben Regeln wie der Server
 * (`apps/server/src/map-series/schreiben.ts`), damit der Schalter sie zeigt, bevor jemand drückt.
 */
export function stufeGesperrt(
    eintrag: AdminKartenserie,
    stufe: KartenserieStufe,
    alle: readonly AdminKartenserie[],
): string | undefined {
    if (eintrag.stufe === stufe) return undefined;
    if (stufe !== "alle" && eintrag.istVorgabe) return t("admin.kartenserien.error.defaultVisible");
    if (stufe !== "alle" && letzteUeberallFuerAlle(eintrag, alle)) return t("admin.kartenserien.error.lastSeries");
    return undefined;
}

/**
 * Ist das die letzte Serie, die alle in jeder Ansicht sehen? Eine mit Beschriftung im Bild zählt nicht: Besucher sehen sie nur unter
 * „Nur Karte“ (Betreiber 2026-11-10). Dieselbe Regel wie der Server (`last_series`).
 */
export function letzteUeberallFuerAlle(eintrag: AdminKartenserie, alle: readonly AdminKartenserie[]): boolean {
    const ueberall = (e: AdminKartenserie) => e.stufe === "alle" && !e.serie.labelsInImage;
    return ueberall(eintrag) && alle.filter(ueberall).length <= 1;
}

/** „Geändert vor 5 Minuten · Rondrikan“, oder nichts. */
export function geaendertText(eintrag: AdminKartenserie, jetzt: Date): string | null {
    if (eintrag.geaendert === null) return null;
    const wann = relativeTime(new Date(eintrag.geaendert.at), jetzt, locale.value);
    return eintrag.geaendert.by === null
        ? t("admin.kartenserien.geaendert", { zeit: wann })
        : t("admin.kartenserien.geaendertVon", { zeit: wann, wer: eintrag.geaendert.by });
}

// ── Hochladen und Zerlegen (Schnitt 3): der Ablauf einer Serie, wie die Vorlage ihn zeigt ─────────────────────────────────────────

/** Die Schritte des Ablaufs, in der Reihenfolge der Vorlage (Fassung 4). */
export const ABLAUF_SCHRITTE = ["hochladen", "pruefen", "warten", "zerlegen", "umschalten"] as const;

export interface AblaufSicht {
    /** Der laufende Schritt (Index in `ABLAUF_SCHRITTE`). */
    schritt: number;
    /** Gesamtfortschritt 0 bis 100: Hochladen bis 40, der Auftrag den Rest. */
    prozent: number;
    /** Die Zeile unter dem Balken (Bytes oder Kacheln). */
    zeile: string;
    fehler: string | null;
    angehalten: boolean;
}

const mb = (bytes: number): string => formatNumber(bytes / 1024 ** 2, 0);

/**
 * Der Ablauf einer Serie aus dem Upload im Browser und dem Auftrag aus dem Lesemodell; `null`, wenn nichts läuft. Hochladen zählt bis
 * 40 %, der Auftrag (`progress` 0 bis 1, Phasen prüfen 0, zerlegen ab 0,1, Manifest 0,8, umschalten 0,95) den Rest.
 */
export function ablauf(upload: HochladenStand | null, auftrag: KartenserieAuftrag | null): AblaufSicht | null {
    if (upload !== null && upload.phase !== "fertig") {
        const angehalten = upload.phase === "angehalten" || upload.phase === "fehler";
        return {
            schritt: upload.phase === "abschluss" ? 1 : 0,
            prozent: Math.round((40 * upload.empfangen) / Math.max(1, upload.bytes)),
            zeile: t("admin.kartenserien.ablauf.bytes", { von: mb(upload.empfangen), bis: mb(upload.bytes) }),
            fehler: upload.fehler.length > 0 ? upload.fehler.map((p) => t(p.key, p.params)).join(" ") : null,
            angehalten,
        };
    }
    if (auftrag === null) return null;
    const anteil = auftrag.progress ?? 0;
    const prozent = Math.round(40 + 60 * anteil);
    if (auftrag.state === "FAILED" || auftrag.state === "CANCELLED") {
        return {
            schritt: 3,
            prozent,
            zeile: "",
            fehler: auftrag.fehler ?? t("admin.kartenserien.ablauf.gescheitert"),
            angehalten: true,
        };
    }
    if (auftrag.state === "QUEUED") {
        return {
            schritt: 2,
            prozent: 42,
            zeile: t("admin.kartenserien.ablauf.wartet"),
            fehler: null,
            angehalten: false,
        };
    }
    const schritt = auftrag.phase === "umschalten" ? 4 : auftrag.phase === "pruefen" ? 1 : 3;
    const kacheln = auftrag.kante === null ? 0 : kartenserieKachelzahl(auftrag.kante);
    const fertig = Math.max(0, Math.min(kacheln, Math.round(((anteil - 0.1) / 0.7) * kacheln)));
    return {
        schritt,
        prozent,
        zeile:
            schritt === 3 && kacheln > 0
                ? t("admin.kartenserien.ablauf.kacheln", {
                      fertig: formatNumber(fertig, 0),
                      alle: formatNumber(kacheln, 0),
                  })
                : "",
        fehler: null,
        angehalten: false,
    };
}

/** Läuft für eine Serie gerade etwas, das der Reiter nachlesen sollte (Auftrag oder Übernahme wartet oder rechnet)? */
export function laeuftEtwas(stand: AdminKartenserien | null): boolean {
    if (stand === null) return false;
    const aktiv = (a: KartenserieAuftrag | null) => a !== null && (a.state === "QUEUED" || a.state === "RUNNING");
    const rueber = (u: AdminKartenserie["uebernahme"]) => u !== null && (u.state === "QUEUED" || u.state === "RUNNING");
    return (
        stand.serien.some((e) => aktiv(e.auftrag) || rueber(e.uebernahme)) ||
        stand.inArbeit.some((e) => aktiv(e.auftrag))
    );
}

// ── Übernahme nach Production (Schnitt 4): Sperrgrund und Stand, wie die Vorlage sie zeigt ────────────────────────────────────────

/**
 * Warum „Nach Production übernehmen“ gerade nicht geht; `undefined`, wenn es geht. Dieselben Regeln wie der Server
 * (`apps/server/src/map-series/uebernahme.ts`): nur die Betreiber, nicht ausgeblendet, kein laufender Auftrag derselben Serie.
 */
export function uebernahmeGesperrt(
    eintrag: AdminKartenserie,
    { darf, sonst }: { darf: boolean; sonst: string | undefined },
): string | undefined {
    if (!darf) return t("admin.kartenserien.uebernahme.nurBetreiber");
    if (eintrag.stufe === "niemand") return t("admin.kartenserien.error.ausgeblendet");
    const offen = (state: string | undefined) => state === "QUEUED" || state === "RUNNING";
    if (offen(eintrag.auftrag?.state) || offen(eintrag.uebernahme?.state))
        return t("admin.kartenserien.hochladen.laeuftSchon");
    if (eintrag.fassung === null) return t("admin.kartenserien.error.fassungFehlt");
    return sonst;
}

/** Der Satz zur letzten Übernahme einer Serie, oder nichts. */
export function uebernahmeSatz(eintrag: AdminKartenserie, jetzt: Date): string | null {
    const u = eintrag.uebernahme;
    if (u === null) return null;
    if (u.state === "QUEUED") return t("admin.kartenserien.uebernahme.stand.wartet");
    if (u.state === "RUNNING") {
        const phase = u.phase === null ? "" : label("admin.kartenserien.uebernahme.phase", u.phase);
        return t("admin.kartenserien.uebernahme.stand.laeuft", { phase });
    }
    if (u.state === "SUCCEEDED") {
        const wann = relativeTime(new Date(u.bis ?? u.seit), jetzt, locale.value);
        return t("admin.kartenserien.uebernahme.stand.fertig", { fassung: u.revision, zeit: wann });
    }
    return t("admin.kartenserien.uebernahme.stand.gescheitert", {
        grund: u.fehler ?? t("admin.kartenserien.ablauf.gescheitert"),
    });
}
