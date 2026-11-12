import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { ActionResult } from "../auth/verwaltung";
import type { Wikisync, WikisyncTafelnKoerper } from "./wikisync";

/**
 * Die zwei Tafeln des Kanon-Etiketts speichern jede Änderung SOFORT (WI-0253, Vali 2026-10-27: „sachen die ich in Ohne Wiki-Artikel und ohne Quelle einstelle,
 * speichern nicht“ und „warum muss man speichern, warum speichert der klick nicht?“): kein Entwurf, kein Speichern-Knopf. Gemeinsam für beide Tafeln, ohne Dom.
 *
 * - **Auswahl und ↺ speichern beim Klick.** Ein Textfeld speichert beim Verlassen oder mit Enter, nie je Tastendruck; Escape stellt den gespeicherten Wert wieder her.
 *   Ein Wert, der so nicht gespeichert wird (zu lang), bleibt im Feld stehen, und die Zeile nennt den Grund.
 * - **Der Wunsch.** Solange eine Änderung unterwegs ist, zeigt die Zeile den gewünschten Wert (sonst sprängen die Felder bei jedem Klick einen Augenblick zurück). Der Wunsch
 *   ist je Zeile EINER: Zwei Klicks hintereinander schicken die Zeile mit beiden Werten, nicht zwei Anfragen mit Revisionen, die einander überholen.
 * - **Eine Reihe.** `Wikisync.tafelnSpeichern` reiht alle Änderungen; die Zeile wird erst geschickt, wenn sie an der Reihe ist, und gar nicht, wenn der Server sie dann schon
 *   so hält. Ein Passkey wird so nur einmal gefragt, und keine Änderung geht mit einer überholten Revision.
 * - **Nie still.** Lehnt der Server ab oder bricht die Person den Passkey ab, springt die Zeile auf den gespeicherten Wert zurück, und die Meldung steht an der Tafel
 *   (`fehler`). Nach dem Speichern steht die Wirkung in EINEM Satz da (`meldung`), gerechnet aus dem Stand vor der Änderung.
 */

export interface SofortOptionen<Z, K extends string | number> {
    wikisync: Wikisync;
    wo: "namensraeume" | "ohne";
    schluessel: (zeile: Z) => K;
    /** Die gespeicherten Zeilen (reaktiv gelesen). */
    gespeichert: () => readonly Z[];
    gleich: (a: Z, b: Z) => boolean;
    /** Die Anfrage zu EINER Zeile; `null`: die Zeile fällt aus der Tafel. */
    koerper: (zeile: Z | null, schluessel: K) => WikisyncTafelnKoerper;
    /** Der Satz zur Wirkung, gerechnet aus dem Stand VOR der Änderung (`alt: undefined`: eine neue Zeile; `neu: null`: entfernt). */
    satz: (alt: Z | undefined, neu: Z | null, schluessel: K) => string;
    /** Der Text des einen Textfelds der Zeile (der Bezeichner) und wie ein getippter Text die Zeile ändert. */
    textVon: (zeile: Z) => string;
    mitText: (zeile: Z, text: string) => Z;
    /** Warum die Zeile so nicht gespeichert wird (ein Satz), sonst `undefined`. */
    grund: (zeile: Z) => string | undefined;
}

export interface Sofort<Z, K extends string | number> {
    /** Die Zeilen, wie sie dastehen: gespeichert, überdeckt vom Wunsch; eine Zeile, die gerade entfernt wird, fehlt. */
    zeilen: ComputedRef<Z[]>;
    /** Wird die Zeile gerade gespeichert? */
    speichert(schluessel: K): boolean;
    /** Eine Auswahl oder ein Schalter der Zeile: gespeichert wird sofort. */
    aendere(schluessel: K, teil: Partial<Z>): void;
    /** ↺: die Zeile auf diesen Stand, mit allem, was ein halb getippter Text war. */
    ersetze(schluessel: K, zeile: Z): void;
    /** ✕: die Zeile aus der Tafel nehmen. */
    entferne(schluessel: K): void;
    /** Eine neue Zeile; erst wenn sie gespeichert ist, steht sie in der Tafel. */
    fuegeHinzu(schluessel: K, zeile: Z): Promise<ActionResult>;
    /** Der Text im Feld: der getippte, sonst der der Zeile. */
    text(schluessel: K, zeile: Z): string;
    tippe(schluessel: K, text: string): void;
    /** Verlassen oder Enter: den getippten Text speichern, wenn er gilt. */
    fertig(schluessel: K): void;
    /** Escape: den getippten Text verwerfen; `true`, wenn es etwas zu verwerfen gab (dann gilt Escape dem Feld und nicht dem Fenster). */
    zurueck(schluessel: K): boolean;
    /** Warum der getippte Text nicht gespeichert wird. */
    textGrund(schluessel: K): string | undefined;
    /** Der Satz zur Wirkung der letzten Änderung. */
    meldung: ShallowRef<string | null>;
    /** Die Ablehnung der letzten Änderung (Server, Passkey abgebrochen, Konflikt). */
    fehler: ShallowRef<ActionResult | undefined>;
}

