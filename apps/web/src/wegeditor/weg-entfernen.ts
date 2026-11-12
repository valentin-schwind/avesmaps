import { shallowRef, type ShallowRef } from "vue";
import {
    PATH_SAMMEL_MAX,
    type EditorPathDetail,
    type OperationReceipt,
    type PathRemovalBody,
    type PathSammelRemovalBody,
    type PathStreetRemovalBody,
} from "@avesmaps3d/shared";
import type { ApiFehler } from "../ortseditor/ort-bearbeitung";

/**
 * „Weg entfernen …“ (WI-0177 Stufe 3; EDIT-0003 G10, T22 Fassung 4, F12, T43): EIN Blatt mit den zwei Stufen aller Editoren, „Von der
 * Karte nehmen“ (Stufe 3b, `path.take_off_map`; der Weg steht danach im Wege-Fenster unter „Nicht auf der Karte“) und „Ganz löschen“
 * (weich, `path.delete`; Wiki und Quellen bleiben am Weg, ↺ holt ihn zurück). Es gilt dem Abschnitt, an dem es geöffnet wurde: unter
 * dem Rechtsklick oder vom zweiten Klick markiert (T24 (1)); der Umfang „ganze Straße“ ist noch offen.
 *
 * Die Steuerung des Blatts: wer gebeten hat (`bitte`), den Weg lesen, die Wahl, „Los“ als EINE Operation, die Meldung danach. Dazu das
 * Gegenstück „Zurück auf die Karte“ (`zurueck`, `path.put_on_map`), das das Wege-Fenster je Abschnitt anbietet.
 *
 * **Ganze Straße** (EDIT-0003 T49, „Weg entfernen › Ganze Straße (n Abschnitte) …“): dasselbe Blatt für alle Abschnitte (`bitteStrasse`),
 * „Los“ ist EINE Operation über alle, jeder gegen seine Revision (alle oder keiner).
 *
 * **Mehrfachauswahl** (WI-0252; Betreiber 2026-10-25: „entfernen -> ganz löschen geht noch nicht mit mehrfachauswahl“): dasselbe Blatt für
 * alle gewählten Wege (`bitteAuswahl`); die Abschnitte aller Wege liest der Aufrufer frisch (Revisionen), das Blatt nennt die Zahl der
 * Wege, und „Los“ ist EINE Operation über alle (`loescheAuswahl`, `nimmAuswahlAb`).
 */

export type WegEntfernenWahl = "abnehmen" | "loeschen";

export type EntfernenAntwort =
    { ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler };

export interface WegEntfernenDaten {
    weg(publicId: string, signal: AbortSignal): Promise<EditorPathDetail | null>;
    loesche(publicId: string, body: PathRemovalBody): Promise<EntfernenAntwort>;
    nimmAb(publicId: string, body: PathRemovalBody): Promise<EntfernenAntwort>;
    legeZurueck(publicId: string, body: PathRemovalBody): Promise<EntfernenAntwort>;
    loescheStrasse(publicId: string, body: PathStreetRemovalBody): Promise<EntfernenAntwort>;
    nimmStrasseAb(publicId: string, body: PathStreetRemovalBody): Promise<EntfernenAntwort>;
    loescheAuswahl(body: PathSammelRemovalBody): Promise<EntfernenAntwort>;
    nimmAuswahlAb(body: PathSammelRemovalBody): Promise<EntfernenAntwort>;
}

/** Ein Abschnitt der ganzen Straße mit der Revision, gegen die geschrieben wird. */
export interface StrassenAbschnitt {
    readonly publicId: string;
    readonly revision: number;
}

/** Die Mehrfachauswahl für das Blatt: wie viele Wege, mit allen ihren Abschnitten und deren Revisionen. */
export interface WegEntfernenAuswahl {
    readonly wege: number;
    readonly abschnitte: readonly StrassenAbschnitt[];
}

