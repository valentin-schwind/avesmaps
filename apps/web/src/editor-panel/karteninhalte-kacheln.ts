import { EDITORPANEL, kinder, type MapView, type NavEintrag } from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import { kreisZaehlung, type Kreis } from "../editor-liste/liste-modell";
import { ansichtFuerHinflug, type HinflugAnsicht, type HinflugObjekt } from "../map/hinflug-ansicht";

/**
 * Die Kacheln des Reiters „Karteninhalte“ (WI-0212; EDIT-0003 T37, Betreiber 2026-10-16 zur Probierseite: „so jetzt hab ichs aber :)“).
 * Reine Funktionen, damit Vitest sie ohne Browser prüft; das Bauteil `editor-karteninhalte.vue` zeichnet nur, was hier steht.
 *
 * - **Welche Inhalte, in welcher Folge, gebaut oder „später“**, sagt allein das Register (`EDITORPANEL`, Kinder von „karteninhalte“).
 *   Wird ein Inhalt dort aus `spaeter` ein `subjekt`, ist seine Kachel wählbar, ohne dass hier etwas geändert wird.
 * - **Zwei Gruppen** („Auf der Karte · Nachschlagen“): abgeleitet aus dem Ziel im Register. Wer kein Ziel auf der Karte hat (`ziel:
 *   "keins"`: Literatur, Vorkommen, Quellen, Korpora), steht unter „Nachschlagen“; alles andere hat Objekte auf der Karte.
 * - **Was das Register nicht weiß:** das Zeichen und die Art der Objekte, aus der die Ansicht der Karte folgt. Die Ansicht selbst steht
 *   nur in `map/hinflug-ansicht.ts` (EDIT-0003 T32 (1)): Orte → Standard, Landschaften → Landschaften, Herrschaftsgebiete → Politisch …
 * - **Die Zahl** einer Kachel ist die Zählung der Kreise ihrer Liste (`kreisZaehlung`), dieselbe wie unter der Liste im Editor.
 */

type Eintrag = (typeof EDITORPANEL)["eintraege"][number];

/** Die Kennungen der Karteninhalte im Register. */
export type KarteninhaltId = Extract<Eintrag, { unter: "karteninhalte" }>["id"];

/** Die Gruppen in ihrer Folge (T37: „Auf der Karte · Nachschlagen“). */
export const KACHEL_GRUPPEN = ["karte", "nachschlagen"] as const;
export type KachelGruppe = (typeof KACHEL_GRUPPEN)[number];

/**
 * Zeichen und Objektart je Inhalt. Wege und Kraftlinien tragen den Strich ihres Anlegens („neuer-weg“, „neue-kraftlinie“): EIN Satz
 * Zeichen. Ein Inhalt ohne Objekte auf der Karte hat keine Ansicht. 🔴 `satisfies Record<…>`: Ein neuer Inhalt im Register ohne Zeile
 * hier ist ein Typfehler, keine Kachel ohne Zeichen.
 */
export const KARTENINHALTE = {
    orte: { zeichen: "ort", objekt: { art: "ort" } },
    territorien: { zeichen: "herrschaft", objekt: { art: "herrschaftsgebiet" } },
    regionen: { zeichen: "landschaft", objekt: { art: "landschaft" } },
    wege: { zeichen: "neuer-weg", objekt: { art: "weg" } },
    kraftlinien: { zeichen: "neue-kraftlinie", objekt: { art: "kraftlinie" } },
    // Die Sprachen (WI-0261 S5d2) tragen das Zeichen ihrer Ebene in der Ebenenleiste: dieselbe Sprechblase.
    sprachen: { zeichen: "ebene-sprachen", objekt: { art: "sprache" } },
    // Das Wetter (WI-0288 Stufe 3): eine Wolke mit Windstrich, wie in der Probierseite; die Karte steht auf „Standard“.
    wetter: { zeichen: "wetter", objekt: { art: "wetter" } },
    literatur: { zeichen: "literatur" },
    vorkommen: { zeichen: "vorkommen" },
    quellen: { zeichen: "quellen" },
    korpora: { zeichen: "korpora" },
} as const satisfies Record<KarteninhaltId, { zeichen: EditorZeichenName; objekt?: HinflugObjekt }>;

export interface Kachel {
    readonly id: KarteninhaltId;
    readonly zeichen: EditorZeichenName;
    /** Wählbar; sonst steht die Kachel gestrichelt mit „später“ da und lässt sich nicht wählen (D16). */
    readonly gebaut: boolean;
    /** Die Ansicht, auf die eine Wahl die Karte stellt (ohne Flug); fehlt bei Inhalten ohne Objekte auf der Karte. */
    readonly ansicht: HinflugAnsicht | undefined;
}

export interface KachelGruppeMitKacheln {
    readonly id: KachelGruppe;
    readonly kacheln: readonly Kachel[];
}

