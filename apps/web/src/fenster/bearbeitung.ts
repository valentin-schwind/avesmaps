import { shallowRef, type ShallowRef } from "vue";
import type { EditorLockKind, EditorLockPart, FeldHerkunft, OperationReceipt } from "@avesmaps3d/shared";
import type { EditorSperre, FreigabeAusgang } from "../editor-sperre/sperre";
import { isMessageKey, t } from "../i18n/i18n";
import { createEntwurf, type Entwurf, type EntwurfLage } from "./entwurf-kern";
import { VERWERFEN_BEENDET } from "./entwurf-regeln";
import type { SchreibAntwort } from "./entwurf-senden";
import { folgeArbeit, type FolgeArbeit, type FolgeAuftrag } from "./folge-arbeit";
import { lies as liesGesichert, sichere as sichereImBrowser, vergiss } from "./entwurf-sicherung";

export type { SchreibAntwort } from "./entwurf-senden";

/**
 * Der gemeinsame Fensterrumpf (O3; EDIT-0003 §6 „Gemeinsame Pakete“, G4, G5, T27 (4), (5), (7), F20, R1, R2, §4 Sperre; EDIT-0001 §4.3
 * und D19; Festlegungen der Editor-Orchestrierung vom 2026-10-17): EIN Entwurf je Objekt für Felder UND Form, geschrieben mit EINEM
 * „Fertig“ als EINE Operation. Reine Rechnung mit Vue-Refs, ohne Karte und ohne Fenster, damit Vitest sie prüft.
 *
 * ## Die Schnittstelle
 *
 * **Eine Art** (`BearbeitungsArt<D, F, G, B>`) sagt, was gelesen und geschrieben wird; alles andere ist für alle Editoren gleich.
 * `D` ist der gelesene Stand (mit Revision), `F` die Felder des Entwurfs, `G` die Form, `B` der Körper der EINEN Operation.
 *
 * | Griff | Fläche (B2) | Gebiet | Weg | Kraftlinie | Ort |
 * |---|---|---|---|---|---|
 * | `sperrArt` | `landscape` | `territory` | `path` | `powerline` | `place` |
 * | `lade` | `GET /api/editor/landscapes/:id` | Gebietsdetail | Wegdetail | Linie | Ort |
 * | `felder` | Name, Art, Beschriftungen | Felder | Felder | Name, Beschriftung, Beschreibung | heutiger `Entwurf` |
 * | `G` (Form) | `FormStand` des Formentwurfs | `FormStand` | Wegkurve | Teile und Enden | Lage und Wegenden |
 * | `operation` → `schreibe` | `landscape.update` mit `areas` | `territory.update` | `path.update` mit Kurve | `powerline.update_line` | `place.update` mit Lage |
 *
 * `geaendert` (eigene Felder, die Form heißt `form`), `fremde` (was ein anderer zwischen zwei gelesenen Ständen geändert hat) und
 * `aufNeuenStand` (die eigenen Änderungen auf einen neuen Stand) braucht der Konflikt; `sicherung` macht den Stand zu JSON und zurück.
 *
 * **Die Form** bringt der Besitzer der Karte mit (der Formentwurf des Geometrie-Moduls): `formEntwurf(teil)` gibt ihm statt eines
 * eigenen Kerns eine Sicht auf diesen Entwurf. `beginne(g0)` hängt die Form an (mitten im Felder-Entwurf gilt `g0` auch für alle
 * Stände davor), jede Handbewegung ist `schritt(g)`, `leere()` hängt sie ab und lässt den Entwurf stehen (ein Fenster wird abgelegt).
 * Feld- und Formschritte stehen in EINER Folge; ↶ nimmt den jüngsten zurück, egal welcher Art. Läuft die Form, gehen ↶ ↷ und
 * Verwerfen über `teil`, weil nur er die Karte neu zeichnet.
 *
 * ## Der Ablauf
 *
 * - **Beginn** (Orchestrierung 2026-10-17, (2)): Die erste Feldänderung oder das Anhängen der Form beginnt; die Sperre wird genommen
 *   (Teil `felder`, mit Form `form`). Hält ein anderer das Objekt, fällt die Änderung zurück, und `gesperrt` nennt ihn.
 * - **Felder** (Orchestrierung, (4)): Tippen in einem Feld ist EIN Schritt (`feld(…, verschmelze)`), bis das Feld verlassen wird
 *   (`feldVerlassen`).
 * - **„Fertig“** schreibt `art.operation` als EINE Operation, nachdem die Sperre gilt. Gibt es nichts zu schreiben, endet die
 *   Bearbeitung still. Fehlt dem Stand noch etwas (`art.pruefe`, etwa die Art nach einer neuen Ebene), ist „Fertig“ gesperrt und
 *   nennt den Grund (`lage.grund`), und die Frage beim Verlassen bietet kein Speichern an. Die Befunde der Quittung (etwa „Gelände
 *   veraltet“, T18) stehen danach im Fuß, übersetzt über `entwurf.befund.<code>`. Reiht sie Folgearbeit ein (Gelände im Umkreis, WI-0223;
 *   Gebiete), sagt der Fuß bis zum Ende, wie weit sie ist (`folge-arbeit.ts`), beim Gelände statt „Gelände veraltet“. Geschrieben: neu lesen, Ende, Sperre frei, Sicherung weg, `karte.geaendert(mapRevision)`. Kein Zurücknehmen-Feld
 *   (T27 (5)); zurück geht es über den Verlauf.
 * - **Konflikt** (409 `edit_conflict`; ebenso ein gesicherter Entwurf auf einem älteren Stand): anwenden (nur ohne Überschneidung) ·
 *   übernehmen · überschreiben (als Gefahr). **Sperre abgelaufen** (`beiVerlust`, auch „Sperre aufheben …“ eines Admins) zeigt dieselben
 *   drei Wege; jeder nimmt die Sperre erst neu. Der Entwurf bleibt in jedem Fall stehen, bis jemand wählt.
 * - **Abgelehnt** (423, 503 `map_import_running`, 400, keine Verbindung): Der Satz des Servers steht da, der Entwurf bleibt.
 * - **Verwerfen** stellt den Start her; ob die Bearbeitung endet, sagt allein `VERWERFEN_BEENDET` (F20).
 * - **Verlassen** (R2; Orchestrierung, (3)): Esc ohne laufenden Zug fragt bei Ungeschriebenem „Speichern · Verwerfen · Weiter
 *   bearbeiten“ (`antworte`), sonst endet die Bearbeitung. Das Ablegen eines Fensters fragt nie: Das tut nicht diese Rechnung, sondern
 *   die Fensterverwaltung (`editor-panel/fenster-verwaltung.ts`, D19, G5 „Schließen verwirft nie“).
 * - **Im Browser gesichert** (R1, D19): Jeder Schritt sichert den Entwurf (`entwurf-sicherung.ts`); eine neue Bearbeitung desselben
 *   Objekts stellt ihn her. Hat sich der Stand seitdem geändert, kommt der Konflikt, nie still der neue Stand.
 * - **Freigabe auf Bitte** (WI-0262, OPS-000059): Hält die Bearbeitung die Sperre, meldet sie bei `sperre.bieteFreigabe` an, wie sie sich
 *   beenden lässt: „Fertig“ (`fertig`), und danach gibt sie die Sperre ab. Scheitert „Fertig“ (Prüfung, Konflikt, 409), bleibt alles
 *   wie es war, und der Grund steht im Ausgang. Abgemeldet wird mit der Sperre. Die Bitte selbst beantwortet nicht diese Rechnung,
 *   sondern `editor-sperre/freigabe-anfragen.ts`.
 * - **Neu lesen** (`neuLesen`, für ↺ im Verlauf, `entwurf-verlauf.ts`): nur, solange keine Bearbeitung läuft; sonst bliebe ein
 *   ungeschriebener Entwurf auf einem Stand stehen, den es nicht mehr gibt. Beginnt inzwischen eine, gilt die späte Antwort nicht; gibt
 *   es das Objekt nicht mehr, heißt der Zustand wie beim Laden `fehlt`; ohne Verbindung bleibt der gelesene Stand.
 */

