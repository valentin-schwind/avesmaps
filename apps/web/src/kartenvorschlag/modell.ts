import {
    KARTENVORSCHLAG_DATEITYPEN,
    KARTENVORSCHLAG_GRENZEN,
    KARTENVORSCHLAG_LIMITS,
    KARTENVORSCHLAG_TERMS_VERSION,
    MEDIA_UPLOAD_LIMITS,
    type KarteArt,
    type KarteTyp,
    type KartenvorschlagDateityp,
    type KartenvorschlagEinreichung,
    type KartenvorschlagNutzung,
} from "@avesmaps3d/shared";
import type { FormularKennung } from "../community/api";
import type { MessageKey } from "../i18n/de";

/**
 * Was „Karte vorschlagen“ rechnet (WI-0275 Stufe C; Vertrag `packages/shared/src/kartenvorschlag.ts`), ohne Browser: der Entwurf, die Pflicht samt Grund der Sperre, die Prüfung der Datei und der Rumpf der
 * Anfrage. Wie es aussieht, steht in `karte-formular.vue`, die Hülle in `kartenvorschlag-fenster.vue`, die Aufrufe in `api.ts`.
 *
 * - **Pflicht sind nur der Titel und (Link ODER Datei)**, bei einer Datei dazu das Häkchen der Erklärung. Alles andere ist freiwillig; die Quelle sperrt nie. Die dreiwertigen Angaben (Spoiler, offiziell …)
 *   fehlen im Rumpf, solange der Einreicher nichts wählt: „unbekannt“ wird nie als „nein“ gesendet.
 * - 🔴 **Die Datei wird im Browser nicht neu kodiert** (anders als ein Reisebild): Die Karte soll so ankommen, wie sie ist, auch ein PDF. Geprüft wird nur Art (JPEG, PNG, WebP, PDF) und Größe (50 MiB);
 *   der Server prüft die Art danach aus den Bytes.
 * - 🔴 **Der Rumpf trägt die Fassung der Bedingungen nur bei einer Datei** (`KARTENVORSCHLAG_TERMS_VERSION`) und immer die gemessene Dauer seit dem Öffnen (Zeitfalle) samt Honigtopf.
 */

/** Eine dreiwertige Angabe: leer heißt unbekannt (und fehlt im Rumpf), nie „nein“. */
export type Dreiwertig = "" | "ja" | "nein";
export const DREIWERTIGE = ["spoiler", "beschriftet", "mehrstoeckig", "offiziell", "kostenpflichtig"] as const;
export type DreiwertigesFeld = (typeof DREIWERTIGE)[number];

export type Weg = "link" | "datei";

export interface KartenEntwurf {
    weg: Weg;
    link: string;
    /** Die gewählte Datei; geht erst im zweiten Schritt hinaus. */
    datei: File | undefined;
    titel: string;
    beschreibung: string;
    quelle: string;
    vorschauLink: string;
    nutzung: KartenvorschlagNutzung;
    /** Das Häkchen der Erklärung zu den Rechten (nur bei einer Datei Pflicht). */
    haken: boolean;
    urheber: string;
    name: string;
    typen: KarteTyp[];
    art: KarteArt | "";
    gueltigAb: string;
    gueltigBis: string;
    farbe: "graustufen" | "braun" | "farbig" | "";
    spoiler: Dreiwertig;
    beschriftet: Dreiwertig;
    mehrstoeckig: Dreiwertig;
    offiziell: Dreiwertig;
    kostenpflichtig: Dreiwertig;
    notiz: string;
    /** Das Honigtopf-Feld: Ein Mensch sieht es nie, ein einfacher Bot füllt es. */
    honig: string;
}

export function leererEntwurf(): KartenEntwurf {
    return {
        weg: "link",
        link: "",
        datei: undefined,
        titel: "",
        beschreibung: "",
        quelle: "",
        vorschauLink: "",
        nutzung: "avesmaps_only",
        haken: false,
        urheber: "",
        name: "",
        typen: [],
        art: "",
        gueltigAb: "",
        gueltigBis: "",
        farbe: "",
        spoiler: "",
        beschriftet: "",
        mehrstoeckig: "",
        offiziell: "",
        kostenpflichtig: "",
        notiz: "",
        honig: "",
    };
}

