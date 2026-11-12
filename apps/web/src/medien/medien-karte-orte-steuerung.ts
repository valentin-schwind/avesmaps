import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { MamKarteDetail, MamKarteOrteBody, OperationReceipt, SearchHit } from "@avesmaps3d/shared";
import { createTextSuche } from "../fenster/text-suche";
import { fetchSearch } from "../search/search-client";
import {
    hinweisText,
    ortZeilen,
    schonAngehaengt,
    trefferAusSuche,
    type OrtTreffer,
    type OrteHinweis,
} from "./medien-karte-orte-modell";
import { Handlung, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Die Orte und Regionen EINES Eintrags der Kartensammlung (WI-0287 Stufe 3) mit Suche, Schreiben, Fehlern und Hinweis, ohne Bauteil. **Sofort speichern**, kein Speichern-Knopf (wie die
 * Publikationen, `medien-karte-publikationen-steuerung.ts`): Jede Wahl und jedes Lösen ist EINE Operation (`citymap.places`), danach liest der Inspector den Eintrag neu (`geaendert`).
 *
 * - **Die Suche** ist die der Karte (`fetchSearch`), Orte und Regionen in einer Liste (`medien-karte-orte-modell.ts`). Sie ist offen zum Anhängen (`anhaengen`) oder, für eine nicht aufgelöste
 *   Zeile, vorbelegt mit deren Rohnamen (`zuordnen`); die Wahl ersetzt dann die Zeile.
 * - **Schreiben läuft nacheinander**; der gesehene Stand ist die Revision des Eintrags, die zuletzt bekannt war (gelesen oder aus der letzten Quittung), damit eine zweite Handlung nicht am
 *   eigenen ersten Schreiben scheitert.
 * - **Fehler** stehen unter der Liste, mit dem Satz der Medienverwaltung (`operationsFehler`); bei 409 `edit_conflict` liest der Inspector neu.
 */

export type OrtSuche = (text: string, signal: AbortSignal) => Promise<readonly SearchHit[]>;

export interface OrteOptionen {
    suche?: OrtSuche | undefined;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number | undefined;
}

/** Wie die Suche gerade offen ist: zum Anhängen oder zum Zuordnen einer Zeile (deren Stelle). */
export type OrteSucheModus =
    { readonly art: "anhaengen" } | { readonly art: "zuordnen"; readonly index: number; readonly rohname: string };

export interface OrteSteuerung {
    readonly modus: Readonly<ShallowRef<OrteSucheModus | undefined>>;
    readonly text: Ref<string>;
    readonly laedt: Readonly<Ref<boolean>>;
    /** Die Treffer der Suche, wählbar; schon angehängte stehen gesperrt. */
    readonly treffer: Readonly<ShallowRef<readonly OrtTreffer[]>>;
    readonly schreibt: Readonly<Ref<boolean>>;
    readonly fehler: Readonly<Ref<string | undefined>>;
    readonly hinweis: Readonly<Ref<string | undefined>>;
    /** „✚ Ort oder Region“: die Suche zum Anhängen öffnen oder, ist sie so offen, schließen. */
    schalteAnhaengen(): void;
    /** „⌕ Zuordnen“ an einer nicht aufgelösten Zeile: die Suche mit deren Namen öffnen. */
    ordneZuOeffnen(index: number): void;
    schliesse(): void;
    waehle(treffer: OrtTreffer): Promise<void>;
    loese(index: number): Promise<void>;
}

const ENTPRELL_VORGABE = 250;

const standardSuche: OrtSuche = async (text, signal) => (await fetchSearch(text, signal)).hits;

export function createOrteSteuerung(
    karte: () => MamKarteDetail | undefined,
    operationen: Pick<MedienOperationen, "karteOrte">,
    geaendert: () => void,
    optionen: OrteOptionen = {},
): OrteSteuerung {
    const modus = shallowRef<OrteSucheModus | undefined>(undefined);
    const schreibt = ref(false);
    const fehler = ref<string | undefined>(undefined);
    const hinweis = ref<string | undefined>(undefined);
    const suche = createTextSuche<SearchHit>(optionen.suche ?? standardSuche, optionen.entprellMs ?? ENTPRELL_VORGABE);
    const treffer = shallowRef<readonly OrtTreffer[]>([]);

    /** Die Revision aus der letzten Quittung; zählt, solange der neu gelesene Eintrag sie noch nicht trägt. */
    let bekannt = 0;
    let kette: Promise<unknown> = Promise.resolve();
    let entsorgt = false;

    // Die Treffer folgen der Suche und dem Stand des Eintrags (was schon hängt, steht gesperrt).
    watch(
        [suche.treffer, () => karte()?.places],
        () => {
            treffer.value = trefferAusSuche(suche.treffer.value, schonAngehaengt(karte()?.places ?? []));
        },
        { immediate: true },
    );
    // Ein anderer Eintrag beginnt von vorn.
    watch(
        () => karte()?.id,
        () => {
            bekannt = 0;
            fehler.value = undefined;
            hinweis.value = undefined;
            modus.value = undefined;
            suche.leere();
        },
    );
    onScopeDispose(() => {
        entsorgt = true;
    });

    /** Das Schreiben EINER Handlung; gibt zurück, ob der Server sie angenommen hat. */
    async function fuehreAus(koerper: Omit<MamKarteOrteBody, "operationId" | "baseRevision">): Promise<boolean> {
        const eintrag = karte();
        try {
            if (entsorgt || eintrag === undefined) return false;
            const handlung = new Handlung();
            const quittung: OperationReceipt = await handlung.fuehreAus((operationId) =>
                operationen.karteOrte(eintrag.id, {
                    operationId,
                    baseRevision: Math.max(eintrag.revision, bekannt),
                    ...koerper,
                }),
            );
            if (karte()?.id !== eintrag.id) return true;
            const revision = quittung.affected.find((e) => e.kind === "citymap" && e.id === eintrag.id)?.revision;
            if (revision !== undefined) bekannt = Math.max(bekannt, revision);
            geaendert();
            return true;
        } catch (error) {
            if (entsorgt || karte()?.id !== eintrag?.id) return false;
            const grund = operationsFehler(error);
            fehler.value = grund.text;
            // Jemand war schneller: Der Inspector liest neu.
            if (grund.konflikt !== undefined) geaendert();
            return false;
        } finally {
            schreibt.value = false;
        }
    }

    function schreibe(
        koerper: Omit<MamKarteOrteBody, "operationId" | "baseRevision">,
        meldung: OrteHinweis,
    ): Promise<boolean> {
        if (entsorgt || karte() === undefined) return Promise.resolve(false);
        schreibt.value = true;
        fehler.value = undefined;
        hinweis.value = undefined;
        const lauf = kette.then(() => fuehreAus(koerper));
        kette = lauf.catch(() => undefined);
        return lauf.then((ging) => {
            if (ging && !entsorgt) hinweis.value = hinweisText(meldung);
            return ging;
        });
    }

    return {
        modus,
        text: suche.text,
        laedt: suche.laedt,
        treffer,
        schreibt,
        fehler,
        hinweis,
        schalteAnhaengen() {
            if (modus.value?.art === "anhaengen") {
                modus.value = undefined;
                suche.leere();
            } else {
                modus.value = { art: "anhaengen" };
                suche.leere();
            }
        },
        ordneZuOeffnen(index) {
            const zeile = ortZeilen(karte()?.places ?? [])[index];
            if (zeile === undefined) return;
            modus.value = { art: "zuordnen", index, rohname: zeile.rohname };
            suche.text.value = zeile.rohname;
        },
        schliesse() {
            modus.value = undefined;
            suche.leere();
        },
        async waehle(ziel) {
            const jetzt = modus.value;
            if (jetzt === undefined || ziel.schon) return;
            const ging = await schreibe(
                jetzt.art === "zuordnen"
                    ? { action: "resolve", index: jetzt.index, target: { kind: ziel.kind, id: ziel.id } }
                    : { action: "add", target: { kind: ziel.kind, id: ziel.id } },
                { art: "gespeichert", name: ziel.name, kind: ziel.kind },
            );
            if (ging) {
                modus.value = undefined;
                suche.leere();
            }
        },
        async loese(index) {
            const zeile = ortZeilen(karte()?.places ?? [])[index];
            if (zeile === undefined) return;
            await schreibe(
                { action: "remove", index },
                zeile.aufgeloest ? { art: "geloest", name: zeile.name } : { art: "geloestOffen", name: zeile.rohname },
            );
        },
    };
}
