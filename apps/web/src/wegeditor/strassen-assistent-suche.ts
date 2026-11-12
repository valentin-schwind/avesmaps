import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from "vue";

/**
 * Das Feld mit Vorschlagsliste im Straßen-Assistenten (WI-0310): Orte und Artikel. Wie die Ortszeile des Planers (Design Guide §17.4): Die
 * Liste überlagert, sie verschiebt nicht, hat KEINE Vorauswahl im Sinne von „schon gewählt“ (der erste Treffer ist nur markiert), Pfeiltasten
 * wählen, Enter nimmt, Escape schließt. Jede Frage trägt ein `AbortSignal`: Eine jüngere bricht die ältere ab.
 */

export interface Vorschlaege<T> {
    readonly text: Ref<string>;
    readonly treffer: ShallowRef<readonly T[]>;
    readonly offen: Ref<boolean>;
    readonly aktiv: Ref<number>;
    /** Eine Frage läuft. */
    readonly laedt: Ref<boolean>;
    /** Es wurde gefragt, und die Antwort ist da (auch eine leere): erst dann sagt die Liste „nichts gefunden“. */
    readonly beantwortet: Ref<boolean>;
    readonly fehler: Ref<boolean>;
    eingabe(): void;
    taste(event: KeyboardEvent): void;
    nimm(index: number): void;
    schliesse(): void;
    /** Beim Verlassen des Felds: Ein Klick in die Liste kommt nach dem Blur an, darum kurz warten. */
    verlassen(): void;
}

export function useVorschlaege<T>(optionen: {
    finde: (q: string, signal: AbortSignal) => Promise<readonly T[]>;
    nimm: (treffer: T) => void;
    /** Unter so vielen Zeichen wird nicht gefragt. */
    min?: number;
    ruheMs?: number;
}): Vorschlaege<T> {
    const min = optionen.min ?? 2;
    const ruheMs = optionen.ruheMs ?? 150;
    const text = ref("");
    const treffer = shallowRef<readonly T[]>([]);
    const offen = ref(false);
    const aktiv = ref(0);
    const laedt = ref(false);
    const beantwortet = ref(false);
    const fehler = ref(false);
    let abbruch: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let blur: ReturnType<typeof setTimeout> | undefined;

    function schliesse(): void {
        offen.value = false;
        aktiv.value = 0;
    }

    async function frage(): Promise<void> {
        abbruch?.abort();
        const q = text.value.trim();
        if (q.length < min) {
            laedt.value = false;
            beantwortet.value = false;
            treffer.value = [];
            schliesse();
            return;
        }
        const steuer = new AbortController();
        abbruch = steuer;
        laedt.value = true;
        fehler.value = false;
        offen.value = true;
        try {
            const gefunden = await optionen.finde(q, steuer.signal);
            if (steuer.signal.aborted) return;
            treffer.value = gefunden;
            aktiv.value = 0;
            beantwortet.value = true;
        } catch {
            if (steuer.signal.aborted) return;
            treffer.value = [];
            fehler.value = true;
            beantwortet.value = true;
        } finally {
            if (abbruch === steuer) laedt.value = false;
        }
    }

    function nimm(index: number): void {
        const gewaehlt = treffer.value[index];
        if (gewaehlt === undefined) return;
        text.value = "";
        treffer.value = [];
        beantwortet.value = false;
        schliesse();
        optionen.nimm(gewaehlt);
    }

    onBeforeUnmount(() => {
        abbruch?.abort();
        clearTimeout(timer);
        clearTimeout(blur);
    });

    return {
        text,
        treffer,
        offen,
        aktiv,
        laedt,
        beantwortet,
        fehler,
        eingabe() {
            clearTimeout(timer);
            timer = setTimeout(() => void frage(), ruheMs);
        },
        taste(event) {
            if (!offen.value) return;
            const n = treffer.value.length;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && n > 0) {
                aktiv.value = (aktiv.value + (event.key === "ArrowDown" ? 1 : n - 1)) % n;
            } else if (event.key === "Enter") {
                if (n === 0) return;
                nimm(aktiv.value);
            } else if (event.key === "Escape") {
                schliesse();
            } else {
                return;
            }
            // Die Tasten gehören hier der Liste, nicht der Karte oder dem Fenster.
            event.preventDefault();
            event.stopPropagation();
        },
        nimm,
        schliesse,
        verlassen() {
            clearTimeout(blur);
            blur = setTimeout(schliesse, 120);
        },
    };
}
