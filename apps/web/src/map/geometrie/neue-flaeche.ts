import { shallowRef, type Component, type ShallowRef } from "vue";
import type { LandscapeSelection, MapView } from "@avesmaps3d/shared";
import type { MessageKey } from "../../i18n/i18n";
import type {
    AnlegenArt,
    AnlegenEingabe,
    AnlegenGrund,
    AnlegenModus,
    AnlegenPunkt,
    AnlegenStand,
    AnlegenZeiger,
} from "./anlegen";
import { geometrieBelegt } from "./besitzer";
import type { Pixel, Punkt, Ziel } from "./geometrie";
import { deckungsgleich, einrasten } from "./rechnung";

/**
 * „Neue Fläche“ (C3; EDIT-0003 T47, abgenommen 2026-10-18, §6 „Neue Fläche“; Kopf
 * `project-control/discovery/wi-0209-c3-neue-flaeche-schnittstelle-2026-10-18.md`): EIN Anlegen-Ablauf für alle Flächen, Derographie
 * (je Ebene) und Herrschaftsgebiete, über dem Modus „Anlegen“ des Geometrie-Moduls (`anlegen.ts`, Besitzer `geometry-edit`, nie zwei
 * Modi zugleich). Muster `wegeditor/neuer-weg.ts`. Der Ablauf kennt Ansicht und Ebene, nicht den Server: Was entsteht, wie es geschrieben
 * wird, woran es einrastet und was danach aufgeht, sagt die **Andockung** der Art (`NeueFlaecheAndockung`).
 *
 * Betreiber 2026-10-18 zur Probierseite T47, wörtlich: „Nach dem Zeichnen / Fertig: bleiben · Abbruch: zurück“.
 *
 * 1. **Prüfen:** kein laufender Modus (`geometrieBelegt`), die Rechte und `MAP_EDITING` der Seite (`grund`), dazu `andockung.darf()`.
 *    Sonst gibt `starte` den Grund zurück, und nichts geschieht.
 * 2. **Merken** der Ansicht von vorher (Ansicht und Ebene), **Umschalten** auf die der Art (Derographie: Landschaften in ihrer Ebene;
 *    Herrschaftsgebiet: Politisch); die Kamera bleibt. **Sperren** des Ansichtswechsels, solange gezeichnet wird („Erst fertig zeichnen
 *    oder mit Esc abbrechen.“); der Untergrund-Regler bleibt frei.
 * 3. **Zeichnen** im Modus „Anlegen“ mit `andockung.art`. Der Punkt, an dem es begann (der Klickpunkt des Kartenmenüs, Legacy), ist die
 *    erste Ecke, eingerastet wie ein Klick; ohne ihn setzt sie der erste Klick. Die Ziele liest der Ablauf nach dem Umschalten und wann
 *    immer die Karte zur Ruhe kommt (`ladeZiele`), nie während einer Geste. Gesten, Tasten und Esc-Frage wie „Neuer Weg“ (R2, R3, R5, R7).
 * 4. **Fertig** (Klick auf die erste Ecke, Doppelklick, Enter, Knopf) schreibt über `andockung.schreibe` EINE Operation. Gelungen: Modus
 *    aus, Sperre weg, die Ansicht BLEIBT, `andockung.geoeffnet` öffnet das Fenster an der neuen Fläche. Abgelehnt: der Entwurf bleibt,
 *    die Meldung trägt den Satz des Servers.
 * 5. **Abbruch** (Esc nach der Frage, Esc ohne Abschnitt, „Verwerfen“ auf die Frage): Modus aus, Sperre weg, Ansicht und Ebene von
 *    vorher ZURÜCK; nichts ist entstanden. „Verwerfen“ in der Leiste stellt nur den Beginn her, der Modus bleibt (F20). Esc während des
 *    Schreibens beendet den Modus, die Ansicht bleibt (ob die Fläche entstand, sagt erst die Quittung).
 *
 * Die Leiste ist `neue-flaeche-leiste.vue` (im Platz `#zusatz` das Bauteil `andockung.zusatz`, die Derographie: ihr Untergrund-Regler,
 * Frage 5; Editor-Orchestrierung 2026-10-18: ein Bauteil der Andockung, kein Slot der Seite); Tasten, Meldungen und
 * Schild verbindet `neue-flaeche-anbindung.ts` mit der Seite.
 */

