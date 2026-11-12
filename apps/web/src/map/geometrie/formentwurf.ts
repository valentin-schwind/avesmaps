import { shallowRef, type ShallowRef } from "vue";
import type { ApiErrorBody, EditorLockKind } from "@avesmaps3d/shared";
import type { EditorSperre } from "../../editor-sperre/sperre";
import { createEntwurf, type Entwurf } from "../../fenster/entwurf-kern";
import { neueVerstoesse, type FormVerstossGrund } from "./form-regel";
import type { Aenderung, GeometrieArt, Pixel, Punkt, Stelle, Teil, Ziel } from "./geometrie";
import type { Umriss } from "./kamera";
import type { GeometrieEingabe, GeometrieModus } from "./modus";
import { deckungsgleich, mitPunkt, verschoben } from "./rechnung";

/**
 * Der gemeinsame Formentwurf der Editoren (WI-0209 C1; gehoben aus „Ecken bearbeiten“ der Landschaft, WI-0178 C1/C2, auf Auftrag der
 * Editor-Orchestrierung 2026-10-17: „heb ecken.ts zu EINEM gemeinsamen Formentwurf – keine Gebiets-Kopie“). Er verbindet eine Art des
 * Geometrie-Moduls (`GeometrieArt`) mit dem Entwurfskern (`fenster/entwurf-kern.ts`), der Sperre (EDIT-0003 §4) und einer Quelle, die liest und
 * schreibt. Fläche (`landschaftseditor/ecken.ts`) und Herrschaftsgebiet (`gebietseditor/gebietsform.ts`) nutzen ihn; Wegkurve und
 * Kraftlinie können als weitere Quelle andocken.
 *
 * ## Die Schnittstelle
 *
 * **Eine Quelle** (`FormQuelle`) sagt, was gelesen und geschrieben wird:
 *
 * | Griff | Fläche | Gebiet |
 * |---|---|---|
 * | `sperrArt` | `landscape` | `territory` |
 * | `lade(id, signal)` → `FormStart` | Landschaft und Andockziele (Nachbarn derselben Ebene, Kanten der sichtbaren Ebenen, Flusspunkte) | Gebiet am Klickpunkt (abgeleitet → Baronie darunter), Nachbarn, Kanten |
 * | `schreibe(start, vorher, jetzt, operationId)` | `area.reshape` (C2) | fehlt bis C2: „Fertig“ geht dann nicht |
 *
 * **Ein Start** (`FormStart`) trägt das Objekt, seine Teile mit Revision, die Nachbarn je sperrbarem Objekt und die übrigen Ziele.
 * Nachbarn, die ein anderer gerade bearbeitet, ziehen nicht mit: Ihre Ecken bleiben Ziele, die gemeinsame Ecke löst sich (Betreiber
 * 2026-10-16, wörtlich: „Korrektur: Die gemeinsame Ecke löst sich.“).
 *
 * **Der Ablauf:** Start nur ausdrücklich; erst gesperrt, dann bearbeitet (hält ein anderer das Objekt, beginnt nichts). Jede
 * Handbewegung ist ein Schritt des Entwurfs; nichts fragt während einer Geste den Server. „Fertig“ schreibt EINE Operation und beendet
 * den Modus; ist die Sperre verloren, nimmt „Fertig“ sie neu. Ein Konflikt (409) oder eine Ablehnung lässt den Entwurf stehen.
 * „Verwerfen“ stellt den Start her, der Modus bleibt (F20). Esc bricht erst einen laufenden Zug ab, fragt dann bei Ungeschriebenem.
 * Die Frage bietet „Verwerfen“ und „Weiter bearbeiten“ (`antworte`); „Fertig“ ruft der Aufrufer selbst über `fertig()` (Leiste,
 * Doppelklick ins Leere), wie die Leiste es neben der Frage zeigt (EDIT-0003 §3a).
 *
 * **Im gemeinsamen Entwurf** (O3, EDIT-0003 T44; `fenster/bearbeitung.ts`): Mit `entwurf` nimmt der Formentwurf statt eines eigenen
 * Kerns die Sicht einer Bearbeitung (`bearbeitung.formEntwurf()`). `beginne` hängt die Form an, `leere` (jedes Ende, auch nach
 * „Fertig“) hängt nur sie ab, die Felder bleiben. `verwerfen`, `esc` und `antworte` gelten dann dem EINEN Entwurf aus Feldern und Form
 * (T44: ein Entwurf, ↶ nimmt den jüngsten Schritt, „Verwerfen“ stellt den ganzen Start her). Ohne `entwurf` bleibt alles wie oben.
 *
 * **Schritte mit der Regel des Servers** (`pruefeSchritte`, Fläche und Gebiet; Vali 2026-11-10): Schafft ein Schritt einen Ring unter drei
 * Ecken oder einen Nachbarn mit mehr als den gemeinsamen Ecken (`form-regel.ts`), wird er nicht übernommen. Die Meldung `verhindert` nennt
 * Fläche und Stelle, der Modus markiert sie rot, bis zum nächsten Schritt, ↶, ↷ oder Verwerfen. So lehnt „Fertig“ nicht ab, was der Editor
 * vorher zugelassen hat.
 */

