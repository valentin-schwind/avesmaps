import { ref, type Ref } from "vue";
import {
    MAX_BAND,
    ZOOMBAENDER_URL,
    ZOOMBAND_GRUPPEN,
    ZOOMBAND_SPUREN,
    wirksameZoombaender,
    zoombandFolge,
    type AdminZoombaender,
    type OperationReceipt,
    type ZoombandSpur,
    type Zoomspanne,
} from "@avesmaps3d/shared";
import { isMessageKey, locale, t } from "../i18n/i18n";
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
import { landscapeTypeName } from "../map/landscape-layers";
import { ladeZoombaender } from "../map/zoombaender-stand";

/**
 * Der Reiter „Zoombänder“ (WI-0221; Vorlage Fassung 4, Betreiber 2026-10-18 abgenommen): Ab welchem bis zu welchem Band jede Art auf der
 * Karte erscheint. Was die Oberfläche rechnet, steht hier; wie es aussieht, in `verwaltung-zoombaender.vue`.
 *
 * - **Die Spuren kommen aus der Tafel** (`packages/shared/src/system/zoombaender.ts`): Kennung, Gruppe, Zeile, Vorgabe, „nur zur Ansicht“,
 *   Grenze. Der Server schickt nur, was abweicht.
 * - **Ein Auslöser oben:** Verstellt wird im Entwurf, ohne Passkey; „Übernehmen“ schickt alle geänderten Spannen auf einmal (EIN Eintrag im
 *   Protokoll). ↺ setzt die Zeile im Entwurf auf die Vorgabe.
 * - Nach dem Übernehmen liest die Karte ihre Spannen neu (`ladeZoombaender`); sie gelten, sobald die Karte ihren Stil neu baut, spätestens
 *   beim nächsten Laden.
 */

const gleich = (a: Zoomspanne, b: Zoomspanne): boolean => a.von === b.von && a.bis === b.bis;

/** Die gespeicherten Spannen: die Abweichungen des Servers über den Vorgaben. */
export function gespeichert(stand: AdminZoombaender | null): Record<string, Zoomspanne> {
    return wirksameZoombaender(Object.fromEntries((stand?.zeilen ?? []).map((zeile) => [zeile.id, zeile.spanne])));
}

/** „3 bis 8“, „nur 4“. */
export function vonBisText(spanne: Zoomspanne): string {
    return spanne.von === spanne.bis
        ? t("admin.zoombaender.span.only", { band: spanne.von })
        : t("admin.zoombaender.span.range", { von: spanne.von, bis: spanne.bis });
}

/**
 * Der Name einer Zeile: die Art einer Landschaft aus ihrer Tafel (`landscape.type.*`), alles andere und die Arten, die dort fehlen
 * (Berggipfel, Ebene, Fluss, Vulkan), aus der Sprachtafel des Reiters.
 */
export function zeilenName(spur: ZoombandSpur): string {
    const art = spur.gruppe === "landschaften" ? landscapeTypeName(spur.zeile) : "";
    return art || label(`admin.zoombaender.zeile.${spur.gruppe}`, spur.zeile);
}

export interface SpurSicht {
    spur: ZoombandSpur;
    /** Der Name der Spur („Zeichen“, „Name“, „Linie“ …). */
    name: string;
    /** Was im Entwurf steht. */
    spanne: Zoomspanne;
    /** Was gespeichert ist. */
    gespeichert: Zoomspanne;
    /** Der Entwurf weicht vom gespeicherten Stand ab (noch nicht übernommen). */
    geaendert: boolean;
    /** Der Entwurf weicht von der Vorgabe ab. */
    abweichend: boolean;
    /** Ein Satz „nur zur Ansicht“ (Herrschaftsgebiete, Seewege); sonst `undefined`. */
    gesperrt: string | undefined;
    /** Was eine Abweichung braucht, als Satz; `null` auf der Vorgabe. */
    folge: string | null;
    /** Liegt das Band der Vorschau in der Spanne? */
    sichtbar: boolean;
}

export interface ZeilenSicht {
    key: string;
    name: string;
    notiz: string | null;
    spuren: SpurSicht[];
    /** ↺ ist wach: Eine Spur der Zeile weicht im Entwurf von der Vorgabe ab. */
    zuruecksetzbar: boolean;
    /** Nichts dieser Zeile ist auf dem Band der Vorschau zu sehen. */
    blass: boolean;
    /** Wer wann zuletzt verstellt hat; `null` ohne gespeicherte Abweichung. */
    stand: string | null;
}

export interface PanelSicht {
    id: string;
    titel: string;
    wirkung: string;
    hinweis: string | null;
    ansicht: boolean;
    zeilen: ZeilenSicht[];
}

