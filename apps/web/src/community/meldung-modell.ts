import {
    COMMUNITY_GRENZEN,
    roundMapCoordinate,
    type BezugObjektart,
    type CommunityLage,
    type FehltArt,
    type MeldungBezug,
    type MeldungBody,
    type MeldungKategorie,
} from "@avesmaps3d/shared";
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import type { MessageKey } from "../i18n/de";
import { kuerzeZeichen, zeichenZahl, type FormularKennung } from "./api";

/**
 * Was das Meldeformular rechnet (WI-0268 C2; Bedienkonzept §2.1, §2.1a), ohne Browser: der Bezug, die Pflichtfelder samt Grund der Sperre, der Rumpf der Anfrage. Wie es
 * aussieht, steht in `meldung-fenster.vue`.
 *
 * - **Bezug:** ein Kartenobjekt mit Schnappschuss (Name, Art, Lage, wie der Besucher es sah) oder eine Stelle. Ein Vorschlag (neue Lage) wird gezeigt, nie angewandt.
 * - **Eine Stelle kennt ihren nächsten Ort** (`ort`, wo der Aufrufer ihn gefunden hat): Das Formular bietet ihn als zweite Wahl unter „Betrifft“ an („Wehrheim (in der Nähe)“).
 */

/** Der Ort in der Nähe einer Stelle: eine zweite Wahl unter „Betrifft“, kein eigener Bezug. */
export interface BezugOrt {
    readonly id: string;
    readonly name: string;
    readonly typ: string;
    readonly lage: CommunityLage;
}

/** Worauf sich eine Meldung bezieht, wie der Aufrufer es gefunden hat (Kachel im Infopanel, Kartenmenü). */
export type MeldeBezug =
    | {
          readonly art: "objekt";
          readonly objektArt: BezugObjektart;
          readonly objektId: string;
          readonly name: string;
          readonly typ?: string | undefined;
          readonly lage?: CommunityLage | undefined;
      }
    | {
          readonly art: "stelle";
          readonly lage: CommunityLage;
          readonly ort?: BezugOrt | undefined;
          /** Gemeldet aus der Bildansicht: das Reisebild (WI-0272). Es bleibt am Bezug, auch wenn „Betrifft“ auf den Ort wechselt. */
          readonly reisebildId?: string | undefined;
      };

/** Was unter „Betrifft“ gewählt ist: die Stelle selbst oder der Ort in ihrer Nähe. Bei einem Objekt gibt es nur `objekt`. */
export type Betrifft = "objekt" | "stelle" | "ort";

export interface MeldeEntwurf {
    kategorie: MeldungKategorie | "";
    fehltArt: FehltArt | "";
    text: string;
    quelle: string;
    name: string;
    /** Das Honigtopf-Feld (Fachkonzept §10.5): Ein Mensch sieht es nie, ein einfacher Bot füllt es. */
    honig: string;
}

/**
 * Das erste, was ein Formular wählt (Bedienkonzept §2.1a: „Etwas fehlt“ ist an einer Stelle vorbelegt; an einem Objekt wählt der Besucher selbst, denn „Lage“ und „Name“
 * wären geraten).
 */
export const startBetrifft = (bezug: MeldeBezug): Betrifft => (bezug.art === "objekt" ? "objekt" : "stelle");

export function leererEntwurf(bezug: MeldeBezug): MeldeEntwurf {
    return {
        kategorie: bezug.art === "stelle" ? "fehlt" : "",
        fehltArt: "",
        text: "",
        quelle: "",
        name: "",
        honig: "",
    };
}

/** Gilt das Gewählte einem Kartenobjekt? Nur dann gibt es eine neue Lage zu zeigen. */
export const betrifftObjekt = (bezug: MeldeBezug, betrifft: Betrifft): boolean =>
    bezug.art === "objekt" || (betrifft === "ort" && bezug.ort !== undefined);

/** Der Name des Gewählten für die Zeile „Neue Lage auf der Karte zeigen“ und die Moduszeile. */
export function betrifftName(bezug: MeldeBezug, betrifft: Betrifft): string | undefined {
    if (bezug.art === "objekt") return bezug.name;
    return betrifft === "ort" ? bezug.ort?.name : undefined;
}

/** Die alte Lage des Gewählten: von ihr geht die gestrichelte Linie zur neuen. */
export function betrifftLage(bezug: MeldeBezug, betrifft: Betrifft): CommunityLage | undefined {
    if (bezug.art === "objekt") return bezug.lage;
    return betrifft === "ort" ? bezug.ort?.lage : undefined;
}

const gekuerzt = kuerzeZeichen;
const lageRund = (lage: CommunityLage): CommunityLage => ({
    x: roundMapCoordinate(lage.x),
    y: roundMapCoordinate(lage.y),
});

/** Der Bezug, wie der Server ihn nimmt (`MeldungBezug`). Ein Vorschlag gilt nur bei „Lage falsch“ an einem Objekt. */
export function drahtBezug(
    bezug: MeldeBezug,
    betrifft: Betrifft,
    kategorie: MeldungKategorie | "",
    vorschlag: CommunityLage | undefined,
): MeldungBezug {
    const mitVorschlag = kategorie === "lage" && vorschlag !== undefined;
    const bild = bezug.art === "stelle" && bezug.reisebildId !== undefined ? { reisebildId: bezug.reisebildId } : {};
    if (bezug.art === "objekt" || (betrifft === "ort" && bezug.ort !== undefined)) {
        const objekt =
            bezug.art === "objekt"
                ? bezug
                : {
                      objektArt: "place" as const,
                      objektId: bezug.ort!.id,
                      name: bezug.ort!.name,
                      typ: bezug.ort!.typ,
                      lage: bezug.ort!.lage,
                  };
        return {
            art: "objekt",
            objektArt: objekt.objektArt,
            objektId: objekt.objektId,
            name: gekuerzt(objekt.name.trim() === "" ? "?" : objekt.name.trim(), 200),
            ...(objekt.typ === undefined || objekt.typ === "" ? {} : { typ: gekuerzt(objekt.typ, 80) }),
            ...(objekt.lage === undefined ? {} : { lage: lageRund(objekt.lage) }),
            ...(mitVorschlag ? { vorschlagLage: lageRund(vorschlag) } : {}),
            ...bild,
        };
    }
    return {
        art: "stelle",
        lage: lageRund(bezug.lage),
        ...(bezug.ort === undefined
            ? {}
            : { naechsterOrt: gekuerzt(bezug.ort.name.trim() === "" ? "?" : bezug.ort.name.trim(), 200) }),
        ...bild,
    };
}

