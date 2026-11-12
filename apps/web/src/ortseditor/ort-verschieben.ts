import { shallowRef, type ShallowRef } from "vue";
import type {
    EditorLock,
    EditorMoveTargets,
    EditorPlaceDetail,
    OperationReceipt,
    PlaceMoveBody,
} from "@avesmaps3d/shared";
import { createEntwurf, entwurfsTaste, type EntwurfLage } from "../fenster/entwurf-kern";
import { VERWERFEN_BEENDET } from "../fenster/entwurf-regeln";
import type { ApiFehler } from "./ort-bearbeitung";
import type { OrtSperre } from "./ort-sperre";
import {
    bewegung,
    quittungAus,
    startAus,
    type Punkt,
    type Quittung,
    type VerschiebeStart,
    type Zug,
} from "./verschieben";

/**
 * Die Steuerung von „✥ Ort verschieben“ (WI-0128 E12; EDIT-0001 §4.4, G4; EDIT-0003 G4, Vali 2026-10-31): ein Modus zur Zeit, ein
 * Entwurf wie in den anderen Formmodi, geschrieben erst mit „Fertig“.
 *
 * - **Start** nur ausdrücklich (Abschnitt „Lage“ im Ortseditor; Infopanel und Menü am Objekt folgen mit E15). Er liest den Ort mit
 *   Revision und Wegenden und, einmal, die freien Wegenden im Umkreis; ist der Ort nicht frei sichtbar, fliegt die Kamera hin.
 * - **Loslassen** ist ein Schritt im Entwurf (`fenster/entwurf-kern.ts`, derselbe Kern wie bei den anderen Formmodi) und schreibt nichts;
 *   der Modus bleibt offen, man zieht mehrmals. „n ungespeichert“ zählt die Schritte, ↶ ↷ (Strg+Z, Strg+Y) gehen zurück und vor,
 *   „Verwerfen“ stellt die Ausgangslage her, der Modus bleibt (F20). Die Leiste dazu steht über der Karte (`ort-verschieben-leiste.vue`).
 * - **„Fertig“** (Knopf, Enter) sendet EINE Operation `place.move` mit der letzten Lage samt Wegenden (`verschieben.ts`); die Felder des
 *   Ortseditors behalten ihre eigene Speicherleiste (`place.update` ist eine andere Operation). Ohne Schritte endet „Fertig“ still. Danach
 *   endet der Modus, die Quittung steht im Fenster.
 * - **Esc** bricht erst einen laufenden Zug ab; dann fragt es bei Ungespeichertem „Speichern · Verwerfen · Weiter bearbeiten“ (R2), ein
 *   zweites Esc verwirft und endet, ohne Schritte endet der Modus gleich. Während des Schreibens tut Esc nichts.
 * - **Das Fenster** muss nicht offen bleiben: Schließen oder Ablegen beendet den Modus nur, solange nichts ungespeichert ist (F1,
 *   „Schließen verwirft nie“; der Wächter steht in `app.vue`, `beende`).
 * - **Konflikt** (409): Der Modus endet, der Ort steht wieder, wo der Server ihn hat; die Meldung nennt wer und wann, „Erneut
 *   verschieben“ startet neu. Ob der Ort selbst oder ein Weg an ihm geändert wurde, sagt ein frisches Lesen des Orts. Jede andere
 *   Ablehnung (423, 503, keine Verbindung) lässt den Entwurf stehen; die Meldung nennt den Grund.
 * - **Sperre** (EDIT-0003 §4, WI-0208): Erst gesperrt, dann verschoben. Hält ein anderer den Ort, beginnt der Modus nicht, und die
 *   Meldung sagt, wer ihn seit wann bearbeitet. Frei wird der Ort, wenn der Modus endet. Geht die Sperre unterwegs verloren (ein Admin
 *   hebt sie auf), endet der Modus ohne Schritte; mit Schritten bleibt der Entwurf, und „Fertig“ nimmt die Sperre neu (hält sie dann
 *   ein anderer, schreibt es nicht).
 * - **Freigabe auf Bitte** (WI-0262): Bittet ein anderer um den Ort, schreibt der Entwurf wie „Fertig“; ohne Schritte endet der Modus.
 */

