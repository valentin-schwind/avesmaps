import { ref, type Ref } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";
import type { ApiFehler, SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Speichern ohne Knopf (WI-0288 Stufe 3; Betreiber 2026-11-07: „Änderungen werden sofort gespeichert“): Der Wetter-Editor schreibt jede
 * Änderung selbst, entprellt, mit `baseRevision`. Diese Rechnung kennt weder Vue-Fenster noch Server; sie bekommt, wie sie sendet.
 *
 * - **Entprellt je Ziel** (ein Preset, ein Icon): Felder, die kurz hintereinander kommen (ein Regler, Tippen im Namen), sammeln sich und gehen
 *   `WARTE_MS` nach der letzten Änderung als EINE Anfrage. Ein anderes Ziel wartet für sich.
 * - **Eine Anfrage zur Zeit**, in der Folge der Handlungen: Die Revision liest erst die Anfrage, wenn sie dran ist, also nach der Quittung
 *   der vorigen. So trägt auch ein Tausch der Zeitpunkte (er hebt zwei Revisionen) nie eine veraltete.
 * - **Sofort** gehen Handlungen mit eigener Frage oder eigenem Ergebnis (Zeitpunkt, Anlegen, Entfernen): Was zu den Feldern noch wartet,
 *   geht vorher.
 * - **Konflikt** (409 `edit_conflict`): Was noch wartet, fällt weg, ebenso Anfragen, die schon in der Reihe stehen; der Aufrufer lädt neu und
 *   sagt es. 409 `no_change` (der Wert stand schon so) zählt als gespeichert. Jeder andere Fehler ebenso wie ein Konflikt, mit seinem Satz.
 */

export const WARTE_MS = 400;

export interface WetterZiel {
    readonly art: "preset" | "symbol";
    readonly id: string;
}

export const zielSchluessel = (ziel: WetterZiel): string => `${ziel.art}:${ziel.id}`;

/** `ruhe`: alles gespeichert; `wartet`: eine Änderung wartet auf ihre Frist; `laeuft`: eine Anfrage ist unterwegs. */
export type SpeicherStand = "ruhe" | "wartet" | "laeuft";

export interface Uhr {
    setze(tu: () => void, ms: number): unknown;
    loesche(griff: unknown): void;
    jetzt(): number;
}

const BROWSER_UHR: Uhr = {
    setze: (tu, ms) => setTimeout(tu, ms),
    loesche: (griff) => clearTimeout(griff as ReturnType<typeof setTimeout>),
    jetzt: () => Date.now(),
};

export interface WetterSpeicherOptionen {
    /** Sendet die gesammelten Felder eines Ziels; die Revision liest der Aufrufer selbst, wenn die Anfrage dran ist. */
    sende(ziel: WetterZiel, felder: Readonly<Record<string, unknown>>): Promise<SchreibAntwort>;
    /** Eine Quittung: die neuen Revisionen der berührten Presets und Icons. */
    quittung(quittung: OperationReceipt): void;
    /** 409 `edit_conflict`: jemand anderes war schneller. */
    konflikt(): void;
    /** Jeder andere Fehler, mit Status (0 ohne Verbindung) und Umschlag. */
    fehler(status: number, fehler: ApiFehler): void;
    warteMs?: number;
    uhr?: Uhr;
}

export interface WetterSpeicher {
    /** Felder eines Ziels geändert: Sie gehen nach der Frist, mit allem, was bis dahin dazukommt. */
    aendere(ziel: WetterZiel, felder: Readonly<Record<string, unknown>>): void;
    /** Eine Handlung, die nicht wartet; was zu Feldern wartet, geht vorher. `undefined`, wenn ein Konflikt sie überholt hat. */
    sofort(arbeit: () => Promise<SchreibAntwort>): Promise<SchreibAntwort | undefined>;
    /** Schickt alles, was wartet, gleich, und wartet auf die Reihe (etwa beim Schließen des Fensters). */
    alles(): Promise<void>;
    /** Lässt fallen, was wartet und was in der Reihe steht (nach einem Konflikt, vor dem Neuladen). */
    verwerfe(): void;
    readonly stand: Readonly<Ref<SpeicherStand>>;
    /** Wann zuletzt etwas gespeichert ist (Uhr der Seite), oder `undefined`. */
    readonly zuletzt: Readonly<Ref<number | undefined>>;
    destroy(): void;
}

interface Offen {
    readonly ziel: WetterZiel;
    felder: Record<string, unknown>;
    griff: unknown;
}

export function createWetterSpeicher(optionen: WetterSpeicherOptionen): WetterSpeicher {
    const uhr = optionen.uhr ?? BROWSER_UHR;
    const warteMs = optionen.warteMs ?? WARTE_MS;
    const offen = new Map<string, Offen>();
    const stand = ref<SpeicherStand>("ruhe");
    const zuletzt = ref<number | undefined>(undefined);
    let reihe = 0;
    let generation = 0;
    let kette: Promise<unknown> = Promise.resolve();

    const neuerStand = (): void => {
        stand.value = reihe > 0 ? "laeuft" : offen.size > 0 ? "wartet" : "ruhe";
    };

    function verwerfe(): void {
        generation += 1;
        for (const eintrag of offen.values()) uhr.loesche(eintrag.griff);
        offen.clear();
        neuerStand();
    }

    function antwort(ergebnis: SchreibAntwort): void {
        if (ergebnis.ok) {
            optionen.quittung(ergebnis.quittung);
            zuletzt.value = uhr.jetzt();
            return;
        }
        if (ergebnis.status === 409 && ergebnis.fehler.code === "no_change") {
            zuletzt.value = uhr.jetzt();
            return;
        }
        verwerfe();
        if (ergebnis.status === 409 && ergebnis.fehler.code === "edit_conflict") optionen.konflikt();
        else optionen.fehler(ergebnis.status, ergebnis.fehler);
    }

    function stelleAn(arbeit: () => Promise<SchreibAntwort>): Promise<SchreibAntwort | undefined> {
        const meine = generation;
        reihe += 1;
        neuerStand();
        const lauf = kette
            .then(async () => {
                if (meine !== generation) return undefined;
                const ergebnis = await arbeit();
                if (meine !== generation) return undefined;
                antwort(ergebnis);
                return ergebnis;
            })
            .finally(() => {
                reihe -= 1;
                neuerStand();
            });
        kette = lauf.catch(() => undefined);
        return lauf;
    }

    function schicke(schluessel: string): void {
        const eintrag = offen.get(schluessel);
        if (eintrag === undefined) return;
        uhr.loesche(eintrag.griff);
        offen.delete(schluessel);
        const { ziel, felder } = eintrag;
        void stelleAn(() => optionen.sende(ziel, felder));
    }

    const schickeAlles = (): void => {
        for (const schluessel of [...offen.keys()]) schicke(schluessel);
    };

    return {
        aendere(ziel, felder) {
            const schluessel = zielSchluessel(ziel);
            const eintrag = offen.get(schluessel);
            if (eintrag !== undefined) uhr.loesche(eintrag.griff);
            const neu: Offen = {
                ziel,
                felder: { ...(eintrag?.felder ?? {}), ...felder },
                griff: uhr.setze(() => schicke(schluessel), warteMs),
            };
            offen.set(schluessel, neu);
            neuerStand();
        },
        sofort(arbeit) {
            schickeAlles();
            return stelleAn(arbeit);
        },
        async alles() {
            schickeAlles();
            await kette;
        },
        verwerfe,
        stand,
        zuletzt,
        destroy() {
            for (const eintrag of offen.values()) uhr.loesche(eintrag.griff);
            offen.clear();
        },
    };
}