/** Was im Entwurf steht: die eigenen Teile und die Teile der Nachbarn, wie sie nach den Schritten liegen. */
export interface FormStand {
    readonly teile: readonly Teil[];
    readonly nachbarn: readonly Teil[];
}

/** Ein Nachbar, wie er gesperrt wird (Landschaft, Gebiet), mit seinen Teilen. */
export interface FormNachbar {
    readonly sperrId: string;
    readonly name: string;
    readonly teile: readonly Teil[];
}

export interface FormStart {
    /** Woran gesperrt wird (Landschaft, Gebiet). */
    readonly sperrId: string;
    readonly name: string;
    readonly teile: readonly Teil[];
    readonly nachbarn: readonly FormNachbar[];
    /** Die Ziele: Ecken und Kanten der freien Nachbarn (mit Stelle, sie ziehen mit), der gehaltenen (ohne) und alles Übrige. */
    ziele(freie: readonly Teil[], gehalten: readonly Teil[]): Ziel[];
    /** Ein Hinweis zum Start (ein abgeleitetes Gebiet führt zur Baronie darunter). */
    readonly hinweis?: FormMeldung;
}

/** Die Antwort auf „Fertig“: geschrieben, oder der Fehler im Umschlag (ADR-0018), ohne Verbindung mit eigenem Fehler. */
export type FormAntwort =
    | {
          readonly ok: true;
          readonly mapRevision?: number | undefined;
          /** Die Nachbarn (`sperrId`), deren Teile mitgeschrieben wurden. */
          readonly mitgezogen: readonly string[];
      }
    | { readonly ok: false; readonly status: number; readonly fehler: ApiErrorBody["error"] };

export interface FormQuelle<S extends FormStart = FormStart> {
    readonly sperrArt: EditorLockKind;
    /** `null`: das Objekt gibt es nicht. Ein Fehler wirft. */
    lade(id: string, signal: AbortSignal): Promise<S | null>;
    /** „Fertig“; fehlt, solange es keinen Schreibweg gibt (dann geht „Fertig“ nicht). */
    readonly schreibe?: (start: S, vorher: FormStand, jetzt: FormStand, operationId: string) => Promise<FormAntwort>;
}

export interface FormKarte {
    /** Schaltet das Geometrie-Modul ein; ohne Karte `undefined`. */
    ein(eingabe: GeometrieEingabe): GeometrieModus | undefined;
    /** Das Objekt in die freie Fläche holen, wenn nichts von ihm frei zu sehen ist (Hausregel „Kamera fliegt immer“, `kamera.ts`). */
    zeige(teile: readonly Umriss[]): void;
    /** Geschrieben: die Karte lädt mit der Kachelrevision neu (`map.changed`). */
    geaendert(revision: number | undefined): void;
}

