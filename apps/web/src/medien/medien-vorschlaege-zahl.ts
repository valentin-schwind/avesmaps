import { ref, watch, type Ref } from "vue";
import { ladeVorschlaege } from "../community/kartenvorschlaege-api";
import { redaktion } from "../community/redaktion";

/**
 * Die Zahl an der Schiene „Eingänge › Kartenvorschläge“ (WI-0068 OPS-000093): die OFFENEN Vorschläge, dieselbe Zahl, die bei den Meldungen in Community mitzählt (`zaehler.pending`). Ein eigener leichter Abruf der Liste
 * (Segment offen, eine Zeile), nur solange die Verwaltung offen ist und die Sitzung eines der beiden Redaktionsrechte hat. Sie liest neu, wenn die Redaktion etwas ändert (`redaktion.listeVersion`: Annehmen, Ablehnen,
 * auch aus dem Werkzeugfenster). Ein Fehler lässt die Zahl leer (`undefined`): Die Schiene zeigt dann keine, die Liste daneben sagt selbst, was los ist.
 */
export function useVorschlagsZahl(aktiv: () => boolean): Ref<number | undefined> {
    const zahl = ref<number | undefined>(undefined);
    let lauf = 0;
    async function lade(): Promise<void> {
        const mein = ++lauf;
        try {
            const liste = await ladeVorschlaege({ segment: "offen", limit: 1 });
            if (mein === lauf) zahl.value = liste.zaehler.pending;
        } catch {
            if (mein === lauf) zahl.value = undefined;
        }
    }
    watch(
        [aktiv, () => redaktion.listeVersion.value],
        ([an]) => {
            if (an) void lade();
            else {
                lauf += 1;
                zahl.value = undefined;
            }
        },
        { immediate: true },
    );
    return zahl;
}