/** Ein Stand des Entwurfs: die Felder und, sobald die Form angehängt ist, die Form. */
export interface Stand<F, G> {
    readonly felder: F;
    readonly form: G | undefined;
}

export interface BearbeitungsArt<D, F, G, B> {
    readonly sperrArt: EditorLockKind;
    /** Der gelesene Stand; `null`: das Objekt gibt es nicht. Ein Fehler wirft. */
    lade(id: string, signal: AbortSignal): Promise<D | null>;
    felder(d: D): F;
    /** Der Körper der EINEN Operation von `start` nach `jetzt` auf dem gelesenen Stand `d`; `undefined`: nichts zu schreiben. */
    operation(d: D, start: Stand<F, G>, jetzt: Stand<F, G>, operationId: string): B | undefined;
    schreibe(id: string, body: B): Promise<SchreibAntwort>;
    /** Was der Entwurf gegenüber dem gelesenen Stand ändert (Feldnamen; die Form heißt `form`). */
    geaendert(d: D, stand: Stand<F, G>): readonly string[];
    /** Was ein anderer zwischen zwei gelesenen Ständen geändert hat. */
    fremde(vorher: D, jetzt: D): readonly string[];
    /** Die eigenen Änderungen (gegenüber `vorher`) auf den neuen Stand `jetzt`; alles andere ist der neue Stand. */
    aufNeuenStand(vorher: D, jetzt: D, stand: Stand<F, G>): Stand<F, G>;
    /** Warum „Fertig“ diesen Stand nicht schreibt, als Satz (ein Feld fehlt noch); `undefined`: er darf. Nie ein Befund des Servers. */
    pruefe?(d: D, stand: Stand<F, G>): string | undefined;
    /**
     * Wiki-Felder (WI-0225, Modell c; `packages/shared/src/feld-herkunft.ts`): `aufWiki` setzt im Entwurf das Feld `schluessel` auf seinen
     * Wiki-Wert UND die Herkunft wiki (↺, als EIN Schritt: `bearbeitung.feld((f) => art.aufWiki(f, schluessel))`); `herkunft` sagt,
     * woher der Wert im Entwurf kommt. Ohne die beiden Griffe hat die Art keine Wiki-Felder. Regel und Hilfen: `fenster/wiki-feld.ts`.
     */
    aufWiki?(felder: F, schluessel: string): F;
    herkunft?(felder: F, schluessel: string): FeldHerkunft | undefined;
    readonly sicherung?: {
        readonly version: number;
        aus(stand: Stand<F, G>): unknown;
        ein(wert: unknown): Stand<F, G> | undefined;
    };
}