export interface VerschiebeApi {
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
    ziele(publicId: string, signal: AbortSignal): Promise<EditorMoveTargets | null>;
    verschiebe(
        publicId: string,
        body: PlaceMoveBody,
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }>;
}

/** Was die Karte für den Modus tut (`map/geometrie/ort.ts` und der Hinflug, in `app.vue` gebunden). */
export interface VerschiebeKarte {
    /** Der Ort in die freie Fläche neben dem Fenster `fenster` (dessen Liste eingezogen ist), wenn er nicht frei sichtbar ist. */
    zeige(start: VerschiebeStart, fenster: string): void;
    /** Schaltet den Modus auf der Karte ein; `losgelassen` meldet jeden Zug (ein Schritt des Entwurfs); ohne Karte `undefined`. */
    ein(start: VerschiebeStart, losgelassen: (zug: Zug) => void): KartenModus | undefined;
    /** Nach einem Verschieben: Ort und Wege neu zeichnen (`revision` aus der Quittung, E13). */
    geaendert(revision: number | undefined): void;
    /**
     * Nach dem Speichern sanft auf die neue Lage zentrieren, der Zoom bleibt (Betreiber 2026-10-11: „schön wärs auch wenn nach dem
     * verschieben die ansicht auf die neue position des ortes zentriert“; Hausregel „Kamera fliegt immer“). Beim Abbrechen nicht.
     * Optional: Die Karte der Seite bindet es an die Kamera.
     */
    zentriere?(punkt: Punkt, fenster: string): void;
}

export interface KartenModus {
    /** Bricht einen laufenden Zug ab; gibt zurück, ob gerade gezogen wurde. */
    abbrechen(): boolean;
    /** Setzt den Stand von außen (↶ ↷, „Verwerfen“); `undefined` ist die Ausgangslage. */
    setze(zug: Zug | undefined): void;
    /** Während gespeichert wird, packt niemand den Griff. */
    sperre(gesperrt: boolean): void;
    aus(): void;
}

interface Laufend {
    readonly fenster: string;
    readonly publicId: string;
}

/** Was die Leiste über den Entwurf zeigt: „n ungespeichert“, ↶ ↷ und die Frage beim Verlassen (`fenster/entwurf-kern.ts`). */
export type VerschiebeLage = EntwurfLage;

export type Verschiebung =
    | (Laufend & { readonly art: "laedt" })
    | (Laufend & { readonly art: "zieht"; readonly start: VerschiebeStart; readonly lage: VerschiebeLage })
    | (Laufend & { readonly art: "speichert"; readonly start: VerschiebeStart; readonly lage: VerschiebeLage });

export type VerschiebeMeldung =
    | (Laufend & { readonly art: "quittung"; readonly quittung: Quittung })
    | (Laufend & {
          readonly art: "konflikt";
          readonly wer: string | undefined;
          readonly wann: string | undefined;
          readonly revision: number;
          /** Ein Weg am Ort wurde geändert, nicht der Ort selbst. */
          readonly weg: boolean;
      })
    | (Laufend & { readonly art: "abgelehnt"; readonly satz: string });

/**
 * Was der Abschnitt „Lage“ eines Ortseditor-Fensters zum Verschieben braucht (`ortseditor-felder.vue`): Knopf oder Satz (T12.10), ob
 * der Modus läuft, die Meldung zu diesem Ort und die beiden Handgriffe.
 */