export interface WegEntfernenStand {
    /** Der Abschnitt, an dem das Blatt geöffnet wurde; bei der Mehrfachauswahl der erste ihrer Abschnitte (leer, solange sie liest). */
    readonly publicId: string;
    readonly phase: "laedt" | "bereit" | "laeuft" | "ladefehler";
    readonly weg: EditorPathDetail | undefined;
    readonly wahl: WegEntfernenWahl | undefined;
    /** Der Satz des Servers, wenn „Los“ abgelehnt wurde. */
    readonly satz: string | undefined;
    /** Die ganze Straße: alle ihre Abschnitte; fehlt beim einzelnen Abschnitt. */
    readonly strasse?: readonly StrassenAbschnitt[] | undefined;
    /** Die Mehrfachauswahl: alle gewählten Wege; fehlt sonst. */
    readonly auswahl?: WegEntfernenAuswahl | undefined;
}

export interface WegEntfernen {
    readonly stand: Readonly<ShallowRef<WegEntfernenStand | undefined>>;
    /** Das Blatt für diesen Abschnitt öffnen. */
    bitte(publicId: string): Promise<void>;
    /** Das Blatt für die ganze Straße öffnen (alle Abschnitte in ihrer Folge). */
    bitteStrasse(abschnitte: readonly StrassenAbschnitt[]): Promise<void>;
    /**
     * Das Blatt für die Mehrfachauswahl öffnen (WI-0252): `lies` liefert die Abschnitte aller gewählten Wege mit frischen Revisionen,
     * `undefined`, wenn sie sich nicht lesen ließen. Das Blatt steht so lange auf „Lädt …“.
     */
    bitteAuswahl(lies: () => Promise<WegEntfernenAuswahl | undefined>): Promise<void>;
    waehle(wahl: WegEntfernenWahl): void;
    /**
     * Die Wahl schreiben; gibt Quittung und Wahl zurück, wenn es ging (dann ist das Blatt zu). `wege` nennt bei der Mehrfachauswahl die
     * Zahl der Wege.
     */
    los(): Promise<{ quittung: OperationReceipt; wahl: WegEntfernenWahl; wege?: number } | undefined>;
    schliesse(): void;
    /** „Zurück auf die Karte“ für einen genommenen Abschnitt, gegen seine Revision. */
    zurueck(publicId: string, revision: number): Promise<EntfernenAntwort>;
}

/**
 * Was „Weg entfernen …“ im Wege-Fenster öffnet (OPS-000085): ein gewählter Abschnitt (oder der einzige des Wegs) öffnet das Blatt für
 * ihn, (W) der ganze Weg das Blatt der ganzen Straße. Ein Teil von mehreren Abschnitten geht nicht: Der Server nimmt nur einzelne
 * Abschnitte oder genau die ganze Straße (`setStreetState`), das Fenster sagt es.
 */
export type EntfernenZiel =
    | { readonly art: "abschnitt"; readonly publicId: string }
    | { readonly art: "strasse"; readonly abschnitte: readonly StrassenAbschnitt[] }
    | { readonly art: "mehrere" };

export function entfernenZiel(
    abschnitte: readonly { readonly id: string; readonly revision: number }[],
    wahl: ReadonlySet<string> | null,
): EntfernenZiel | undefined {
    const erster = abschnitte[0];
    if (erster === undefined) return undefined;
    if (abschnitte.length === 1) return { art: "abschnitt", publicId: erster.id };
    if (wahl === null || wahl.size === abschnitte.length)
        return { art: "strasse", abschnitte: abschnitte.map((a) => ({ publicId: a.id, revision: a.revision })) };
    const gewaehlt = abschnitte.filter((a) => wahl.has(a.id));
    const einer = gewaehlt[0];
    return gewaehlt.length === 1 && einer !== undefined ? { art: "abschnitt", publicId: einer.id } : { art: "mehrere" };
}

/** Hat die Auswahl mehr Abschnitte, als EINE Operation nimmt (`PATH_SAMMEL_MAX`)? Dann geht „Los“ nicht, und das Blatt sagt es. */
export const zuViele = (auswahl: WegEntfernenAuswahl): boolean => auswahl.abschnitte.length > PATH_SAMMEL_MAX;

/** Welche Wahl gerade gehen. */
export const WEG_ENTFERNEN_GEHT: Readonly<Record<WegEntfernenWahl, boolean>> = { abnehmen: true, loeschen: true };

