import { KANAL_IDS, fassungFuer, regelFuer, type KanalId, type KanalRegeln } from "@avesmaps3d/shared";
import { KANAELE } from "../legal/community";

/**
 * Was die „Vorschau je Kanal“ im Beitragsfenster des Social Hubs rechnet (WI-0270; Probierseite V15, Vali 2026-11-01: „da wo die vorschau ist: kannst du das mehr nach vorschau - z.b. nach instagram
 * oder facebook „aussehen lassen“?“, bestätigt am selben Tag per Antwortknopf „Ja, so einbauen“), ohne Browser: die Reiter in ihrer Reihenfolge, der Text, den ein Kanal bekommt, in Stücken (Text, Hashtag,
 * Adresse, Zeilenumbruch), die Kürzung nach der Art des Dienstes und der Kontoname. Wie es aussieht, steht in `social-vorschau.vue`.
 *
 * - 🔴 **Kein HTML aus dem Text.** Der Text wird in Stücke zerlegt, die das Bauteil als Spannen rendert; ein `v-html` gibt es nicht. Ein `<script>` im Beitrag bleibt ein Wort, das mitgeschrieben wird.
 * - 🔴 **Die Vorschau zeigt, was gesendet wird.** Der Text kommt aus `fassungFuer` der Zählung (`packages/shared/src/social/zaehlen.ts`): der Text, dann die ersten so vielen Hashtags, wie der Kanal nimmt.
 * - **Die Reiter kommen aus der Kanalliste des Hubs** (`KANAL_IDS`), nicht aus einer eigenen: Steht ein Kanal dort nicht (mehr), gibt es keinen Reiter. Angehakte Kanäle stehen vorn, die übrigen zum Vergleich dahinter.
 */

/** Die Reihenfolge der Reiter (Entwurf V15). Ein Kanal der Liste des Hubs, der hier fehlt, steht hinten. */
const REIHE: readonly KanalId[] = ["neuigkeiten", "mastodon", "instagram", "facebook", "discord"];

export interface VorschauReiter {
    readonly id: KanalId;
    /** Ist der Kanal im Beitrag angehakt? Sonst steht der Reiter nur zum Vergleich da. */
    readonly angehakt: boolean;
}

/** Die Reiter: zuerst die angehakten, dann die übrigen, je in der Reihenfolge des Entwurfs; nur Kanäle der Liste `vorhanden`. */
export function reiterVon(
    angehakt: readonly KanalId[],
    vorhanden: readonly KanalId[] = KANAL_IDS,
): readonly VorschauReiter[] {
    const reihe = [...REIHE, ...vorhanden.filter((id) => !REIHE.includes(id))].filter((id) => vorhanden.includes(id));
    const an = reihe.filter((id) => angehakt.includes(id));
    return [...an, ...reihe.filter((id) => !an.includes(id))].map((id) => ({ id, angehakt: an.includes(id) }));
}

/** Welcher Reiter gilt? Der gewählte, solange es ihn gibt; sonst der erste. */
export const aktiverReiter = (reiter: readonly VorschauReiter[], gewaehlt: KanalId | undefined): KanalId | undefined =>
    reiter.find((eintrag) => eintrag.id === gewaehlt)?.id ?? reiter[0]?.id;

// --- Text in Stücken ----------------------------------------------------------------------------------------------------------------

export type Stueck =
    | { readonly art: "text"; readonly text: string }
    | { readonly art: "hashtag"; readonly text: string }
    /** Eine Adresse, wie der Dienst sie zeigt: ohne Protokoll, nach 30 Zeichen mit „…“. */
    | { readonly art: "adresse"; readonly text: string }
    | { readonly art: "umbruch" };
/** Ein Absatz (durch eine Leerzeile getrennt), Zeilenumbrüche darin als Stück. */
export type Absatz = readonly Stueck[];