export interface LageSteuerung {
    /** Ohne `edit_map_geometry` fehlt der Knopf; ein Satz sagt warum (T12.10). */
    readonly ohneRecht: boolean;
    readonly laeuft: boolean;
    /** Solange der Modus lädt oder speichert, sagt es dieser Satz; sonst erklärt die Lage, wie der Modus geht. */
    readonly hinweis?: string | undefined;
    readonly meldung: VerschiebeMeldung | undefined;
    verschiebe(): void;
    fliege(): void;
    /** Eine Stelle der Karte zeigen („Zum nächsten“, ⊕); fehlt, wo die Seite das nicht kann (kein toter Knopf). */
    readonly zeige?: ((punkt: { x: number; y: number }) => void) | undefined;
    /** Der Ort steht noch nicht auf der Karte und darf gesetzt werden (E16): „● Auf der Karte setzen“. */
    readonly setzbar: boolean;
    /** Der Modus wartet auf den Klick, oder der Ort wird gerade gesetzt. */
    readonly setztGerade: boolean;
    /** Warum das Setzen nicht ging. */
    readonly setzSatz: string | undefined;
    setze(): void;
    /** „Ort entfernen“ öffnet das Blatt (E22); fehlt ohne Schreibrecht oder ohne Bearbeitung. */
    readonly entfernen?: (() => void) | undefined;
}

export interface OrtVerschieben {
    readonly laufend: Readonly<ShallowRef<Verschiebung | undefined>>;
    /** Die letzte Meldung (Quittung, Konflikt, Ablehnung), bis zum nächsten Start. */
    readonly meldung: Readonly<ShallowRef<VerschiebeMeldung | undefined>>;
    starte(fenster: string, publicId: string): Promise<void>;
    /** ↶ ↷: ein Schritt des Entwurfs zurück und vor. */
    zurueck(): void;
    wieder(): void;
    /** „Verwerfen“: zurück auf die Ausgangslage; der Modus bleibt (F20). */
    verwerfen(): void;
    /** „Fertig“ (Knopf, Enter): schreibt EINE `place.move` mit der letzten Lage; ohne Schritte endet der Modus still. */
    fertig(): Promise<void>;
    /** Die Antwort auf die Frage beim Verlassen (R2). */
    antworte(wahl: "speichern" | "verwerfen" | "weiter"): Promise<void>;
    /** Esc: bricht erst einen Zug ab, fragt dann bei Ungespeichertem, sonst endet der Modus. Gibt zurück, ob einer lief. */
    abbrechen(): boolean;
    /** Beendet den Modus ohne Frage und ohne zu schreiben (das Fenster ging, und es ist nichts ungespeichert). */
    beende(): void;
    destroy(): void;
}

export interface OrtVerschiebenOptionen {
    readonly api: VerschiebeApi;
    readonly karte: VerschiebeKarte;
    /** Gelesen, wenn ein Satz fehlt (`t`), damit die Rechnung ohne i18n prüfbar bleibt. */
    readonly ladefehler: string;
    readonly neueKennung?: () => string;
    /** Die Sperre des Orts (EDIT-0003 §4); ohne sie verschiebt der Modus ungesperrt (Prüfungen ohne Server). */
    readonly sperre?: VerschiebeSperre | undefined;
}

/** Die Sperre und ihre Sätze; die Sätze kommen von außen, damit die Rechnung ohne i18n prüfbar bleibt. */
export interface VerschiebeSperre {
    readonly ort: OrtSperre;
    /** „🔒 Thomas bearbeitet die Form seit 07:32. Zuletzt aktiv …“ */
    gesperrt(sperre: EditorLock): string;
    /** Der Server war nicht zu erreichen oder lehnte ab. */
    readonly fehler: string;
    /** Die Sperre ging unterwegs verloren. */
    readonly verloren: string;
}

/** Der Ort liegt noch, wo er beim Start lag: Da gibt es nichts zu schreiben. */
const amStart = (start: VerschiebeStart, zug: Zug): boolean => zug.ort.x === start.von.x && zug.ort.y === start.von.y;

/** Zwei Stände sind dieselbe Lage: derselbe Ort, beide gelöst oder beide nicht (das Einrasten folgt dem Ort). */
const gleicheLage = (a: Zug, b: Zug): boolean =>
    a.ort.x === b.ort.x && a.ort.y === b.ort.y && a.getrennt === b.getrennt;

