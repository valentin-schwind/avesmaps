import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import {
    GITHUB_REPOSITORY,
    VERSIONEN_URL,
    type ReleaseVoll,
    type VersionenListe,
    type VersionGruppe,
} from "@avesmaps3d/shared";
import { suchtreffer } from "../controls/avm-listenleiste";
import { locale, NUMBER_LOCALE } from "../i18n/i18n";
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
 * Der Eintrag „Versionen“ der Systemsteuerung (WI-0137, VERSION-0001 §4): das laufende Release mit seinen Commits nach Arbeitspaket, darunter
 * die früheren zugeklappt; Aufklappen lädt deren Commits einmal. Die Daten kommen aus den Release-Notizen des Servers (`config/releases/`),
 * der Server fragt nie GitHub. Wie es aussieht, steht in `verwaltung-versionen.vue`.
 */

/**
 * Die Suche in „Versionen“ (`AvmListenleiste`, Koordination 2026-10-11): je Zeile im Satz, im Betreff, im Arbeitspaket (Nummer und Name),
 * beim Wer und im Commit. Gruppen ohne Treffer fallen weg; eine leere Suche lässt alles stehen.
 */
export function gesuchteGruppen(gruppen: readonly VersionGruppe[], suche: string): VersionGruppe[] {
    if (suche.trim() === "") return [...gruppen];
    return gruppen
        .map((gruppe) => ({
            ...gruppe,
            zeilen: gruppe.zeilen.filter((zeile) =>
                suchtreffer(
                    [
                        zeile.text,
                        zeile.commit.betreff,
                        gruppe.id,
                        gruppe.name ?? "",
                        zeile.commit.wer,
                        zeile.commit.sha,
                    ].join(" "),
                    suche,
                ),
            ),
        }))
        .filter((gruppe) => gruppe.zeilen.length > 0);
}

/**
 * „11.10. 00:41“ in der Zeit des Betrachters; mit Jahr für den Kopf und die früheren Releases. Das Gebietsschema ist das der
 * Zahlen (`NUMBER_LOCALE`, WI-0168): Bis dahin kannte diese Stelle nur Deutsch und gab jeder anderen Sprache das englische
 * Datum.
 */
export function wann(iso: string, mitJahr = false): string {
    return new Date(iso).toLocaleString(NUMBER_LOCALE[locale.value], {
        day: "2-digit",
        month: "2-digit",
        ...(mitJahr ? { year: "numeric" } : {}),
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** „Alle auf GitHub vergleichen“: aus den zwei SHAs des Release gebaut (vom Schema geprüft), nie aus Text. */
export const vergleichLink = (release: Pick<ReleaseVoll, "von" | "bis">): string =>
    `${GITHUB_REPOSITORY}/compare/${release.von}...${release.bis}`;

export interface VersionenDeps {
    fetcher?: Fetcher;
    reads?: ReadConfirmation;
}

export interface Versionen {
    liste: ShallowRef<VersionenListe | null>;
    loading: Ref<boolean>;
    loadProblems: Ref<Phrase[]>;
    unconfirmed: Ref<Need | null>;
    confirmAgain(): void;
    load(): Promise<void>;
    /** Die Commits der früheren Releases, sobald sie aufgeklappt wurden; `"laedt"` dazwischen, `null` bei einem Fehler. */
    frueher: Ref<Record<string, ReleaseVoll | "laedt" | null>>;
    aufklappen(stamm: string): Promise<void>;
}

export function createVersionen(deps: VersionenDeps = {}): Versionen {
    const liste = shallowRef<VersionenListe | null>(null);
    const loading = ref(false);
    const loadProblems = ref<Phrase[]>([]);
    const unconfirmed = ref<Need | null>(null);
    const frueher = ref<Record<string, ReleaseVoll | "laedt" | null>>({});
    const reads = deps.reads ?? createReadConfirmation(requestConfirmation);
    reads.onOffer(() => (unconfirmed.value === null ? undefined : load()));

    async function load(): Promise<void> {
        loading.value = true;
        try {
            liste.value = await withConfirmation(() => getJson<VersionenListe>(VERSIONEN_URL, deps.fetcher), reads.ask);
            loadProblems.value = [];
            unconfirmed.value = null;
        } catch (error) {
            loadProblems.value = formProblems(error);
            unconfirmed.value = neededConfirmation(error);
        } finally {
            loading.value = false;
        }
    }

    async function aufklappen(stamm: string): Promise<void> {
        const da = frueher.value[stamm];
        if (da !== undefined && da !== null) return;
        frueher.value = { ...frueher.value, [stamm]: "laedt" };
        try {
            const release = await getJson<ReleaseVoll>(`${VERSIONEN_URL}/${encodeURIComponent(stamm)}`, deps.fetcher);
            frueher.value = { ...frueher.value, [stamm]: release };
        } catch {
            frueher.value = { ...frueher.value, [stamm]: null };
        }
    }

    return { liste, loading, loadProblems, unconfirmed, confirmAgain: () => reads.offer(), load, frueher, aufklappen };
}

/** Der Wert in der Schiene: die ersten acht Zeichen des laufenden Release. */
export const schienenWert = (liste: VersionenListe | null): string | undefined => liste?.laufend?.bis.slice(0, 8);
