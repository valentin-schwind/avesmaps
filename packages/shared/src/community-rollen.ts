import { Type, type Static } from "@sinclair/typebox";
import { SONDERROLLEN_NAMEN, isSonderrolle, type SonderrolleName } from "./auth/sonderrollen.ts";
import { OperationId } from "./operation.ts";

/**
 * Meldungen an Sonderrollen (WI-0279; Vali 2026-11-10/11, Entwurf „Meldungen an Rollen“ Fassung 3, „das alles bauen“): Eine Meldung hat neben der EINEN zuständigen
 * Person eine oder mehrere Sonderrollen. Wer eine Rolle hat (regional: in einer Region der Meldung), sieht die Meldung unter „Meine“; wer sie neu zugewiesen bekommt, hört
 * die Glocke (`community_rolle`). Gesetzt wird die ganze Menge auf einmal (`POST /api/community/vorgaenge/:com/rollen`); beim Eingang setzt der Server, was passt.
 *
 * - **Zuweisen beim Eingang („wenn möglich“):** Die Art des Bezugs bestimmt die Rollen (`ROLLEN_JE_ART`), bei „Etwas fehlt“ dazu die gewählte Art; liegt die Stelle in einer
 *   Region, kommen Ortskundiger und Regionalkanzler dazu (`REGIONALE_ROLLEN`). Gesetzt wird nur eine Rolle, die mindestens eine Person hat, die Meldungen bearbeiten darf
 *   (regional: in einer der Regionen). Sonst bleibt die Meldung bei „niemand“.
 * - 🔴 **Die Tafel ist tolerant:** Ihre Schlüssel sind Zeichenketten, keine `FehltArt`: Sie nennt jede Art von `FEHLT_ARTEN` (seit Migration 0338 auch `insel`,
 *   `landschaft`, `herrschaft`, `sprache`) und die Arten der Objekte (`kraftlinie`). Eine unbekannte Art trägt keine Rolle.
 */

/** Welche Sonderrollen eine Art des Bezugs (oder „Etwas fehlt“) beim Eingang bekommt; die regionalen kommen für jede Meldung mit Region dazu. */
export const ROLLEN_JE_ART: Readonly<Record<string, readonly SonderrolleName[]>> = {
    ort: [],
    weg: ["odologe"],
    fluss: ["derograph", "odologe"],
    gewaesser: ["derograph"],
    insel: ["derograph", "topograph"],
    landschaft: ["derograph"],
    gebirge: ["topograph", "derograph"],
    herrschaft: ["politologe", "regionalkanzler"],
    sprache: ["linguist"],
    anderes: [],
    gebiet: [],
    kraftlinie: [],
};

/** Liegt der Bezug in einer Region, kommen diese beiden beim Eingang dazu (wenn jemand sie dort hat). */
export const REGIONALE_ROLLEN: readonly SonderrolleName[] = ["ortskundiger", "regionalkanzler"];

/** Die Rollen einer Art; eine unbekannte trägt keine. */
export const rollenDerArt = (art: string | null | undefined): readonly SonderrolleName[] =>
    art === null || art === undefined ? [] : (ROLLEN_JE_ART[art] ?? []);

/** Die Flächentypen der Derographie (`config/map-cartography/aventuria.json`, `types`), die nicht „Landschaft“ heißen. */
const FLAECHE_ALS: Readonly<Record<string, string>> = {
    gebirge: "gebirge",
    huegelland: "gebirge",
    hochebene: "gebirge",
    bergtundra: "gebirge",
    insel: "insel",
    inselgruppe: "insel",
    see: "gewaesser",
    meer: "gewaesser",
    kueste: "gewaesser",
};

/**
 * Die Art der Tafel zu einem Kartenobjekt: Ort, Weg (der Flussweg ist ein Fluss, der Seeweg ein Gewässer), Fläche der Derographie nach ihrem Typ, Herrschaftsgebiet, Gipfel
 * (Gebirge), Kraftlinie. Der Typ kommt aus dem Schnappschuss des Bezugs; Groß- und Kleinschreibung zählt nicht.
 */