/**
 * Warum „Absenden“ gerade gesperrt ist, als Sprachschlüssel; `undefined`, wenn alles da ist. Der erste fehlende Punkt in der Reihenfolge des Formulars (Bedienkonzept §2.1:
 * „gesperrt, solange Pflichtfelder fehlen; der Grund steht im Tooltip“). Die Quelle sperrt nie: Eine Beobachtung soll nicht verloren gehen (Fachkonzept §3.2).
 */
export function sperrGrund(entwurf: MeldeEntwurf): MessageKey | undefined {
    if (entwurf.kategorie === "") return "community.sperre.kategorie";
    if (entwurf.kategorie === "fehlt" && entwurf.fehltArt === "") return "community.sperre.fehltArt";
    // Der Server zählt in Codepunkten (WI-0291): ein Emoji ist ein Zeichen.
    const laenge = zeichenZahl(entwurf.text.trim());
    if (laenge < COMMUNITY_GRENZEN.textMin) return "community.sperre.text";
    if (laenge > COMMUNITY_GRENZEN.textMax) return "community.sperre.textLang";
    return undefined;
}

/** Das Feld, das „Absenden“ gerade sperrt (für die Markierung und den Fokus nach einem Druck auf den gesperrten Knopf); `undefined`, wenn alles da ist. Gleiche Reihenfolge wie `sperrGrund`. */
export function sperrFeld(entwurf: MeldeEntwurf): "kategorie" | "fehltArt" | "text" | undefined {
    const key = sperrGrund(entwurf);
    if (key === undefined) return undefined;
    if (key === "community.sperre.kategorie") return "kategorie";
    if (key === "community.sperre.fehltArt") return "fehltArt";
    return "text";
}

/** Das Zeichen je Kategorie, aus dem einen Zeichensatz (`editor-zeichen.vue`): keine Bilder im Meldeformular. */
export const KATEGORIE_ZEICHEN = {
    lage: "fadenkreuz",
    name: "namensschild",
    angabe: "info",
    fehlt: "fehlt",
    entfaellt: "loeschen",
    sonstiges: "kreis-punkte",
} as const satisfies Record<MeldungKategorie, EditorZeichenName>;

/** Das Zeichen je Art des Fehlenden; `gebiet` wird nicht mehr angeboten, bleibt für alte Meldungen aber gültig. */
export const FEHLT_ZEICHEN = {
    ort: "ort",
    weg: "neuer-weg",
    fluss: "fluss",
    gewaesser: "wetter-stroemung",
    insel: "insel",
    landschaft: "ebene-vegetation",
    gebirge: "ebene-topographie",
    herrschaft: "herrschaft",
    sprache: "ebene-sprachen",
    anderes: "punkte",
    gebiet: "herrschaft",
} as const satisfies Record<FehltArt, EditorZeichenName>;

/** Das Zeichen der Objektart im Kopf des Formulars an einem Objekt. */
export const OBJEKT_ZEICHEN = {
    place: "ort",
    path: "neuer-weg",
    area: "ebene-vegetation",
    territory: "herrschaft",
    peak: "ebene-topographie",
    powerline: "neue-kraftlinie",
} as const satisfies Record<BezugObjektart, EditorZeichenName>;

/**
 * Der Rumpf der Anfrage. Wirft, wo `sperrGrund` etwas meldet: Der Aufrufer prüft zuerst. Leere Felder fehlen im Rumpf (der Server kennt „keine Quelle“ als Abwesenheit).
 * `dauerMs` ist die Zeit seit dem Öffnen des Formulars, `entwurf.honig` das Honigtopf-Feld: beides geht mit (Fachkonzept §10.5).
 */
export function drahtBody(
    kennung: FormularKennung,
    entwurf: MeldeEntwurf,
    bezug: MeldeBezug,
    betrifft: Betrifft,
    vorschlag: CommunityLage | undefined,
    dauerMs: number,
): MeldungBody {
    if (entwurf.kategorie === "" || sperrGrund(entwurf) !== undefined) throw new Error("Formular unvollständig");
    const quelle = entwurf.quelle.trim();
    const name = entwurf.name.trim();
    return {
        operationId: kennung.operationId,
        schluessel: kennung.schluessel,
        kategorie: entwurf.kategorie,
        text: entwurf.text.trim(),
        ...(quelle === "" ? {} : { quelle: gekuerzt(quelle, COMMUNITY_GRENZEN.quelleMax) }),
        ...(entwurf.kategorie === "fehlt" && entwurf.fehltArt !== "" ? { fehltArt: entwurf.fehltArt } : {}),
        ...(name === "" ? {} : { name: gekuerzt(name, COMMUNITY_GRENZEN.nameMax) }),
        bezug: drahtBezug(bezug, betrifft, entwurf.kategorie, vorschlag),
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}
