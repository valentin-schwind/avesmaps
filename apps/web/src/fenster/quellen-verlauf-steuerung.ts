import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { InhalteTraegerQuellen, MapHistoryEntry } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import { t } from "../i18n/i18n";
import { juengsteJeQuelle, protokollKennungen, umkehrung, type QuellenZeile } from "./quellen-verlauf-modell";
import { baueAenderung, baueBody, fehlerAus, leseGrund } from "./traeger-quellen-modell";
import { createTraegerQuellenClient, type TraegerQuellenClient, type TraegerZiel } from "./traeger-quellen-steuerung";
import { fehlerSatz } from "./traeger-quellen-texte";

/**
 * ↺ an den Zeilen „Quelle … angehängt / geändert / gelöst / zurückgeholt“ im Verlauf eines Orts, Gebiets oder einer Landschaft (WI-0254 §12), ohne Bauteil. Die Rechnung steht in `quellen-verlauf-modell.ts`.
 *
 * - **Die Umkehrung geht über denselben Schreibweg** wie die Klappbox (`POST …/traeger/:kind/:id/quellen`, eine Änderung): Ziel sind der Zustand und die Angaben aus „vorher“ des Eintrags, `vorher` der Anfrage ist der
 *   heute gelesene Stand der Verknüpfung. Vor dem Schreiben liest sie den Stand noch einmal und prüft, ob er noch dem „nachher“ des Eintrags gleicht; sonst schreibt sie nichts.
 * - **Wann ein Knopf da ist:** Nur an der jüngsten Zeile einer Quelle (ältere haben weder Knopf noch Satz), nur, wo man die Quellen des Objekts ändern darf (Recht `manage_sources`, Schreibrecht des Editors, Objekt
 *   `aenderbar`), und erst, wenn der Stand gelesen ist. Dann ist er frei, solange die Verknüpfung so dasteht wie nach der Änderung, und sonst gesperrt mit einem Satz (`plan`).
 * - **Abgewiesen** (403, 423, 503, 400, 409, kein Netz): Der Satz steht an der Zeile, der Stand wird bei 409 neu gelesen.
 */

export type ZeilenPlan =
    | { readonly art: "geht" }
    /** Der Satz, warum ↺ gerade nicht geht. */
    | { readonly art: "gesperrt"; readonly satz: string };

export interface QuellenVerlaufOptionen {
    client?: TraegerQuellenClient | undefined;
    neueOperationId?: (() => string) | undefined;
    /** Die gelesenen Einträge des Verlaufs: Nur an der jüngsten Zeile einer Quelle steht ↺. */
    eintraege: () => readonly MapHistoryEntry[];
    /** Das Recht `manage_sources`. */
    recht: () => boolean;
    /** Schreibt der Editor gerade (sein Schreibrecht, `MAP_EDITING`)? */
    schreibt: () => boolean;
    /** ↺ ist geschrieben: Der Verlauf liest neu. */
    nach?: (() => void) | undefined;
}

export interface QuellenVerlauf {
    /** Die Quellen des Objekts, wie zuletzt gelesen; `undefined`, bis gelesen ist. */
    readonly daten: Readonly<ShallowRef<InhalteTraegerQuellen | undefined>>;
    /** Die Zeile, deren ↺ gerade schreibt. */
    readonly sendet: Readonly<Ref<string | undefined>>;
    /** Der Satz einer Abweisung, an seiner Zeile. */
    readonly meldung: Readonly<ShallowRef<{ readonly schluessel: string; readonly satz: string } | undefined>>;
    /** Liest den Stand der Quellen neu; `true`, wenn es ging. */
    lese(): Promise<boolean>;
    /** Was ↺ an der Zeile täte; `undefined`: kein Knopf (nicht die jüngste Zeile ihrer Quelle, nicht änderbar oder noch nicht gelesen). */
    plan(zeile: QuellenZeile): ZeilenPlan | undefined;
    /** ↺: `true`, wenn der Server es angenommen hat. */
    zuruecknehmen(zeile: QuellenZeile): Promise<boolean>;
}

