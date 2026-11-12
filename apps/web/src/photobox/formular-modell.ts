import {
    PHOTOBOX_LIMITS,
    PHOTOBOX_TERMS_VERSION,
    photoboxGrantAllowed,
    roundMapCoordinate,
    type CommunityLage,
    type PhotoboxCreationKind,
    type PhotoboxEinreichung,
    type PhotoboxUsageGrant,
} from "@avesmaps3d/shared";
import type { FormularKennung } from "../community/api";
import type { BezugOrt } from "../community/meldung-modell";
import type { MessageKey } from "../i18n/de";
import type { GewaehltesBild } from "./bild";
import type { BezugWahl } from "./bezug-suche";
import { imOrt } from "./stelle-text";

/**
 * Was das Formular „Eigenes Bild hinzufügen“ rechnet (WI-0272 S2b, Aufgabe 13; WI §5.1, §12), ohne Browser: der Entwurf, die Pflichtfelder samt Grund der Sperre, die Wahl der Nutzung
 * und der Rumpf der Anfrage. Wie es aussieht, steht in `reisebild-formular.vue`, die Hülle in `reisebild-fenster.vue`, die Aufrufe in `api.ts`, die Stelle in Worten in `stelle-text.ts`.
 *
 * - **Pflicht sind das Bild, die Bildbeschreibung (höchstens 300 Zeichen), die Angabe „Entstanden als“ und das Häkchen der Erklärung.** „Bild hochladen“ ist gesperrt, solange etwas fehlt (der
 *   Knopf bleibt drückbar, `aria-disabled`); erst ein Druck nennt den Grund und markiert das fehlende Feld (`fehlendes`, Entwurf 8). Der Name, die Blickrichtung und der Bezug sind freiwillig; die Nutzung hat eine Vorgabe („Nur für Avesmaps“).
 * - 🔴 **CC BY ist bei einer Avesmaps-Aufnahme gesperrt** (WI §12 Frage 2b): Die Karte darin gehört nicht dem Einsender. Wer danach auf „Avesmaps-Aufnahme“ wechselt, bekommt die Vorgabe
 *   zurück (`waehleEntstehung`); die Datenbank weist die Kombination ohnehin ab (`photoboxGrantAllowed`, Migration 0274), das Formular sagt es vorher.
 * - 🔴 **Der Rumpf trägt die Fassung der Bedingungen** (`PHOTOBOX_TERMS_VERSION`) und die gemessene Dauer seit dem Öffnen (Zeitfalle) samt Honigtopf. Beschreibung und Name gehen getrimmt
 *   (der Server prüft die Länge ungetrimmt).
 */

/** Die Zahl der Zeichen eines Textes, wie der Server sie zählt (Codepunkte: ajv `maxLength`, `char_length`), nicht die UTF-16-Einheiten von `.length` (WI-0291). */
export const zeichen = (text: string): number => [...text].length;

/** Die ersten `max` Zeichen (Codepunkte) eines Textes: schneidet kein Emoji in der Mitte durch (ein halbes Zeichen wäre kein gültiges JSON mehr). */
export const kuerze = (text: string, max: number): string => [...text].slice(0, max).join("");

export interface ReisebildEntwurf {
    bild: GewaehltesBild | undefined;
    text: string;
    /** Leer, solange nichts gewählt ist: eine Pflicht ohne Vorgabe, denn „Foto“ zu raten wäre eine falsche Auskunft. */
    entstehung: PhotoboxCreationKind | "";
    nutzung: PhotoboxUsageGrant;
    /** Die Blickrichtung als Himmelsrichtung 0 (Norden) bis 7 im Uhrzeigersinn; `undefined` heißt ohne. */
    richtung: number | undefined;
    name: string;
    /** Das Häkchen der Erklärung (eigenes Werk, erkennbare Personen einverstanden, mindestens 16). */
    haken: boolean;
    /** Das Honigtopf-Feld (Fachkonzept §10.5): Ein Mensch sieht es nie, ein einfacher Bot füllt es. */
    honig: string;
    bezug: BezugWahl | undefined;
}

export function leererEntwurf(
    vorbelegung: { entstehung?: PhotoboxCreationKind | undefined; name?: string | undefined } = {},
): ReisebildEntwurf {
    return {
        bild: undefined,
        text: "",
        entstehung: vorbelegung.entstehung ?? "",
        nutzung: "avesmaps_only",
        richtung: undefined,
        name: vorbelegung.name ?? "",
        haken: false,
        honig: "",
        bezug: undefined,
    };
}

/** Die Wahl „Entstanden als“; ist danach CC BY nicht mehr erlaubt (Avesmaps-Aufnahme), gilt wieder die Vorgabe. */
export function waehleEntstehung(entwurf: ReisebildEntwurf, art: PhotoboxCreationKind): void {
    entwurf.entstehung = art;
    if (!photoboxGrantAllowed(art, entwurf.nutzung)) entwurf.nutzung = "avesmaps_only";
}

/** Warum diese Nutzung gerade nicht wählbar ist (Sprachschlüssel des Satzes), oder `undefined`. */
export function nutzungGesperrt(entwurf: ReisebildEntwurf, nutzung: PhotoboxUsageGrant): MessageKey | undefined {
    if (entwurf.entstehung === "") return undefined;
    return photoboxGrantAllowed(entwurf.entstehung, nutzung) ? undefined : "photobox.nutzung.gesperrtAufnahme";
}