/** Was der Besitzer der Form (der Formentwurf) für die Bearbeitung tut; nur er zeichnet die Karte. */
export interface FormTeil {
    /** ↶ ↷ und Verwerfen über ihn: Er rechnet über die Sicht (`formEntwurf`) und zeichnet die Karte neu. */
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    /** Esc: bricht einen laufenden Zug ab oder fragt über die Sicht; `true`, wenn etwas lief. */
    abbrechen(): boolean;
    /** Die Bearbeitung ist zu Ende (geschrieben, verworfen, übernommen): Griffe aus. */
    beende(): void;
}

export type BearbeitungsZustand<D> =
    | { readonly art: "laedt" }
    | { readonly art: "fehlt" }
    | { readonly art: "lesefehler" }
    | { readonly art: "bereit" }
    | { readonly art: "speichert" }
    | {
          readonly art: "gespeichert";
          readonly revision: number | undefined;
          readonly befunde: readonly string[];
          /** Die Folgearbeit, deren Stand der Fuß bis zum Ende zeigt (`folge-arbeit.ts`); ohne keine. */
          readonly folge?: FolgeAuftrag | undefined;
          readonly mapRevision: number | undefined;
      }
    /** Ein anderer hält das Objekt (EDIT-0003 §4): Das Bearbeiten beginnt nicht, oder „Fertig“ schreibt nicht. */
    | { readonly art: "gesperrt"; readonly wer: string }
    /** Die Sperre ließ sich nicht nehmen (keine Verbindung, Bearbeiten aus). */
    | { readonly art: "sperrfehler" }
    | {
          readonly art: "konflikt";
          /** `fremd`: jemand hat inzwischen geschrieben; `sperre`: die Sperre ist abgelaufen oder wurde aufgehoben. */
          readonly grund: "fremd" | "sperre";
          readonly jetzt: D;
          readonly wer?: string | undefined;
          readonly wann?: string | undefined;
          readonly eigene: readonly string[];
          readonly fremde: readonly string[];
          readonly beide: readonly string[];
      }
    /** Der Server lehnt ab; `details` wie im Umschlag (ADR-0018), etwa Grund und Stelle einer ungültigen Form (`map/geometrie/form-ungueltig.ts`). */
    | {
          readonly art: "abgelehnt";
          readonly code: string;
          readonly satz: string;
          readonly details?: Readonly<Record<string, unknown>> | undefined;
      };

/** Was Leiste und Fuß zeigen. */
export interface BearbeitungsLage extends EntwurfLage {
    /** Eine Bearbeitung läuft (Sperre, Leiste mit „Fertig“). */
    readonly aktiv: boolean;
    /** Die Form ist angehängt (ein Modus der Form läuft). */
    readonly form: boolean;
    /** Warum „Fertig“ gesperrt ist (`art.pruefe`); `undefined`: es schreibt. */
    readonly grund?: string | undefined;
}

export interface BearbeitungsOptionen {
    readonly id: string;
    /** Woran gesperrt wird; ohne Angabe `id` (die Kraftlinie sperrt am Anker). */
    readonly sperrId?: string | undefined;
    /** Der Name in „Offene Bearbeitungen“ nach dem Neuladen. */
    readonly titel: string;
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust"> & Partial<Pick<EditorSperre, "bieteFreigabe">>;
    readonly karte?: { geaendert(revision: number | undefined): void } | undefined;
    /** Der Speicher des Browsers für die Sicherung; ohne keine Sicherung. */
    readonly speicher?: Storage | undefined;
    readonly neueKennung?: () => string;
    /** Wie lange nach dem letzten Schritt gesichert wird (Tippen sichert nicht je Taste). */
    readonly sicherungsPause?: number;
    /** Die Folgearbeit nach dem Speichern; ohne Angabe die eine der Seite (`folge-arbeit.ts`). */
    readonly folge?: Pick<FolgeArbeit, "vormerke"> | undefined;
}

