import { shallowRef, type ShallowRef } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { isMessageKey, t } from "../i18n/i18n";
import type { Antwort, BearbeitungsLage, BearbeitungsZustand } from "./bearbeitung";
import { createEntwurf } from "./entwurf-kern";
import type { SchreibAntwort } from "./entwurf-senden";

/**
 * Die Felder einer Mehrfachauswahl (EDIT-0003 T57; Betreiber 2026-10-19 zu Fassung 5 der Gebiete, wörtlich: „perfekt genau das wollen
 * wir“; Probierseite https://claude.ai/artifact/HhKu7U5yJamSVeq7unPa9L): EIN Bauteil für alle Editoren. Die Liste mit Umschalter und
 * Häkchen steht in `editor-liste/editor-liste.vue` (`v-model:mehrfach`, `v-model:angehakt`), ihre Rechnung in
 * `editor-liste/mehrfachauswahl.ts`.
 *
 * ## Was ein Editor liefert (`SammelArt`)
 *
 * - `gemeinsam`: je gemeinsamem Feld, wie man seinen Wert an einem Objekt liest. Gemeinsam ist, was für jedes gewählte Objekt denselben
 *   Sinn hat (T57: „Entfernen …“, ↺ auf Wiki-Werte, dazu je Editor die schreibbaren Felder mit einem Wert für alle).
 * - `einzeln`: die Felder, die nur einzeln gehen (Name, Kurzname, Form, Anlegen, Teilen …): Sie stehen in der Mehrfachauswahl gesperrt
 *   mit „Nur einzeln“ da (`sammel-hinweis.vue`), Reiter, die nicht gehen, grau (`fenster-reiter.vue`, `spaeter`).
 * - `schreibe(ids, aenderungen, operationId)`: ALLE Änderungen für ALLE gewählten Objekte als EINE Operation (ein Schreibaufruf; im
 *   Verlauf steht sie je Objekt, ↺ dort nimmt sie je Objekt zurück). Sperren und Revisionen prüft der Server wie bei jeder Operation.
 * - „Entfernen …“ bleibt das Blatt des Editors; es bekommt die gewählten Objekte statt eines.
 *
 * ## Was dieses Bauteil gibt
 *
 * - `ueberAlle(objekte, lies)`: gleich (mit Wert) oder gemischt. Ein gemischtes Feld zeigt `t("fenster.sammel.gemischt")` als Platzhalter
 *   und überschreibt erst, wenn man es ändert; danach steht „gilt für alle n“ daran (`sammel-hinweis.vue`).
 * - `createSammelEntwurf(art, ids)`: die Änderungen je Feld und die Wiki-Felder, die auf den Wiki-Wert gehen, mit ↶ ↷, Zählung,
 *   Verwerfen und „Fertig“. Er hat die Form einer Bearbeitung (`zustand`, `lage`, `zurueck`, `wieder`, `verwerfen`, `fertig`,
 *   `antworte`), also dieselbe Leiste (`entwurf-leiste.vue`). Er hält keine Sperren und sichert nicht im Browser: Die Auswahl ist
 *   flüchtig, ein Wechsel der Auswahl beginnt einen neuen Entwurf.
 */

/** Der Wert eines Felds über alle gewählten Objekte: gleich (mit Wert) oder gemischt. */
export type Ueber<T> = { readonly gleich: true; readonly wert: T } | { readonly gleich: false };

/** Gleich oder gemischt; ohne Objekte gemischt. `gleich` vergleicht zwei Werte (Vorgabe `Object.is`). */
export function ueberAlle<O, T>(
    objekte: readonly O[],
    lies: (objekt: O) => T,
    gleich: (a: T, b: T) => boolean = Object.is,
): Ueber<T> {
    if (objekte.length === 0) return { gleich: false };
    const erster = lies(objekte[0]!);
    return objekte.every((objekt) => gleich(lies(objekt), erster)) ? { gleich: true, wert: erster } : { gleich: false };
}

/** Was „Fertig“ schreibt: die geänderten gemeinsamen Felder und die Wiki-Felder, die für alle auf den Wiki-Wert gehen. */
export interface SammelAenderungen<F extends object> {
    readonly felder: Partial<F>;
    readonly wiki: readonly string[];
}

/** Was ein Editor für die Mehrfachauswahl liefert (siehe oben). `O` ist ein gewähltes Objekt, `F` die gemeinsamen Felder. */
export interface SammelArt<O, F extends object> {
    readonly gemeinsam: { readonly [K in keyof F]-?: (objekt: O) => F[K] };
    readonly einzeln: readonly string[];
    schreibe(
        ids: readonly string[],
        aenderungen: SammelAenderungen<F>,
        operationId: string,
    ): Promise<SchreibAntwort<OperationReceipt>>;
}