export interface FormLauf {
    /** Wonach gefragt wurde (die Kennung beim Start). */
    readonly id: string;
    /** Der Name des bearbeiteten Objekts; leer, solange es lädt. */
    readonly name: string;
    readonly phase: "laedt" | "bereit" | "speichert";
    readonly ungespeichert: number;
    readonly zurueck: boolean;
    readonly wieder: boolean;
    readonly frage: boolean;
}

export type FormMeldung =
    | { readonly art: "ohneFlaeche"; readonly name: string }
    | { readonly art: "ladefehler" }
    | { readonly art: "verworfen"; readonly name: string }
    /** Ein anderer bearbeitet das Objekt gerade (EDIT-0003 §4): Der Modus beginnt nicht. */
    | { readonly art: "gesperrt"; readonly name: string; readonly wer: string }
    /** Die Sperre ließ sich nicht nehmen (keine Verbindung, Bearbeiten aus): Der Modus beginnt nicht. */
    | { readonly art: "sperrfehler"; readonly name: string }
    /** Die Sperre ist abgelaufen, und ein anderer hat sie genommen: Der Entwurf bleibt, Speichern geht nicht mehr. */
    | { readonly art: "verloren"; readonly name: string }
    /** Eine gemeinsame Ecke mit einem Nachbarn, den ein anderer gerade bearbeitet, hat sich von ihm gelöst. */
    | { readonly art: "geloest"; readonly name: string; readonly wer: string }
    /** Bearbeitet wird ein anderes Objekt als das verlangte (ein abgeleitetes Gebiet führt zur Baronie darunter). */
    | { readonly art: "darunter"; readonly name: string; readonly von: string }
    /** „Fertig“ hat geschrieben; `mitgezogen` nennt die Nachbarn, deren Ecken mitgingen. */
    | { readonly art: "gespeichert"; readonly name: string; readonly mitgezogen: readonly string[] }
    /** Jemand hat inzwischen geändert (409): Der Entwurf bleibt. */
    | {
          readonly art: "konflikt";
          readonly name: string;
          readonly wer?: string | undefined;
          readonly wann?: string | undefined;
      }
    /** Der Server lehnte ab (Bearbeiten aus, Zug läuft, ungültig, keine Verbindung): Der Entwurf bleibt, der Satz sagt warum. */
    | { readonly art: "abgelehnt"; readonly satz: string }
    /** Ein Schritt, den der Server beim Speichern ablehnen würde, ist nicht übernommen (`pruefeSchritte`); die Stelle ist markiert. */
    | {
          readonly art: "verhindert";
          readonly grund: FormVerstossGrund;
          /** Die Fläche, an der es liegt. */
          readonly name: string;
          /** Das bearbeitete Objekt. */
          readonly eigen: string;
          readonly stelle: Punkt;
      };

export interface Formentwurf {
    readonly laufend: Readonly<ShallowRef<FormLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<FormMeldung | undefined>>;
    /** Geht „Fertig“ überhaupt (gibt es einen Schreibweg)? */
    readonly schreibbar: boolean;
    starte(id: string): Promise<void>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): Promise<void>;
    antworte(verwerfen: boolean): void;
    /** Esc: bricht einen laufenden Zug ab, fragt bei Ungeschriebenem, sonst endet der Modus. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    beende(): void;
    entwurf(): FormStand | undefined;
    /** Liegt der Bildpunkt in der bearbeiteten Fläche oder im Saum ihrer Kante? */
    traegt(punkt: Pixel): boolean;
    destroy(): void;
}