export function artDesObjekts(objektArt: string | null, typ: string | null | undefined): string | undefined {
    const klein = (typ ?? "").trim().toLowerCase();
    switch (objektArt) {
        case "place":
            return "ort";
        case "path":
            if (klein === "flussweg") return "fluss";
            return klein === "seeweg" ? "gewaesser" : "weg";
        case "area":
            return FLAECHE_ALS[klein] ?? "landschaft";
        case "territory":
            return "herrschaft";
        case "peak":
            return "gebirge";
        case "powerline":
            return "kraftlinie";
        default:
            return undefined;
    }
}

/** Die Rollen zu Objekt und „Etwas fehlt“ (Vereinigung), in der Reihenfolge des Katalogs; ohne die regionalen, die die Region bringt. */
export function rollenDesBezugs(
    objekt: { readonly objektArt: string | null; readonly typ: string | null | undefined } | null,
    fehltArt: string | null | undefined,
): SonderrolleName[] {
    const rollen = new Set<SonderrolleName>([
        ...rollenDerArt(objekt === null ? undefined : artDesObjekts(objekt.objektArt, objekt.typ)),
        ...rollenDerArt(fehltArt),
    ]);
    return SONDERROLLEN_NAMEN.filter((rolle) => rollen.has(rolle));
}

/** Ordnet Rollen nach dem Katalog; Unbekanntes fällt weg. */
export const rollenGeordnet = (rollen: Iterable<string>): SonderrolleName[] => {
    const menge = new Set(rollen);
    return SONDERROLLEN_NAMEN.filter((rolle) => menge.has(rolle));
};

// --- Vertrag ---------------------------------------------------------------------------------------------------------------------

const strict = { additionalProperties: false } as const;
const Person = Type.Object({ id: Type.String(), name: Type.String() }, strict);

/** Eine zugewiesene Rolle in der Zeile der Liste: ob sie MEINE ist (ich habe die Rolle; regional: in einer Region der Meldung). */
export const ZeilenRolle = Type.Object({ sonderrolle: Type.String(), mein: Type.Boolean() }, strict);
export type ZeilenRolle = Static<typeof ZeilenRolle>;

/** Wer eine Rolle setzte: eine Person (nach einer Kontoauflösung `null`) oder Avesmaps beim Eingang (`system`). */
export const RollenVon = Type.Object(
    { art: Type.Union([Type.Literal("person"), Type.Literal("system")]), person: Type.Union([Person, Type.Null()]) },
    strict,
);
export type RollenVon = Static<typeof RollenVon>;

/**
 * Eine zugewiesene Rolle im Vorgangsfenster (Kasten „Zuständig“): wer sie setzte und wann, wer sie hat (nur wer Meldungen bearbeiten darf; regional: in einer Region der
 * Meldung) und bei regionalen Rollen die Regionen dazu (die kleinste zuerst).
 */
export const VorgangRolle = Type.Object(
    {
        sonderrolle: Type.String(),
        von: RollenVon,
        at: Type.String(),
        inhaber: Type.Array(Person),
        regionen: Type.Array(Type.String()),
    },
    strict,
);
export type VorgangRolle = Static<typeof VorgangRolle>;

/** Für das Blatt „Sonderrollen zuweisen“: zu JEDER Rolle des Katalogs, wer sie für diese Meldung hat (wie `VorgangRolle.inhaber`). */
export const RollenInhaber = Type.Object({ sonderrolle: Type.String(), personen: Type.Array(Person) }, strict);
export type RollenInhaber = Static<typeof RollenInhaber>;

