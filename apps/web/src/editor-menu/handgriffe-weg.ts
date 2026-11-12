import { pathChainKey, type EditorLock, type EditorStatus } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { Teilstelle } from "../wegeditor/weg-hier-teilen";
import type { EditorAction, EditorMenuSubject, HandgriffWahl } from "./action";
import { modusGrund } from "./handgriffe-ort";

/**
 * Die Handgriffe an einem Weg im Register (WI-0177 W2; EDIT-0003 G10, T24, T25; Probierblatt P5, Blatt „Wegeditor“). Folge und Wörter
 * wie im Probierblatt:
 *
 * - **Bearbeiten:** „Eigenschaften bearbeiten“ öffnet das Wege-Fenster an der Straße (W5a, noch lesend), „Wegkurve bearbeiten“ und „Wegkurve
 *   vereinfachen“ (W3, Wunsch des Betreibers 2026-10-16) starten ihren Modus am Abschnitt.
 * - **Neues von hier aus:** „Neuer Weg ab hier“ am Ort startet das Zeichnen mit dem Ort als Anfang (EDIT-0003 T40 (3), T24; Probierblatt
 *   P5). Es braucht beide Schreibrechte wie „Neuer Ort“; während ein Modus läuft, ist es gesperrt. „Neuer Weg“ an einer Stelle der Karte
 *   steht unter „Hier hinzufügen ›“ (`kartenmenue.ts`).
 * - **Entfernen:** „Weg entfernen …“, rot, zuletzt: öffnet das Blatt mit den zwei Stufen (`wegeditor/weg-entfernen-fenster.vue`) für den
 *   Abschnitt unter dem Rechtsklick beziehungsweise den vom zweiten Klick markierten. Liegt der Abschnitt unter dem Rechtsklick in der
 *   Mehrfachauswahl (WI-0252), gilt das Blatt allen angehakten Wegen in EINER Operation (`inMehrfach`, `entfernenAuswahl`).
 * - **Weg hier teilen** (Thomas 2.1; Betreiber 2026-10-19 „A: auch am Weg (Empfehlung)“): im Kartenmenü am Abschnitt unter dem
 *   Rechtsklick; teilt an seinem inneren Stützpunkt, der dem Klick am nächsten liegt (`wegeditor/weg-hier-teilen.ts`), ohne den Modus.
 *   Liegt keiner in der Nähe, steht der Eintrag grau und sagt, wie man einen setzt.
 * - **Am Stützpunkt** (nur im Rechtsklick auf den Griff der laufenden Wegkurve, `situativ`; T24 (3), R7): „Hier teilen“ (am inneren
 *   Stützpunkt, ohne Ungespeichertes: Teilen ist eine eigene Operation `path.split`) und „Stützpunkt entfernen“ (ein Schritt im Entwurf
 *   wie der Doppelklick; die Enden bleiben).
 *
 * 🔴 Ein Weg ist im Infopanel die ganze Straße (`PathRef`, die Gruppe der Abschnitte); die Wegkurve gilt EINEM Abschnitt. Im Kartenmenü
 * ist es der Abschnitt unter dem Rechtsklick (`anchor`). Im Menü am Objekt und im Infopanel ist es der Abschnitt, den der zweite Klick
 * markiert hat (T24 (1), `WegLage.abschnitt`). 🪤 Nie den Anker des Gegenstands nehmen: Nach der Antwort des Servers ist es der kleinste
 * Abschnitt der Straße, nicht der markierte. Dasselbe gilt für „Wegkurve vereinfachen“.
 *
 * **Abschnitte im Menü** (EDIT-0003 T49, Betreiber 2026-10-17 nach der Probierseite: „abschnittseditierung perfekt“): Solange die ganze
 * Straße markiert ist (erster Klick), stehen im Menü am Objekt „Wegkurve bearbeiten ›“, „Wegkurve vereinfachen ›“ und „Weg entfernen ›“ mit
 * dem Untermenü ihrer Abschnitte „n · Von – Bis“ (`WegLage.wahlen`, `wegeditor/weg-abschnitte.ts`); Zeigen lässt den Abschnitt leuchten.
 * „Weg entfernen ›“ hat dazu „Ganze Straße (n Abschnitte) …“. Hat sie nur einen Abschnitt, steht er trotzdem im Untermenü. Der zweite Klick
 * bleibt wie gebaut (die Einträge flach am markierten). Am Finger (`WegLage.finger`) gibt es kein Menü am Objekt: Dort trägt das Blatt
 * des langen Drucks dieselben Untermenüs statt der Einträge am Abschnitt unter dem Finger.
 */