export interface FormOptionen<S extends FormStart> {
    readonly art: GeometrieArt;
    readonly quelle: FormQuelle<S>;
    readonly karte: FormKarte;
    readonly fangradius: () => number;
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust" | "liste">;
    /** Eine neue Kennung je Schreiben (`operationId`); für Tests ersetzbar. */
    readonly neueKennung?: () => string;
    /** Der Kern einer Bearbeitung (O3, `bearbeitung.formEntwurf()`); ohne Angabe ein eigener. */
    readonly entwurf?: Entwurf<FormStand>;
    /** Jeden Schritt mit der Regel des Servers prüfen (Kopf, „Schritte mit der Regel des Servers“); Fläche und Gebiet. */
    readonly pruefeSchritte?: boolean;
}

/** Die Ringe von Flächen als Teile: je Fläche ein Objekt, `nr` zählt ihre Ringe über alle Polygone. */
export function teileAus(
    flaechen: readonly {
        id: string;
        revision: number;
        polygons: readonly (readonly (readonly [number, number])[])[][];
    }[],
    name: string,
): Teil[] {
    const teile: Teil[] = [];
    for (const flaeche of flaechen) {
        let nr = 0;
        for (const polygon of flaeche.polygons)
            for (const ring of polygon) {
                teile.push({
                    objekt: flaeche.id,
                    name,
                    nr,
                    art: "ring",
                    punkte: ring.map(([x, y]) => ({ x, y })),
                    revision: flaeche.revision,
                });
                nr += 1;
            }
    }
    return teile;
}

/**
 * Ecken und Kanten von Ringen als Ziele. Mit `mitStelle` tragen sie ihre Stelle (Nachbarn: Sie ziehen mit und werden mitgeschrieben),
 * sonst nicht (gehaltene Nachbarn: einrasten ja, mitziehen nein). Doppelte Ecken stehen einmal (`gesehen`).
 */
export function ringZiele(teile: readonly Teil[], mitStelle: boolean, gesehen: Set<string>, raus: Ziel[]): void {
    for (const teil of teile) {
        teil.punkte.forEach((at, index) => {
            const stelle = mitStelle ? { stelle: { objekt: teil.objekt, nr: teil.nr, index } } : {};
            const schluessel = `${teil.objekt} ${at.x.toFixed(5)} ${at.y.toFixed(5)}`;
            if (!gesehen.has(schluessel)) {
                gesehen.add(schluessel);
                raus.push({ art: "ecke", at, objekt: teil.objekt, name: teil.name, ...stelle });
            }
            const bis = teil.punkte[(index + 1) % teil.punkte.length]!;
            raus.push({ art: "kante", at, bis, objekt: teil.objekt, name: teil.name, ...stelle });
        });
    }
}

/**
 * Kanten anderer Objekte als Ziele (Fläche: Teilflächen der sichtbaren Ebenen, Gebiet: Flächen anderer Gebiete): beide Enden als Ecke,
 * die Strecke als Kante, ohne Stelle (sie ziehen nie mit). Doppelte Ecken stehen einmal (`gesehen`).
 */
export function kantenZiele(
    kanten: readonly {
        readonly areaId: string;
        readonly name: string;
        readonly a: readonly [number, number];
        readonly b: readonly [number, number];
    }[],
    gesehen: Set<string>,
    raus: Ziel[],
): void {
    for (const kante of kanten) {
        const a = { x: kante.a[0], y: kante.a[1] };
        const b = { x: kante.b[0], y: kante.b[1] };
        for (const at of [a, b]) {
            const schluessel = `${kante.areaId} ${at.x.toFixed(5)} ${at.y.toFixed(5)}`;
            if (gesehen.has(schluessel)) continue;
            gesehen.add(schluessel);
            raus.push({ art: "ecke", at, objekt: kante.areaId, name: kante.name });
        }
        raus.push({ art: "kante", at: a, bis: b, objekt: kante.areaId, name: kante.name });
    }
}