/** Wer die zuständige Person einsetzte und wann (Kasten „Zuständig“): `von` gleich der Person heißt „selbst übernommen“; `null` nach einer Kontoauflösung. */
export const ZustaendigSeit = Type.Object({ von: Type.Union([Person, Type.Null()]), at: Type.String() }, strict);
export type ZustaendigSeit = Static<typeof ZustaendigSeit>;

/** `POST /api/community/vorgaenge/:com/rollen`: die ganze Menge (hinzu und heraus); nur Rollen des Katalogs, jede höchstens einmal. */
export const RollenBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        rollen: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
            maxItems: SONDERROLLEN_NAMEN.length,
            uniqueItems: true,
        }),
    },
    strict,
);
export type RollenBody = Static<typeof RollenBody>;

/** Sind alle Werte Rollen des Katalogs? (Der Server antwortet sonst 422; das Blatt bietet nur sie an.) */
export const nurBekannteRollen = (rollen: readonly string[]): boolean => rollen.every((rolle) => isSonderrolle(rolle));

// --- Glocke ----------------------------------------------------------------------------------------------------------------------

/**
 * Der `text` der Glocke `community_rolle`: die Rolle, dann die Nummern (`derograph COM-000072 COM-000075`). Gebündelt wird je Empfänger, Absender und Rolle, solange
 * ungelesen; jede weitere Meldung hängt ihre Nummer an. Passt keine Nummer mehr in die 300 Zeichen der Tafel, zählt `#n` die ganze Menge (`derograph #31 COM-… …`).
 * 🔴 Nie ein Text der Meldung, nie ein Name.
 */
export interface RollenGlocke {
    readonly rolle: string;
    readonly nummern: readonly string[];
    /** Wie viele Meldungen der Eintrag zählt (mindestens die der Nummern). */
    readonly anzahl: number;
}

const GLOCKE_TEXT_MAX = 300;
const NUMMER = /^COM-[0-9]{6,12}$/u;

export function rollenGlockeText(glocke: RollenGlocke): string {
    const teile = [glocke.rolle, ...(glocke.anzahl > glocke.nummern.length ? [`#${String(glocke.anzahl)}`] : [])];
    return [...teile, ...glocke.nummern].join(" ");
}

export function leseRollenGlocke(text: string | null): RollenGlocke | undefined {
    if (text === null) return undefined;
    const [rolle, ...rest] = text.trim().split(/\s+/u);
    if (rolle === undefined || rolle === "" || !/^[a-z_]{1,40}$/u.test(rolle)) return undefined;
    const zahl = rest[0]?.startsWith("#") === true ? Number(rest[0].slice(1)) : undefined;
    const nummern = rest.filter((teil) => NUMMER.test(teil));
    if (nummern.length === 0) return undefined;
    const anzahl = zahl !== undefined && Number.isInteger(zahl) && zahl > nummern.length ? zahl : nummern.length;
    return { rolle, nummern, anzahl };
}

/** Hängt eine Nummer an (eine schon genannte zählt nicht noch einmal); passt sie nicht mehr in die Tafel, wächst nur die Zahl. */
export function rollenGlockeDazu(glocke: RollenGlocke, nummer: string): RollenGlocke {
    if (glocke.nummern.includes(nummer)) return glocke;
    const mehr = { ...glocke, nummern: [...glocke.nummern, nummer], anzahl: glocke.anzahl + 1 };
    if (rollenGlockeText(mehr).length <= GLOCKE_TEXT_MAX) return mehr;
    // Die Zahl `#n` braucht selbst Platz: Dann fallen hinten Nummern weg, bis der Text wieder passt.
    let gezaehlt: RollenGlocke = { ...glocke, anzahl: glocke.anzahl + 1 };
    while (rollenGlockeText(gezaehlt).length > GLOCKE_TEXT_MAX && gezaehlt.nummern.length > 1) {
        gezaehlt = { ...gezaehlt, nummern: gezaehlt.nummern.slice(0, -1) };
    }
    return gezaehlt;
}