/** Was die Handgriffe über den Stand wissen; `app.vue` liest ihn bei jedem Öffnen frisch. */
export interface WegLage {
    readonly rechte: readonly string[];
    /** Der Stand des Bearbeitens (`MAP_EDITING`, E9); unbekannt zählt wie ausgeschaltet. */
    readonly bearbeiten: EditorStatus | undefined;
    /** Läuft gerade ein Modus (Wegkurve, Ecken bearbeiten, Ort verschieben …)? */
    readonly laeuft: boolean;
    /** Der Abschnitt, den der zweite Klick auf der Karte markiert hat (`path.public_id`); die ganze Straße: keiner. */
    readonly abschnitt?: string | undefined;
    /** Der Stützpunkt unter dem Rechtsklick in der laufenden Wegkurve: sein Index, ob er ein Ende ist, ob Ungespeichertes steht. */
    readonly griff?: { readonly index: number; readonly ende: boolean; readonly ungespeichert: boolean } | undefined;
    /** Die Abschnitte der Straße dieses Gegenstands als Wahlen „n · Von – Bis“ (T49); leer, solange sie lädt. */
    readonly wahlen?: ((subject: EditorMenuSubject) => readonly HandgriffWahl[]) | undefined;
    /** Am Finger: Das Blatt des langen Drucks trägt die Untermenüs der Abschnitte (es gibt kein Menü am Objekt). */
    readonly finger?: boolean | undefined;
    /** Der Text der Wahl „Ganze Straße (n Abschnitte) …“ in der Sprache der Seite. */
    readonly ganzeStrasse?: ((abschnitte: number) => string) | undefined;
    /** Die Sperre eines anderen an diesem Abschnitt (EDIT-0003 §4; WI-0205 K11): Dann geht die Form nicht. */
    readonly sperreVon?: ((abschnitt: string) => EditorLock | undefined) | undefined;
    /** Wo „Weg hier teilen“ diesen Abschnitt am Rechtsklick teilen würde (`weg-hier-teilen.ts`). */
    readonly teilstelle?: ((abschnitt: string) => Teilstelle) | undefined;
    /**
     * Gehört dieser Abschnitt zur Auswahl des vordersten Wege-Fensters (WI-0252: mehrere angehakte Wege oder ein Teil der Abschnitte eines
     * Wegs)? Nur dann steht „Auswahl zu neuem Weg …“ an ihm.
     */
    readonly inAuswahl?: ((abschnitt: string) => boolean) | undefined;
    /**
     * Gehört dieser Abschnitt zu einem der angehakten Wege der Mehrfachauswahl des vordersten Wege-Fensters (WI-0252)? Dann gilt „Weg
     * entfernen …“ im Kartenmenü allen angehakten Wegen, nicht nur dem Abschnitt unter dem Rechtsklick.
     */
    readonly inMehrfach?: ((abschnitt: string) => boolean) | undefined;
    /**
     * „Wege verbinden ›“ an diesem Abschnitt (WI-0252): die gewählten Abschnitte in Kettenfolge als Wahlen und, solange es nicht geht oder
     * geprüft wird, der Grund; `undefined` ohne Auswahl von mindestens zwei Abschnitten, zu der er gehört.
     */
    readonly verbinden?:
        | ((
              abschnitt: string,
          ) => { readonly wahlen: readonly HandgriffWahl[]; readonly grund: MessageKey | undefined } | undefined)
        | undefined;
}