export type Antwort = "speichern" | "verwerfen" | "weiter";

export interface Bearbeitung<D, F, G> {
    readonly id: string;
    readonly detail: Readonly<ShallowRef<D | undefined>>;
    /** Der Stand, wie er jetzt ist (Felder und Form); vor dem Laden `undefined`. */
    readonly stand: Readonly<ShallowRef<Stand<F, G> | undefined>>;
    readonly zustand: Readonly<ShallowRef<BearbeitungsZustand<D>>>;
    readonly lage: Readonly<ShallowRef<BearbeitungsLage>>;
    /** Ein Feld ändern; mit `verschmelze` (das Feld) wird Tippen EIN Schritt bis `feldVerlassen`. */
    feld(neu: (felder: F) => F, verschmelze?: string): void;
    feldVerlassen(): void;
    /** Die Sicht für den Besitzer der Form (statt eines eigenen Kerns). */
    formEntwurf(teil?: FormTeil): Entwurf<G>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): Promise<void>;
    /** Im Konflikt: die eigenen Änderungen auf den jetzigen Stand (`trotzdem` auch bei Überschneidung). */
    eigeneAnwenden(trotzdem?: boolean): Promise<void>;
    /** Im Konflikt: den jetzigen Stand übernehmen, der eigene Entwurf ist weg. */
    fremdenUebernehmen(): Promise<void>;
    /** Esc: bricht einen Zug ab, fragt bei Ungeschriebenem, sonst endet die Bearbeitung. `true`, wenn etwas lief. */
    esc(): boolean;
    antworte(wahl: Antwort): Promise<void>;
    /** Den Stand neu lesen (nach ↺ im Verlauf); nur, solange keine Bearbeitung läuft. */
    neuLesen(): Promise<void>;
    destroy(): void;
}

const RUHE: BearbeitungsLage = {
    aktiv: false,
    form: false,
    ungespeichert: 0,
    zurueck: false,
    wieder: false,
    frage: false,
};