export function createQuellenVerlauf(
    ziel: () => TraegerZiel | undefined,
    optionen: QuellenVerlaufOptionen,
): QuellenVerlauf {
    const client = optionen.client ?? createTraegerQuellenClient();
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const daten = shallowRef<InhalteTraegerQuellen | undefined>(undefined);
    const sendet = ref<string | undefined>(undefined);
    const meldung = shallowRef<{ schluessel: string; satz: string } | undefined>(undefined);
    let epoche = 0;
    let nummer = 0;
    let abbruch: AbortController | undefined;
    let entsorgt = false;

    async function lese(): Promise<boolean> {
        const z = ziel();
        if (z === undefined) return false;
        const meine = epoche;
        const dieseNummer = ++nummer;
        abbruch?.abort();
        const eigene = new AbortController();
        abbruch = eigene;
        try {
            const antwort = await client.lies(z.kind, z.id, eigene.signal);
            if (eigene.signal.aborted || entsorgt || meine !== epoche || dieseNummer !== nummer) return false;
            daten.value = antwort;
            return true;
        } catch {
            return false;
        }
    }

    watch(
        () => {
            const z = ziel();
            return z === undefined ? undefined : `${z.kind}/${z.id}`;
        },
        () => {
            epoche += 1;
            daten.value = undefined;
            sendet.value = undefined;
            meldung.value = undefined;
            void lese();
        },
        { immediate: true },
    );
    onScopeDispose(() => {
        entsorgt = true;
        abbruch?.abort();
    });

    /** Ist das die jüngste Zeile ihrer Quelle? */
    const istJuengste = (zeile: QuellenZeile): boolean =>
        juengsteJeQuelle(optionen.eintraege(), protokollKennungen(ziel())).get(zeile.sourceId) === zeile.schluessel;

    const heute = (zeile: QuellenZeile) => daten.value?.quellen.find((quelle) => quelle.sourceId === zeile.sourceId);

    return {
        daten,
        sendet,
        meldung,
        lese,
        plan(zeile) {
            if (!istJuengste(zeile)) return undefined;
            if (
                daten.value === undefined ||
                leseGrund(optionen.recht(), optionen.schreibt(), daten.value) !== undefined
            ) {
                return undefined;
            }
            if (sendet.value !== undefined) return { art: "gesperrt", satz: t("verlauf.gesperrtSendet") };
            return umkehrung(zeile, heute(zeile)).art === "geht"
                ? { art: "geht" }
                : { art: "gesperrt", satz: t("fenster.traegerQuellen.verlauf.anders") };
        },
        async zuruecknehmen(zeile) {
            const z = ziel();
            if (z === undefined || sendet.value !== undefined || !istJuengste(zeile)) return false;
            const meine = epoche;
            sendet.value = zeile.schluessel;
            meldung.value = undefined;
            try {
                // `vorher` der Anfrage ist der heutige Stand: erst lesen, dann prüfen, dass er noch dem „nachher“ der Zeile gleicht.
                const gelesen = await lese();
                if (meine !== epoche || entsorgt) return false;
                if (!gelesen) {
                    meldung.value = { schluessel: zeile.schluessel, satz: t("entwurf.lesefehler") };
                    return false;
                }
                const jetzt = heute(zeile);
                const plan = umkehrung(zeile, jetzt);
                if (leseGrund(optionen.recht(), optionen.schreibt(), daten.value) !== undefined) return false;
                if (plan.art !== "geht") {
                    meldung.value = { schluessel: zeile.schluessel, satz: t("fenster.traegerQuellen.verlauf.anders") };
                    return false;
                }
                const aenderung = baueAenderung(zeile.sourceId, plan.handlung, jetzt);
                if (aenderung === undefined) return false;
                const antwort = await client.schreibe(z.kind, z.id, baueBody(neueOperationId(), aenderung));
                if (meine !== epoche || entsorgt) return antwort.ok;
                if (!antwort.ok) {
                    const grund = fehlerAus(antwort.status, antwort.fehler);
                    meldung.value = { schluessel: zeile.schluessel, satz: fehlerSatz(grund) };
                    if (grund.art === "konflikt") await lese();
                    return false;
                }
                await lese();
                optionen.nach?.();
                return true;
            } finally {
                if (meine === epoche && !entsorgt) sendet.value = undefined;
            }
        },
    };
}
