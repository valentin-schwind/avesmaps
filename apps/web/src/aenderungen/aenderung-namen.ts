import { shallowRef } from "vue";
import {
    EDITOR_POWERLINES_URL,
    EDITOR_TERRITORIES_URL,
    type EditorPowerlineDetail,
    type EditorTerritoryList,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";

/**
 * Die Namen, die das Protokoll nicht trägt (WI-0265 B5a2): Ändert sich das Obergebiet eines Gebiets, steht im Protokoll nur die Kennung des
 * alten und des neuen. Der Gebietseditor kennt die Namen aus seiner Liste (`GET /api/editor/territories`); „Änderungen“ liest sie einmal, erst
 * wenn eine Zeile sie braucht, und hält sie, bis die Seite neu lädt. Ohne Antwort (kein Recht, kein Netz) bleibt es beim „anderen Eintrag“.
 *
 * Die Namen stehen in einem Ref: Wer sie beim Zeichnen liest, zeichnet neu, sobald die Liste da ist.
 */
const gebiete = shallowRef<ReadonlyMap<string, string>>(new Map());
let laeuft: Promise<void> | undefined;

/** Liest die Namen der Gebiete (einmal); mehrere Aufrufe teilen sich die eine Frage. Ein Fehler lässt eine spätere Frage zu. */
export function ladeGebietsnamen(fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init)): Promise<void> {
    if (gebiete.value.size > 0) return Promise.resolve();
    laeuft ??= fetcher(EDITOR_TERRITORIES_URL, { cache: "no-store", headers: { accept: "application/json" } })
        .then(async (antwort) => {
            if (!antwort.ok) return;
            const liste = (await antwort.json()) as EditorTerritoryList;
            gebiete.value = new Map(liste.rows.map((zeile) => [zeile.id, zeile.name]));
        })
        .catch(() => undefined)
        .finally(() => {
            laeuft = undefined;
        });
    return laeuft;
}

/** Der Name eines Gebiets, wenn die Liste ihn kennt; stößt beim ersten Mal das Lesen der Liste an. */
export function gebietName(id: string): string | undefined {
    if (gebiete.value.size === 0) void ladeGebietsnamen();
    return gebiete.value.get(id);
}

/** Ein Test setzt die Namen. */
export function setzeGebietsnamen(namen: ReadonlyMap<string, string>): void {
    gebiete.value = namen;
}

/**
 * Die Knoten der Kraftlinien (WI-0265 B6b): Ändert sich ein Ende eines Abschnitts (`from`, `to`), steht im Protokoll nur die Kennung des Knotens. Die Linie nennt ihre Knoten mit
 * Namen (`GET /api/editor/powerlines/:abschnitt`, `nodes`); „Änderungen“ liest sie je Linie einmal, wenn ein Eintrag sie braucht, und hält sie, bis die Seite neu lädt. Ein
 * Kraftlinienpunkt ohne Namen heißt wie im Fenster der Linie „Nodix“. Ohne Antwort bleibt es beim „anderen Eintrag“.
 */
const knoten = shallowRef<ReadonlyMap<string, string>>(new Map());
const knotenGelesen = new Set<string>();

/** Liest die Knoten der Linie, zu der der Abschnitt gehört (einmal je Abschnitt); ein Fehler lässt eine spätere Frage zu. */
export async function ladeKnotenNamen(
    abschnitt: string,
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): Promise<void> {
    if (knotenGelesen.has(abschnitt)) return;
    knotenGelesen.add(abschnitt);
    try {
        const antwort = await fetcher(`${EDITOR_POWERLINES_URL}/${abschnitt}`, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) {
            knotenGelesen.delete(abschnitt);
            return;
        }
        const detail = (await antwort.json()) as EditorPowerlineDetail;
        const neu = new Map(knoten.value);
        for (const k of detail.nodes)
            if (k.kind !== "missing")
                neu.set(k.id, (k.name ?? "").trim() === "" ? t("kraftlinieneditor.punkt") : k.name!);
        knoten.value = neu;
    } catch {
        knotenGelesen.delete(abschnitt);
    }
}

/** Der Name eines Knotens, wenn eine gelesene Linie ihn nennt. */
export const knotenName = (id: string): string | undefined => knoten.value.get(id);

/** Ein Test setzt die Namen. */
export function setzeKnotenNamen(namen: ReadonlyMap<string, string>): void {
    knoten.value = namen;
    knotenGelesen.clear();
}