export function createBearbeitung<D, F, G, B>(
    art: BearbeitungsArt<D, F, G, B>,
    optionen: BearbeitungsOptionen,
): Bearbeitung<D, F, G> {
    const { id, sperre } = optionen;
    const sperrZiel = { kind: art.sperrArt, id: optionen.sperrId ?? id };
    const neueKennung = optionen.neueKennung ?? (() => crypto.randomUUID());
    const detail = shallowRef<D | undefined>(undefined);
    const stand = shallowRef<Stand<F, G> | undefined>(undefined);
    const zustand = shallowRef<BearbeitungsZustand<D>>({ art: "laedt" });
    const lage = shallowRef<BearbeitungsLage>(RUHE);
    const kern = createEntwurf<Stand<F, G>>();
    const abbruch = new AbortController();
    let aktiv = false;
    let teil: FormTeil | undefined;
    let formDran = false;
    /** Die Form kam, bevor der Stand gelesen war (der Formentwurf liest selbst): Sie gilt nach dem Lesen. */
    let formWartet: G | undefined;
    /** Welcher Teil der Sperre gehalten wird; `form` deckt auch die Felder. */
    let gehalten: EditorLockPart | undefined;
    let sicherungsUhr: ReturnType<typeof setTimeout> | undefined;
    /** Die Anmeldung zur Freigabe auf Bitte, solange die Sperre gehalten wird. */
    let freigabeAngebot: (() => void) | undefined;
    /**
     * Geschrieben, die Bearbeitung endet gleich (nach dem Neulesen): Es gibt nichts mehr zu sichern. Ohne diese Sperre lag der Entwurf
     * während des Neulesens noch im Browser, und ein Neuladen in dieser Lücke holte ihn als „ungespeichert“ zurück (Befund der
     * Kraftlinien am Browserfall „Tunnel oben“, 2026-10-19).
     */
    let geschriebenEndetGleich = false;
    /** Zählt die Läufe: Eine späte Antwort gehört nicht mehr zur nächsten Bearbeitung. */
    let lauf = 0;

    /** Was dem jetzigen Stand fehlt (`art.pruefe`). */
    const fehlt = (): string | undefined => {
        const d = detail.value;
        const jetzt = kern.jetzt();
        return d === undefined || jetzt === undefined ? undefined : art.pruefe?.(d, jetzt);
    };
    const zeige = (): void => {
        const neu = kern.jetzt();
        // Eine Ablehnung gilt dem Stand, den sie abgelehnt hat: Ein anderer Stand (Schritt, ↶, ↷, Verwerfen) beendet sie, sonst nennte
        // die Leiste „an der markierten Stelle“ ohne Marke (`map/geometrie/form-ungueltig.ts`, Stage 2026-11-09).
        if (neu !== stand.value && zustand.value.art === "abgelehnt") zustand.value = { art: "bereit" };
        stand.value = neu;
        lage.value = aktiv ? { ...kern.lage(), aktiv, form: formDran, grund: fehlt() } : RUHE;
        planeSicherung();
    };

    // --- Sicherung im Browser ---
    function sichereJetzt(): void {
        sicherungsUhr = undefined;
        const d = detail.value;
        const start = kern.start();
        const jetzt = kern.jetzt();
        if (
            !aktiv ||
            geschriebenEndetGleich ||
            d === undefined ||
            start === undefined ||
            jetzt === undefined ||
            kern.lage().ungespeichert === 0
        ) {
            vergiss(optionen.speicher, art.sperrArt, id);
            return;
        }
        if (art.sicherung === undefined) return;
        sichereImBrowser(optionen.speicher, {
            art: art.sperrArt,
            id,
            titel: optionen.titel,
            zeit: new Date().toISOString(),
            version: art.sicherung.version,
            basis: d,
            start: art.sicherung.aus(start),
            jetzt: art.sicherung.aus(jetzt),
        });
    }
    function planeSicherung(): void {
        if (optionen.speicher === undefined || art.sicherung === undefined) return;
        if (sicherungsUhr !== undefined) clearTimeout(sicherungsUhr);
        sicherungsUhr = setTimeout(sichereJetzt, optionen.sicherungsPause ?? 250);
    }
    function vergissSicherung(): void {
        if (sicherungsUhr !== undefined) clearTimeout(sicherungsUhr);
        sicherungsUhr = undefined;
        vergiss(optionen.speicher, art.sperrArt, id);
    }

    // --- Sperre ---
    /** Nimmt die Sperre (oder hebt sie auf `form`); `false` mit dem Zustand, warum nicht. */
    async function sichere(gewuenscht: EditorLockPart): Promise<boolean> {
        if (gehalten === "form" || gehalten === gewuenscht) return true;
        const ergebnis = await sperre.nimm(sperrZiel, gewuenscht);
        if (ergebnis.art === "genommen") {
            gehalten = gewuenscht;
            bieteFreigabe();
            return true;
        }
        zustand.value =
            ergebnis.art === "gesperrt"
                ? { art: "gesperrt", wer: ergebnis.sperre.person.name }
                : { art: "sperrfehler" };
        return false;
    }
    function gibFrei(): void {
        if (gehalten === undefined) return;
        gehalten = undefined;
        zieheFreigabeZurueck();
        sperre.gib(sperrZiel);
    }

    // --- Freigabe auf Bitte (WI-0262) ---
    function bieteFreigabe(): void {
        if (freigabeAngebot !== undefined || sperre.bieteFreigabe === undefined) return;
        freigabeAngebot = sperre.bieteFreigabe(sperrZiel, { titel: optionen.titel, speichere: speichereFuerFreigabe });
    }
    function zieheFreigabeZurueck(): void {
        freigabeAngebot?.();
        freigabeAngebot = undefined;
    }
    /** Warum „Fertig“ die Bearbeitung nicht beendet hat, als Satz; `undefined`, wenn der Zustand keinen nennt. */
    function grundDesBleibens(): string | undefined {
        const z = zustand.value;
        switch (z.art) {
            case "abgelehnt":
                return z.satz;
            case "konflikt":
                return t("sperre.freigabe.grund.konflikt");
            case "gesperrt":
                return t("sperre.freigabe.grund.gesperrt", { wer: z.wer });
            case "sperrfehler":
                return t("sperre.freigabe.grund.sperrfehler");
            case "speichert":
                return t("sperre.freigabe.grund.laeuft");
            default:
                return fehlt();
        }
    }
    /**
     * Auf Bitte um Freigabe: den Entwurf über „Fertig“ schreiben (das beendet die Bearbeitung und gibt die Sperre ab). Läuft nichts mehr
     * oder gibt es nichts zu schreiben, endet sie ohne Schreiben. Bleibt sie danach stehen, ist etwas schiefgegangen: Alles bleibt, wie es
     * war (Entwurf, Sperre, Zustand mit seinem Satz im Fuß), und der Grund geht zurück.
     */
    async function speichereFuerFreigabe(): Promise<FreigabeAusgang> {
        if (!aktiv) return { ok: true };
        await fertig();
        if (!aktiv) return { ok: true };
        return { ok: false, grund: grundDesBleibens() };
    }
    const abmelden = sperre.beiVerlust((ziel) => {
        if (ziel.kind !== sperrZiel.kind || ziel.id !== sperrZiel.id || gehalten === undefined) return;
        gehalten = undefined;
        zieheFreigabeZurueck();
        const d = detail.value;
        if (!aktiv || d === undefined || zustand.value.art === "speichert") return;
        const eigene = kern.jetzt() === undefined ? [] : art.geaendert(d, kern.jetzt()!);
        zustand.value = { art: "konflikt", grund: "sperre", jetzt: d, eigene, fremde: [], beide: [] };
    });

    // --- Lesen, Beginn, Ende ---
    const standAus = (d: D, form: G | undefined): Stand<F, G> => ({ felder: art.felder(d), form });

    async function lies(): Promise<D | null | undefined> {
        try {
            return await art.lade(id, abbruch.signal);
        } catch {
            return undefined;
        }
    }

    function beginne(): boolean {
        if (aktiv) return false;
        aktiv = true;
        lauf += 1;
        return true;
    }

    /** Die Bearbeitung endet: Entwurf auf den gelesenen Stand, Sperre frei, Form ab, Sicherung weg. */
    function ende(): void {
        const d = detail.value;
        aktiv = false;
        lauf += 1;
        gibFrei();
        vergissSicherung();
        geschriebenEndetGleich = false;
        const formBesitzer = teil;
        teil = undefined;
        formDran = false;
        if (d !== undefined) kern.beginne(standAus(d, undefined));
        zeige();
        formBesitzer?.beende();
    }

    async function laden(): Promise<void> {
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
        let start: Stand<F, G>;
        try {
            start = standAus(gelesen, undefined);
        } catch {
            // Eine Antwort, aus der die Art keine Felder lesen kann, ist so gut wie keine.
            zustand.value = { art: "lesefehler" };
            return;
        }
        detail.value = gelesen;
        kern.beginne(start);
        zustand.value = { art: "bereit" };
        stelleHer(gelesen);
        if (formWartet !== undefined && kern.jetzt()?.form === undefined) {
            const g0 = formWartet;
            kern.ersetzeAlle((s) => ({ ...s, form: g0 }));
        }
        formWartet = undefined;
        zeige();
    }

    /** Ein gesicherter Entwurf: auf demselben Stand weiter, auf einem neueren als Konflikt (nie still auf den neuen Stand). */
    function stelleHer(frisch: D): void {
        const gesichert = liesGesichert(optionen.speicher, art.sperrArt, id);
        if (gesichert === undefined || art.sicherung === undefined) return;
        if (gesichert.version !== art.sicherung.version) {
            vergiss(optionen.speicher, art.sperrArt, id);
            return;
        }
        const start = art.sicherung.ein(gesichert.start);
        const jetzt = art.sicherung.ein(gesichert.jetzt);
        if (start === undefined || jetzt === undefined) return;
        const basis = gesichert.basis as D;
        const gleich = JSON.stringify(basis) === JSON.stringify(frisch);
        const fremde = gleich ? [] : art.fremde(basis, frisch);
        detail.value = gleich ? frisch : basis;
        kern.beginne(start);
        kern.schritt(jetzt);
        beginne();
        formDran = false;
        if (fremde.length > 0) {
            const eigene = art.geaendert(basis, jetzt);
            zustand.value = {
                art: "konflikt",
                grund: "fremd",
                jetzt: frisch,
                eigene,
                fremde,
                beide: eigene.filter((feld) => fremde.includes(feld)),
            };
        }
    }

    // --- Schritte ---
    function schritt(neu: Stand<F, G>, verschmelze?: string): void {
        const bisher = zustand.value.art;
        if (bisher === "gespeichert" || bisher === "abgelehnt" || bisher === "gesperrt" || bisher === "sperrfehler")
            zustand.value = { art: "bereit" };
        kern.schritt(neu, verschmelze);
        zeige();
    }

    /** Die erste Änderung beginnt und nimmt die Sperre; hält sie ein anderer, fällt die Änderung zurück. */
    function beginneMitSperre(teilDerSperre: EditorLockPart): void {
        if (!beginne()) {
            void sichere(teilDerSperre);
            return;
        }
        const meiner = lauf;
        void sichere(teilDerSperre).then((ok) => {
            if (ok || meiner !== lauf || abbruch.signal.aborted) return;
            const nicht = zustand.value;
            ende();
            zustand.value = nicht;
        });
    }

    function laeuftSpeichern(): boolean {
        return zustand.value.art === "speichert";
    }

    // --- Schreiben ---
    async function sende(d: D, start: Stand<F, G>, jetzt: Stand<F, G>): Promise<void> {
        const body = art.operation(d, start, jetzt, neueKennung());
        if (body === undefined) {
            ende();
            zustand.value = { art: "bereit" };
            return;
        }
        const meiner = lauf;
        if (!(await sichere(formDran ? "form" : "felder"))) return;
        if (meiner !== lauf) return;
        zustand.value = { art: "speichert" };
        const antwort = await art.schreibe(id, body);
        if (antwort.ok) optionen.karte?.geaendert(antwort.quittung.mapRevision);
        if (abbruch.signal.aborted || meiner !== lauf) return;
        if (antwort.ok) {
            await gespeichert(antwort.quittung);
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const frisch = await lies();
            if (abbruch.signal.aborted || meiner !== lauf) return;
            if (!frisch) {
                zustand.value = { art: "abgelehnt", code: antwort.fehler.code, satz: antwort.fehler.message };
                return;
            }
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
            const eigene = art.geaendert(d, jetzt);
            const fremde = art.fremde(d, frisch);
            zustand.value = {
                art: "konflikt",
                grund: "fremd",
                jetzt: frisch,
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
                eigene,
                fremde,
                beide: eigene.filter((feld) => fremde.includes(feld)),
            };
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "object_locked") {
            const details = antwort.fehler.details as { lock?: { person?: { name?: string } } } | undefined;
            zustand.value = { art: "gesperrt", wer: details?.lock?.person?.name ?? "" };
            return;
        }
        zustand.value = {
            art: "abgelehnt",
            code: antwort.fehler.code,
            satz: antwort.fehler.message,
            details: antwort.fehler.details,
        };
    }

    async function gespeichert(quittung: OperationReceipt): Promise<void> {
        const eigenes = quittung.affected.find((x) => x.kind === art.sperrArt && x.id === sperrZiel.id);
        // Geschrieben: Die Sicherung im Browser geht sofort, nicht erst nach dem Neulesen.
        geschriebenEndetGleich = true;
        vergissSicherung();
        const frisch = await lies();
        if (abbruch.signal.aborted) return;
        if (frisch) detail.value = frisch;
        ende();
        // Reiht die Operation Folgearbeit ein, sagt der Fuß bis zum Ende, wie weit sie ist; rechnet das Gelände im Umkreis neu (WI-0223),
        // gilt „Gelände veraltet“ nicht.
        const folge = (optionen.folge ?? folgeArbeit).vormerke(quittung);
        zustand.value = {
            art: "gespeichert",
            revision: eigenes?.revision,
            befunde: quittung.warnings
                .filter((befund) => folge?.art !== "gelaende" || befund.code !== "terrain_stale")
                .map((befund) => {
                    const key = `entwurf.befund.${befund.code}`;
                    return isMessageKey(key) ? t(key) : befund.message;
                }),
            mapRevision: quittung.mapRevision,
            folge,
        };
    }

    /** Im Konflikt: die eigenen Änderungen auf den jetzigen Stand und schreiben. */
    async function aufJetzt(trotzdem: boolean): Promise<void> {
        const stand0 = zustand.value;
        const d = detail.value;
        const start = kern.start();
        const jetzt = kern.jetzt();
        if (stand0.art !== "konflikt" || d === undefined || start === undefined || jetzt === undefined) return;
        if (stand0.grund === "sperre") {
            if (!(await sichere(formDran ? "form" : "felder"))) return;
            const frisch = await lies();
            if (abbruch.signal.aborted || !frisch) return;
            const fremde = art.fremde(d, frisch);
            const eigene = art.geaendert(d, jetzt);
            const beide = eigene.filter((feld) => fremde.includes(feld));
            if (fremde.length > 0 && beide.length > 0 && !trotzdem) {
                zustand.value = { art: "konflikt", grund: "fremd", jetzt: frisch, eigene, fremde, beide };
                return;
            }
            await rebase(d, frisch, start, jetzt);
            return;
        }
        if (stand0.beide.length > 0 && !trotzdem) return;
        await rebase(d, stand0.jetzt, start, jetzt);
    }

    async function rebase(vorher: D, frisch: D, start: Stand<F, G>, jetzt: Stand<F, G>): Promise<void> {
        const neu = art.aufNeuenStand(vorher, frisch, jetzt);
        detail.value = frisch;
        // Auch der Start rückt auf den neuen Stand (seine Felder und, wo die Art es kennt, die Revisionen seiner Form).
        kern.beginne(art.aufNeuenStand(vorher, frisch, start));
        kern.schritt(neu);
        zustand.value = { art: "bereit" };
        zeige();
        await sende(frisch, kern.start()!, kern.jetzt()!);
    }

    // --- Die Sicht für den Besitzer der Form ---
    function formEntwurf(besitzer?: FormTeil): Entwurf<G> {
        const ohneForm = (): void => undefined;
        return {
            beginne(g0) {
                teil = besitzer;
                if (!formDran) {
                    formDran = true;
                    // Noch nicht gelesen: Die Form gilt, sobald der Stand da ist (`laden`).
                    if (kern.jetzt() === undefined) formWartet = g0;
                    else if (kern.jetzt()?.form === undefined) kern.ersetzeAlle((s) => ({ ...s, form: g0 }));
                }
                beginneMitSperre("form");
                zeige();
            },
            leere() {
                // Die Form hängt ab (der Modus endet, das Fenster wird abgelegt); der Entwurf bleibt stehen.
                if (teil === besitzer) teil = undefined;
                formDran = false;
                zeige();
            },
            schritt(g, verschmelze) {
                const jetzt = kern.jetzt();
                if (jetzt !== undefined && aktiv) schritt({ ...jetzt, form: g }, verschmelze);
            },
            schluss: () => kern.schluss(),
            ersetzeAlle: ohneForm,
            start: () => kern.start()?.form,
            jetzt: () => kern.jetzt()?.form,
            zurueck() {
                const ok = kern.zurueck();
                zeige();
                return ok;
            },
            wieder() {
                const ok = kern.wieder();
                zeige();
                return ok;
            },
            verwerfen() {
                const etwas = kern.verwerfen();
                zeige();
                return etwas;
            },
            esc() {
                const wie = kern.esc();
                if (wie === "ende") ende();
                else zeige();
                return wie;
            },
            antworte(verwerfen) {
                const wie = kern.antworte(verwerfen);
                if (wie === "ende") ende();
                else zeige();
                return wie;
            },
            lage: () => kern.lage(),
        };
    }

    async function fertig(): Promise<void> {
        const d = detail.value;
        const start = kern.start();
        const jetzt = kern.jetzt();
        if (!aktiv || d === undefined || start === undefined || jetzt === undefined) return;
        if (laeuftSpeichern() || zustand.value.art === "konflikt" || fehlt() !== undefined) return;
        await sende(d, start, jetzt);
    }

    void laden();

    return {
        id,
        detail,
        stand,
        zustand,
        lage,
        feld(neu, verschmelze) {
            const jetzt = kern.jetzt();
            if (jetzt === undefined || laeuftSpeichern() || zustand.value.art === "konflikt") return;
            const erste = !aktiv;
            if (erste) beginneMitSperre("felder");
            schritt({ ...jetzt, felder: neu(jetzt.felder) }, verschmelze);
        },
        feldVerlassen() {
            kern.schluss();
        },
        formEntwurf,
        zurueck() {
            if (!aktiv || laeuftSpeichern()) return;
            if (teil !== undefined && formDran) teil.zurueck();
            else if (kern.zurueck()) zeige();
        },
        wieder() {
            if (!aktiv || laeuftSpeichern()) return;
            if (teil !== undefined && formDran) teil.wieder();
            else if (kern.wieder()) zeige();
        },
        verwerfen() {
            if (!aktiv || laeuftSpeichern()) return;
            if (teil !== undefined && formDran) teil.verwerfen();
            else kern.verwerfen();
            if (VERWERFEN_BEENDET) ende();
            else zeige();
        },
        fertig,
        eigeneAnwenden: (trotzdem = false) => aufJetzt(trotzdem),
        async fremdenUebernehmen() {
            const stand0 = zustand.value;
            if (stand0.art !== "konflikt") return;
            const frisch = stand0.grund === "fremd" ? stand0.jetzt : ((await lies()) ?? stand0.jetzt);
            if (abbruch.signal.aborted) return;
            detail.value = frisch;
            ende();
            zustand.value = { art: "bereit" };
        },
        esc() {
            if (!aktiv) return false;
            if (laeuftSpeichern()) return true;
            if (teil !== undefined && formDran) return teil.abbrechen();
            const wie = kern.esc();
            if (wie === "ende") ende();
            else zeige();
            return true;
        },
        async antworte(wahl) {
            if (!aktiv) return;
            if (wahl === "speichern") {
                kern.antworte(false);
                zeige();
                if (fehlt() !== undefined) return;
                const d = detail.value;
                const start = kern.start();
                const jetzt = kern.jetzt();
                if (d !== undefined && start !== undefined && jetzt !== undefined) await sende(d, start, jetzt);
                return;
            }
            if (kern.antworte(wahl === "verwerfen") === "ende") ende();
            else zeige();
        },
        async neuLesen() {
            if (aktiv) return;
            const meiner = lauf;
            const frisch = await lies();
            if (abbruch.signal.aborted || aktiv || meiner !== lauf || frisch === undefined) return;
            if (frisch === null) {
                zustand.value = { art: "fehlt" };
                return;
            }
            detail.value = frisch;
            kern.beginne(standAus(frisch, undefined));
            zustand.value = { art: "bereit" };
            zeige();
        },
        destroy() {
            // Ein Entwurf überlebt das Ende der Rechnung im Browser: Die Sicherung wird jetzt geschrieben, nicht verworfen.
            if (sicherungsUhr !== undefined) {
                clearTimeout(sicherungsUhr);
                sichereJetzt();
            }
            abbruch.abort();
            abmelden();
            gibFrei();
        },
    };
}