/** Was die Handgriffe tun; `app.vue` bindet es an die Wegkurve. */
export interface WegWirkung {
    /** Das Wege-Fenster an diesem Weg öffnen: am Abschnitt (`anchor`) oder an der Straße (`chain`). */
    eigenschaften(weg: { readonly anchor: string } | { readonly chain: string }): void;
    /** Den Modus „Wegkurve bearbeiten“ an diesem Abschnitt starten (`path.public_id`). */
    wegkurve(publicId: string): void;
    /** Den Modus „Wegkurve vereinfachen“ an diesem Abschnitt starten. */
    vereinfachen(publicId: string): void;
    /** „Hier teilen“ am Stützpunkt `index` der laufenden Wegkurve (`path.split`). */
    teilen?(index: number): void;
    /** „Weg hier teilen“ am Abschnitt unter dem Rechtsklick (`path.split` am nächsten inneren Stützpunkt); `name` für den Hinweis. */
    teilenAmWeg?(publicId: string, name: string): void;
    /** „Stützpunkt entfernen“: ein Schritt im Entwurf der laufenden Wegkurve. */
    stuetzpunktEntfernen?(index: number): void;
    /** „Weg entfernen …“: das Blatt für diesen Abschnitt öffnen. */
    entfernen?(publicId: string): void;
    /** „Ganze Straße (n Abschnitte) …“: das Blatt für alle Abschnitte der Straße dieses Abschnitts öffnen. */
    entfernenStrasse?(publicId: string): void;
    /** „Weg entfernen …“ an der Mehrfachauswahl (WI-0252): das Blatt für alle angehakten Wege öffnen. */
    entfernenAuswahl?(): void;
    /** „Neuer Weg ab hier“: das Zeichnen mit diesem Ort als Anfang starten (`place.public_id`). */
    neuAbOrt(publicId: string): void;
    /** „Auswahl zu neuem Weg …“ (WI-0252): die Rückfrage im vordersten Wege-Fenster öffnen. */
    neuerWeg?(): void;
    /** „Wege verbinden ›“ (WI-0252): die Auswahl mit dieser Vorlage verbinden (`path.public_id`). */
    verbinden?(vorlage: string): void;
}

/** Ein Abschnitt unter dem Zeiger, wie die Kachel ihn kennt. */
export interface WegAmPunkt {
    readonly publicId: string;
    readonly name: string;
    readonly subtype: string;
    readonly isBach: boolean;
}

/**
 * Ein Abschnitt als Gegenstand der Handgriffe (Kartenmenü): der Anker ist der angeklickte Abschnitt, die Kette (`name:<Name>`) nennt die
 * Straße, wo sie einen Namen hat. `titel` steht schon in der Sprache der Seite (ein namenloser heißt nach seiner Art, WI-0105).
 */
export function wegSubjekt(weg: WegAmPunkt, titel: string): EditorMenuSubject {
    const kette = pathChainKey(weg.name);
    return {
        ref:
            weg.name.trim() === ""
                ? { kind: "path", anchor: weg.publicId }
                : { kind: "path", anchor: weg.publicId, chain: kette },
        title: titel,
        art: undefined,
        answer: undefined,
    };
}

/** Der angeklickte Abschnitt eines Wegs; ohne Anker (die ganze Straße aus dem Infopanel) keiner. */
const abschnitt = (subject: EditorMenuSubject): string | undefined =>
    subject.ref.kind === "path" && "anchor" in subject.ref ? subject.ref.anchor : undefined;

/** Die Wahl „Ganze Straße“ im Untermenü von „Weg entfernen ›“. */
export const GANZE_STRASSE = "strasse";

/**
 * Wo die Abschnitte im Untermenü stehen (T49): `strasse` im Menü am Objekt, solange die ganze Straße markiert ist; `finger` im Blatt des
 * langen Drucks statt des Eintrags am Abschnitt unter dem Finger (`karte`). Erst wenn die Straße geladen ist: Bis dahin steht am Finger
 * der Eintrag am Abschnitt, und am Objekt fehlt der Handgriff (nie ein leeres Untermenü).
 */
function abschnitteSichtbar(
    lage: () => WegLage,
    wo: "karte" | "strasse" | "finger",
): (subject: EditorMenuSubject) => boolean {
    return (subject) => {
        const jetzt = lage();
        const geladen = (jetzt.wahlen?.(subject).length ?? 0) > 0;
        if (wo === "strasse") return jetzt.abschnitt === undefined && geladen;
        const amFinger = jetzt.finger === true && geladen;
        return wo === "finger" ? amFinger : !amFinger;
    };
}