/** Eine Ansicht der Karte: `layer` nur für die Landschaften; ohne bleibt die Ebene, wie sie ist. */
export interface NeueFlaecheAnsicht {
    readonly view: MapView;
    readonly layer?: LandscapeSelection | undefined;
}

/** Ein Kasten in Karteneinheiten. */
export interface NeueFlaecheKasten {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}

/** Die Antwort der Andockung auf „Fertig“: angelegt, abgelehnt mit Satz, oder der Server scheiterte (`status` 0: keine Antwort). */
export type NeueFlaecheErgebnis =
    | {
          readonly ok: true;
          readonly publicId: string;
          readonly name: string;
          readonly mapRevision?: number | undefined;
          /** Ein Satz der Art zur Meldung (die Gebiete: ab welchem Band die Karte das Gebiet zeigt). */
          readonly hinweis?: string | undefined;
      }
    | { readonly ok: false; readonly satz: string }
    | { readonly ok: false; readonly status: number };

/**
 * Was entsteht (je Art eine; Tafel im Kopf von `project-control/discovery/wi-0209-c3-neue-flaeche-schnittstelle-2026-10-18.md`). Eine
 * Andockung gilt für EINEN Lauf: Sie darf sich merken, was `objekt` an der ersten Ecke bestimmt hat (das Gebiet: sein Obergebiet), und
 * schreibt damit, damit die Leiste vorher sagt, was „Fertig“ schreibt.
 */
export interface NeueFlaecheAndockung {
    /** `derographisch`, `vegetation`, `topographie`, `gebiet`, `gebiet-grenze` … */
    readonly id: string;
    readonly art: AnlegenArt;
    readonly ansicht: NeueFlaecheAnsicht;
    /** Was entsteht, für die Leiste („Herrschaftsgebiet“, „Regionen“). */
    readonly titel: MessageKey;
    /**
     * Was die Art beim Zeichnen in der Leiste braucht (Platz `#zusatz`; die Derographie: den Untergrund-Regler, Frage 5). Ohne steht
     * dort nichts; so kommt in der Leiste nichts einer bestimmten Art vor, und in Politisch erscheint kein Regler.
     */
    readonly zusatz?: Component | undefined;
    /** Warum es gerade nicht geht; ohne Grund geht es. */
    darf(): MessageKey | undefined;
    /**
     * Was die Leiste über das Entstehende sagt, sobald die erste Ecke steht (Gebiet: „Wird Untergebiet von Grafschaft Albenhus“);
     * gefragt erst, wenn die Karte in der Ansicht der Art gezeichnet ist, und neu, wenn sich die erste Ecke ändert.
     */
    objekt?(ersteEcke: Punkt | undefined): string | undefined;
    /** Woran eingerastet wird, im Kasten um den sichtbaren Ausschnitt; `um` ist die letzte Ecke. `null`: nicht lesbar. */
    ziele(kasten: NeueFlaecheKasten, um: Punkt | undefined, signal: AbortSignal): Promise<readonly Ziel[] | null>;
    /** Der Ring offen (die erste Ecke nicht wiederholt), eckig, wie gezeichnet; EINE Operation. */
    schreibe(ring: readonly Punkt[], operationId: string): Promise<NeueFlaecheErgebnis>;
    /** Gespeichert: das Fenster an der neuen Fläche öffnen, der Name markiert. */
    geoeffnet(neu: { readonly publicId: string; readonly name: string }): void;
}

export interface NeueFlaecheAuftrag {
    readonly andockung: NeueFlaecheAndockung;
    /** Der Klickpunkt des Menüs = die erste Ecke; ohne setzt sie der erste Klick. */
    readonly anfang?: Punkt | undefined;
}