/** Ein Satz aus der Sprachtafel, wenn es ihn gibt (Hinweise und Notizen hat nicht jede Zeile); sonst `null`. */
function satz(key: string): string | null {
    return isMessageKey(key) ? t(key) : null;
}

function folgeSatz(spur: ZoombandSpur, spanne: Zoomspanne): string {
    const folge = zoombandFolge(spur, spanne);
    if (folge === "kacheln") return t("admin.zoombaender.folge.kacheln", { band: spur.grenze?.von ?? 0 });
    return t(`admin.zoombaender.folge.${folge}`);
}

/** Die Panele mit ihren Zeilen, in der Reihenfolge der Tafel. */
export function panele(
    stand: AdminZoombaender | null,
    entwurf: Readonly<Record<string, Zoomspanne>>,
    blick: number,
    jetzt: Date,
): PanelSicht[] {
    const fest = gespeichert(stand);
    const zeilenStand = new Map((stand?.zeilen ?? []).map((zeile) => [zeile.id, zeile]));
    return ZOOMBAND_GRUPPEN.map((gruppe) => {
        const spuren = ZOOMBAND_SPUREN.filter((spur) => spur.gruppe === gruppe);
        const zeilenKeys = [...new Set(spuren.map((spur) => spur.zeile))];
        const ansicht = spuren.every((spur) => spur.nurAnsicht === "gebiete");
        return {
            id: gruppe,
            titel: t(`admin.zoombaender.panel.${gruppe}.title`),
            wirkung: t(`admin.zoombaender.panel.${gruppe}.effect`),
            hinweis: satz(`admin.zoombaender.panel.${gruppe}.note`),
            ansicht,
            zeilen: zeilenKeys.map((zeile): ZeilenSicht => {
                const eigene = spuren.filter((spur) => spur.zeile === zeile);
                const sichten = eigene.map((spur): SpurSicht => {
                    const gespeicherteSpanne = fest[spur.id] ?? spur.vorgabe;
                    const spanne = entwurf[spur.id] ?? gespeicherteSpanne;
                    const abweichend = !gleich(spanne, spur.vorgabe);
                    const gesperrt =
                        spur.nurAnsicht === undefined ? undefined : t(`admin.zoombaender.viewOnly.${spur.nurAnsicht}`);
                    return {
                        spur,
                        name: label("admin.zoombaender.spur", spur.spur),
                        spanne,
                        gespeichert: gespeicherteSpanne,
                        geaendert: !gleich(spanne, gespeicherteSpanne),
                        abweichend,
                        gesperrt,
                        folge: abweichend && gesperrt === undefined ? folgeSatz(spur, spanne) : null,
                        sichtbar: spur.nurAnsicht !== "abgeschaltet" && spanne.von <= blick && blick <= spanne.bis,
                    };
                });
                const letzte = eigene
                    .map((spur) => zeilenStand.get(spur.id))
                    .filter((eintrag) => eintrag !== undefined)
                    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
                const ersteSpur = eigene[0]!;
                return {
                    key: `${gruppe}.${zeile}`,
                    name: zeilenName(ersteSpur),
                    notiz: satz(`admin.zoombaender.notiz.${gruppe}.${zeile}`),
                    spuren: sichten,
                    zuruecksetzbar: sichten.some((sicht) => sicht.abweichend && sicht.gesperrt === undefined),
                    blass: !sichten.some((sicht) => sicht.sichtbar),
                    stand:
                        letzte === undefined
                            ? null
                            : [
                                  t("admin.zoombaender.changedAt", {
                                      time: relativeTime(new Date(letzte.changedAt), jetzt, locale.value, "zeitpunkt"),
                                  }),
                                  letzte.changedBy,
                              ]
                                  .filter((teil) => teil !== null)
                                  .join(" · "),
                };
            }),
        };
    });
}

/** Was in der Schiene rechts steht: wie viele Spannen von der Vorgabe abweichen; keine: nichts. */
export function schienenWert(stand: AdminZoombaender | null): string | undefined {
    if (stand === null) return undefined;
    const n = stand.zeilen.length;
    return n === 0 ? undefined : t("admin.zoombaender.rail", { n });
}

/** Wie viele Zeilen auf dem Band der Vorschau etwas zeigen. */
export function vorschau(sicht: readonly PanelSicht[]): { sichtbar: number; alle: number } {
    const zeilen = sicht.flatMap((panel) => panel.zeilen);
    return { sichtbar: zeilen.filter((zeile) => !zeile.blass).length, alle: zeilen.length };
}

// --- Zustand des Eintrags ----------------------------------------------------------------------------------------------------------

export interface ZoombaenderDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    reads?: ReadConfirmation;
    /** Die Karte liest ihre Spannen nach dem Übernehmen neu; in Tests ersetzbar. */
    nachladen?: () => Promise<void>;
}