export function wegHandgriffe(lage: () => WegLage, wirkung: WegWirkung): EditorAction[] {
    /** Ohne Recht „ohne Recht“, sonst „Kommt später.“ (die Schreibwege kommen mit ihren Stufen). */
    const spaeter = (recht: string) => (): "editorPanel.spaeter.satz" | "ortseditor.handgriff.grund.recht" =>
        lage().rechte.includes(recht) ? "editorPanel.spaeter.satz" : "ortseditor.handgriff.grund.recht";
    /**
     * Ein Modus an der Form eines Abschnitts, zweimal: im Kartenmenü am Abschnitt unter dem Rechtsklick, im Menü am Objekt und im
     * Infopanel am Abschnitt, den der zweite Klick markiert hat. Wie „Gebietsform bearbeiten“ an der Fläche (F18): ohne Recht, bei
     * ausgeschaltetem Bearbeiten, während ein Modus läuft und wenn ein anderer den Abschnitt gerade bearbeitet (`sperreVon`, F10: 🔒
     * „wird gerade bearbeitet“; wer und seit wann steht im Kasten darüber) gesperrt. In den Untermenüs („strasse“, „finger“) wählt man
     * den Abschnitt erst dort: Am Eintrag steht keine Sperre (Absprache mit der Wege-Sitzung 2026-10-18); die Sperre beim Start sagt es.
     */
    const amAbschnitt = (
        id: string,
        zeichen: EditorZeichenName,
        label: MessageKey,
        starte: (publicId: string) => void,
        doppelklick = false,
    ): EditorAction[] => {
        const grund = (markiert: boolean, am?: string): MessageKey | undefined => {
            const jetzt = lage();
            if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
            if (am !== undefined && jetzt.sperreVon?.(am) !== undefined) return "sperre.grund";
            if (!jetzt.rechte.includes("edit_map_geometry")) return "ortseditor.handgriff.grund.recht";
            if (markiert && jetzt.abschnitt === undefined) return "wegeditor.griff.grund.abschnitt";
            return modusGrund(jetzt.bearbeiten);
        };
        const gemeinsam = {
            kinds: ["path"],
            capability: "edit_map_geometry",
            gruppe: "bearbeiten",
            zeichen,
            label,
        } as const;
        return [
            {
                ...gemeinsam,
                id,
                stellen: ["karte"],
                ...(doppelklick ? { doppelklick: true as const } : {}),
                // Am Finger trägt das Blatt die Abschnitte im Untermenü (`-finger`).
                visible: abschnitteSichtbar(lage, "karte"),
                sperre: (subject) => grund(false, abschnitt(subject)),
                run: ({ subject }) => {
                    const publicId = abschnitt(subject);
                    if (publicId !== undefined) starte(publicId);
                },
            },
            // Abschnitte im Menü (T49): solange die ganze Straße markiert ist im Menü am Objekt, am Finger im Blatt des langen Drucks.
            ...(["strasse", "finger"] as const).map((wo): EditorAction => ({
                ...gemeinsam,
                id: `${id}-${wo}`,
                stellen: wo === "strasse" ? ["objekt"] : ["karte"],
                visible: abschnitteSichtbar(lage, wo),
                auswahl: (subject) => lage().wahlen?.(subject) ?? [],
                sperre: () => grund(false),
                run: ({ wahl }) => {
                    if (wahl !== undefined) starte(wahl);
                },
            })),
            {
                ...gemeinsam,
                id: `${id}-abschnitt`,
                stellen: ["objekt", "infopanel"],
                sperre: () => grund(true, lage().abschnitt),
                run: () => {
                    const publicId = lage().abschnitt;
                    if (publicId !== undefined) starte(publicId);
                },
            },
        ];
    };
    return [
        {
            id: "weg-eigenschaften",
            kinds: ["path"],
            capability: "use_editor_menu",
            gruppe: "bearbeiten",
            zeichen: "bearbeiten",
            label: "wegeditor.griff.eigenschaften",
            run: ({ subject }) => {
                const ref = subject.ref;
                if (ref.kind !== "path") return;
                if ("anchor" in ref) wirkung.eigenschaften({ anchor: ref.anchor });
                else wirkung.eigenschaften({ chain: ref.chain });
            },
        },
        // Der Doppelklick auf einen Weg startet die Wegkurve am Abschnitt unter dem Zeiger (EDIT-0003 R3).
        ...amAbschnitt("weg-wegkurve", "gebietsform", "wegeditor.griff.wegkurve", (id) => wirkung.wegkurve(id), true),
        ...amAbschnitt("weg-vereinfachen", "vereinfachen", "wegeditor.griff.vereinfachen", (id) =>
            wirkung.vereinfachen(id),
        ),
        // „Weg hier teilen“ am Abschnitt unter dem Rechtsklick (Thomas 2.1, Betreiber 2026-10-19 „A: auch am Weg (Empfehlung)“).
        {
            id: "weg-hier-teilen",
            kinds: ["path"],
            capability: "edit_map_geometry",
            gruppe: "bearbeiten",
            stellen: ["karte"],
            zeichen: "zerschneiden",
            label: "wegeditor.griff.teilenAmWeg",
            visible: () => wirkung.teilenAmWeg !== undefined,
            sperre: (subject) => {
                const jetzt = lage();
                const am = abschnitt(subject);
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                if (am !== undefined && jetzt.sperreVon?.(am) !== undefined) return "sperre.grund";
                if (!jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry"))
                    return "ortseditor.handgriff.grund.recht";
                const modus = modusGrund(jetzt.bearbeiten);
                if (modus !== undefined) return modus;
                const stelle = am === undefined ? undefined : jetzt.teilstelle?.(am);
                if (stelle === undefined || stelle.art === "laedt") return "wegeditor.griff.grund.laedt";
                return stelle.art === "keine" ? "wegeditor.griff.grund.keinStuetzpunkt" : undefined;
            },
            run: ({ subject }) => {
                const am = abschnitt(subject);
                if (am !== undefined) wirkung.teilenAmWeg?.(am, subject.title);
            },
        },
        // „Auswahl zu neuem Weg …“ (WI-0252; Betreiber 2026-10-24: „(bei Form bzw. im kontextmenü)“): im Kartenmenü an einem Abschnitt der
        // Auswahl des vordersten Wege-Fensters; öffnet dort die Rückfrage mit dem Namen. Die Namens- und Zuweisungsaktion, keine Geometrie.
        {
            id: "weg-neuer-weg",
            kinds: ["path"],
            capability: "edit_map_objects",
            gruppe: "form",
            stellen: ["karte"],
            zeichen: "neuer-weg",
            label: "wegeditor.griff.neuerWeg",
            visible: (subject) => {
                const am = abschnitt(subject);
                return wirkung.neuerWeg !== undefined && am !== undefined && lage().inAuswahl?.(am) === true;
            },
            sperre: () => {
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                if (!jetzt.rechte.includes("edit_map_objects")) return "ortseditor.handgriff.grund.recht";
                return modusGrund(jetzt.bearbeiten);
            },
            run: () => wirkung.neuerWeg?.(),
        },
        // „Wege verbinden ›“ (WI-0252; Betreiber 2026-10-24: „beim rechtsklick über "Weg entfernen" die menü option "Wege verbinden" …
        // ähnlich wie bei "wegkurve bearbeiten" kann ich dann im untermenü auswählen wessen abschnittseinstellungen dann übernommen werden
        // sollen“): am Abschnitt einer Auswahl von mindestens zwei, als letzter Eintrag der Form direkt über „Weg entfernen“. Das Untermenü
        // nennt die Abschnitte in Kettenfolge; hängen sie nicht verlustfrei aneinander, steht der Eintrag grau mit dem Grund.
        {
            id: "weg-verbinden",
            kinds: ["path"],
            capability: "edit_map_geometry",
            gruppe: "form",
            stellen: ["karte"],
            zeichen: "vereinigen",
            label: "wegeditor.griff.verbinden",
            visible: (subject) => {
                const am = abschnitt(subject);
                return wirkung.verbinden !== undefined && am !== undefined && lage().verbinden?.(am) !== undefined;
            },
            auswahl: (subject) => {
                const am = abschnitt(subject);
                return am === undefined ? [] : (lage().verbinden?.(am)?.wahlen ?? []);
            },
            sperre: (subject) => {
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                if (!jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry"))
                    return "ortseditor.handgriff.grund.recht";
                const modus = modusGrund(jetzt.bearbeiten);
                if (modus !== undefined) return modus;
                const am = abschnitt(subject);
                return am === undefined ? undefined : jetzt.verbinden?.(am)?.grund;
            },
            run: ({ wahl }) => {
                if (wahl !== undefined) wirkung.verbinden?.(wahl);
            },
        },
        // Am Stützpunkt der laufenden Wegkurve, nur im Rechtsklick auf den Griff (T24 (3)).
        {
            id: "weg-stuetzpunkt-teilen",
            kinds: ["path"],
            capability: "edit_map_geometry",
            gruppe: "form",
            situativ: true,
            zeichen: "zerschneiden",
            label: "wegeditor.griff.teilen",
            sperre: () => {
                const griff = lage().griff;
                if (griff === undefined || griff.ende) return "wegeditor.griff.grund.innen";
                if (!lage().rechte.includes("edit_map_objects")) return "ortseditor.handgriff.grund.recht";
                return griff.ungespeichert ? "wegeditor.griff.grund.ungespeichert" : undefined;
            },
            run: () => {
                const griff = lage().griff;
                if (griff !== undefined) wirkung.teilen?.(griff.index);
            },
        },
        {
            id: "weg-stuetzpunkt-entfernen",
            kinds: ["path"],
            capability: "edit_map_geometry",
            gruppe: "form",
            situativ: true,
            zeichen: "entfernen",
            label: "wegeditor.griff.stuetzpunktEntfernen",
            danger: true,
            sperre: () => {
                const griff = lage().griff;
                return griff === undefined || griff.ende ? "wegeditor.griff.grund.endeBleibt" : undefined;
            },
            run: () => {
                const griff = lage().griff;
                if (griff !== undefined) wirkung.stuetzpunktEntfernen?.(griff.index);
            },
        },
        {
            id: "weg-neu",
            kinds: ["place"],
            capability: "edit_map_geometry",
            gruppe: "neu",
            zeichen: "neuer-weg",
            label: "wegeditor.handgriff.neuAbHier",
            sperre: () => {
                const jetzt = lage();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                const recht = !jetzt.rechte.includes("edit_map_objects") || !jetzt.rechte.includes("edit_map_geometry");
                return recht ? "ortseditor.handgriff.grund.recht" : modusGrund(jetzt.bearbeiten);
            },
            run: ({ subject }) => {
                if (subject.ref.kind === "place") wirkung.neuAbOrt(subject.ref.id);
            },
        },
        // „Weg entfernen …“ (Stufe 3): im Kartenmenü am Abschnitt unter dem Rechtsklick, im Menü am Objekt und im Infopanel am markierten;
        // solange die ganze Straße markiert ist (und am Finger im Blatt) „Weg entfernen ›“ mit den Abschnitten und der ganzen Straße (T49).
        ...(["karte", "markiert", "strasse", "finger"] as const).map((wo): EditorAction => ({
            id: {
                karte: "weg-entfernen",
                markiert: "weg-entfernen-abschnitt",
                strasse: "weg-entfernen-strasse",
                finger: "weg-entfernen-finger",
            }[wo],
            kinds: ["path"],
            capability: "edit_map_objects",
            gruppe: "entfernen",
            stellen: wo === "markiert" ? ["objekt", "infopanel"] : wo === "strasse" ? ["objekt"] : ["karte"],
            zeichen: "loeschen",
            label: "wegeditor.griff.entfernen",
            danger: true,
            ...(wo === "markiert" ? {} : { visible: abschnitteSichtbar(lage, wo) }),
            ...(wo === "strasse" || wo === "finger"
                ? {
                      auswahl: (subject: EditorMenuSubject): readonly HandgriffWahl[] => {
                          const wahlen = lage().wahlen?.(subject) ?? [];
                          return wahlen.length === 0
                              ? []
                              : [
                                    ...wahlen,
                                    {
                                        id: GANZE_STRASSE,
                                        text: lage().ganzeStrasse?.(wahlen.length) ?? GANZE_STRASSE,
                                        vorschau: true,
                                    },
                                ];
                      },
                  }
                : {}),
            sperre: () => {
                const jetzt = lage();
                if (wirkung.entfernen === undefined) return spaeter("edit_map_objects")();
                if (jetzt.laeuft) return "ortseditor.handgriff.grund.laeuft";
                if (!jetzt.rechte.includes("edit_map_objects")) return "ortseditor.handgriff.grund.recht";
                if (wo === "markiert" && jetzt.abschnitt === undefined) return "wegeditor.griff.grund.abschnitt";
                return modusGrund(jetzt.bearbeiten);
            },
            run: ({ subject, wahl }) => {
                if (wo === "strasse" || wo === "finger") {
                    const anker = abschnitt(subject);
                    if (wahl === GANZE_STRASSE && anker !== undefined) wirkung.entfernenStrasse?.(anker);
                    else if (wahl !== undefined) wirkung.entfernen?.(wahl);
                    return;
                }
                const publicId = wo === "karte" ? abschnitt(subject) : lage().abschnitt;
                if (publicId === undefined) return;
                // Liegt der Abschnitt in der Mehrfachauswahl, gilt das Blatt allen angehakten Wegen (WI-0252; Betreiber 2026-10-25:
                // „entfernen -> ganz löschen geht noch nicht mit mehrfachauswahl“).
                if (wo === "karte" && wirkung.entfernenAuswahl !== undefined && lage().inMehrfach?.(publicId) === true)
                    wirkung.entfernenAuswahl();
                else wirkung.entfernen?.(publicId);
            },
        })),
    ];
}