const ADRESSE_ANZEIGE = 30;
/** Satzzeichen am Ende gehören dem Satz, nicht der Adresse (wie die Zählung). */
const ADRESSE_ENDE = /[.,;:!?)\]}'"»”’…]+$/u;
/** Eine Adresse mit Protokoll, oder ein Hashtag am Anfang oder hinter Leerraum. */
const MUSTER = /(https?:\/\/[^\s<>"]+)|(?<=^|\s)(#[\p{L}\p{N}_]+)/gu;

function adresseKurz(adresse: string): string {
    const ohne = Array.from(adresse.replace(/^https?:\/\//u, ""));
    return ohne.length > ADRESSE_ANZEIGE ? `${ohne.slice(0, ADRESSE_ANZEIGE).join("")}…` : ohne.join("");
}

function zerlegeZeile(zeile: string, verweise: boolean): Stueck[] {
    const stuecke: Stueck[] = [];
    let ab = 0;
    const bis = (ende: number): void => {
        if (ende > ab) stuecke.push({ art: "text", text: zeile.slice(ab, ende) });
    };
    for (const treffer of zeile.matchAll(MUSTER)) {
        const start = treffer.index;
        const adresse = treffer[1];
        const hashtag = treffer[2];
        if (adresse !== undefined) {
            if (!verweise) continue;
            const kern = adresse.slice(0, adresse.length - (ADRESSE_ENDE.exec(adresse)?.[0].length ?? 0));
            // Bleibt von der Adresse nach dem Abschneiden nichts als das Protokoll, ist es keine.
            if (!/^https?:\/\/./u.test(kern)) continue;
            bis(start);
            stuecke.push({ art: "adresse", text: adresseKurz(kern) });
            ab = start + kern.length;
        } else if (hashtag !== undefined) {
            bis(start);
            stuecke.push({ art: "hashtag", text: hashtag });
            ab = start + hashtag.length;
        }
    }
    bis(zeile.length);
    return stuecke;
}

/**
 * Zerlegt einen Text in Absätze und Stücke. Hashtags sind immer Stücke eigener Art (Farbe); Adressen nur, wo der Dienst sie zu Verweisen macht (`verweise`; Instagram macht sie nicht).
 * Aus dem Text wird nie Markup: Was spitze Klammern enthält, bleibt Text.
 */
export function zerlege(text: string, verweise: boolean): readonly Absatz[] {
    return text
        .replace(/\r\n?/gu, "\n")
        .split(/\n{2,}/u)
        .map((absatz) =>
            absatz
                .split("\n")
                .flatMap((zeile, i): Stueck[] => [
                    ...(i === 0 ? [] : [{ art: "umbruch" } as const]),
                    ...zerlegeZeile(zeile, verweise),
                ]),
        );
}

// --- Text je Kanal ------------------------------------------------------------------------------------------------------------------------

/** Wie viele Zeichen ein Dienst zeigt, bevor er mit „mehr“ kürzt (Instagram rund 125, Facebook rund fünf Zeilen, geschätzt 300). */
export const KUERZUNG: Readonly<Partial<Record<KanalId, number>>> = { instagram: 125, facebook: 300 };

/** Machen Adressen im Text einen Verweis? Auf Instagram nicht. */
export const MIT_VERWEISEN: Readonly<Partial<Record<KanalId, boolean>>> = { instagram: false };

export interface VorschauText {
    readonly absaetze: readonly Absatz[];
    /** Wurde gekürzt (der Knopf „mehr“ steht dann hinter dem Text)? */
    readonly gekuerzt: boolean;
}

export interface VorschauOptionen {
    /** Der Text, wenn der Beitrag noch keinen hat (die Hashtags stehen trotzdem dahinter). */
    readonly leer: string;
    /** Die Regeln der Instanz (Mastodon), sonst gelten die Vorgaben. */
    readonly regeln?: KanalRegeln | undefined;
    /** Aufgeklappt: Der Text wird nicht gekürzt. */
    readonly voll?: boolean | undefined;
}

/**
 * Der Text, den ein Kanal bekommt, wie der Dienst ihn zeigt: dazu die ersten so vielen Hashtags, wie der Kanal nimmt (`fassungFuer`, dieselbe Zeile wie die Zählung), gekürzt nach der Art des Dienstes
 * (am Wortrand, ohne ein Zeichen zu spalten).
 */
export function vorschauText(
    kanal: KanalId,
    eingabe: { readonly text: string; readonly hashtags: readonly string[] },
    optionen: VorschauOptionen,
): VorschauText {
    const rumpf = eingabe.text.trim() === "" ? optionen.leer : eingabe.text.trim();
    let text = fassungFuer(regelFuer(kanal, optionen.regeln), { text: rumpf, hashtags: eingabe.hashtags }).text;
    let gekuerzt = false;
    const grenze = KUERZUNG[kanal];
    if (grenze !== undefined && optionen.voll !== true) {
        const zeichen = Array.from(text);
        if (zeichen.length > grenze) {
            text = zeichen
                .slice(0, grenze)
                .join("")
                .replace(/\s+\S*$/u, "");
            gekuerzt = true;
        }
    }
    return { absaetze: zerlege(text, MIT_VERWEISEN[kanal] ?? true), gekuerzt };
}

// --- Bild ---------------------------------------------------------------------------------------------------------------------------

/** Was die Bildfläche der Vorschau zeigt: das Bild, eine Fläche in seiner Form (gewählt, aber ohne Adresse), die gestrichelte Fläche (der Dienst verlangt eines) oder nichts. */
export type FotoArt = "bild" | "platz" | "ohne" | "kein";

export function fotoArt(gewaehlt: boolean, url: string | null, dienstVerlangtBild: boolean): FotoArt {
    if (gewaehlt) return url === null ? "platz" : "bild";
    return dienstVerlangtBild ? "ohne" : "kein";
}

// --- Konto ----------------------------------------------------------------------------------------------------------------------------

/** Der Name, unter dem die Vorschau den Absender zeigt. */
export const ANZEIGENAME = "Avesmaps";

/**
 * Der Kontoname je Kanal. Der Kanalstand des Hubs nennt ihn nicht (🔴 weder die Instanz noch ein Schlüssel steht in seiner Antwort, `SocialKanalStand`); die öffentlichen Konten stehen schon in „Hinweise“
 * (`legal/community.ts`), von dort kommen Instanz und Name. Fehlt das Konto dort, gilt die Vorgabe des Entwurfs.
 */
export function kontoVon(kanal: KanalId): string {
    // Nur Mastodon (@Name@Instanz) und Instagram (Kontoname) zeigen ein Konto; Facebook und Discord zeigen den Namen der Seite beziehungsweise der Anwendung.
    if (kanal !== "mastodon" && kanal !== "instagram") return ANZEIGENAME;
    const ziel = KANAELE.find((eintrag) => eintrag.id === kanal)?.ziel;
    try {
        const adresse = ziel === undefined ? undefined : new URL(ziel);
        const name = adresse?.pathname.replace(/\/+$/u, "").split("/").pop()?.replace(/^@/u, "");
        if (adresse !== undefined && name !== undefined && name !== "") {
            return kanal === "mastodon" ? `@${name}@${adresse.hostname}` : name;
        }
    } catch {
        // Eine Adresse, die sich nicht lesen lässt: die Vorgabe.
    }
    return kanal === "mastodon" ? "@Avesmaps@rollenspiel.social" : "avesmaps";
}