export interface NeueFlaecheLauf {
    readonly phase: "laedt" | "bereit" | "speichert";
    /** Die Kennung der Andockung. */
    readonly andockung: string;
    readonly titel: MessageKey;
    /** Das Bauteil der Andockung für den Platz `#zusatz` der Leiste. */
    readonly zusatz: Component | undefined;
    readonly objekt: string | undefined;
    readonly stand: AnlegenStand;
    /** Esc mit ungespeicherten Abschnitten: die Frage, ob verworfen wird. */
    readonly frage: boolean;
}

export type NeueFlaecheMeldung =
    | {
          readonly art: "gespeichert";
          readonly publicId: string;
          readonly name: string;
          readonly hinweis?: string | undefined;
      }
    | { readonly art: "abgelehnt"; readonly satz: string }
    /** Der Server scheiterte (5xx) oder antwortete nicht (`status` 0); der Entwurf bleibt. */
    | { readonly art: "serverfehler"; readonly status: number }
    | { readonly art: "abgewiesen"; readonly grund: AnlegenGrund }
    | { readonly art: "verworfen" };

export interface NeueFlaecheKarte {
    /** Schaltet den Modus „Anlegen“ ein (`anlegen-modus.ts`); ohne Karte `undefined`. */
    ein(eingabe: AnlegenEingabe): AnlegenModus | undefined;
    sichtbar(): NeueFlaecheKasten | undefined;
    schirm(p: Punkt): Pixel;
    /** Die Ansicht jetzt. */
    ansicht(): NeueFlaecheAnsicht;
    stelle(ansicht: NeueFlaecheAnsicht): void;
    /** Solange gezeichnet wird, wechselt weder Ansicht noch Ebene. */
    sperreAnsicht(gesperrt: boolean): void;
    /** Bis die Karte in der Ansicht der Art gezeichnet ist (die Andockung liest an der ersten Ecke, was dort zu sehen ist). */
    gezeichnet(): Promise<void>;
    /** Nach dem Speichern: die Karte mit der Revision der Quittung neu. */
    geaendert(revision: number | undefined): void;
}

export interface NeueFlaecheOptionen {
    readonly karte: NeueFlaecheKarte;
    readonly fangradius: () => number;
    /**
     * Rechte und `MAP_EDITING` der Seite für diese Andockung; ohne Grund geht es. Die Andockung entscheidet mit, weil die Rechte am Fach hängen
     * (WI-0279): Eine Sprache zeichnet, wer Sprachen schreibt, nicht, wer Derographie oder Gebiete formt.
     */
    readonly grund?: (andockung: NeueFlaecheAndockung) => MessageKey | undefined;
    readonly neueKennung?: () => string;
    /** Solange wahr, setzt jeder Klick eine Ecke und kein Doppelklick schließt (gehaltene Leertaste, OPS-000040; `AnlegenEingabe`). */
    readonly einzeln?: () => boolean;
}

/** Was `starte` sagt: Der Modus läuft, oder warum nicht. */
export type NeueFlaecheStart = "laeuft" | MessageKey;

export interface NeueFlaeche {
    readonly laufend: Readonly<ShallowRef<NeueFlaecheLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<NeueFlaecheMeldung | undefined>>;
    /** Das Ziel unter dem Zeiger, für das Schild (`anlegen-schild.vue`). */
    readonly zeiger: Readonly<ShallowRef<AnlegenZeiger | undefined>>;
    starte(auftrag: NeueFlaecheAuftrag): Promise<NeueFlaecheStart>;
    /** Die Ziele neu lesen (die Karte ist zur Ruhe gekommen). */
    ladeZiele(): Promise<void>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): void;
    /** Die Antwort auf die Frage beim Verlassen: verwerfen und zurück, oder weiter zeichnen. */
    antworte(verwerfen: boolean): void;
    /** Esc: schließt die Frage, fragt bei ungespeicherten Abschnitten, sonst endet der Modus. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    /** Beendet ohne Frage wie ein Abbruch (zurück zur Ansicht von vorher). */
    beende(): void;
    destroy(): void;
}

const LEER: AnlegenStand = { punkte: 0, abschnitte: 0, zurueck: false, wieder: false, fertig: "zuWenig" };