/** Die Zeichen eines Textes, wie der Server sie zählt (WI-0291): in Codepunkten (ajv, `char_length`), nicht in UTF-16 wie `.length`; ein Emoji ist EIN Zeichen. */
export const zeichen = (text: string): number => [...text].length;

/** Ein Text auf höchstens `max` Codepunkte gekürzt, ohne ein Paar zu zerreißen. */
const kuerze = (text: string, max: number): string => [...text].slice(0, max).join("");

/** Das Muster des Servers für Links (`KartenvorschlagEinreichung`): Schema `http` oder `https`, danach nichts als Zeichen ohne Leerraum. */
const LINK_MUSTER = /^https?:\/\/\S+$/u;

/**
 * Ein Link, wie er hinausgeht: getrimmt, das Schema klein (`HTTPS://…` ist dasselbe, der Server prüft aber nur die kleine Schreibung; WI-0291: umschreiben statt ablehnen).
 * Alles hinter dem Schema bleibt, wie es ist (Pfade unterscheiden Groß und Klein).
 */
export const linkBereinigt = (text: string): string =>
    text.trim().replace(/^(https?):\/\//iu, (_, schema: string) => `${schema.toLowerCase()}://`);

/**
 * Ist das eine Adresse, die der Server nimmt und die irgendwohin führt? Die Regel des Servers (WI-0291): 8 bis 500 Zeichen, `http://` oder `https://`, kein Leerraum; dazu wie bisher
 * ein Punkt im Rechnernamen (eine Karte liegt nicht auf `localhost`). Strenger als der Server zu sein ist hier gewollt: Der Knopf sagt dann vorher, warum, statt dass der Server ablehnt.
 */
export function istLink(text: string): boolean {
    const wert = linkBereinigt(text);
    const n = zeichen(wert);
    if (n < 8 || n > KARTENVORSCHLAG_LIMITS.linkMax || !LINK_MUSTER.test(wert)) return false;
    try {
        return new URL(wert).hostname.includes(".");
    } catch {
        return false;
    }
}

/** Der Rechnername eines Links ohne `www.`, für die Zeile „Karte auf …“; `undefined`, wo es keine Adresse ist. */
export function linkHost(text: string): string | undefined {
    if (!istLink(text)) return undefined;
    try {
        return new URL(linkBereinigt(text)).hostname.replace(/^www\./u, "");
    } catch {
        return undefined;
    }
}

const ENDUNGEN: Readonly<Record<string, KartenvorschlagDateityp>> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
};

/** Die Art der Datei, wie sie angekündigt wird: der Typ des Browsers, sonst die Endung (manche Systeme melden keinen). `undefined`: nicht erlaubt. */
export function dateityp(datei: { readonly type: string; readonly name: string }): KartenvorschlagDateityp | undefined {
    const gemeldet = (KARTENVORSCHLAG_DATEITYPEN as readonly string[]).find((typ) => typ === datei.type.toLowerCase());
    if (gemeldet !== undefined) return gemeldet as KartenvorschlagDateityp;
    if (datei.type !== "") return undefined;
    return ENDUNGEN[datei.name.toLowerCase().split(".").pop() ?? ""];
}

/** Darf diese Datei gewählt werden? Sonst der Satz, warum nicht. */
export function dateiProbe(datei: {
    readonly type: string;
    readonly name: string;
    readonly size: number;
}): { readonly ok: true } | { readonly ok: false; readonly grund: MessageKey } {
    if (dateityp(datei) === undefined) return { ok: false, grund: "kartenvorschlag.datei.fehler.format" };
    if (datei.size <= 0 || datei.size > KARTENVORSCHLAG_GRENZEN.dateiBytes) {
        return { ok: false, grund: "kartenvorschlag.datei.fehler.gross" };
    }
    return { ok: true };
}

/**
 * Passen die Maße eines Bildes (JPEG, PNG, WebP) zu den Grenzen des Servers? Dieselbe Reihenfolge wie dort (`inspect.ts`): erst die längste Kante, dann die Pixelzahl. Der Grund ist der Code, den der
 * Server schickt (`DATEI_GRUENDE`), damit Vorabprüfung und Ablehnung denselben Satz sagen (WI-0291). Ein PDF hat im Browser keine Maße und prüft nur der Server.
 */