export interface SammelEntwurf<F extends object> {
    /** Die gewählten Objekte, für die er schreibt. */
    readonly ids: readonly string[];
    readonly stand: Readonly<ShallowRef<SammelAenderungen<F>>>;
    /** Ein gemeinsames Feld für alle setzen (Tippen in dasselbe Feld verschmilzt zu einem Schritt). */
    setze<K extends keyof F>(feld: K, wert: F[K]): void;
    /** Ein Wiki-Feld für alle auf den Wiki-Wert (↺). */
    aufWiki(feld: string): void;
    /** Ist das Feld geändert (gilt für alle) oder geht es für alle auf den Wiki-Wert? */
    geaendert(feld: string): boolean;
    readonly zustand: Readonly<ShallowRef<BearbeitungsZustand<never>>>;
    readonly lage: Readonly<ShallowRef<BearbeitungsLage>>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): Promise<void>;
    antworte(wahl: Antwort): Promise<void>;
    /** Escape: mit Ungeschriebenem die Frage, sonst `zu`. */
    esc(): "frage" | "zu";
}

export interface SammelOptionen {
    readonly neueKennung?: () => string;
    /** Geschrieben: die Quittung (Kachelrevision, Folgearbeit) an den Editor; er liest Liste und Objekte neu. */
    readonly geschrieben?: (quittung: OperationReceipt) => void;
}

const LEER = { felder: {}, wiki: [] } as const;

export function createSammelEntwurf<F extends object>(
    art: Pick<SammelArt<unknown, F>, "schreibe">,
    ids: readonly string[],
    optionen: SammelOptionen = {},
): SammelEntwurf<F> {
    const neueKennung = optionen.neueKennung ?? (() => crypto.randomUUID());
    const kern = createEntwurf<SammelAenderungen<F>>();
    kern.beginne(LEER as SammelAenderungen<F>);
    const stand = shallowRef<SammelAenderungen<F>>(LEER as SammelAenderungen<F>);
    const zustand = shallowRef<BearbeitungsZustand<never>>({ art: "bereit" });
    const lage = shallowRef<BearbeitungsLage>({ ...kern.lage(), aktiv: false, form: false });
    const zeige = (): void => {
        stand.value = kern.jetzt() ?? (LEER as SammelAenderungen<F>);
        const kernLage = kern.lage();
        lage.value = { ...kernLage, aktiv: kernLage.ungespeichert > 0, form: false };
    };
    const schritt = (neu: SammelAenderungen<F>, verschmelze?: string): void => {
        if (zustand.value.art !== "bereit") zustand.value = { art: "bereit" };
        kern.schritt(neu, verschmelze);
        zeige();
    };
    async function fertig(): Promise<void> {
        const jetzt = stand.value;
        if (Object.keys(jetzt.felder).length === 0 && jetzt.wiki.length === 0) return;
        zustand.value = { art: "speichert" };
        const antwort = await art.schreibe(ids, jetzt, neueKennung());
        if (!antwort.ok) {
            const key = `entwurf.fehler.${antwort.fehler.code}`;
            zustand.value = {
                art: "abgelehnt",
                code: antwort.fehler.code,
                satz: isMessageKey(key) ? t(key) : antwort.fehler.message,
            };
            return;
        }
        kern.beginne(LEER as SammelAenderungen<F>);
        zeige();
        zustand.value = {
            art: "gespeichert",
            revision: undefined,
            befunde: antwort.quittung.warnings.map((befund) => {
                const key = `entwurf.befund.${befund.code}`;
                return isMessageKey(key) ? t(key) : befund.message;
            }),
            mapRevision: antwort.quittung.mapRevision,
        };
        optionen.geschrieben?.(antwort.quittung);
    }
    return {
        ids,
        stand,
        setze(feld, wert) {
            const jetzt = stand.value;
            schritt({ felder: { ...jetzt.felder, [feld]: wert }, wiki: jetzt.wiki }, `feld:${String(feld)}`);
        },
        aufWiki(feld) {
            const jetzt = stand.value;
            if (jetzt.wiki.includes(feld)) return;
            schritt({ felder: jetzt.felder, wiki: [...jetzt.wiki, feld] });
        },
        geaendert(feld) {
            return feld in stand.value.felder || stand.value.wiki.includes(feld);
        },
        zustand,
        lage,
        zurueck() {
            kern.zurueck();
            zeige();
        },
        wieder() {
            kern.wieder();
            zeige();
        },
        verwerfen() {
            kern.verwerfen();
            zeige();
        },
        fertig,
        async antworte(wahl) {
            if (wahl === "speichern") {
                kern.antworte(false);
                await fertig();
            } else kern.antworte(wahl === "verwerfen");
            zeige();
        },
        esc() {
            const ergebnis = kern.esc();
            zeige();
            return ergebnis === "frage" ? "frage" : "zu";
        },
    };
}
