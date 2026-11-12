import {
    MEDIA_EDITOR_URL,
    SOCIAL_URL,
    type MamSearchResult,
    type MediaAssetDetail,
    type MediaAssetType,
    type SocialBildRechte,
    type SocialBildUrteile,
    type SocialDetail,
    type SocialListe,
    type SocialQuittung,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { withConfirmation } from "../auth/bestaetigen";
import { fehlerArt } from "./api";
import type { Formular, anfrageVon } from "./social-modell";
import { inhaltVon } from "./social-modell";

/**
 * Der Social Hub an der Leitung (WI-0270 C11; Server: `apps/server/src/routes/social.ts`, Vertrag `packages/shared/src/community-social.ts`). Lesen: die Liste und ein Beitrag. Schritte: je ein Aufruf mit der
 * Revision, die die Person gesehen hat (`baseRevision`); der Server lehnt einen veralteten Stand mit `community_conflict` ab, nie ein stilles Überschreiben. Die Fehler übersetzt `redaktionFehler`
 * (`redaktion-api.ts`); die Oberfläche wählt ihren Satz nach dem Code, nie den Text des Servers.
 *
 * - 🔴 **Eine Kennung je Handlung** (ADR-0019): `kennung` gibt für denselben Schritt an demselben Beitrag dieselbe `operationId` zurück, bis er gelungen ist oder der Server ihn abgelehnt hat; ein erneutes
 *   Senden nach einem Netzfehler legt nie zwei Einträge an. Ein NEUER Beitrag trägt seine Kennung, bis er angelegt ist (`neueKennung`).
 */

export type SocialAnfrage = ReturnType<typeof anfrageVon>;

export function ladeBeitraege(frage: SocialAnfrage, fetcher?: Fetcher): Promise<SocialListe> {
    const parameter = new URLSearchParams({ segment: frage.segment });
    if (frage.q !== undefined) parameter.set("q", frage.q);
    if (frage.kanal !== undefined) parameter.set("kanal", frage.kanal);
    if (frage.herkunft !== undefined) parameter.set("herkunft", frage.herkunft);
    return getJson<SocialListe>(`${SOCIAL_URL}?${parameter.toString()}`, fetcher);
}

export const ladeBeitrag = (id: number, fetcher?: Fetcher): Promise<SocialDetail> =>
    getJson<SocialDetail>(`${SOCIAL_URL}/${String(id)}`, fetcher);

export type SocialSchritt =
    | "aendern"
    | "vorlegen"
    | "zurueckziehen"
    | "zurueckgeben"
    | "freigeben"
    | "aenderung"
    | "zuruecknehmen"
    | "kanal-zuruecknehmen"
    | "papierkorb"
    | "zurueckholen"
    | "erneut";

/** Die Kennungen der Handlungen, die noch keinen Abschluss haben: derselbe Schritt am selben Beitrag schickt dieselbe. */
const offeneKennungen = new Map<string, string>();

export function kennung(schluessel: string): string {
    let kennungId = offeneKennungen.get(schluessel);
    if (kennungId === undefined) {
        kennungId = newOperationId();
        offeneKennungen.set(schluessel, kennungId);
    }
    return kennungId;
}

export const kennungFrei = (schluessel: string): void => {
    offeneKennungen.delete(schluessel);
};

/**
 * Führt einen Schritt aus. Ein Netzfehler lässt die Kennung stehen (das erneute Senden ist gefahrlos), jede andere Antwort gibt sie frei. Verlangt der Schritt den zweiten Faktor (`publish_social`, `manage_news`: Stufe V,
 * eine Sonderrolle bringt ihn nicht mit), fragt „Kurz bestätigen“ nach und wiederholt ihn mit derselben Kennung.
 */
async function senden(
    schluessel: string,
    adresse: string,
    body: Record<string, unknown>,
    fetcher?: Fetcher,
): Promise<SocialQuittung> {
    try {
        const rumpf = { operationId: kennung(schluessel), ...body };
        const antwort = await withConfirmation(() => postJson<SocialQuittung>(adresse, rumpf, fetcher));
        kennungFrei(schluessel);
        return antwort;
    } catch (fehler) {
        if (fehlerArt(fehler) !== "netz") kennungFrei(schluessel);
        throw fehler;
    }
}

export const fuehreAus = (
    id: number,
    schritt: Exclude<SocialSchritt, "aendern">,
    baseRevision: number,
    extra: Record<string, unknown> = {},
    fetcher?: Fetcher,
): Promise<SocialQuittung> =>
    senden(`${String(id)}/${schritt}`, `${SOCIAL_URL}/${String(id)}/${schritt}`, { baseRevision, ...extra }, fetcher);

/** Das Formular speichern. Die Kennung hängt am Inhalt: Derselbe Inhalt nach einem Netzfehler schickt dieselbe, ein anderer eine neue. */
export function speichereBeitrag(
    id: number,
    baseRevision: number,
    formular: Formular,
    fetcher?: Fetcher,
): Promise<SocialQuittung> {
    const inhalt = inhaltVon(formular);
    return senden(
        `${String(id)}/aendern/${JSON.stringify(inhalt)}`,
        `${SOCIAL_URL}/${String(id)}/aendern`,
        { baseRevision, ...inhalt },
        fetcher,
    );
}

/** Einen neuen Beitrag anlegen; `vorgang` ist die COM-Nummer (ohne Präfix) bei „Als Beitrag vorschlagen“. */
export function legeBeitragAn(formular: Formular, vorgang?: number, fetcher?: Fetcher): Promise<SocialQuittung> {
    const inhalt = inhaltVon(formular);
    return senden(
        `neu/${JSON.stringify(inhalt)}/${String(vorgang ?? 0)}`,
        SOCIAL_URL,
        { ...inhalt, ...(vorgang === undefined ? {} : { vorgang }) },
        fetcher,
    );
}

// --- Bild aus der Medienverwaltung ------------------------------------------------------------------------------------------------------

export interface BildWahl {
    readonly id: string;
    readonly titel: string | null;
    readonly rechtsbasis: string | null;
    readonly klaerung: string | null;
    readonly vorschau: string | null;
    readonly typ: MediaAssetType | null;
    /** Darf das Bild in einen Beitrag? Das sagt allein der Server (Policy, `bild-urteil.ts`). */
    readonly erlaubt: boolean;
    readonly grund: string;
    readonly nennung: string | null;
    readonly oeffentlich: boolean;
}

/** Solange der Server nichts gesagt hat, ist nichts erlaubt. */
const OHNE_URTEIL = { erlaubt: false, grund: "rights_missing", nennung: null, oeffentlich: false } as const;

/** Was die Medienverwaltung von einem Bild sagt, noch ohne Urteil. */
type BildRoh = Omit<BildWahl, "erlaubt" | "grund" | "nennung" | "oeffentlich">;

/** Ein Bild, dessen Stand nicht ankam: gesperrt, bis der Server es anders sagt. */
export const bildOhneUrteil = (bild: BildRoh): BildWahl => ({ ...bild, ...OHNE_URTEIL });

/** Die Urteile des Servers an die Bilder hängen (WI-0278: So warnt die Auswahl vor genau dem, woran das Senden scheitern würde). */
async function mitUrteil(bilder: readonly BildRoh[], fetcher?: Fetcher): Promise<BildWahl[]> {
    if (bilder.length === 0) return [];
    const { urteile } = await getJson<SocialBildUrteile>(
        `${SOCIAL_URL}/bilder/urteile?ids=${bilder.map((bild) => bild.id).join(",")}`,
        fetcher,
    );
    const je = new Map(urteile.map((urteil) => [urteil.id, urteil]));
    return bilder.map((bild) => {
        const urteil = je.get(bild.id);
        return urteil === undefined
            ? bildOhneUrteil(bild)
            : {
                  ...bild,
                  erlaubt: urteil.erlaubt,
                  grund: urteil.grund,
                  nennung: urteil.nennung,
                  oeffentlich: urteil.oeffentlich,
              };
    });
}

export interface BildTreffer {
    readonly bilder: readonly BildWahl[];
    readonly gesamt: number;
}

/** So viele Bilder lädt die Auswahl je Seite. */
const BILD_SEITE = 24;

/**
 * Die Bilder der Medienverwaltung, nach Titel gesucht (`view_media_private` genügt, Editoren haben es); je Gruppe bytegleicher Werke nur eines, seitenweise (WI-0278). Die zuletzt geänderten zwölf aller
 * Bilder waren auf der Stage nur Typbilder, und mehr gab es nicht. Darum wählt die Person jetzt die Kategorie: Die eigene „Social Media Posts“ steht mit dem Neuesten vorn, alle anderen nach Namen.
 */
export async function sucheBilder(
    suche: string,
    wahl: { readonly typ?: MediaAssetType | undefined; readonly offset?: number | undefined } = {},
    fetcher?: Fetcher,
): Promise<BildTreffer> {
    const parameter = new URLSearchParams({
        kind: "image",
        groupFiles: "true",
        // Ein Reisebild geht nicht in einen Beitrag: wie die anderen Bildwahlen (WI-0272 S5).
        ohneReisebilder: "true",
        limit: String(BILD_SEITE),
        offset: String(wahl.offset ?? 0),
        ...(wahl.typ === "social_post" ? { sort: "changed", order: "desc" } : { sort: "name" }),
    });
    if (wahl.typ !== undefined) parameter.set("type", wahl.typ);
    const q = suche.trim();
    if (q !== "") parameter.set("q", q.slice(0, 200));
    const ergebnis = await getJson<MamSearchResult>(`${MEDIA_EDITOR_URL}?${parameter.toString()}`, fetcher);
    return {
        gesamt: ergebnis.total,
        bilder: await mitUrteil(
            ergebnis.items.map((asset) => ({
                id: asset.id,
                titel: asset.title,
                rechtsbasis: asset.rightsBasis,
                klaerung: asset.clearance,
                // Unter einem Notaus liegt die öffentliche Datei in Quarantäne: Ihre Adresse zeigte ein kaputtes Bild.
                vorschau: asset.suspended === true ? null : (asset.preview?.url ?? asset.privatePreview?.url ?? null),
                typ: asset.assetType,
            })),
            fetcher,
        ),
    };
}

/** Ein Bild der Medienverwaltung mit Titel, Rechten und Vorschau: das eben hochgeladene oder das eines gespeicherten Beitrags. */
export async function ladeBild(id: string, fetcher?: Fetcher): Promise<BildWahl> {
    const d = await getJson<MediaAssetDetail>(`${MEDIA_EDITOR_URL}/${id}`, fetcher);
    const [bild] = await mitUrteil(
        [
            {
                id,
                titel: d.asset.title,
                rechtsbasis: d.rights?.basis ?? null,
                klaerung: d.rights?.clearance ?? null,
                vorschau:
                    d.representations.find((datei) => datei.url !== null)?.url ??
                    d.representations.find((datei) => (datei.privateUrl ?? null) !== null)?.privateUrl ??
                    null,
                typ: d.asset.assetType,
            },
        ],
        fetcher,
    );
    return bild!;
}

/** „Rechte bestätigen“ an einem Bild der Kategorie „Social Media Posts“ (WI-0278, Recht `manage_news`). */
export function bestaetigeBildRechte(asset: string, fetcher?: Fetcher): Promise<SocialBildRechte> {
    const rumpf = { operationId: newOperationId() };
    return withConfirmation(() => postJson<SocialBildRechte>(`${SOCIAL_URL}/bilder/${asset}/rechte`, rumpf, fetcher));
}
