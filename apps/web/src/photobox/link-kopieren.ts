import { onBeforeUnmount, ref, type Ref } from "vue";
import { useKopieren, type KopierZustand } from "../controls/avm-kopierfeld";
import { copyToClipboard } from "../route-planner/use-share-link";

/**
 * „Link kopieren“ im Linkkasten (`link-kasten.vue`) der Bestätigung und der Statusseite (WI-0272 S3, Aufgabe 19a): kopieren, dem Knopf 2,6 s „✓ Kopiert“ geben, bei einem Fehler den Satz darunter zeigen.
 * Was sonst noch geschieht (die Warnung aufheben, den Link markieren), hängt der Aufrufer an `erfolg` und `misserfolg`.
 */

/** Wie lange der Kopierknopf „✓ Kopiert“ zeigt. */
export const KOPIERT_MS = 2600;

export interface LinkKopieren {
    /** Wie der Kopierknopf aussieht: Ruhe, 2,6 s „✓ Kopiert“ oder „ging nicht“ (die Zeile darunter sagt es). */
    readonly anzeige: Ref<KopierZustand>;
    /** Kopiert den Link; `true`, wenn er in der Zwischenablage liegt. */
    kopiere(): Promise<boolean>;
}

export function useLinkKopieren(umfeld: {
    readonly link: () => string;
    /** Der Link liegt in der Zwischenablage. */
    readonly erfolg?: () => void;
    /** Kopieren ging nicht (die Zwischenablage ist gesperrt): Der Aufrufer markiert den Link, Strg+C nimmt ihn mit. */
    readonly misserfolg?: () => void;
}): LinkKopieren {
    const kopieren = useKopieren(copyToClipboard);
    const anzeige = ref<KopierZustand>("ruhe");
    let uhr: ReturnType<typeof setTimeout> | undefined;
    onBeforeUnmount(() => clearTimeout(uhr));

    async function kopiere(): Promise<boolean> {
        const ok = await kopieren.kopiere(umfeld.link());
        clearTimeout(uhr);
        if (ok) {
            anzeige.value = "kopiert";
            uhr = setTimeout(() => {
                anzeige.value = "ruhe";
            }, KOPIERT_MS);
            umfeld.erfolg?.();
        } else {
            anzeige.value = "fehler";
            umfeld.misserfolg?.();
        }
        return ok;
    }

    return { anzeige, kopiere };
}
