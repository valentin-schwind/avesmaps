import type { PhotoboxStatus } from "@avesmaps3d/shared";
import type { PhotoboxFehlerArt } from "./api";
import { VORSCHAU_TAKT, naechsterSchritt } from "./status-modell";

/**
 * Die Abfrageschleife der Statusseite `/reisebild#…` (WI-0272 S2b, Aufgabe 14; Review S2b I5): den Stand lesen, die Vorschau holen, solange sie fehlt in `VORSCHAU_TAKT.abstandMs` neu fragen, höchstens
 * `VORSCHAU_TAKT.hoechstens`-mal, danach „Neu laden“ von Hand. Sie hängt an keinem Fenster und an keinem Vue-Zustand, damit ein Test sie mit falscher Uhr (`vi.useFakeTimers`) ablaufen lassen kann: Die Seite
 * (`reisebild-status-fenster.vue`) reicht nur die Aufrufe und die Ausgänge herein.
 *
 * - 🔴 **Die Lesegrenze liegt bei 120 Aufrufen je Stunde und Adresse.** Ein Öffnen kostet höchstens 1 + 8 Aufrufe von `/status` (und je Runde einen der Vorschau), „Neu laden“ beginnt von vorn.
 * - **`lauf` macht Antworten ungültig**: Wer inzwischen neu geladen hat, den Schlüssel gewechselt hat oder gegangen ist (`stoppe`), dessen späte Antwort wird verworfen; es läuft nie eine zweite Kette.
 * - **Ein Fehler beim Lesen** geht an `ladefehler`, mit der Auskunft, ob schon ein Stand da war. War einer da, bleibt er stehen und die Seite zeigt den Fehler dazu; lief gerade die Nachfrage der Vorschau,
 *   endet sie (die Seite bietet „Neu laden“ an), statt ohne Zeitgeber und ohne Knopf bei „wird gerechnet“ stehen zu bleiben.
 */

/**
 * Wie es um die Vorschau steht: `da`, `rechnet` (der Worker ist noch dran, es wird nachgefragt), `aufgegeben` (nach den Wiederholungen: „Neu laden“), `gesperrt` (die Datei liegt in Quarantäne, der Server meldet `vorschauGesperrt`: es wird nicht nachgefragt),
 * `entfernt` (der Betreiber hat das Bild endgültig gelöscht, `bildEntfernt`, WI-0272: es gibt keine mehr, es wird nicht nachgefragt) oder `ohne` (noch nichts gefragt).
 */
export type VorschauZustand = "ohne" | "da" | "rechnet" | "aufgegeben" | "gesperrt" | "entfernt";

export interface StatusAbfrageUmfeld {
    /** Der Schlüssel des Links; `null`, wenn es keinen gibt: Dann gibt es nichts zu fragen. */
    readonly schluessel: () => string | null;
    readonly leseStatus: (schluessel: string) => Promise<PhotoboxStatus>;
    /** Die Vorschau; `"fehlt"` heißt: noch nicht berechnet. */
    readonly ladeVorschau: (schluessel: string) => Promise<Blob | "fehlt">;
    readonly fehlerArt: (fehler: unknown) => PhotoboxFehlerArt;
}

export interface StatusAbfrageAusgang {
    /** Ein neuer Stand (ein vorheriger Fehler beim Lesen ist damit erledigt). */
    stand(status: PhotoboxStatus): void;
    /** Die Vorschau ist da: Die Seite macht daraus eine Adresse (`URL.createObjectURL`) und gibt die alte frei. */
    vorschau(bild: Blob): void;
    /** Die gezeigte Vorschau gilt nicht mehr (das Bild wurde ersetzt): Die Seite gibt ihre Adresse frei. */
    vorschauWeg(): void;
    vorschauZustand(zustand: VorschauZustand): void;
    /** Zu diesem Schlüssel gibt es nichts (mehr). */
    nichtGefunden(): void;
    /** Das Lesen scheiterte. `hatStand`: Es war schon ein Stand gezeigt worden. */
    ladefehler(fehler: unknown, art: PhotoboxFehlerArt, hatStand: boolean): void;
}

export interface StatusAbfrage {
    /** Den Stand lesen; `neu` (Öffnen, „Neu laden“) beginnt die Wiederholungen von vorn, die Nachfrage der Zeitgebers nicht. */
    ladeStatus(neu: boolean): Promise<void>;
    /** Ein Stand, den eine Aktion der Seite geliefert hat: Fehlt ihm die Vorschau (Bild ersetzt), beginnt die Nachfrage von vorn. */
    uebernimm(status: PhotoboxStatus): void;
    /** Alles Laufende ungültig machen und den Zeitgeber löschen (Schließen). */
    stoppe(): void;
    /** Wie `stoppe`, dazu vergessen, was gezeigt wurde (der Link hat gewechselt). */
    zuruecksetzen(): void;
}

