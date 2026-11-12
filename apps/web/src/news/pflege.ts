import { computed, ref, shallowRef, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    NEWS_ADMIN_URL,
    type NewsEintragVoll,
    type NewsPflege,
    type NewsRubrik,
    type NewsZustand,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import {
    createReadConfirmation,
    requestConfirmation,
    withConfirmation,
    type ReadConfirmation,
} from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import { locale } from "../i18n/i18n";

/**
 * Der Eintrag „Neuigkeiten“ der Systemsteuerung (WI-0139 N6, WI-0217): Entwürfe der täglichen Routine freigeben, einen Eintrag
 * bessern oder verstecken, von Hand neu anlegen, auch zwischendrin, und in den Papierkorb legen. Wie es aussieht, steht in
 * `verwaltung-neuigkeiten.vue`.
 *
 * 🔴 **Gelöscht wird nie** (WI-0139): Löschen heißt Papierkorb (Betreiber 2026-10-17, gewählt „Papierkorb“). Der Eintrag verlässt die
 * Liste und avesmaps.de und lässt sich zurückholen.
 *
 * Der Kreis je Zeile (Design Guide §13.17, wie überall): ○ Entwurf — wartet auf euch · ● sichtbar · ◐ versteckt (war sichtbar, ist es
 * nicht mehr).
 */

export type Kreis = "leer" | "halb" | "voll";

export function kreisVon(eintrag: Pick<NewsEintragVoll, "zustand">): Kreis {
    if (eintrag.zustand === "entwurf") return "leer";
    return eintrag.zustand === "sichtbar" ? "voll" : "halb";
}

/** Was die Zeile über die Herkunft sagt: die Routine, der Startbestand aus Legacy oder ein Name. */
export function herkunftSchluessel(eintrag: Pick<NewsEintragVoll, "herkunft">): "routine" | "legacy" | "person" {
    if (eintrag.herkunft === "routine") return "routine";
    return eintrag.herkunft === "legacy" ? "legacy" : "person";
}

/** Ein Tag (`2026-10-13`) in der Schreibweise der Sprache, ohne Uhrzeit und ohne Zeitzone. */
export function tagText(datum: string, mitJahr = true): string {
    const [jahr, monat, tag] = datum.split("-").map((teil) => Number.parseInt(teil, 10));
    if (jahr === undefined || monat === undefined || tag === undefined || Number.isNaN(tag)) return datum;
    return new Date(Date.UTC(jahr, monat - 1, tag)).toLocaleDateString(locale.value, {
        ...(mitJahr ? { year: "numeric" } : {}),
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

const TAG = /^\d{4}-\d{2}-\d{2}$/u;

/** Was der Editor festhält; dieselben Felder für Neu und Bearbeiten. */
export interface EditorFelder {
    datum: string;
    rubrik: NewsRubrik;
    titel: string;
    text: string;
}

/**
 * 🔴 **Die Reihenfolge ist das Datum** (WI-0217). Wer unter einem Eintrag einfügt (`nach`, `null` heißt ganz oben), bleibt dort nur mit
 * einem Datum zwischen dem Eintrag darüber und dem darunter; der Satz sagt welches, oder dass der Eintrag beim Speichern an seinen Platz
 * rückt. Dieselbe Regel rechnet der Server (`routes/news.ts`): gleiches Datum heißt direkt darunter, sonst die Spitze des Tages.
 */
export function platzHinweis(
    eintraege: readonly Pick<NewsEintragVoll, "id" | "datum">[],
    nach: number | null,
    datum: string,
): { satz: Phrase | null; bleibt: boolean } {
    if (!TAG.test(datum)) return { satz: null, bleibt: false };
    const index = nach === null ? -1 : eintraege.findIndex((eintrag) => eintrag.id === nach);
    const oben = index >= 0 ? eintraege[index] : undefined;
    const unten = eintraege[index + 1];
    const bleibt = (oben === undefined || datum <= oben.datum) && (unten === undefined || datum >= unten.datum);
    if (!bleibt) return { satz: { key: "admin.news.platz.rueckt" }, bleibt };
    if (oben !== undefined && unten !== undefined) {
        const satz: Phrase =
            oben.datum === unten.datum
                ? { key: "admin.news.platz.gleich", params: { tag: tagText(oben.datum) } }
                : {
                      key: "admin.news.platz.zwischen",
                      params: { von: tagText(unten.datum, false), bis: tagText(oben.datum) },
                  };
        return { satz, bleibt };
    }
    if (unten !== undefined)
        return { satz: { key: "admin.news.platz.oben", params: { tag: tagText(unten.datum) } }, bleibt };
    if (oben !== undefined)
        return { satz: { key: "admin.news.platz.unten", params: { tag: tagText(oben.datum) } }, bleibt };
    return { satz: null, bleibt };
}

/** Wer gerade arbeitet: ein Eintrag (seine Kennung) oder ein neuer, der noch keine hat. */
const NEU = 0;

export interface NeuigkeitenPflege {
    stand: ShallowRef<NewsPflege | null>;
    fehler: Ref<boolean>;
    busy: Ref<number | null>;
    problems: Ref<Phrase[]>;
    entwuerfe: ComputedRef<number>;
    laden: () => Promise<void>;
    setzeZustand: (id: number, zustand: NewsZustand) => Promise<boolean>;
    bessere: (id: number, felder: Partial<EditorFelder>) => Promise<boolean>;
    /** Von Hand anlegen, auf Wunsch unter einem Eintrag (`nach`) und als Entwurf. */
    anlegen: (felder: EditorFelder & { nach?: number; zustand: "sichtbar" | "entwurf" }) => Promise<boolean>;
    /** In den Papierkorb (`true`) oder zurück (`false`). */
    papierkorb: (id: number, hinein: boolean) => Promise<boolean>;
}

/** Dieselben Abhängigkeiten wie die anderen Einträge der Verwaltung (`inhalte.ts`): eigener Abruf, geteilte Lesebestätigung. */
export interface NeuigkeitenPflegeDeps {
    fetcher?: Fetcher;
    /** Die Lesebestätigung der Verwaltung; ohne sie fragt dieser Eintrag für sich. */
    reads?: ReadConfirmation;
}

export function createNeuigkeitenPflege(deps: NeuigkeitenPflegeDeps = {}): NeuigkeitenPflege {
    const stand = shallowRef<NewsPflege | null>(null);
    const fehler = ref(false);
    const busy = ref<number | null>(null);
    const problems = ref<Phrase[]>([]);

    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);

    async function laden(): Promise<void> {
        try {
            stand.value = await withConfirmation(() => getJson<NewsPflege>(NEWS_ADMIN_URL, deps.fetcher), reads.ask);
            fehler.value = false;
        } catch {
            fehler.value = true;
        }
    }

    async function sende(wer: number, url: string, rumpf: Record<string, unknown>): Promise<boolean> {
        if (busy.value !== null) return false;
        busy.value = wer;
        problems.value = [];
        let ok = false;
        try {
            await withConfirmation(
                () => postJson<OperationReceipt>(url, { operationId: newOperationId(), ...rumpf }, deps.fetcher),
                requestConfirmation,
            );
            ok = true;
        } catch (error) {
            problems.value = formProblems(error);
        } finally {
            busy.value = null;
        }
        await laden();
        return ok;
    }

    const aendere = (id: number, rumpf: Record<string, unknown>) => sende(id, `${NEWS_ADMIN_URL}/${String(id)}`, rumpf);

    return {
        stand,
        fehler,
        busy,
        problems,
        entwuerfe: computed(() => stand.value?.entwuerfe ?? 0),
        laden,
        setzeZustand: (id, zustand) => aendere(id, { zustand }),
        bessere: (id, felder) => aendere(id, { ...felder }),
        anlegen: (felder) => sende(NEU, NEWS_ADMIN_URL, { ...felder }),
        papierkorb: (id, hinein) => aendere(id, { papierkorb: hinein }),
    };
}

/** Der Wert an der Schiene: wie viele Entwürfe warten; keiner, kein Wert. */
export function schienenWert(stand: Pick<NewsPflege, "entwuerfe"> | null): string | undefined {
    const zahl = stand?.entwuerfe ?? 0;
    return zahl > 0 ? String(zahl) : undefined;
}