/** Die Pflichtfelder des Formulars, in seiner Reihenfolge: Das fehlende Feld markiert und fokussiert ein Druck auf den gesperrten Knopf. */
export type PflichtFeld = "bild" | "text" | "entstehung" | "haken";

/**
 * Was noch fehlt: das erste Pflichtfeld in der Reihenfolge des Formulars mit dem Satz dazu (Sprachschlüssel); `undefined`, wenn alles da ist.
 */
export function fehlendes(entwurf: ReisebildEntwurf): { feld: PflichtFeld; grund: MessageKey } | undefined {
    if (entwurf.bild === undefined) return { feld: "bild", grund: "photobox.sperre.bild" };
    const laenge = zeichen(entwurf.text.trim());
    if (laenge === 0) return { feld: "text", grund: "photobox.sperre.text" };
    if (laenge > PHOTOBOX_LIMITS.descriptionMax) return { feld: "text", grund: "photobox.sperre.textLang" };
    if (entwurf.entstehung === "") return { feld: "entstehung", grund: "photobox.sperre.entstehung" };
    if (!entwurf.haken) return { feld: "haken", grund: "photobox.sperre.haken" };
    return undefined;
}

/**
 * Warum „Bild hochladen“ gerade gesperrt ist, als Sprachschlüssel; `undefined`, wenn alles da ist. Der erste fehlende Punkt in der Reihenfolge des Formulars.
 */
export const sperrGrund = (entwurf: ReisebildEntwurf): MessageKey | undefined => fehlendes(entwurf)?.grund;

/** Die Blickrichtung in der Auswahlliste: `""` heißt ohne, sonst die Himmelsrichtung 0 (Norden) bis 7 als Text. */
export const richtungWert = (richtung: number | undefined): string => (richtung === undefined ? "" : String(richtung));

/** Die Wahl der Auswahlliste zurück in die Himmelsrichtung; alles außer 0 bis 7 heißt ohne. */
export function richtungAusWert(wert: string): number | undefined {
    if (!/^[0-7]$/u.test(wert)) return undefined;
    return Number(wert);
}

const OEFFENTLICHE_KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Der Ort des Bildes (`placeId`) und der weitere Bezug (`bezug`), wie der Server sie nimmt:
 * - Ein Treffer der Suche mit der Art `ort` ist der Ort des Bildes (`placeId`), sofern seine Kennung eine öffentliche Kennung ist; sonst geht er als `bezug`.
 * - Ohne gewählten Ort ist der nächste Ort der Ort des Bildes, wenn die Stelle „in“ ihm liegt (`imOrt`); das ist der automatische Bezug (WI §4).
 * - Jeder andere Treffer (Landschaft, Weg, Klima) ist der `bezug`.
 */
export function ortUndBezug(
    stelle: CommunityLage,
    ort: BezugOrt | undefined,
    gewaehlt: BezugWahl | undefined,
): Pick<PhotoboxEinreichung, "placeId" | "bezug"> {
    const gewaehlterOrt = gewaehlt?.art === "ort" && OEFFENTLICHE_KENNUNG.test(gewaehlt.id) ? gewaehlt : undefined;
    const naheOrt = ort !== undefined && OEFFENTLICHE_KENNUNG.test(ort.id) && imOrt(stelle, ort) ? ort : undefined;
    const placeId = gewaehlterOrt?.id ?? naheOrt?.id;
    const bezug =
        gewaehlt !== undefined && gewaehlterOrt === undefined ? { art: gewaehlt.art, id: gewaehlt.id } : undefined;
    return { ...(placeId === undefined ? {} : { placeId }), ...(bezug === undefined ? {} : { bezug }) };
}

const lageRund = (lage: CommunityLage): CommunityLage => ({
    x: roundMapCoordinate(lage.x),
    y: roundMapCoordinate(lage.y),
});

/**
 * Der Rumpf der Einreichung. Wirft, wo `sperrGrund` etwas meldet: Der Aufrufer prüft zuerst. `dauerMs` ist die Zeit seit dem Öffnen des Formulars, `entwurf.honig` das
 * Honigtopf-Feld: beides geht mit (Fachkonzept §10.5). Leere Felder fehlen im Rumpf (der Server kennt „kein Name“ als Abwesenheit).
 */
export function drahtBody(
    kennung: FormularKennung,
    entwurf: ReisebildEntwurf,
    stelle: CommunityLage,
    ort: BezugOrt | undefined,
    dauerMs: number,
): PhotoboxEinreichung {
    if (entwurf.bild === undefined || entwurf.entstehung === "" || sperrGrund(entwurf) !== undefined) {
        throw new Error("Formular unvollständig");
    }
    const name = entwurf.name.trim();
    return {
        operationId: kennung.operationId,
        schluessel: kennung.schluessel,
        bild: entwurf.bild.datei,
        lage: lageRund(stelle),
        ...ortUndBezug(stelle, ort, entwurf.bezug),
        ...(entwurf.richtung === undefined ? {} : { blickrichtung: entwurf.richtung }),
        entstehung: entwurf.entstehung,
        nutzung: entwurf.nutzung,
        beschreibung: entwurf.text.trim(),
        ...(name === "" ? {} : { name: kuerze(name, PHOTOBOX_LIMITS.attributionMax) }),
        bedingungen: PHOTOBOX_TERMS_VERSION,
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}