/**
 * Ein Schritt: die eigenen Teile nach der Handbewegung, die Nachbarn mit ihren mitgezogenen und eingefügten Punkten (5.2: ein neuer Punkt
 * auf einer gemeinsamen Kante, mit Strg + Klick vier). Jede Stelle zählt nach dem Einfügen aller Punkte; darum wird von vorn eingefügt.
 */
export function standNach(stand: FormStand, aenderung: Aenderung): FormStand {
    const amTeil = <T extends { readonly stelle: { readonly objekt: string; readonly nr: number } }>(
        liste: readonly T[],
        nachbar: Teil,
    ): T[] => liste.filter((x) => x.stelle.objekt === nachbar.objekt && x.stelle.nr === nachbar.nr);
    return {
        teile: aenderung.teile,
        nachbarn: stand.nachbarn.map((nachbar) => {
            const seine = amTeil(aenderung.mitgezogen, nachbar);
            const neue = amTeil(aenderung.eingefuegt ?? [], nachbar).sort((a, b) => a.stelle.index - b.stelle.index);
            let punkte: readonly Punkt[] = nachbar.punkte;
            for (const m of seine) punkte = verschoben(punkte, m.stelle.index, m.nach);
            for (const e of neue) punkte = mitPunkt(punkte, e.stelle.index, e.at);
            const weg = new Set(amTeil(aenderung.entfernt ?? [], nachbar).map((x) => x.stelle.index));
            if (weg.size > 0) punkte = punkte.filter((_, i) => !weg.has(i));
            return seine.length === 0 && neue.length === 0 && weg.size === 0 ? nachbar : { ...nachbar, punkte };
        }),
    };
}

/**
 * Was beim Löschen einer Ecke auch beim Nachbarn geht: nur, was erst dieser Entwurf dorthin gebracht hat, ein neuer Punkt auf der gemeinsamen Kante oder eine mitgezogene Ecke
 * (OPS-000079: Punkt gesetzt und wieder gelöscht, blieb er beim Nachbarn; „Fertig“ schickte dann nur den Nachbarn, 404, oder einen Punkt, den das Gebiet nicht hat, 400).
 * Eine Ecke, die dort schon vorher lag, bleibt dem Nachbarn, und kein Ring fällt unter seine Mindestzahl.
 */
export function ausDemEntwurf(
    entfernt: readonly { readonly stelle: Stelle }[],
    jetzt: FormStand,
    start: FormStand,
    mindestens: number,
): { readonly stelle: Stelle }[] {
    return entfernt.filter(({ stelle }) => {
        const derselbe = (teil: Teil): boolean => teil.objekt === stelle.objekt && teil.nr === stelle.nr;
        const teil = jetzt.nachbarn.find(derselbe);
        const punkt = teil?.punkte[stelle.index];
        if (teil === undefined || punkt === undefined || teil.punkte.length <= mindestens) return false;
        return !start.nachbarn.find(derselbe)?.punkte.some((p) => deckungsgleich(p, punkt));
    });
}