export function createNeueFlaeche(optionen: NeueFlaecheOptionen): NeueFlaeche {
    const { karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<NeueFlaecheLauf | undefined>(undefined);
    const meldung = shallowRef<NeueFlaecheMeldung | undefined>(undefined);
    const zeiger = shallowRef<AnlegenZeiger | undefined>(undefined);
    let modus: AnlegenModus | undefined;
    let andockung: NeueFlaecheAndockung | undefined;
    let vorher: NeueFlaecheAnsicht | undefined;
    let ziele: readonly Ziel[] = [];
    let lesen: AbortController | undefined;
    /** Die erste Ecke, nach der die Andockung zuletzt gefragt wurde; `null`: noch nie (gefragt wird auch ohne Ecke, beim Start). */
    let ersteEcke: Punkt | undefined | null = null;
    /** Jeder Start bekommt eine eigene Marke; was zu einem älteren gehört, kommt zu spät und zählt nicht. */
    let lauf: object | undefined;

    const setze = (teil: Partial<NeueFlaecheLauf>): void => {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...teil };
    };

    async function holeZiele(signal: AbortSignal, um: Punkt | undefined): Promise<readonly Ziel[] | null> {
        const sichtbar = karte.sichtbar();
        if (sichtbar === undefined || andockung === undefined) return null;
        try {
            return await andockung.ziele(sichtbar, um, signal);
        } catch {
            return null;
        }
    }

    /** Die Zeile der Leiste über das Entstehende, wenn sich die erste Ecke geändert hat. */
    function folgeErsterEcke(punkt: AnlegenPunkt | undefined): void {
        const at = punkt?.at;
        const gleich =
            ersteEcke !== null &&
            (at === undefined ? ersteEcke === undefined : ersteEcke !== undefined && deckungsgleich(at, ersteEcke));
        if (gleich) return;
        ersteEcke = at;
        setze({ objekt: andockung?.objekt?.(at) });
    }

    /** Beendet den Lauf: nach „Fertig“ bleibt die Ansicht, nach einem Abbruch geht es zur Ansicht von vorher zurück. */
    function ende(wie: "bleiben" | "zurueck"): void {
        const zurueckZu = vorher;
        const lief = laufend.value !== undefined;
        lesen?.abort();
        lesen = undefined;
        modus?.aus();
        modus = undefined;
        ziele = [];
        lauf = undefined;
        andockung = undefined;
        vorher = undefined;
        ersteEcke = null;
        zeiger.value = undefined;
        laufend.value = undefined;
        if (!lief) return;
        karte.sperreAnsicht(false);
        if (wie === "zurueck" && zurueckZu !== undefined) karte.stelle(zurueckZu);
    }

    async function schreibe(punkte: readonly AnlegenPunkt[]): Promise<void> {
        const meiner = lauf;
        const art = andockung;
        if (laufend.value?.phase !== "bereit" || modus === undefined || art === undefined) return;
        modus.sperre(true);
        setze({ phase: "speichert", frage: false });
        // Auch eine Ausnahme beim Schreiben lässt den Modus nie im Speichern hängen.
        const ergebnis = await art
            .schreibe(
                punkte.map((p) => ({ x: p.at.x, y: p.at.y })),
                neueKennung(),
            )
            .catch((): NeueFlaecheErgebnis => ({ ok: false, status: 0 }));
        // Gespeichert ist gespeichert: Die Karte folgt, auch wenn der Modus inzwischen endete.
        if (ergebnis.ok) karte.geaendert(ergebnis.mapRevision);
        if (lauf !== meiner) return;
        if (ergebnis.ok) {
            const { publicId, name, hinweis } = ergebnis;
            ende("bleiben");
            meldung.value = { art: "gespeichert", publicId, name, ...(hinweis === undefined ? {} : { hinweis }) };
            art.geoeffnet({ publicId, name });
            return;
        }
        modus?.sperre(false);
        setze({ phase: "bereit" });
        meldung.value =
            "satz" in ergebnis
                ? { art: "abgelehnt", satz: ergebnis.satz }
                : { art: "serverfehler", status: ergebnis.status };
    }

    async function starte(auftrag: NeueFlaecheAuftrag): Promise<NeueFlaecheStart> {
        if (geometrieBelegt()) return "geometrie.belegt";
        const grund = optionen.grund?.(auftrag.andockung) ?? auftrag.andockung.darf();
        if (grund !== undefined) return grund;
        ende("zurueck");
        meldung.value = undefined;
        const meiner = {};
        lauf = meiner;
        andockung = auftrag.andockung;
        vorher = karte.ansicht();
        karte.stelle(andockung.ansicht);
        karte.sperreAnsicht(true);
        laufend.value = {
            phase: "laedt",
            andockung: andockung.id,
            titel: andockung.titel,
            zusatz: andockung.zusatz,
            objekt: undefined,
            stand: LEER,
            frage: false,
        };
        const eigene = new AbortController();
        lesen = eigene;
        await karte.gezeichnet();
        if (lauf !== meiner) return "laeuft";
        const geladen = (await holeZiele(eigene.signal, auftrag.anfang)) ?? [];
        if (lauf !== meiner) return "laeuft";
        lesen = undefined;
        ziele = geladen;
        const art = andockung.art;
        // Der Klickpunkt des Menüs rastet wie ein Klick ein: an einer Ecke oder Kante im Fangradius.
        let erste: AnlegenPunkt | undefined;
        if (auftrag.anfang !== undefined) {
            const treffer = einrasten(
                karte.schirm(auftrag.anfang),
                ziele,
                art.ziele("anfang"),
                optionen.fangradius(),
                karte.schirm,
            );
            erste = { at: treffer?.at ?? auftrag.anfang, ziel: treffer?.ziel };
        }
        const ein = karte.ein({
            art,
            anfang: erste,
            ziele: () => ziele,
            fangradius: optionen.fangradius,
            stand(stand) {
                setze({ stand });
                folgeErsterEcke(modus?.entwurf().punkte[0] ?? erste);
            },
            zeiger(neu) {
                zeiger.value = neu;
            },
            fertig(punkte) {
                void schreibe(punkte);
            },
            abgewiesen(grund) {
                meldung.value = { art: "abgewiesen", grund };
            },
            einzeln: () => optionen.einzeln?.() === true,
        });
        if (ein === undefined) {
            ende("zurueck");
            return "geometrie.belegt";
        }
        modus = ein;
        setze({ phase: "bereit" });
        folgeErsterEcke(ein.entwurf().punkte[0]);
        return "laeuft";
    }

    return {
        laufend,
        meldung,
        zeiger,
        starte,
        async ladeZiele() {
            if (laufend.value?.phase !== "bereit") return;
            lesen?.abort();
            const eigene = new AbortController();
            lesen = eigene;
            const neu = await holeZiele(eigene.signal, modus?.entwurf().punkte.at(-1)?.at);
            if (lesen !== eigene) return;
            lesen = undefined;
            if (neu === null) return;
            ziele = neu;
            modus?.aktualisiere();
        },
        zurueck: () => modus?.zurueck(),
        wieder: () => modus?.wieder(),
        verwerfen() {
            if (laufend.value?.phase !== "bereit") return;
            modus?.verwerfen();
            setze({ frage: false });
            meldung.value = { art: "verworfen" };
        },
        fertig: () => modus?.fertig(),
        antworte(verwerfen) {
            if (laufend.value === undefined) return;
            if (!verwerfen) {
                setze({ frage: false });
                return;
            }
            ende("zurueck");
            meldung.value = { art: "verworfen" };
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            // Während des Schreibens nicht mehr warten; ob die Fläche entstand, sagt erst die Quittung, darum bleibt die Ansicht.
            if (jetzt.phase === "speichert") {
                ende("bleiben");
                return true;
            }
            // Das zweite Esc beantwortet die Frage: verwerfen und zurück.
            if (jetzt.frage) {
                ende("zurueck");
                meldung.value = { art: "verworfen" };
                return true;
            }
            if (jetzt.stand.abschnitte > 0) {
                setze({ frage: true });
                return true;
            }
            ende("zurueck");
            return true;
        },
        beende: () => ende("zurueck"),
        destroy: () => ende("zurueck"),
    };
}
