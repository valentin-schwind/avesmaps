import { shallowRef, watch, type ShallowRef } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { EigenerAuftrag, KopfStand } from "../warteschlange/eigene-auftraege";
import { beziehe, type EigeneQuelle } from "../warteschlange/eigene-quelle";

/**
 * Was nach dem Speichern noch berechnet wird, als Band im Fuß des Fensters (WI-0223, EDIT-0003 G7: „der Editor zeigt „Gelände wird im
 * Umkreis neu gerechnet“ bis zum Abschluss“; Plan der Derographie, von der Editor-Orchestrierung 2026-10-19 angenommen). EINMAL im
 * Fensterrumpf (`bearbeitung.ts`, Fuß `entwurf-fuss.vue`), damit jeder Editor es zeigt, der über den Rumpf schreibt.
 *
 * - **Je Art eine Regel** (`REGELN`): welche Aufträge der Quittung (`derivedWork`) das Band abwartet, in ihrer Reihenfolge. Das
 *   Gelände wartet auf `terrain_local` und sein `dem_publish` (`gelaende-folgen.ts`); die Gebiete auf `territory_derive` (mehrere
 *   Speicherungen teilen sich denselben Auftrag, `map-operation.ts`).
 * - **Der Stand** kommt aus derselben Quelle wie die Warteschlange im Kopf (`warteschlange/eigene-quelle.ts`, WI-0230): gesammelt,
 *   wartet, läuft, fertig, fehlgeschlagen, `rest` in Sekunden. Das Band zeigt den ersten Auftrag der Kette, der noch nicht fertig ist;
 *   fertig ist es mit dem letzten, fehlgeschlagen mit irgendeinem. Fehlt ein Auftrag in der Liste (noch nicht abgerufen, Abruf
 *   gescheitert), bleibt sein letzter Stand, ohne Restzeit. Fertig und fehlgeschlagen bleiben im Fuß stehen, auch wenn der Kopf sie
 *   nach Sekunden oder nach dem Quittieren nicht mehr nennt.
 * - **Nur solange etwas offen ist** liest es die Quelle (`beziehe` und `abmelden`). Nach `HOECHSTENS_MS` endet ein Band still: Ein Band,
 *   das nie endet, wäre falsch. Es endet am Zustand des Auftrags, nicht an einem Ereignis: Eine Gebietsableitung ohne neue Eingabe
 *   endet `ueberholt` und meldet kein `map.changed`.
 */

export type FolgeArt = "gelaende" | "gebiete";

/** Ein Band: seine Art und der Auftrag, mit dessen Ende es endet (der letzte der Kette). */
export interface FolgeAuftrag {
    readonly art: FolgeArt;
    readonly auftrag: string;
}

export interface FolgeStand {
    readonly stand: KopfStand;
    /** Sekunden bis zum Ende des Sammelns, bis zum Start oder bis zum Ende, je nach Stand; ohne unbekannt. */
    readonly rest?: number;
}

type Arbeit = OperationReceipt["derivedWork"];

const kennungen = (arbeit: Arbeit, arten: readonly string[]): string[] =>
    arten.flatMap((art) => {
        const kennung = arbeit.find((x) => x.kind === art)?.jobId;
        return kennung === undefined ? [] : [kennung];
    });

/** Je Art: die Aufträge der Quittung, die das Band abwartet, in ihrer Reihenfolge; leer heißt kein Band. */
export const REGELN: readonly { readonly art: FolgeArt; kette(arbeit: Arbeit): string[] }[] = [
    {
        art: "gelaende",
        kette: (arbeit) =>
            arbeit.some((x) => x.kind === "terrain_local") ? kennungen(arbeit, ["terrain_local", "dem_publish"]) : [],
    },
    { art: "gebiete", kette: (arbeit) => kennungen(arbeit, ["territory_derive"]) },
];

/** So lange läuft ein Band höchstens (das Gelände sammelt bis zu 15 Minuten, die grobe Stufe rechnet 4 bis 5). */
export const HOECHSTENS_MS = 30 * 60_000;

export interface FolgeArbeit {
    /** Der Stand je Band (Kennung des letzten Auftrags der Kette). */
    readonly staende: Readonly<ShallowRef<ReadonlyMap<string, FolgeStand>>>;
    /** Nimmt die Quittung einer Operation; gibt das Band zurück, das der Fuß zeigt, oder nichts. */
    vormerke(quittung: Pick<OperationReceipt, "derivedWork">): FolgeAuftrag | undefined;
    stand(folge: FolgeAuftrag | undefined): FolgeStand | undefined;
}

