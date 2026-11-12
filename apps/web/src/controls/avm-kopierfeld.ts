import { ref, type Ref } from "vue";

/**
 * Der Ablauf des Kopierfelds ohne Browser (WI-0120 A8): kopieren, Ergebnis melden, bei einem neuen Wert zurück auf Ruhe.
 *
 * 🔴 Die Rückmeldung steht im Feld, nicht im Toast: Im modalen Fenster liegt der Toast unter dem Schleier und ist nicht zu
 * sehen (Discovery Frontend, Risiko R5). Geschrieben wird über `copyToClipboard` des Kurzlinks
 * (`route-planner/use-share-link.ts`), der drei Wege kennt und auch ohne sichere Verbindung kopiert; hier wird er nur
 * hineingereicht, damit der Test ihn ersetzen kann.
 *
 * 🪤 Eine späte Antwort eines älteren Klicks überschreibt die jüngere nicht: Jeder Versuch hat seine Nummer.
 */
export type KopierZustand = "ruhe" | "kopiert" | "fehler";

export interface Kopieren {
    zustand: Ref<KopierZustand>;
    /** Kopiert `wert`; `true`, wenn der Wert in der Zwischenablage liegt. */
    kopiere(wert: string): Promise<boolean>;
    /** Zurück auf Ruhe, etwa wenn ein neuer Link im Feld steht. */
    zuruecksetzen(): void;
}

export function useKopieren(schreiben: (text: Promise<string>) => Promise<boolean>): Kopieren {
    const zustand = ref<KopierZustand>("ruhe");
    let versuch = 0;

    async function kopiere(wert: string): Promise<boolean> {
        const eigener = ++versuch;
        let ok: boolean;
        try {
            ok = wert !== "" && (await schreiben(Promise.resolve(wert)));
        } catch {
            ok = false;
        }
        if (eigener === versuch) zustand.value = ok ? "kopiert" : "fehler";
        return ok;
    }

    function zuruecksetzen(): void {
        versuch += 1;
        zustand.value = "ruhe";
    }

    return { zustand, kopiere, zuruecksetzen };
}