export function createFormentwurf<S extends FormStart>(optionen: FormOptionen<S>): Formentwurf {
    const { quelle, karte } = optionen;
    const laufend = shallowRef<FormLauf | undefined>(undefined);
    const meldung = shallowRef<FormMeldung | undefined>(undefined);
    const entwurf = optionen.entwurf ?? createEntwurf<FormStand>();
    let modus: GeometrieModus | undefined;
    let ziele: readonly Ziel[] = [];
    let lesen: AbortController | undefined;
    let geladen: S | undefined;
    /** Das Objekt, dessen Sperre dieser Modus hält. */
    let gesperrt: string | undefined;
    /** Nachbarn, die ein anderer hält, mit seinem Namen; je Nachbar ein Hinweis je Lauf. */
    let fremd: { teile: readonly Teil[]; wer: string; name: string }[] = [];
    const gemeldet = new Set<string>();
    /** Der Name je Fläche eines freien Nachbarn und sein sperrbares Objekt, für „mitgezogen“. */
    let nachbarVon = new Map<string, FormNachbar>();
    /** Zählt die Läufe: Eine späte Antwort auf „Fertig“ gehört nicht mehr zum nächsten Lauf. */
    let lauf = 0;
    const neueKennung = optionen.neueKennung ?? (() => crypto.randomUUID());
    const ziel = (id: string) => ({ kind: quelle.sperrArt, id });

    const abmelden = optionen.sperre.beiVerlust((verloren) => {
        const jetzt = laufend.value;
        if (verloren.kind !== quelle.sperrArt || verloren.id !== gesperrt || jetzt === undefined) return;
        gesperrt = undefined;
        meldung.value = { art: "verloren", name: jetzt.name };
    });

    function setze(teil: Partial<FormLauf>): void {
        if (laufend.value === undefined) return;
        laufend.value = { ...laufend.value, ...entwurf.lage(), ...teil };
    }

    /** Lag die gezogene Ecke auf einer Ecke eines fremd gehaltenen Nachbarn, sagt ein Hinweis, dass sie sich gelöst hat. */
    function meldeGeloest(vorher: FormStand, aenderung: Aenderung): void {
        if (aenderung.art !== "ziehen" || fremd.length === 0) return;
        for (const stelle of [aenderung.stelle, ...(aenderung.auch ?? [])]) {
            const teil = vorher.teile.find((t) => t.objekt === stelle.objekt && t.nr === stelle.nr);
            const von = teil?.punkte[stelle.index];
            if (von === undefined) continue;
            const nachbar = fremd.find(
                (n) =>
                    !gemeldet.has(n.name) && n.teile.some((t) => t.punkte.some((p) => p.x === von.x && p.y === von.y)),
            );
            if (nachbar === undefined) continue;
            gemeldet.add(nachbar.name);
            meldung.value = { art: "geloest", name: nachbar.name, wer: nachbar.wer };
            return;
        }
    }

    /** Die rote Marke eines nicht übernommenen Schritts; jeder neue Stand nimmt sie weg. */
    let verhindert = false;
    function markiere(stelle: Punkt | undefined): void {
        if (stelle === undefined && !verhindert) return;
        verhindert = stelle !== undefined;
        modus?.markiere(stelle === undefined ? [] : [{ at: stelle, art: "fehler" }]);
    }

    function zeige(): void {
        markiere(undefined);
        modus?.aktualisiere();
        setze({});
    }

    function beende(): void {
        lauf += 1;
        lesen?.abort();
        lesen = undefined;
        if (gesperrt !== undefined) optionen.sperre.gib(ziel(gesperrt));
        gesperrt = undefined;
        modus?.aus();
        modus = undefined;
        verhindert = false;
        entwurf.leere();
        ziele = [];
        fremd = [];
        gemeldet.clear();
        nachbarVon = new Map();
        geladen = undefined;
        laufend.value = undefined;
    }

    async function starte(id: string): Promise<void> {
        beende();
        meldung.value = undefined;
        const steuer = new AbortController();
        lesen = steuer;
        laufend.value = { id, name: "", phase: "laedt", ungespeichert: 0, zurueck: false, wieder: false, frage: false };
        let start: S | null;
        try {
            start = await quelle.lade(id, steuer.signal);
        } catch {
            if (lesen !== steuer) return;
            beende();
            meldung.value = { art: "ladefehler" };
            return;
        }
        if (lesen !== steuer) return;
        if (start === null) {
            beende();
            meldung.value = { art: "ladefehler" };
            return;
        }
        if (start.teile.length === 0) {
            beende();
            meldung.value = { art: "ohneFlaeche", name: start.name };
            return;
        }
        // Erst gesperrt, dann bearbeitet (EDIT-0003 §4): Hält ein anderer das Objekt, beginnt der Modus nicht.
        const sperre = await optionen.sperre.nimm(ziel(start.sperrId), "form");
        if (lesen !== steuer) {
            if (sperre.art === "genommen") optionen.sperre.gib(ziel(start.sperrId));
            return;
        }
        if (sperre.art !== "genommen") {
            beende();
            meldung.value =
                sperre.art === "gesperrt"
                    ? { art: "gesperrt", name: start.name, wer: sperre.sperre.person.name }
                    : { art: "sperrfehler", name: start.name };
            return;
        }
        gesperrt = start.sperrId;
        // Nachbarn, die ein anderer gerade bearbeitet, ziehen nicht mit: Die gemeinsame Ecke löst sich von ihnen.
        const halter = new Map(
            (await optionen.sperre.liste(quelle.sperrArt))
                .filter((s) => !s.own)
                .map((s) => [s.id, s.person.name] as const),
        );
        if (lesen !== steuer) return;
        const freie = start.nachbarn.filter((n) => !halter.has(n.sperrId));
        fremd = start.nachbarn
            .filter((n) => halter.has(n.sperrId))
            .map((n) => ({ teile: n.teile, wer: halter.get(n.sperrId)!, name: n.name }));
        const nachbarn = freie.flatMap((n) => n.teile);
        nachbarVon = new Map(freie.flatMap((n) => n.teile.map((t) => [t.objekt, n] as const)));
        geladen = start;
        entwurf.beginne({ teile: start.teile, nachbarn });
        ziele = start.ziele(
            nachbarn,
            fremd.flatMap((n) => n.teile),
        );
        laufend.value = { ...laufend.value, name: start.name, phase: "bereit" };
        if (start.hinweis !== undefined) meldung.value = start.hinweis;
        modus = karte.ein({
            art: optionen.art,
            teile: () => entwurf.jetzt()?.teile ?? [],
            nachbarn: () => entwurf.jetzt()?.nachbarn ?? [],
            ziele: () => ziele,
            // Flächen und Gebiete kennen keine Orte, an denen nichts mitzieht.
            orte: () => [],
            fangradius: optionen.fangradius,
            handbewegung(aenderung) {
                const jetzt = entwurf.jetzt();
                if (jetzt === undefined) return;
                meldeGeloest(jetzt, aenderung);
                const anfang = entwurf.start() ?? jetzt;
                const entfernt = ausDemEntwurf(aenderung.entfernt ?? [], jetzt, anfang, optionen.art.mindestens);
                const naechster = standNach(jetzt, { ...aenderung, entfernt });
                const verstoss =
                    optionen.pruefeSchritte === true ? neueVerstoesse(anfang, jetzt, naechster)[0] : undefined;
                if (verstoss !== undefined) {
                    // Nicht übernommen: Der Modus zeigt wieder den Stand davor, die Stelle bleibt markiert.
                    modus?.aktualisiere();
                    markiere(verstoss.stelle);
                    meldung.value = {
                        art: "verhindert",
                        grund: verstoss.grund,
                        name: verstoss.name,
                        eigen: laufend.value?.name ?? "",
                        stelle: verstoss.stelle,
                    };
                    return;
                }
                entwurf.schritt(naechster);
                zeige();
            },
        });
        if (modus === undefined) {
            beende();
            return;
        }
        setze({});
        karte.zeige(start.teile);
    }

    /** Vor dem Schreiben muss die Sperre gelten (EDIT-0003 §4); war sie verloren, wird sie neu genommen. */
    async function sperreFuerFertig(sperrId: string, name: string): Promise<boolean> {
        if (gesperrt === sperrId) return true;
        const neu = await optionen.sperre.nimm(ziel(sperrId), "form");
        if (neu.art === "genommen") {
            gesperrt = sperrId;
            return true;
        }
        meldung.value =
            neu.art === "gesperrt"
                ? { art: "gesperrt", name, wer: neu.sperre.person.name }
                : { art: "sperrfehler", name };
        return false;
    }

    async function fertig(): Promise<void> {
        const jetzt = laufend.value;
        const start = entwurf.start();
        const e = entwurf.jetzt();
        const quelleStart = geladen;
        if (jetzt?.phase !== "bereit" || start === undefined || e === undefined || modus === undefined) return;
        if (jetzt.ungespeichert === 0) {
            beende();
            return;
        }
        if (quelle.schreibe === undefined || quelleStart === undefined) return;
        const meiner = lauf;
        modus.sperre(true);
        setze({ phase: "speichert", frage: false });
        const weiter = (): void => {
            modus?.sperre(false);
            setze({ phase: "bereit" });
        };
        if (!(await sperreFuerFertig(quelleStart.sperrId, jetzt.name))) {
            if (lauf === meiner) weiter();
            return;
        }
        if (lauf !== meiner) return;
        const antwort = await quelle.schreibe(quelleStart, start, e, neueKennung());
        // Geschrieben ist geschrieben: Die Kacheln folgen, auch wenn der Modus inzwischen endete.
        if (antwort.ok) karte.geaendert(antwort.mapRevision);
        if (lauf !== meiner) return;
        if (antwort.ok) {
            const namen = antwort.mitgezogen.map((sperrId) => nachbarName(sperrId));
            const mitgezogen = [...new Set(namen.filter((n): n is string => n !== undefined))];
            beende();
            meldung.value = { art: "gespeichert", name: jetzt.name, mitgezogen };
            return;
        }
        weiter();
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            const details = antwort.fehler.details as
                { changedBy?: { displayName?: string }; changedAt?: string } | undefined;
            meldung.value = {
                art: "konflikt",
                name: jetzt.name,
                wer: details?.changedBy?.displayName,
                wann: details?.changedAt,
            };
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "object_locked") {
            const details = antwort.fehler.details as { lock?: { person?: { name?: string } } } | undefined;
            meldung.value = { art: "gesperrt", name: jetzt.name, wer: details?.lock?.person?.name ?? "" };
            return;
        }
        meldung.value = { art: "abgelehnt", satz: antwort.fehler.message };
    }

    /** Der Name eines mitgeschriebenen Nachbarn: über eine seiner Flächen oder sein sperrbares Objekt. */
    function nachbarName(kennung: string): string | undefined {
        const ueberFlaeche = nachbarVon.get(kennung);
        if (ueberFlaeche !== undefined) return ueberFlaeche.name;
        return [...nachbarVon.values()].find((n) => n.sperrId === kennung)?.name;
    }

    return {
        laufend,
        meldung,
        schreibbar: quelle.schreibe !== undefined,
        starte,
        traegt: (punkt) => modus?.traegt?.(punkt) ?? false,
        fertig,
        zurueck() {
            if (laufend.value?.phase !== "bereit" || !entwurf.zurueck()) return;
            zeige();
        },
        wieder() {
            if (laufend.value?.phase !== "bereit" || !entwurf.wieder()) return;
            zeige();
        },
        verwerfen() {
            if (laufend.value?.phase !== "bereit" || entwurf.start() === undefined) return;
            const name = laufend.value.name;
            entwurf.verwerfen();
            zeige();
            meldung.value = { art: "verworfen", name };
        },
        antworte(verwerfen) {
            if (laufend.value === undefined) return;
            if (entwurf.antworte(verwerfen) === "ende") beende();
            else setze({});
        },
        abbrechen() {
            if (laufend.value === undefined) return false;
            // Während geschrieben wird, hält Esc nichts an: Die Antwort kommt gleich.
            if (laufend.value.phase === "speichert") return true;
            if (modus?.abbrechen() === true) return true;
            if (entwurf.esc() === "ende") beende();
            else setze({});
            return true;
        },
        beende,
        entwurf: () => entwurf.jetzt(),
        destroy() {
            beende();
            abmelden();
        },
    };
}
