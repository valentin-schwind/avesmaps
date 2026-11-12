import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type {
    InhalteQuellenZeile,
    KarteQuellenOp,
    MamKarteDetail,
    MamKartePublikation,
    OperationReceipt,
} from "@avesmaps3d/shared";
import { createTextSuche } from "../fenster/text-suche";
import { createInhalteClient } from "../inhalte/inhalte-client";
import { Handlung, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Die Publikationen EINES Eintrags der Kartensammlung (WI-0287 Stufe 1, Punkt 4) mit Schreiben, Fehlern und Sperre, ohne Bauteil; die Oberfläche ist die Quellen-Klappbox der Karteneditoren
 * (`quellen-klappbox.vue` mit `publikationen`). Betreiber 2026-10-28: **sofort speichern**, kein Speichern-Knopf.
 *
 * - **Jede Handlung ist EIN Schreiben** (`citymap.sources`): Anhängen (Treffer wählen), die Fundstelle beim Verlassen des Felds oder mit Enter (nur, wo sich der Wert geändert hat), Lösen,
 *   Wiederherstellen, „↑ Zuerst zeigen“. Schreiben läuft nacheinander; der gesehene Stand ist die Revision des Eintrags, die zuletzt bekannt war (gelesen oder aus der letzten Quittung), damit
 *   eine zweite Handlung nicht am eigenen ersten Schreiben scheitert. Danach liest der Inspector den Eintrag neu (`geaendert`).
 * - **Sperre:** Während eine Zeile schreibt, sind ihre Knöpfe gesperrt (`schreibend`); das Feld bleibt bedienbar.
 * - **Fehler** stehen an der Zeile (beim Anhängen am Anhängen), mit dem Satz der Medienverwaltung (`operationsFehler`); bei 409 `edit_conflict` liest der Inspector neu, die Eingabe bleibt.
 * - **Die Eingabe der Fundstelle** überlagert den gespeicherten Wert, bis der neu gelesene Eintrag denselben Wert trägt: kein Springen zwischen Speichern und Neulesen.
 */

/** Die Suche im Quellenverzeichnis (mit Umschlagbild je Treffer). */
export type PublikationsSuche = (text: string, signal: AbortSignal) => Promise<readonly InhalteQuellenZeile[]>;

export interface PublikationenOptionen {
    suche?: PublikationsSuche | undefined;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number | undefined;
}

export interface PublikationenSteuerung {
    /** Die getippte Fundstelle je Quelle, solange sie nicht gespeichert und neu gelesen ist. */
    readonly eingaben: Readonly<ShallowRef<ReadonlyMap<string, string>>>;
    readonly schreibend: Readonly<ShallowRef<ReadonlySet<string>>>;
    readonly fehler: Readonly<ShallowRef<ReadonlyMap<string, string>>>;
    readonly anhaengenLaeuft: Readonly<Ref<boolean>>;
    readonly anhaengenFehler: Readonly<Ref<string | undefined>>;
    /** Eben gelöst: der Satz, dass „Gelöste anzeigen“ sie zurückholt (bis zur nächsten Handlung). */
    readonly geloest: Readonly<Ref<boolean>>;
    readonly quelleText: Ref<string>;
    readonly quelleTreffer: ShallowRef<readonly InhalteQuellenZeile[]>;
    readonly quelleLaedt: Ref<boolean>;
    seiten(sourceId: string, wert: string): void;
    feldSchluss(): Promise<void>;
    /** Anhängen; gibt die Kennung zurück, wenn es ging (die Zeile klappt dann auf). */
    haengeAn(quelle: Pick<InhalteQuellenZeile, "id">): Promise<string | undefined>;
    loese(sourceId: string): Promise<void>;
    stelleHer(sourceId: string): Promise<void>;
    zuerst(sourceId: string): Promise<void>;
}

const ENTPRELL_VORGABE = 250;

/** Leer ist keine Fundstelle (wie am Server). */
const fundstelle = (wert: string | null | undefined): string => (wert ?? "").trim();

const standardSuche = (): PublikationsSuche => {
    const client = createInhalteClient();
    return async (text, signal) =>
        (await client.liste({ q: text, limit: 8, sort: "title", stand: "aktiv", umschlag: true }, signal)).items;
};

export function createPublikationenSteuerung(
    karte: () => MamKarteDetail | undefined,
    operationen: Pick<MedienOperationen, "karteQuellen">,
    geaendert: () => void,
    optionen: PublikationenOptionen = {},
): PublikationenSteuerung {
    const eingaben = shallowRef<ReadonlyMap<string, string>>(new Map());
    const schreibend = shallowRef<ReadonlySet<string>>(new Set());
    const fehler = shallowRef<ReadonlyMap<string, string>>(new Map());
    const anhaengenLaeuft = ref(false);
    const anhaengenFehler = ref<string | undefined>(undefined);
    const geloest = ref(false);
    const suche = createTextSuche<InhalteQuellenZeile>(
        optionen.suche ?? standardSuche(),
        optionen.entprellMs ?? ENTPRELL_VORGABE,
    );

    /** Die Revision aus der letzten Quittung; zählt, solange der neu gelesene Eintrag sie noch nicht trägt. */
    let bekannt = 0;
    let kette: Promise<unknown> = Promise.resolve();
    let entsorgt = false;
    const zaehler = new Map<string, number>();
    /** Fundstellen, die gerade geschrieben werden: dieselbe zweimal (Enter, dann Verlassen) schreibt nur einmal. */
    const imFlug = new Map<string, string>();

    const publikationen = (): readonly MamKartePublikation[] => karte()?.publications ?? [];
    function setzeSchreibend(sourceId: string, an: boolean): void {
        const jetzt = (zaehler.get(sourceId) ?? 0) + (an ? 1 : -1);
        if (jetzt > 0) zaehler.set(sourceId, jetzt);
        else zaehler.delete(sourceId);
        schreibend.value = new Set(zaehler.keys());
    }
    function setzeFehler(sourceId: string, satz: string | undefined): void {
        const neu = new Map(fehler.value);
        if (satz === undefined) neu.delete(sourceId);
        else neu.set(sourceId, satz);
        fehler.value = neu;
    }
    function setzeEingabe(sourceId: string, wert: string | undefined): void {
        const neu = new Map(eingaben.value);
        if (wert === undefined) neu.delete(sourceId);
        else neu.set(sourceId, wert);
        eingaben.value = neu;
    }

    // Ein anderer Eintrag beginnt von vorn; der neu gelesene löst die Eingaben ein, die er schon trägt.
    watch(
        () => karte()?.id,
        () => {
            bekannt = 0;
            eingaben.value = new Map();
            fehler.value = new Map();
            zaehler.clear();
            imFlug.clear();
            schreibend.value = new Set();
            anhaengenFehler.value = undefined;
            geloest.value = false;
            suche.leere();
        },
    );
    watch(
        () => karte()?.publications,
        (jetzt) => {
            if (eingaben.value.size === 0) return;
            const neu = new Map(eingaben.value);
            for (const [sourceId, wert] of eingaben.value) {
                const gespeichert = jetzt?.find((p) => p.sourceId === sourceId);
                if (gespeichert === undefined || fundstelle(gespeichert.pages) === fundstelle(wert))
                    neu.delete(sourceId);
            }
            if (neu.size !== eingaben.value.size) eingaben.value = neu;
        },
    );
    onScopeDispose(() => {
        entsorgt = true;
    });

    /** Das Schreiben EINER Handlung; `true`, wenn der Server sie angenommen hat. */
    async function fuehreAus(sourceId: string, op: KarteQuellenOp, pages?: string): Promise<boolean> {
        const eintrag = karte();
        const anhaengen = op === "add";
        try {
            if (entsorgt || eintrag === undefined) return false;
            const handlung = new Handlung();
            const quittung: OperationReceipt = await handlung.fuehreAus((operationId) =>
                operationen.karteQuellen(eintrag.id, {
                    operationId,
                    baseRevision: Math.max(eintrag.revision, bekannt),
                    op,
                    sourceId,
                    ...(pages === undefined ? {} : { pages }),
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
            if (anhaengen) anhaengenFehler.value = grund.text;
            else setzeFehler(sourceId, grund.text);
            // Jemand war schneller: Der Inspector liest neu, die Eingabe bleibt stehen.
            if (grund.konflikt !== undefined) geaendert();
            return false;
        } finally {
            if (pages !== undefined && op === "pages") imFlug.delete(sourceId);
            setzeSchreibend(sourceId, false);
            if (anhaengen) anhaengenLaeuft.value = false;
        }
    }

    function schreibe(sourceId: string, op: KarteQuellenOp, pages?: string): Promise<boolean> {
        if (entsorgt || karte() === undefined) return Promise.resolve(false);
        geloest.value = false;
        if (op === "pages" && pages !== undefined) imFlug.set(sourceId, pages);
        setzeSchreibend(sourceId, true);
        if (op === "add") {
            anhaengenLaeuft.value = true;
            anhaengenFehler.value = undefined;
        } else {
            setzeFehler(sourceId, undefined);
        }
        const lauf = kette.then(() => fuehreAus(sourceId, op, pages));
        kette = lauf.catch(() => undefined);
        return lauf;
    }

    return {
        eingaben,
        schreibend,
        fehler,
        anhaengenLaeuft,
        anhaengenFehler,
        geloest,
        quelleText: suche.text,
        quelleTreffer: suche.treffer,
        quelleLaedt: suche.laedt,
        seiten(sourceId, wert) {
            setzeEingabe(sourceId, wert);
        },
        async feldSchluss() {
            const laeufe: Promise<boolean>[] = [];
            for (const [sourceId, wert] of eingaben.value) {
                const gespeichert = publikationen().find((p) => p.sourceId === sourceId);
                if (gespeichert === undefined || gespeichert.state !== "active") {
                    setzeEingabe(sourceId, undefined);
                    continue;
                }
                if (imFlug.get(sourceId) === fundstelle(wert)) continue;
                if (fundstelle(wert) === fundstelle(gespeichert.pages)) setzeEingabe(sourceId, undefined);
                else laeufe.push(schreibe(sourceId, "pages", fundstelle(wert)));
            }
            await Promise.all(laeufe);
        },
        async haengeAn(quelle) {
            const ging = await schreibe(quelle.id, "add");
            if (!ging) return undefined;
            suche.leere();
            return quelle.id;
        },
        async loese(sourceId) {
            setzeEingabe(sourceId, undefined);
            if (await schreibe(sourceId, "remove")) geloest.value = true;
        },
        async stelleHer(sourceId) {
            await schreibe(sourceId, "restore");
        },
        async zuerst(sourceId) {
            await schreibe(sourceId, "first");
        },
    };
}