export function createWegEntfernen(
    daten: WegEntfernenDaten,
    neueKennung = (): string => crypto.randomUUID(),
): WegEntfernen {
    const stand = shallowRef<WegEntfernenStand | undefined>(undefined);
    let lesen: AbortController | undefined;
    const setze = (teil: Partial<WegEntfernenStand>): void => {
        if (stand.value !== undefined) stand.value = { ...stand.value, ...teil };
    };
    return {
        stand,
        async bitte(publicId) {
            lesen?.abort();
            const eigene = new AbortController();
            lesen = eigene;
            stand.value = { publicId, phase: "laedt", weg: undefined, wahl: undefined, satz: undefined };
            const weg = await daten.weg(publicId, eigene.signal).catch(() => null);
            if (lesen !== eigene) return;
            lesen = undefined;
            setze(weg === null || !weg.active ? { phase: "ladefehler" } : { phase: "bereit", weg });
        },
        async bitteStrasse(abschnitte) {
            const erster = abschnitte[0];
            if (erster === undefined) return;
            await this.bitte(erster.publicId);
            setze({ strasse: abschnitte });
        },
        async bitteAuswahl(lies) {
            lesen?.abort();
            const eigene = new AbortController();
            lesen = eigene;
            stand.value = { publicId: "", phase: "laedt", weg: undefined, wahl: undefined, satz: undefined };
            const auswahl = await lies().catch(() => undefined);
            if (lesen !== eigene) return;
            lesen = undefined;
            const erster = auswahl?.abschnitte[0];
            setze(
                auswahl === undefined || erster === undefined
                    ? { phase: "ladefehler" }
                    : { phase: "bereit", publicId: erster.publicId, auswahl },
            );
        },
        waehle(wahl) {
            if (stand.value?.phase !== "bereit" || !WEG_ENTFERNEN_GEHT[wahl]) return;
            setze({ wahl, satz: undefined });
        },
        async los() {
            const jetzt = stand.value;
            if (jetzt?.phase !== "bereit" || jetzt.wahl === undefined) return undefined;
            const wahl = jetzt.wahl;
            const auswahl = jetzt.auswahl;
            const strasse = jetzt.strasse;
            const revision = jetzt.weg?.revision;
            if (auswahl === undefined && revision === undefined) return undefined;
            // Mehr Abschnitte nimmt der Server nicht auf einmal (400 „falsch geformt“): Das Blatt sagt es vorher und lässt „Los“ grau.
            if (auswahl !== undefined && zuViele(auswahl)) return undefined;
            setze({ phase: "laeuft", satz: undefined });
            const operationId = neueKennung();
            const abschnitte = (teile: readonly StrassenAbschnitt[]) =>
                teile.map((teil) => ({ publicId: teil.publicId, baseRevision: teil.revision }));
            const antwort = await (auswahl !== undefined
                ? (wahl === "loeschen" ? daten.loescheAuswahl : daten.nimmAuswahlAb)({
                      operationId,
                      sections: abschnitte(auswahl.abschnitte),
                  })
                : strasse !== undefined
                  ? (wahl === "loeschen" ? daten.loescheStrasse : daten.nimmStrasseAb)(jetzt.publicId, {
                        operationId,
                        sections: abschnitte(strasse),
                    })
                  : (wahl === "loeschen" ? daten.loesche : daten.nimmAb)(jetzt.publicId, {
                        operationId,
                        baseRevision: revision!,
                    }));
            if (stand.value?.publicId !== jetzt.publicId) return undefined;
            if (antwort.ok) {
                stand.value = undefined;
                return { quittung: antwort.quittung, wahl, ...(auswahl !== undefined ? { wege: auswahl.wege } : {}) };
            }
            setze({ phase: "bereit", satz: antwort.fehler.message });
            return undefined;
        },
        schliesse() {
            lesen?.abort();
            lesen = undefined;
            stand.value = undefined;
        },
        zurueck: (publicId, revision) =>
            daten.legeZurueck(publicId, { operationId: neueKennung(), baseRevision: revision }),
    };
}