export interface FolgeArbeitDeps {
    beziehe?: () => { quelle: Pick<EigeneQuelle, "liste">; abmelden(): void };
    now?: () => number;
}

interface Band {
    readonly kette: readonly string[];
    readonly seit: number;
}

const ENDE: ReadonlySet<KopfStand> = new Set(["fertig", "fehlgeschlagen"]);

export function createFolgeArbeit(deps: FolgeArbeitDeps = {}): FolgeArbeit {
    const bezieheQuelle = deps.beziehe ?? beziehe;
    const jetzt = deps.now ?? Date.now;
    const staende = shallowRef<ReadonlyMap<string, FolgeStand>>(new Map());
    const baender = new Map<string, Band>();
    /** Der zuletzt gesehene Stand je Auftrag der Ketten. */
    const zuletzt = new Map<string, KopfStand>();
    let lesen: { quelle: Pick<EigeneQuelle, "liste">; abmelden(): void; halt(): void } | undefined;

    function bandStand(kette: readonly string[], liste: ReadonlyMap<string, EigenerAuftrag>): FolgeStand {
        const je = kette.map((kennung) => liste.get(kennung)?.stand ?? { stand: zuletzt.get(kennung) ?? "wartet" });
        if (je.some((s) => s.stand === "fehlgeschlagen")) return { stand: "fehlgeschlagen" };
        return je.find((s) => s.stand !== "fertig") ?? { stand: "fertig" };
    }

    function aktualisiere(liste: readonly EigenerAuftrag[]): void {
        const nach = new Map(liste.map((eintrag) => [eintrag.auftrag.auftrag, eintrag]));
        for (const [kennung, eintrag] of nach) if (zuletzt.has(kennung)) zuletzt.set(kennung, eintrag.stand.stand);
        const neu = new Map(staende.value);
        for (const [auftrag, band] of baender) {
            if (jetzt() - band.seit > HOECHSTENS_MS) {
                neu.delete(auftrag);
                baender.delete(auftrag);
                continue;
            }
            const stand = bandStand(band.kette, nach);
            neu.set(auftrag, stand);
            if (ENDE.has(stand.stand)) baender.delete(auftrag);
        }
        for (const kennung of [...zuletzt.keys()])
            if (![...baender.values()].some((band) => band.kette.includes(kennung))) zuletzt.delete(kennung);
        staende.value = neu;
        if (baender.size === 0) halte();
    }

    function halte(): void {
        const jetztLesen = lesen;
        lesen = undefined;
        jetztLesen?.halt();
        jetztLesen?.abmelden();
    }

    function lies(): Pick<EigeneQuelle, "liste"> {
        if (lesen !== undefined) return lesen.quelle;
        const { quelle, abmelden } = bezieheQuelle();
        lesen = { quelle, abmelden, halt: watch(() => quelle.liste.value, aktualisiere) };
        return quelle;
    }

    function vormerke(quittung: Pick<OperationReceipt, "derivedWork">): FolgeAuftrag | undefined {
        for (const regel of REGELN) {
            const kette = regel.kette(quittung.derivedWork);
            const auftrag = kette.at(-1);
            if (auftrag === undefined) continue;
            for (const kennung of kette) if (!zuletzt.has(kennung)) zuletzt.set(kennung, "wartet");
            baender.set(auftrag, { kette, seit: baender.get(auftrag)?.seit ?? jetzt() });
            aktualisiere(lies().liste.value);
            return { art: regel.art, auftrag };
        }
        return undefined;
    }

    return {
        staende,
        vormerke,
        stand: (folge) => (folge === undefined ? undefined : staende.value.get(folge.auftrag)),
    };
}

/** Restzeit als „1:16“, nie negativ (wie die Warteschlange im Kopf). */
function uhrzeit(sekunden: number): string {
    const ganz = Math.max(0, Math.ceil(sekunden));
    return `${String(Math.floor(ganz / 60))}:${String(ganz % 60).padStart(2, "0")}`;
}

/** Der Satz des Bandes: „Gelände wird im Umkreis neu gerechnet · noch 1:16“, ohne Restzeit mit „…“; fertig und fehlgeschlagen ohne. */
export function folgeSatz(art: FolgeArt, { stand, rest }: FolgeStand): string {
    const satz = t(`entwurf.folge.${art}.${stand}`);
    if (stand === "fertig" || stand === "fehlgeschlagen") return satz;
    return rest === undefined ? `${satz} …` : `${satz} · ${t(`entwurf.folge.rest.${stand}`, { zeit: uhrzeit(rest) })}`;
}

/** Die eine Stelle der Seite: alle Fenster teilen sie. */
export const folgeArbeit = createFolgeArbeit();
