import { ref, type Ref } from "vue";
import type { MessageKey } from "../i18n/de";
import { bereiteBildVor, type BildErgebnis, type GewaehltesBild } from "./bild";

/**
 * Die Wahl des Bildes im Formular „Eigenes Bild hinzufügen“ (WI-0272, Entwurf 8): lesen, die Vorschau, der Grund, wenn es nicht geht. Der Entwurf trägt das gewählte Bild
 * (`bild.ts`: im Browser neu kodiert, ohne Ortsdaten, ohne Dateiname); hier steht nur, was die Oberfläche dazu zeigt.
 *
 * 🔴 Die Vorschau ist ein Blob der gewählten Datei und gehört dem Fenster, nicht dem Formular: Die Bestätigung nach dem Einreichen zeigt dasselbe Bild noch einmal, wenn das Formular
 * schon weg ist. `gibFrei` räumt auf, wenn das Fenster geht.
 */
export interface BildWahl {
    /** Wird gerade gelesen und neu kodiert? Dann ist die Ablage gesperrt, und „Bild hochladen“ geht nicht. */
    readonly laedt: Readonly<Ref<boolean>>;
    /** Warum die letzte Wahl nicht ging (Sprachschlüssel), sonst `undefined`. */
    readonly fehler: Readonly<Ref<MessageKey | undefined>>;
    /** Die Vorschau des gewählten Bildes (Adresse eines Blobs), sonst `undefined`. */
    readonly vorschauUrl: Readonly<Ref<string | undefined>>;
    /** Eine Datei wählen; ein zweiter Aufruf, solange gelesen wird, tut nichts. */
    waehle(datei: File | undefined): Promise<void>;
    /** Das gewählte Bild wieder entfernen (der Entwurf ist leer, die Vorschau weg). */
    entferne(): void;
    gibFrei(): void;
}

/** Die Hälfte des Formulars, die der Entwurf trägt: nur das Bild. */
export interface BildHalter {
    bild: GewaehltesBild | undefined;
}

export function erzeugeBildWahl(
    entwurf: BildHalter,
    umfeld: {
        readonly bereite?: (datei: File) => Promise<BildErgebnis>;
        readonly erzeugeUrl?: (datei: File) => string;
        readonly gibUrlFrei?: (url: string) => void;
    } = {},
): BildWahl {
    const bereite = umfeld.bereite ?? bereiteBildVor;
    const erzeugeUrl = umfeld.erzeugeUrl ?? ((datei: File): string => URL.createObjectURL(datei));
    const gibUrlFrei = umfeld.gibUrlFrei ?? ((url: string): void => URL.revokeObjectURL(url));
    const laedt = ref(false);
    const fehler = ref<MessageKey | undefined>(undefined);
    const vorschauUrl = ref<string | undefined>(undefined);

    function gibFrei(): void {
        if (vorschauUrl.value !== undefined) gibUrlFrei(vorschauUrl.value);
        vorschauUrl.value = undefined;
    }

    async function waehle(datei: File | undefined): Promise<void> {
        if (datei === undefined || laedt.value) return;
        laedt.value = true;
        fehler.value = undefined;
        try {
            const ergebnis = await bereite(datei);
            if (!ergebnis.ok) {
                fehler.value =
                    ergebnis.grund === "zu_gross" ? "photobox.bild.fehler.zuGross" : "photobox.bild.fehler.keinBild";
                return;
            }
            gibFrei();
            vorschauUrl.value = erzeugeUrl(datei);
            entwurf.bild = ergebnis.bild;
        } finally {
            laedt.value = false;
        }
    }

    function entferne(): void {
        entwurf.bild = undefined;
        fehler.value = undefined;
        gibFrei();
    }

    return { laedt, fehler, vorschauUrl, waehle, entferne, gibFrei };
}