export function sofortTafel<Z, K extends string | number>(opt: SofortOptionen<Z, K>): Sofort<Z, K> {
    const sk = (schluessel: K): string => String(schluessel);
    /** `undefined`: kein Wunsch; `null`: die Zeile soll entfallen. */
    const wunsch = shallowRef<Readonly<Record<string, Z | null>>>({});
    const texte = shallowRef<Readonly<Record<string, string>>>({});
    const gruende = shallowRef<Readonly<Record<string, string>>>({});
    const meldung = shallowRef<string | null>(null);
    const fehler = shallowRef<ActionResult | undefined>(undefined);

    const setze = <T>(quelle: ShallowRef<Readonly<Record<string, T>>>, schluessel: K, wert: T): void => {
        quelle.value = { ...quelle.value, [sk(schluessel)]: wert };
    };
    const loesche = <T>(quelle: ShallowRef<Readonly<Record<string, T>>>, schluessel: K): void => {
        if (!(sk(schluessel) in quelle.value)) return;
        const kopie = { ...quelle.value };
        delete kopie[sk(schluessel)];
        quelle.value = kopie;
    };

    const finde = (schluessel: K): Z | undefined => opt.gespeichert().find((z) => opt.schluessel(z) === schluessel);
    const zeilen = computed((): Z[] =>
        opt.gespeichert().flatMap((zeile) => {
            const w = wunsch.value[sk(opt.schluessel(zeile))];
            return w === null ? [] : [w ?? zeile];
        }),
    );
    const stehtDa = (schluessel: K): Z | undefined => {
        const w = wunsch.value[sk(schluessel)];
        return w === undefined ? finde(schluessel) : (w ?? undefined);
    };

    /** Der Wunsch ist erfüllt (steht gespeichert so da)? */
    const erfuellt = (schluessel: K, soll: Z | null): boolean => {
        const alt = finde(schluessel);
        return soll === null ? alt === undefined : alt !== undefined && opt.gleich(alt, soll);
    };

    async function einreihen(schluessel: K): Promise<void> {
        // Was die Reihe geschickt hat (die Funktion unten läuft erst, wenn die Reihe an der Änderung ist).
        const schritt: { gesendet?: Z | null; satz: string } = { satz: "" };
        const ergebnis = await opt.wikisync.tafelnSpeichern(opt.wo, () => {
            const soll = wunsch.value[sk(schluessel)];
            // Schon erledigt (eine frühere Änderung der Reihe schickte diese Zeile mit) oder zurückgenommen: nichts zu schicken.
            if (soll === undefined || erfuellt(schluessel, soll)) return null;
            schritt.gesendet = soll;
            schritt.satz = opt.satz(finde(schluessel), soll, schluessel);
            return opt.koerper(soll, schluessel);
        });
        if (!ergebnis.ok) {
            // Zurück auf den gespeicherten Wert, und die Meldung steht an der Tafel.
            loesche(wunsch, schluessel);
            meldung.value = null;
            fehler.value = ergebnis;
            return;
        }
        if (schritt.satz !== "") meldung.value = schritt.satz;
        // Der Wunsch ist erfüllt: Die Zeile zeigt wieder den gespeicherten Wert. Ein neuerer Wunsch bleibt (seine Änderung steht später in der Reihe).
        const jetzt = wunsch.value[sk(schluessel)];
        if (jetzt !== undefined && (jetzt === schritt.gesendet || erfuellt(schluessel, jetzt)))
            loesche(wunsch, schluessel);
    }

    function wuensche(schluessel: K, soll: Z | null): void {
        // Steht die Zeile schon so da und ist nichts unterwegs, gibt es nichts zu tun (ein Klick auf den Wert, den die Auswahl ohnehin zeigt).
        if (!(sk(schluessel) in wunsch.value) && erfuellt(schluessel, soll)) return;
        meldung.value = null;
        fehler.value = undefined;
        setze(wunsch, schluessel, soll);
        void einreihen(schluessel);
    }

    function verwirfText(schluessel: K): boolean {
        const da = sk(schluessel) in texte.value || sk(schluessel) in gruende.value;
        loesche(texte, schluessel);
        loesche(gruende, schluessel);
        return da;
    }

    return {
        zeilen,
        speichert: (schluessel) => sk(schluessel) in wunsch.value,
        aendere(schluessel, teil) {
            const basis = stehtDa(schluessel);
            if (basis !== undefined) wuensche(schluessel, { ...basis, ...teil });
        },
        ersetze(schluessel, zeile) {
            verwirfText(schluessel);
            wuensche(schluessel, zeile);
        },
        entferne(schluessel) {
            verwirfText(schluessel);
            wuensche(schluessel, null);
        },
        async fuegeHinzu(schluessel, zeile) {
            meldung.value = null;
            fehler.value = undefined;
            const satz = opt.satz(undefined, zeile, schluessel);
            const ergebnis = await opt.wikisync.tafelnSpeichern(opt.wo, () => opt.koerper(zeile, schluessel));
            if (ergebnis.ok) meldung.value = satz;
            else fehler.value = ergebnis;
            return ergebnis;
        },
        text: (schluessel, zeile) => texte.value[sk(schluessel)] ?? opt.textVon(zeile),
        tippe(schluessel, text) {
            setze(texte, schluessel, text);
            loesche(gruende, schluessel);
        },
        fertig(schluessel) {
            const getippt = texte.value[sk(schluessel)];
            if (getippt === undefined) return;
            const basis = stehtDa(schluessel);
            if (basis === undefined) {
                verwirfText(schluessel);
                return;
            }
            const neu = opt.mitText(basis, getippt);
            const grund = opt.grund(neu);
            if (grund !== undefined) {
                // Der Text bleibt im Feld stehen, damit man ihn kürzen kann; gespeichert wird nichts.
                setze(gruende, schluessel, grund);
                return;
            }
            verwirfText(schluessel);
            if (!opt.gleich(basis, neu)) wuensche(schluessel, neu);
        },
        zurueck: verwirfText,
        textGrund: (schluessel) => gruende.value[sk(schluessel)],
        meldung,
        fehler,
    };
}