export function masseProbe(masse: {
    readonly breite: number;
    readonly hoehe: number;
}): { readonly ok: true } | { readonly ok: false; readonly grund: "too_large_dimensions" | "too_many_pixels" } {
    if (Math.max(masse.breite, masse.hoehe) > MEDIA_UPLOAD_LIMITS.maxEdge) {
        return { ok: false, grund: "too_large_dimensions" };
    }
    if (masse.breite * masse.hoehe > MEDIA_UPLOAD_LIMITS.maxPixels) return { ok: false, grund: "too_many_pixels" };
    return { ok: true };
}

/** Die Pflichtfelder in der Reihenfolge des Formulars: Das fehlende Feld markiert und fokussiert ein Druck auf den gesperrten Knopf. */
export type PflichtFeld = "link" | "datei" | "titel" | "vorschau" | "haken" | "ab" | "bis";

/** Ein Jahr der Eingabe ist falsch, wenn etwas dasteht, das keine ganze Zahl im Bereich des Vertrags ist (ein Zahlenfeld des Browsers liefert auch eine Zahl statt Text). */
function jahrFalsch(wert: string | number): boolean {
    const text = String(wert).trim();
    if (text === "") return false;
    const zahl = Number(text);
    return !Number.isInteger(zahl) || zahl < KARTENVORSCHLAG_LIMITS.jahrMin || zahl > KARTENVORSCHLAG_LIMITS.jahrMax;
}

export function fehlendes(
    entwurf: KartenEntwurf,
): { feld: PflichtFeld; grund: MessageKey; params?: Record<string, string> } | undefined {
    if (entwurf.weg === "link") {
        if (entwurf.link.trim() === "") return { feld: "link", grund: "kartenvorschlag.sperre.link" };
        if (!istLink(entwurf.link)) return { feld: "link", grund: "kartenvorschlag.sperre.linkFalsch" };
    } else if (entwurf.datei === undefined) {
        return { feld: "datei", grund: "kartenvorschlag.sperre.datei" };
    }
    if (entwurf.titel.trim() === "") return { feld: "titel", grund: "kartenvorschlag.sperre.titel" };
    if (entwurf.weg === "link" && entwurf.vorschauLink.trim() !== "" && !istLink(entwurf.vorschauLink)) {
        return { feld: "vorschau", grund: "kartenvorschlag.sperre.vorschau" };
    }
    if (entwurf.weg === "datei" && !entwurf.haken) return { feld: "haken", grund: "kartenvorschlag.sperre.haken" };
    // WI-0291: die Jahre und ihre Reihenfolge prüft der Server mit 400 beziehungsweise 422 `zeitraum_verkehrt`; das Fenster sagt es vorher.
    const jahre = { min: String(KARTENVORSCHLAG_LIMITS.jahrMin), max: String(KARTENVORSCHLAG_LIMITS.jahrMax) };
    if (jahrFalsch(entwurf.gueltigAb)) return { feld: "ab", grund: "kartenvorschlag.sperre.jahr", params: jahre };
    if (jahrFalsch(entwurf.gueltigBis)) return { feld: "bis", grund: "kartenvorschlag.sperre.jahr", params: jahre };
    const ab = jahr(entwurf.gueltigAb);
    const bis = jahr(entwurf.gueltigBis);
    if (ab !== undefined && bis !== undefined && ab > bis) {
        return { feld: "bis", grund: "kartenvorschlag.sperre.zeitraum", params: { ab: String(ab), bis: String(bis) } };
    }
    return undefined;
}

const OEFFENTLICHE_KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Ein Jahr der Eingabe (ganze Zahl im erlaubten Bereich), sonst `undefined` (die Angabe fehlt dann im Rumpf). */
function jahr(wert: string | number): number | undefined {
    // 🪤 Ein Zahlenfeld mit `v-model` liefert eine Zahl, kein Text: `.trim()` darauf warf (WI-0291).
    const text = String(wert).trim();
    const zahl = Number(text);
    if (text === "" || !Number.isInteger(zahl)) return undefined;
    return zahl >= KARTENVORSCHLAG_LIMITS.jahrMin && zahl <= KARTENVORSCHLAG_LIMITS.jahrMax ? zahl : undefined;
}

const dreiwertig = (wert: Dreiwertig): boolean | undefined => (wert === "" ? undefined : wert === "ja");