export function erzeugeStatusAbfrage(umfeld: StatusAbfrageUmfeld, ausgang: StatusAbfrageAusgang): StatusAbfrage {
    let lauf = 0;
    let versuche = 0;
    let uhr: ReturnType<typeof setTimeout> | undefined;
    let hatStand = false;
    let hatVorschau = false;
    let zustand: VorschauZustand = "ohne";

    const setzeZustand = (neu: VorschauZustand): void => {
        zustand = neu;
        ausgang.vorschauZustand(neu);
    };

    function nichtGefunden(): void {
        clearTimeout(uhr);
        hatStand = false;
        hatVorschau = false;
        ausgang.nichtGefunden();
    }

    /** Die Vorschau holen, wenn sie bereit ist; sonst in `abstandMs` noch einmal den Stand fragen, höchstens `hoechstens`-mal. */
    async function fragePruefeVorschau(status: PhotoboxStatus, mein: number): Promise<void> {
        const schluessel = umfeld.schluessel();
        if (schluessel === null) return;
        // Endgültig gelöscht (WI-0272): Es gibt keine Vorschau mehr, also keine Nachfrage.
        if (status.bildEntfernt === true) {
            clearTimeout(uhr);
            setzeZustand("entfernt");
            return;
        }
        // In Quarantäne (Inhaltsschalter, Notaus): Die Datei kommt nicht von selbst wieder, also keine Nachfrage und kein „wird gerechnet“.
        if (!status.vorschauBereit && status.vorschauGesperrt === true) {
            clearTimeout(uhr);
            setzeZustand("gesperrt");
            return;
        }
        let bereit = status.vorschauBereit;
        if (bereit && !hatVorschau) {
            try {
                const ergebnis = await umfeld.ladeVorschau(schluessel);
                if (mein !== lauf) return;
                if (ergebnis !== "fehlt") {
                    hatVorschau = true;
                    ausgang.vorschau(ergebnis);
                    setzeZustand("da");
                    return;
                }
                // Der Stand sagt „bereit“, die Datei fehlt noch (der Worker war eben noch dran): wie „nicht bereit“.
                bereit = false;
            } catch (fehler) {
                if (mein !== lauf) return;
                if (umfeld.fehlerArt(fehler) === "nicht_gefunden") return nichtGefunden();
                setzeZustand("aufgegeben");
                return;
            }
        } else if (bereit) {
            setzeZustand("da");
            return;
        }
        clearTimeout(uhr);
        if (naechsterSchritt(bereit, versuche) === "warten") {
            setzeZustand("rechnet");
            uhr = setTimeout(() => {
                versuche += 1;
                void ladeStatus(false);
            }, VORSCHAU_TAKT.abstandMs);
        } else {
            setzeZustand("aufgegeben");
        }
    }

    async function ladeStatus(neu: boolean): Promise<void> {
        const schluessel = umfeld.schluessel();
        if (schluessel === null) return nichtGefunden();
        const mein = ++lauf;
        clearTimeout(uhr);
        if (neu) versuche = 0;
        let status: PhotoboxStatus;
        try {
            status = await umfeld.leseStatus(schluessel);
        } catch (fehler) {
            if (mein !== lauf) return;
            const art = umfeld.fehlerArt(fehler);
            if (art === "nicht_gefunden") return nichtGefunden();
            // Die Nachfrage der Vorschau endet hier; ohne diese Zeile stünde die Seite bei „wird gerechnet“, ohne Zeitgeber und ohne Knopf.
            if (zustand === "rechnet") setzeZustand("aufgegeben");
            ausgang.ladefehler(fehler, art, hatStand);
            return;
        }
        if (mein !== lauf) return;
        hatStand = true;
        ausgang.stand(status);
        await fragePruefeVorschau(status, mein);
    }

    function uebernimm(status: PhotoboxStatus): void {
        hatStand = true;
        ausgang.stand(status);
        // Ist die Vorschau bereit und schon da, bleibt sie; fehlt sie (das Bild wurde ersetzt, oder die Nachfrage war aufgegeben), beginnt die Nachfrage von vorn.
        if (status.vorschauBereit && hatVorschau) return;
        clearTimeout(uhr);
        hatVorschau = false;
        ausgang.vorschauWeg();
        versuche = 0;
        setzeZustand("ohne");
        void fragePruefeVorschau(status, ++lauf);
    }

    function stoppe(): void {
        lauf += 1;
        clearTimeout(uhr);
    }

    function zuruecksetzen(): void {
        stoppe();
        versuche = 0;
        hatStand = false;
        hatVorschau = false;
        zustand = "ohne";
    }

    return { ladeStatus, uebernimm, stoppe, zuruecksetzen };
}
