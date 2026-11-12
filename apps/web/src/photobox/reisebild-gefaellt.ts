import { shallowRef, type ShallowRef } from "vue";
import {
    PHOTOBOX_URL,
    type PhotoboxGefaelltAntwort,
    type PhotoboxGefaelltBody,
    type ReisebildKarte,
} from "@avesmaps3d/shared";
import { postJson, type Fetcher } from "../auth/api";
import { besucherSatz } from "../community/besucher-ablehnung";
import { t } from "../i18n/i18n";
import { createGemocht, type Gemocht } from "../info-panel/bewertungen-gemocht";
import type { Abbildung } from "../system/ablehnung";

/**
 * „Gefällt mir“ an einem Reisebild (WI-0304), genau wie bei den Bewertungen (WI-0269 C10): Der Server zählt nur eine Zahl und weiß nicht, wer es war (`POST /api/photobox/reisebilder/:id/gefaellt`,
 * `routes/photobox.ts`); „einmal je Browser“ merkt sich dieser Browser selbst (`bewertungen-gemocht.ts`, eigener Schlüssel). Ein zweiter Klick nimmt es zurück.
 *
 * - **Sofort sichtbar:** Der Klick ändert Stand und Zahl, bevor der Server antwortet; die Antwort setzt die Zahl des Servers. Scheitert der Aufruf, fallen Stand und Zahl zurück, und ein Satz sagt, warum
 *   (Drossel mit Uhrzeit, Bild nicht mehr da, sonst der allgemeine Satz).
 * - **Gesperrt während des Zählens:** Ein Bild zählt immer nur einen Aufruf zugleich (`beschaeftigt`), sonst überholten sich Antworten.
 * - **Die Zahl** kommt aus der Antwort der Karte (`ReisebildKarte.gefaellt`, fehlt sie, ist sie 0); was dieser Browser selbst zählte, geht darüber (`zahlen`), bis die Seite neu lädt.
 */

/** Der Schlüssel im Speicher des Browsers; getrennt von dem der Bewertungen, damit die Kennungen sich nie verwechseln. */
export const REISEBILD_GEMOCHT_SCHLUESSEL = "avesmaps.reisebilder.gefaellt";

export const sendeReisebildGefaellt = (
    id: string,
    delta: 1 | -1,
    fetcher?: Fetcher,
): Promise<PhotoboxGefaelltAntwort> =>
    postJson<PhotoboxGefaelltAntwort>(
        `${PHOTOBOX_URL}/reisebilder/${encodeURIComponent(id)}/gefaellt`,
        { delta } satisfies PhotoboxGefaelltBody,
        fetcher,
    );

/** Das Bild gibt es nicht mehr (404, Fachcode `reisebild_unbekannt`). */
export const REISEBILD_GEFAELLT_ABLEHNUNG: Abbildung = {
    gruende: { reisebild_unbekannt: () => t("photobox.karte.gefaelltFehlt") },
};

/** Der Satz zu einem gescheiterten Aufruf. */
export const reisebildGefaelltSatz = (fehler: unknown): string =>
    besucherSatz(fehler, REISEBILD_GEFAELLT_ABLEHNUNG, {
        zuViele: "photobox.karte.gefaelltZuViele",
        rueckfall: () => t("photobox.karte.gefaelltFehler"),
    });

export interface ReisebildGefaelltOptionen {
    readonly gemocht?: Gemocht;
    readonly senden?: (id: string, delta: 1 | -1) => Promise<PhotoboxGefaelltAntwort>;
    readonly satz?: (fehler: unknown) => string;
}

export interface ReisebildGefaellt {
    readonly gemocht: Gemocht;
    /** Die Zahl, die das Bild zeigt. */
    zahl(bild: Pick<ReisebildKarte, "id" | "gefaellt">): number;
    /** Zählt für dieses Bild gerade ein Aufruf? Dann ist der Knopf gesperrt. */
    zaehlt(id: string): boolean;
    /** Der Satz zum letzten gescheiterten Aufruf an diesem Bild, sonst `undefined`. */
    problem(id: string): string | undefined;
    /** Setzen oder zurücknehmen; ein Aufruf in Arbeit oder ein unbekanntes Bild bleibt wirkungslos. */
    umschalten(bild: Pick<ReisebildKarte, "id" | "gefaellt">): Promise<void>;
}

export function createReisebildGefaellt(optionen: ReisebildGefaelltOptionen = {}): ReisebildGefaellt {
    const gemocht = optionen.gemocht ?? createGemocht(undefined, REISEBILD_GEMOCHT_SCHLUESSEL);
    const senden = optionen.senden ?? ((id, delta) => sendeReisebildGefaellt(id, delta));
    const satz = optionen.satz ?? reisebildGefaelltSatz;
    const zahlen: ShallowRef<ReadonlyMap<string, number>> = shallowRef(new Map());
    const beschaeftigt: ShallowRef<ReadonlySet<string>> = shallowRef(new Set());
    const probleme: ShallowRef<ReadonlyMap<string, string>> = shallowRef(new Map());

    const zahl = (bild: Pick<ReisebildKarte, "id" | "gefaellt">): number =>
        zahlen.value.get(bild.id) ?? bild.gefaellt ?? 0;
    const setzeZahl = (id: string, wert: number): void => {
        zahlen.value = new Map(zahlen.value).set(id, Math.max(0, wert));
    };
    const setzeProblem = (id: string, text: string | undefined): void => {
        const neu = new Map(probleme.value);
        if (text === undefined) neu.delete(id);
        else neu.set(id, text);
        probleme.value = neu;
    };
    const setzeBeschaeftigt = (id: string, an: boolean): void => {
        const neu = new Set(beschaeftigt.value);
        if (an) neu.add(id);
        else neu.delete(id);
        beschaeftigt.value = neu;
    };

    return {
        gemocht,
        zahl,
        zaehlt: (id) => beschaeftigt.value.has(id),
        problem: (id) => probleme.value.get(id),
        async umschalten(bild) {
            const id = bild.id;
            if (beschaeftigt.value.has(id)) return;
            const vorher = zahl(bild);
            setzeProblem(id, undefined);
            const jetzt = gemocht.umschalten(id);
            setzeZahl(id, vorher + (jetzt ? 1 : -1));
            setzeBeschaeftigt(id, true);
            try {
                setzeZahl(id, (await senden(id, jetzt ? 1 : -1)).gefaellt);
            } catch (fehler) {
                // Der Server hat es nicht gezählt: Stand und Zahl fallen zurück, und ein Satz sagt, warum.
                gemocht.umschalten(id);
                setzeZahl(id, vorher);
                setzeProblem(id, satz(fehler));
            } finally {
                setzeBeschaeftigt(id, false);
            }
        },
    };
}

/** Das eine „Gefällt mir“ der Reisebilder auf dieser Seite. */
export const reisebildGefaellt: ReisebildGefaellt = createReisebildGefaellt();