export function createOrtVerschieben(optionen: OrtVerschiebenOptionen): OrtVerschieben {
    const { api, karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<Verschiebung | undefined>(undefined);
    const meldung = shallowRef<VerschiebeMeldung | undefined>(undefined);
    /** Der Entwurf: der Start ist die Ausgangslage, jeder Schritt ein Zug (derselbe Kern wie bei den anderen Formmodi). */
    const entwurf = createEntwurf<Zug>();
    /** Wer verschiebt und was beim Start galt, solange der Modus läuft. */
    let sitzung: { readonly wer: Laufend; readonly start: VerschiebeStart } | undefined;
    /** Zählt die Läufe: Eine späte Antwort gehört nicht mehr zum nächsten Modus. */
    let epoche = 0;
    let modus: KartenModus | undefined;
    let abbruch: AbortController | undefined;
    /** Der Ort, dessen Sperre dieser Modus hält; `halter` ist dieser Modus gegenüber den Fenstern am selben Ort. */
    let gesperrt: string | undefined;
    const halter = {};
    /** Die Anmeldung zur Freigabe auf Bitte (WI-0262), solange der Modus die Sperre hält. */
    let angebot: (() => void) | undefined;
    let tastenAb: (() => void) | undefined;

    /** Zeigt den Stand des Entwurfs (Schritte, ↶ ↷, Frage) in `laufend`. */
    function zeige(art: "zieht" | "speichert" = "zieht"): void {
        const jetzt = laufend.value;
        if (jetzt === undefined || jetzt.art === "laedt") return;
        laufend.value = { ...jetzt, art, lage: entwurf.lage() };
    }

    /** Beendet den Modus, ohne den Entwurf zu schreiben: Bild weg, Sperre frei, Entwurf vergessen. */
    function beende(): void {
        abbruch?.abort();
        abbruch = undefined;
        modus?.aus();
        modus = undefined;
        angebot?.();
        angebot = undefined;
        tastenAb?.();
        tastenAb = undefined;
        if (gesperrt !== undefined) optionen.sperre?.ort.gib(gesperrt, halter);
        gesperrt = undefined;
        entwurf.leere();
        sitzung = undefined;
        epoche += 1;
        laufend.value = undefined;
    }

    // --- Der Entwurf ---
    /** Ein Zug ist ein Schritt; liegt der Ort danach, wo er schon lag, ist es keiner. */
    function losgelassen(zug: Zug): void {
        if (laufend.value?.art !== "zieht") return;
        const bisher = entwurf.jetzt();
        if (bisher !== undefined && gleicheLage(bisher, zug)) {
            modus?.setze(bisher);
            return;
        }
        entwurf.schritt(zug);
        zeige();
    }
    function schrittGeaendert(): void {
        modus?.setze(entwurf.jetzt());
        zeige();
    }
    function zurueck(): void {
        if (laufend.value?.art === "zieht" && entwurf.zurueck()) schrittGeaendert();
    }
    function wieder(): void {
        if (laufend.value?.art === "zieht" && entwurf.wieder()) schrittGeaendert();
    }
    function verwerfen(): void {
        if (laufend.value?.art !== "zieht") return;
        entwurf.verwerfen();
        modus?.setze(entwurf.jetzt());
        if (VERWERFEN_BEENDET) beende();
        else zeige();
    }

    /** Enter ist „Fertig“, Strg+Z und Strg+Y gehen zurück und vor (T27 (7)); nie in einem Textfeld, nie doppelt auf einem Knopf. */
    function taste(event: KeyboardEvent): void {
        if (laufend.value?.art !== "zieht") return;
        const ziel = event.target as HTMLElement | null;
        if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (ziel?.closest?.("button, a")) return;
            event.preventDefault();
            void fertig();
            return;
        }
        const welche = entwurfsTaste(event);
        if (welche === undefined) return;
        event.preventDefault();
        if (welche === "wieder") wieder();
        else zurueck();
    }

    // --- Sperre und Freigabe auf Bitte ---
    const bieteAn = (id: string): void => {
        if (angebot !== undefined || optionen.sperre?.ort.biete === undefined) return;
        angebot = optionen.sperre.ort.biete(id, {
            // Wie „Fertig“: Der Entwurf wird geschrieben und der Ort frei; ohne Schritte endet der Modus einfach.
            async speichere() {
                const jetzt = laufend.value;
                if (jetzt?.art === "speichert") return { ok: false, grund: undefined };
                if (jetzt === undefined) return { ok: true };
                await fertig();
                const danach = meldung.value;
                if (laufend.value === undefined && danach?.art !== "konflikt" && danach?.art !== "abgelehnt")
                    return { ok: true };
                return { ok: false, grund: danach?.art === "abgelehnt" ? danach.satz : undefined };
            },
        });
    };
    const abmelden = optionen.sperre?.ort.beiVerlust((id) => {
        const jetzt = laufend.value;
        if (id !== gesperrt || jetzt === undefined) return;
        gesperrt = undefined;
        angebot?.();
        angebot = undefined;
        // Gesendet ist gesendet; vorher endet der Modus, und die Meldung sagt warum. Mit Schritten bleibt der Entwurf stehen
        // („Schließen verwirft nie“): „Fertig“ nimmt die Sperre dann neu.
        if (jetzt.art === "speichert") return;
        const wer = { fenster: jetzt.fenster, publicId: jetzt.publicId };
        if (jetzt.art === "laedt" || jetzt.lage.ungespeichert === 0) {
            modus?.abbrechen();
            beende();
        }
        meldung.value = { ...wer, art: "abgelehnt", satz: optionen.sperre!.verloren };
    });

    // --- „Fertig“ ---
    async function fertig(): Promise<void> {
        const jetzt = laufend.value;
        const lauf = sitzung;
        if (jetzt?.art !== "zieht" || lauf === undefined) return;
        const { wer, start } = lauf;
        const zug = entwurf.jetzt();
        // Ohne Schritte, oder wenn der Ort wieder am Start liegt, gibt es nichts zu schreiben: „Fertig“ beendet den Modus still.
        if (zug === undefined || entwurf.lage().ungespeichert === 0 || amStart(start, zug)) {
            modus?.abbrechen();
            beende();
            return;
        }
        const meiner = epoche;
        zeige("speichert");
        modus?.sperre(true);
        // Ging die Sperre inzwischen verloren, nimmt „Fertig“ sie neu; hält sie ein anderer, schreibt nichts.
        if (optionen.sperre !== undefined && gesperrt === undefined) {
            const sperre = await optionen.sperre.ort.nimm(wer.publicId, "form", halter);
            if (epoche !== meiner) {
                if (sperre.art === "genommen") optionen.sperre.ort.gib(wer.publicId, halter);
                return;
            }
            if (sperre.art !== "genommen") {
                modus?.sperre(false);
                zeige();
                const satz =
                    sperre.art === "gesperrt" ? optionen.sperre.gesperrt(sperre.sperre) : optionen.sperre.fehler;
                meldung.value = { ...wer, art: "abgelehnt", satz };
                return;
            }
            gesperrt = wer.publicId;
            bieteAn(wer.publicId);
        }
        const antwort = await api.verschiebe(wer.publicId, bewegung(start, zug, neueKennung()));
        if (epoche !== meiner || laufend.value?.art !== "speichert") return;
        if (antwort.ok) {
            beende();
            meldung.value = { ...wer, art: "quittung", quittung: quittungAus(start, zug, antwort.quittung) };
            karte.geaendert(antwort.quittung.mapRevision);
            karte.zentriere?.(zug.ort, wer.fenster);
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string; currentRevision?: number } | undefined;
            const signal = new AbortController().signal;
            const frisch = await api.ort(wer.publicId, signal).catch(() => null);
            if (epoche !== meiner) return;
            modus?.abbrechen();
            beende();
            meldung.value = {
                ...wer,
                art: "konflikt",
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
                revision: frisch?.revision ?? details?.currentRevision ?? start.revision,
                weg: frisch !== null && frisch.revision === start.revision,
            };
            return;
        }
        // Jede andere Ablehnung (423, 503, keine Verbindung): Der Entwurf bleibt, die Meldung nennt den Grund.
        modus?.sperre(false);
        zeige();
        meldung.value = { ...wer, art: "abgelehnt", satz: antwort.fehler.message };
    }

    return {
        laufend,
        meldung,
        async starte(fenster, publicId) {
            const jetzt = laufend.value;
            if (jetzt?.art === "speichert") return;
            if (jetzt?.fenster === fenster && jetzt.publicId === publicId) return;
            // Ein Entwurf mit Schritten wird nicht still durch einen neuen Start verworfen.
            if (jetzt?.art === "zieht" && jetzt.lage.ungespeichert > 0) return;
            beende();
            meldung.value = undefined;
            const wer = { fenster, publicId };
            laufend.value = { ...wer, art: "laedt" };
            const eigene = new AbortController();
            abbruch = eigene;
            const [ort, ziele] = await Promise.all([
                api.ort(publicId, eigene.signal).catch(() => null),
                api.ziele(publicId, eigene.signal).catch(() => null),
            ]);
            if (eigene.signal.aborted) return;
            if (ort === null || ziele === null || ort.position === undefined) {
                abbruch = undefined;
                laufend.value = undefined;
                meldung.value = { ...wer, art: "abgelehnt", satz: optionen.ladefehler };
                return;
            }
            // Erst gesperrt, dann verschoben (EDIT-0003 §4): Hält ein anderer den Ort, beginnt der Modus nicht. Bis hierher bleibt
            // `abbruch` gesetzt, damit Esc oder ein neuer Start während der Frage erkannt wird.
            if (optionen.sperre !== undefined) {
                const sperre = await optionen.sperre.ort.nimm(publicId, "form", halter);
                if (eigene.signal.aborted) {
                    if (sperre.art === "genommen") optionen.sperre.ort.gib(publicId, halter);
                    return;
                }
                if (sperre.art !== "genommen") {
                    abbruch = undefined;
                    laufend.value = undefined;
                    const satz =
                        sperre.art === "gesperrt" ? optionen.sperre.gesperrt(sperre.sperre) : optionen.sperre.fehler;
                    meldung.value = { ...wer, art: "abgelehnt", satz };
                    return;
                }
                gesperrt = publicId;
                bieteAn(publicId);
            }
            abbruch = undefined;
            const start = startAus(ort, ziele.freeEnds);
            entwurf.beginne({ ort: start.von, getrennt: false, eingerastet: undefined });
            sitzung = { wer, start };
            const ein = karte.ein(start, losgelassen);
            if (ein === undefined) {
                beende();
                return;
            }
            modus = ein;
            laufend.value = { ...wer, art: "zieht", start, lage: entwurf.lage() };
            if (typeof document !== "undefined") {
                document.addEventListener("keydown", taste);
                tastenAb = () => document.removeEventListener("keydown", taste);
            }
            karte.zeige(start, fenster);
        },
        zurueck,
        wieder,
        verwerfen,
        fertig,
        async antworte(wahl) {
            if (laufend.value?.art !== "zieht") return;
            if (wahl === "speichern") {
                entwurf.antworte(false);
                zeige();
                await fertig();
                return;
            }
            if (entwurf.antworte(wahl === "verwerfen") === "ende") {
                modus?.abbrechen();
                beende();
            } else zeige();
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined || jetzt.art === "speichert") return false;
            if (jetzt.art === "laedt") {
                beende();
                return true;
            }
            // Esc bricht erst einen laufenden Zug ab (der Ort geht zurück); dann fragt es bei Ungespeichertem, sonst endet der Modus.
            if (modus?.abbrechen() === true) return true;
            if (entwurf.esc() === "frage") {
                zeige();
                return true;
            }
            beende();
            return true;
        },
        beende,
        destroy() {
            beende();
            abmelden?.();
        },
    };
}