/** Ein freiwilliger Text: getrimmt und auf die Grenze des Vertrags gekürzt; leer heißt, er fehlt im Rumpf. */
const frei = (text: string, max: number): string | undefined => {
    const kurz = kuerze(text.trim(), max);
    return kurz === "" ? undefined : kurz;
};

/** Ein freiwilliger Link: mit kleinem Schema (`linkBereinigt`); leer heißt, er fehlt im Rumpf. */
const linkOder = (text: string): string | undefined => (text.trim() === "" ? undefined : linkBereinigt(text));

/**
 * Der Rumpf der Einreichung. Wirft, wo `fehlendes` etwas meldet: Der Aufrufer prüft zuerst. `ortId` ist die öffentliche Kennung des Ortes, dessen Kartensammlung gemeint ist (fehlt beim
 * Vorschlag ohne Ort). `dauerMs` ist die Zeit seit dem Öffnen (Zeitfalle).
 */
export function drahtBody(
    kennung: FormularKennung,
    entwurf: KartenEntwurf,
    ortId: string | undefined,
    dauerMs: number,
): KartenvorschlagEinreichung {
    if (fehlendes(entwurf) !== undefined) throw new Error("Formular unvollständig");
    const art = entwurf.datei === undefined ? undefined : dateityp(entwurf.datei);
    if (entwurf.weg === "datei" && (entwurf.datei === undefined || art === undefined)) {
        throw new Error("Formular unvollständig");
    }
    const ist = entwurf.weg === "link";
    const optional = {
        beschreibung: frei(entwurf.beschreibung, KARTENVORSCHLAG_LIMITS.beschreibungMax),
        quelle: ist ? frei(entwurf.quelle, KARTENVORSCHLAG_LIMITS.quelleMax) : undefined,
        vorschauLink: ist ? linkOder(entwurf.vorschauLink) : undefined,
        urheber: frei(entwurf.urheber, KARTENVORSCHLAG_LIMITS.urheberMax),
        name: frei(entwurf.name, KARTENVORSCHLAG_LIMITS.nameMax),
        notiz: frei(entwurf.notiz, KARTENVORSCHLAG_LIMITS.notizMax),
        typen: entwurf.typen.length === 0 ? undefined : [...entwurf.typen],
        art: entwurf.art === "" ? undefined : entwurf.art,
        farbe: entwurf.farbe === "" ? undefined : entwurf.farbe,
        gueltigAb: jahr(entwurf.gueltigAb),
        gueltigBis: jahr(entwurf.gueltigBis),
        spoiler: dreiwertig(entwurf.spoiler),
        beschriftet: dreiwertig(entwurf.beschriftet),
        mehrstoeckig: dreiwertig(entwurf.mehrstoeckig),
        offiziell: dreiwertig(entwurf.offiziell),
        kostenpflichtig: dreiwertig(entwurf.kostenpflichtig),
        placeId: ortId !== undefined && OEFFENTLICHE_KENNUNG.test(ortId) ? ortId : undefined,
    };
    const vorhanden = Object.fromEntries(Object.entries(optional).filter(([, wert]) => wert !== undefined));
    return {
        operationId: kennung.operationId,
        schluessel: kennung.schluessel,
        weg: entwurf.weg,
        titel: kuerze(entwurf.titel.trim(), KARTENVORSCHLAG_LIMITS.titelMax),
        ...(ist
            ? { link: linkBereinigt(entwurf.link) }
            : {
                  datei: { typ: art as KartenvorschlagDateityp, groesse: (entwurf.datei as File).size },
                  nutzung: entwurf.nutzung,
                  bedingungen: KARTENVORSCHLAG_TERMS_VERSION,
              }),
        ...vorhanden,
        falle: { feld: entwurf.honig, dauerMs: Math.max(0, Math.round(dauerMs)) },
    };
}

/** Ist im Formular schon etwas geschrieben oder gewählt? Dann schließt Esc in einem Feld das Fenster nicht (✕ bleibt der ausdrückliche Weg). */
export const geschrieben = (entwurf: KartenEntwurf): boolean =>
    entwurf.datei !== undefined ||
    [entwurf.link, entwurf.titel, entwurf.beschreibung, entwurf.quelle, entwurf.notiz, entwurf.urheber].some(
        (text) => text.trim() !== "",
    );