/** Die Gruppe eines Inhalts aus seinem Ziel im Register: ohne Ziel auf der Karte „Nachschlagen“. */
export const gruppeVon = (eintrag: Pick<NavEintrag, "ziel">): KachelGruppe =>
    eintrag.ziel === "keins" ? "nachschlagen" : "karte";

function kachelVon(eintrag: NavEintrag): Kachel {
    const id = eintrag.id as KarteninhaltId;
    const inhalt: { zeichen: EditorZeichenName; objekt?: HinflugObjekt } = KARTENINHALTE[id];
    return {
        id,
        zeichen: inhalt.zeichen,
        gebaut: eintrag.art !== "spaeter",
        ansicht: inhalt.objekt === undefined ? undefined : ansichtFuerHinflug(inhalt.objekt),
    };
}

/** Die Gruppen mit ihren Kacheln in der Folge des Registers; eine Gruppe ohne Kachel fällt weg. */
export function kachelGruppen(rechte: readonly string[]): KachelGruppeMitKacheln[] {
    const eintraege = kinder(EDITORPANEL, "karteninhalte", rechte);
    return KACHEL_GRUPPEN.map((id) => ({
        id,
        kacheln: eintraege.filter((eintrag) => gruppeVon(eintrag) === id).map(kachelVon),
    })).filter((gruppe) => gruppe.kacheln.length > 0);
}

/**
 * Die Kachel zur Ansicht der Karte (Betreiber 2026-10-19, nachdem er einen Link mit `view=political` geöffnet hatte: „die tabs in
 * "inhalte" werden nicht automatisch ausgewählt“): die Umkehrung der Wahl, aus derselben Zuordnung (`map/hinflug-ansicht.ts`), keine
 * zweite Tafel. Gehört die gewählte Kachel schon zur Ansicht (Orte und Wege zu „Standard“), bleibt sie; sonst die zuletzt in dieser
 * Ansicht gewählte (`zuletzt`: Wege, Fächer auf Kraftlinien und zurück, wieder Wege), sonst die erste wählbare in der Folge des
 * Registers. Zu „Nur Karte“ gehört keine: `undefined`, die Wahl bleibt.
 */
export function kachelFuerAnsicht(
    view: MapView,
    gewaehlt: string | undefined,
    rechte: readonly string[],
    zuletzt?: string,
): KarteninhaltId | undefined {
    const alle = kachelGruppen(rechte).flatMap((gruppe) => gruppe.kacheln);
    // Ein Karteninhalt ohne Objekte auf der Karte („Nachschlagen“: Quellen, Literatur, Vorkommen, Korpora) hat keine Ansicht: Eine gebaute
    // Wahl von ihnen bleibt, welche Ansicht die Karte auch zeigt (WI-0254: sonst stellte der Link `?tab=inhalteeditor` die Kachel auf „Orte“).
    const gewaehlteKachel = alle.find((kachel) => kachel.id === gewaehlt);
    if (gewaehlteKachel !== undefined && gewaehlteKachel.gebaut && gewaehlteKachel.ansicht === undefined)
        return gewaehlteKachel.id;
    const passend = alle.filter((kachel) => kachel.gebaut && kachel.ansicht?.view === view);
    const bleibt = (id: string | undefined) => passend.find((kachel) => kachel.id === id);
    return (bleibt(gewaehlt) ?? bleibt(zuletzt) ?? passend[0])?.id;
}

/** Die Zählung eines Inhalts: alle Zeilen seiner Liste und je Kreis, wie viele. */
export interface Zaehlung {
    readonly gesamt: number;
    readonly kreise: Readonly<Record<Kreis, number>>;
}

export function zaehlungAus(kreise: readonly Kreis[]): Zaehlung {
    return { gesamt: kreise.length, kreise: kreisZaehlung(kreise) };
}

/**
 * Die Zählung einer Liste, die ihre Zahlen schon mitbringt (die Listen des Fensters „Inhalte bearbeiten“: Quellen, Literatur, Vorkommen,
 * Korpora; ihre `zahlen` zählen über den ganzen Bestand, nicht über die Seite oder den Filter). 🔴 Dieselbe Rechnung wie die Legende unter
 * diesen Listen (`inhalte-*-liste.vue`): gesamt sind die aktiven Einträge, ● alle aktiven außer den von Hand angelegten, ◐ die von Hand
 * angelegten oder geänderten, ○ die stillgelegten (die Korpora kennen keine: 0).
 */
export function zaehlungAusZahlen(zahlen: {
    readonly aktiv: number;
    readonly editor: number;
    readonly stillgelegt?: number;
}): Zaehlung {
    return {
        gesamt: zahlen.aktiv,
        kreise: {
            voll: Math.max(0, zahlen.aktiv - zahlen.editor),
            halb: zahlen.editor,
            "halb-rechts": 0,
            leer: zahlen.stillgelegt ?? 0,
        },
    };
}
