import { computed, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import type {
    ApiErrorBody,
    EditorLock,
    EditorPlaceDetail,
    OperationReceipt,
    PlaceUpdateBody,
} from "@avesmaps3d/shared";
import {
    aenderungen,
    aufNeuenStand,
    entwurfAus,
    fremdeFelder,
    geaendert,
    ueberschneiden,
    type Aenderungen,
    type Entwurf,
    type EntwurfFeld,
} from "./entwurf";
import type { FreigabeAusgang } from "../editor-sperre/sperre";
import type { OrtSperre } from "./ort-sperre";

/**
 * Die Bearbeitung eines Orts in einem Ortseditor-Fenster (WI-0128 E11; EDIT-0001 §4.3; Gesamtmockup Version 7): der gelesene Stand
 * (`GET /api/editor/places/:id`, mit Revision), der Entwurf, die Speicherleiste und ihre Zustände.
 *
 * - **Speichern** sendet nur die Änderungen gegenüber dem gelesenen Stand, mit dessen Revision (`place.update`, eine Operation) und
 *   einer neuen Kennung je Handlung. Danach liest es den Ort neu: Der Entwurf ist wieder der Stand.
 * - **Konflikt** (409 `edit_conflict`): Es liest den jetzigen Stand und vergleicht ihn mit dem gelesenen; überschneiden sich die Felder
 *   nicht, darf die eigene Änderung auf den neuen Stand („Eigene Änderung auf Revision N anwenden“), sonst nur mit „Trotzdem
 *   überschreiben“. „Fremden Stand übernehmen“ verwirft den eigenen Entwurf.
 * - **Abgelehnt** (403, 423 `map_locked`/`map_editing_off`, 503 `map_import_running`, 400): Der Satz des Servers steht in der Leiste,
 *   der Entwurf bleibt.
 * - Der Entwurf lebt so lange wie das Fenster, auch abgelegt (D19); Schließen verwirft ihn nie.
 * - **Nach einem Verschieben** (E12, T12.8) liest sie den Ort neu und rückt ihre Basis auf die neue Revision vor; der Entwurf behält
 *   seine Änderungen. Die Lage gehört nicht zum Entwurf, so entsteht kein Konflikt mit sich selbst.
 * - **Sperre** (EDIT-0003 §4, WI-0208): Die erste Änderung eines unveränderten Entwurfs nimmt die Sperre des Orts („die
 *   Eigenschaften“). Hält ein anderer den Ort, nimmt sie die Änderung zurück, und die Leiste sagt, wer ihn seit wann bearbeitet: Das
 *   Bearbeiten beginnt nicht. Frei wird der Ort, sobald nichts mehr ungespeichert ist (gespeichert, verworfen, übernommen) oder das
 *   Fenster geht. Geht die Sperre verloren (abgelaufen, aufgehoben), bleibt der Entwurf; Speichern sperrt neu, wenn der Ort frei ist.
 * - **Freigabe auf Bitte** (WI-0262): Hält das Fenster die Sperre, meldet es an, wie es sich beenden lässt: speichern, und der Ort wird frei.
 *   Scheitert das Speichern, bleibt alles, wie es war, und der Satz geht als Grund zurück.
 */

export type ApiFehler = ApiErrorBody["error"];

/** Die Sperre des Orts und ihre Sätze; die Sätze kommen von außen, damit die Rechnung ohne i18n prüfbar bleibt. */
export interface BearbeitungsSperre {
    readonly ort: OrtSperre;
    /** „🔒 Thomas bearbeitet die Eigenschaften seit 07:32. Zuletzt aktiv …“ */
    gesperrt(sperre: EditorLock): string;
    /** Der Server war nicht zu erreichen oder lehnte ab. */
    readonly fehler: string;
    /** Die Sperre ging verloren; der Entwurf bleibt. */
    readonly verloren: string;
    /** Warum die Freigabe auf Bitte im Konflikt stehen bleibt (WI-0262); ohne Satz nennt der Hinweis keinen besonderen Grund. */
    readonly freigabeKonflikt?: string;
}

/** Was der Ortseditor zum Bearbeiten liest und schreibt (`ortseditor-daten.ts`). */
export interface OrtApi {
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
    speichereOrt(
        publicId: string,
        body: PlaceUpdateBody,
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }>;
}

export type BearbeitungsZustand =
    | { art: "laedt" }
    | { art: "fehlt" }
    | { art: "lesefehler" }
    | { art: "bereit" }
    | { art: "speichert" }
    | { art: "gespeichert"; revision: number; befunde: string[]; mapRevision?: number | undefined }
    | {
          art: "konflikt";
          jetzt: EditorPlaceDetail;
          wer: string | undefined;
          wann: string | undefined;
          eigene: EntwurfFeld[];
          fremde: EntwurfFeld[];
          beide: EntwurfFeld[];
      }
    | { art: "abgelehnt"; code: string; satz: string };

export interface OrtBearbeitung {
    readonly detail: Readonly<ShallowRef<EditorPlaceDetail | undefined>>;
    readonly entwurf: Readonly<ShallowRef<Entwurf | undefined>>;
    readonly zustand: Readonly<ShallowRef<BearbeitungsZustand>>;
    readonly aenderung: ComputedRef<Aenderungen>;
    readonly geaenderteFelder: ComputedRef<EntwurfFeld[]>;
    readonly ungespeichert: ComputedRef<boolean>;
    aendere(neu: (entwurf: Entwurf) => Entwurf): void;
    verwerfen(): void;
    speichern(): Promise<void>;
    /** Im Konflikt: die eigenen Änderungen auf den jetzigen Stand (`trotzdem` auch bei Überschneidung). */
    eigeneAnwenden(trotzdem?: boolean): Promise<void>;
    /** Im Konflikt: den jetzigen Stand übernehmen, den eigenen Entwurf verwerfen. */
    fremdenUebernehmen(): void;
    /** Der Ort wurde verschoben: neu lesen, die Basis vorrücken, den Entwurf behalten (E12, T12.8). */
    nachVerschieben(): Promise<void>;
    destroy(): void;
}

export function createOrtBearbeitung(
    publicId: string,
    api: OrtApi,
    neueKennung: () => string = () => crypto.randomUUID(),
    sperre?: BearbeitungsSperre,
): OrtBearbeitung {
    const detail = shallowRef<EditorPlaceDetail | undefined>(undefined);
    const entwurf = shallowRef<Entwurf | undefined>(undefined);
    const zustand = shallowRef<BearbeitungsZustand>({ art: "laedt" });
    const abbruch = new AbortController();

    const aenderung = computed<Aenderungen>(() =>
        detail.value && entwurf.value ? aenderungen(detail.value, entwurf.value) : ({} as Aenderungen),
    );
    const geaenderteFelder = computed(() => geaendert(aenderung.value));
    const ungespeichert = computed(() => geaenderteFelder.value.length > 0);

    /** Hält dieses Fenster die Sperre des Orts? `halter` ist dieses Fenster gegenüber „Ort verschieben“ und anderen Fenstern. */
    let gehalten = false;
    let fragt: Promise<boolean> | undefined;
    const halter = {};
    /** Die Anmeldung zur Freigabe auf Bitte, solange das Fenster die Sperre hält. */
    let angebot: (() => void) | undefined;
    const zieheAngebotZurueck = (): void => {
        angebot?.();
        angebot = undefined;
    };
    /** Auf Bitte um Freigabe: speichern; der Ort wird frei, sobald nichts mehr ungespeichert ist. */
    async function speichereFuerFreigabe(): Promise<FreigabeAusgang> {
        if (!gehalten) return { ok: true };
        await speichern();
        if (!gehalten) return { ok: true };
        const z = zustand.value;
        return {
            ok: false,
            grund: z.art === "abgelehnt" ? z.satz : z.art === "konflikt" ? sperre?.freigabeKonflikt : undefined,
        };
    }
    const bieteAn = (): void => {
        if (angebot !== undefined || sperre?.ort.biete === undefined) return;
        angebot = sperre.ort.biete(publicId, { titel: detail.value?.name, speichere: speichereFuerFreigabe });
    };

    /** Nimmt die Sperre, wenn sie nicht schon gehalten wird; `false` mit dem Satz in der Leiste, wenn nicht. */
    function sichere(): Promise<boolean> {
        if (sperre === undefined || gehalten) return Promise.resolve(true);
        fragt ??= sperre.ort.nimm(publicId, "felder", halter).then((ergebnis) => {
            fragt = undefined;
            if (ergebnis.art === "genommen") {
                // Inzwischen geschlossen oder alles zurückgenommen: gleich wieder frei.
                if (abbruch.signal.aborted || !ungespeichert.value) sperre.ort.gib(publicId, halter);
                else {
                    gehalten = true;
                    bieteAn();
                }
                return true;
            }
            if (abbruch.signal.aborted) return false;
            const satz = ergebnis.art === "gesperrt" ? sperre.gesperrt(ergebnis.sperre) : sperre.fehler;
            zustand.value = { art: "abgelehnt", code: "object_locked", satz };
            return false;
        });
        return fragt;
    }

    function gibFrei(): void {
        if (!gehalten) return;
        gehalten = false;
        zieheAngebotZurueck();
        sperre?.ort.gib(publicId, halter);
    }

    // Nichts mehr ungespeichert (gespeichert, verworfen, übernommen, alles zurückgenommen): Der Ort wird frei.
    const halteNurMitEntwurf = watch(
        ungespeichert,
        (ja) => {
            if (!ja) gibFrei();
        },
        { flush: "sync" },
    );
    const abmelden = sperre?.ort.beiVerlust((id) => {
        if (id !== publicId || !gehalten) return;
        gehalten = false;
        zieheAngebotZurueck();
        if (zustand.value.art !== "speichert")
            zustand.value = { art: "abgelehnt", code: "lock_lost", satz: sperre.verloren };
    });

    async function lies(): Promise<EditorPlaceDetail | null | undefined> {
        try {
            return await api.ort(publicId, abbruch.signal);
        } catch {
            return undefined;
        }
    }

    /** Den Ort (neu) lesen; der Entwurf wird der gelesene Stand. */
    async function laden(nachher?: BearbeitungsZustand): Promise<void> {
        const gelesen = await lies();
        if (abbruch.signal.aborted) return;
        if (gelesen === undefined) {
            zustand.value = { art: "lesefehler" };
            return;
        }
        if (gelesen === null) {
            zustand.value = { art: "fehlt" };
            return;
        }
        detail.value = gelesen;
        entwurf.value = entwurfAus(gelesen);
        zustand.value = nachher ?? { art: "bereit" };
    }

    /** Sendet Änderungen auf einen Stand; danach gespeichert, Konflikt oder abgelehnt. */
    async function sende(aenderungen: Aenderungen, baseRevision: number, basis: EditorPlaceDetail): Promise<void> {
        zustand.value = { art: "speichert" };
        const antwort = await api.speichereOrt(publicId, {
            operationId: neueKennung(),
            baseRevision,
            changes: aenderungen,
        });
        if (abbruch.signal.aborted) return;
        if (antwort.ok) {
            const ort = antwort.quittung.affected.find((x) => x.kind === "place");
            await laden({
                art: "gespeichert",
                revision: ort?.revision ?? baseRevision + 1,
                befunde: antwort.quittung.warnings.map((befund) => befund.message),
                mapRevision: antwort.quittung.mapRevision,
            });
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const jetzt = await lies();
            if (abbruch.signal.aborted) return;
            if (!jetzt) {
                zustand.value = { art: "abgelehnt", code: antwort.fehler.code, satz: antwort.fehler.message };
                return;
            }
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
            const eigene = geaendert(aenderungen);
            const fremde = fremdeFelder(basis, jetzt);
            zustand.value = {
                art: "konflikt",
                jetzt,
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
                eigene,
                fremde,
                beide: ueberschneiden(eigene, fremde),
            };
            return;
        }
        zustand.value = { art: "abgelehnt", code: antwort.fehler.code, satz: antwort.fehler.message };
    }

    async function speichern(): Promise<void> {
        const basis = detail.value;
        if (basis === undefined || !ungespeichert.value) return;
        if (zustand.value.art === "speichert" || zustand.value.art === "konflikt") return;
        // Ging die Sperre verloren, sperrt Speichern neu; hält ein anderer den Ort, bleibt der Entwurf ungespeichert.
        if (!(await sichere()) || abbruch.signal.aborted) return;
        await sende(aenderung.value, basis.revision, basis);
    }

    void laden();

    return {
        detail,
        entwurf,
        zustand,
        aenderung,
        geaenderteFelder,
        ungespeichert,
        aendere(neu) {
            if (entwurf.value === undefined) return;
            const vorher = ungespeichert.value;
            entwurf.value = neu(entwurf.value);
            const art = zustand.value.art;
            if (art === "gespeichert" || art === "abgelehnt") zustand.value = { art: "bereit" };
            // Die erste Änderung nimmt die Sperre. Hält ein anderer den Ort, wird sie zurückgenommen: Das Bearbeiten beginnt nicht.
            if (vorher || !ungespeichert.value) return;
            void sichere().then((ok) => {
                if (!ok && detail.value !== undefined && !abbruch.signal.aborted)
                    entwurf.value = entwurfAus(detail.value);
            });
        },
        verwerfen() {
            if (detail.value === undefined) return;
            entwurf.value = entwurfAus(detail.value);
            zustand.value = { art: "bereit" };
        },
        speichern,
        async eigeneAnwenden(trotzdem = false) {
            const stand = zustand.value;
            const basis = detail.value;
            if (stand.art !== "konflikt" || basis === undefined) return;
            if (stand.beide.length > 0 && !trotzdem) return;
            // Nur die EIGENEN Änderungen, gerechnet gegen den gelesenen Stand: Was der andere geändert hat, bleibt.
            await sende(aenderung.value, stand.jetzt.revision, basis);
        },
        fremdenUebernehmen() {
            const stand = zustand.value;
            if (stand.art !== "konflikt") return;
            detail.value = stand.jetzt;
            entwurf.value = entwurfAus(stand.jetzt);
            zustand.value = { art: "bereit" };
        },
        async nachVerschieben() {
            const vorher = detail.value;
            const jetzt = await lies();
            if (abbruch.signal.aborted || !jetzt) return;
            const laufend = entwurf.value;
            detail.value = jetzt;
            entwurf.value = vorher && laufend ? aufNeuenStand(vorher, jetzt, laufend) : entwurfAus(jetzt);
            // Ein Konflikt oder ein laufendes Speichern bleibt stehen; sonst ist der neue Stand bereit.
            const art = zustand.value.art;
            if (art !== "konflikt" && art !== "speichert") zustand.value = { art: "bereit" };
        },
        destroy() {
            abbruch.abort();
            halteNurMitEntwurf();
            abmelden?.();
            gibFrei();
        },
    };
}