export interface Zoombaender {
    stand: Ref<AdminZoombaender | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    /** Die Spannen, die verstellt, aber noch nicht übernommen sind, je Spur. */
    entwurf: Ref<Record<string, Zoomspanne>>;
    busy: Ref<boolean>;
    /** Die Antwort des letzten Übernehmens. */
    ergebnis: Ref<ActionResult | null>;
    load(): Promise<void>;
    setze(id: string, spanne: Zoomspanne): void;
    /** Die Spuren einer Zeile im Entwurf auf ihre Vorgabe. */
    zuruecksetzen(zeile: string): void;
    verwerfen(): void;
    /** Die geänderten Spuren (Entwurf gegen gespeicherten Stand). */
    geaenderte(): { id: string; spanne: Zoomspanne }[];
    uebernehmen(): Promise<boolean>;
}

export function createZoombaender(deps: ZoombaenderDeps = {}): Zoombaender {
    const stand = ref<AdminZoombaender | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const entwurf = ref<Record<string, Zoomspanne>>({});
    const busy = ref(false);
    const ergebnis = ref<ActionResult | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    const nachladen = deps.nachladen ?? (() => ladeZoombaender());
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));
    let ticket = 0;

    async function load(): Promise<void> {
        const mine = ++ticket;
        loading.value = true;
        try {
            const body = await withConfirmation(
                () => getJson<AdminZoombaender>(ZOOMBAENDER_URL, deps.fetcher),
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

    function geaenderte(): { id: string; spanne: Zoomspanne }[] {
        const fest = gespeichert(stand.value);
        return Object.entries(entwurf.value)
            .filter(([id, spanne]) => {
                const spur = ZOOMBAND_SPUREN.find((eintrag) => eintrag.id === id);
                return spur !== undefined && !gleich(spanne, fest[id] ?? spur.vorgabe);
            })
            .map(([id, spanne]) => ({ id, spanne }));
    }

    function setze(id: string, spanne: Zoomspanne): void {
        const spur = ZOOMBAND_SPUREN.find((eintrag) => eintrag.id === id);
        if (spur === undefined || spur.nurAnsicht !== undefined) return;
        const von = Math.max(0, Math.min(MAX_BAND, spanne.von));
        const bis = Math.max(von, Math.min(MAX_BAND, spanne.bis));
        entwurf.value = { ...entwurf.value, [id]: { von, bis } };
        ergebnis.value = null;
    }

    function zuruecksetzen(zeile: string): void {
        const neu = { ...entwurf.value };
        for (const spur of ZOOMBAND_SPUREN) {
            if (`${spur.gruppe}.${spur.zeile}` === zeile && spur.nurAnsicht === undefined) neu[spur.id] = spur.vorgabe;
        }
        entwurf.value = neu;
        ergebnis.value = null;
    }

    async function uebernehmen(): Promise<boolean> {
        const s = stand.value;
        const liste = geaenderte();
        if (s === null || s.revision === null || liste.length === 0 || busy.value) return false;
        busy.value = true;
        ergebnis.value = null;
        try {
            const aenderungen = liste.map(({ id, spanne }) => {
                const spur = ZOOMBAND_SPUREN.find((eintrag) => eintrag.id === id)!;
                // Zurück auf die Vorgabe heißt: die Abweichung löschen, nicht die Vorgabe speichern.
                return { id, spanne: gleich(spanne, spur.vorgabe) ? null : spanne };
            });
            const body = { operationId: newOperationId(), baseRevision: s.revision, aenderungen };
            await withConfirmation(() => postJson<OperationReceipt>(ZOOMBAENDER_URL, body, deps.fetcher), ask);
            entwurf.value = {};
            ergebnis.value = { ok: true, problems: [] };
            await load();
            await nachladen();
            return true;
        } catch (error) {
            const failure = error instanceof ApiFailure ? error : undefined;
            if (failure?.code === "reauth_required" || failure?.code === "assurance_required") {
                reads.decline();
                ergebnis.value = { ok: false, problems: [{ key: "admin.system.error.notConfirmed" }] };
            } else if (failure?.code === "edit_conflict") {
                const by =
                    (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
                const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
                ergebnis.value = { ok: false, problems: formProblems(error), conflict: { by, at } };
                await load();
            } else {
                ergebnis.value = { ok: false, problems: formProblems(error) };
            }
            return false;
        } finally {
            busy.value = false;
        }
    }

    return {
        stand,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        entwurf,
        busy,
        ergebnis,
        load,
        setze,
        zuruecksetzen,
        verwerfen: () => {
            entwurf.value = {};
            ergebnis.value = null;
        },
        geaenderte,
        uebernehmen,
    };
}
