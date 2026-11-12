import { mediaInstagramUrl } from "@avesmaps3d/shared";
import { leseOeffentlicheHerkunft, type MetaZugang } from "./konfiguration.ts";
import {
    META_KENNUNG,
    MetaFehler,
    graphAufruf,
    graphFehlerZu,
    istObjekt,
    leseKennung,
    type GraphDeps,
} from "./meta-graph.ts";

/**
 * Die Anbindung an das Instagram-Geschäftskonto (WI-0268 C12b; Fachkonzept §15.7, Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §2). Nur diese Datei redet mit Meta für Instagram.
 *
 * - **Zugang prüfen** (`leseKonto`): `GET /{ig-user-id}?fields=id`. Meta nennt keine Grenzen (2200 Zeichen, `ZAEHLREGELN.instagram`); der tägliche Lauf liest nur, ob der Schlüssel noch gilt.
 * - 🔴 **Bild ist Pflicht** und braucht eine **öffentlich abrufbare Adresse**: Meta holt das Bild selbst ab (`image_url`). 🔴 **Instagram nimmt nur JPEG** (Graph-Schnittstelle, `image_url`): Der Hub nennt darum nicht die Adresse
 *   der veröffentlichten WebP, sondern die ihrer JPEG-Fassung (`bildAdresse`, `/media/sha256/…/<hash>.ig.jpg`), die der Versand vorher neben die WebP legt (`social/instagram-ableitung.ts`). Ist die Umgebung nicht
 *   öffentlich erreichbar, gibt es keine Adresse und Instagram ist gesperrt.
 * - **Senden in zwei Schritten** (`sende`): `POST /{ig-user-id}/media` legt einen Container an (`image_url`, `caption`, `alt_text`), `GET /{container-id}?fields=status_code` wartet auf `FINISHED` (mit Grenze),
 *   `POST /{ig-user-id}/media_publish` veröffentlicht ihn, `GET /{media-id}?fields=permalink` nennt die Adresse.
 * - 🔴 **Zurücknehmen gibt es nicht:** Instagram erlaubt kein Löschen über die Schnittstelle (Hub: „bitte in der App löschen“); dieses Modul hat deshalb keine Löschfunktion. Es gibt auch kein Ändern nach dem Senden.
 * - 🔴 **Meta kennt keinen Idempotenz-Kopf:** Gegen Doppeltes schützen die Reservierung der Sendung und die Kennung des Containers, die der Auftrag nach Schritt 1 in `sendung.extern_id` einträgt (`beiContainer`).
 *   Ein neuer Versuch nach einem Fehler in Schritt 2 nimmt DENSELBEN Container (Meta veröffentlicht einen Container nur einmal) und legt keinen zweiten an.
 */

const NAME = "Instagram";

/** Wie oft und in welchem Abstand `status_code` abgefragt wird, bevor der Versuch als zu langsam gilt (30 Sekunden; die Reservierung der Sendung hält drei Minuten). */
export const CONTAINER_VERSUCHE = 15;
export const CONTAINER_ABSTAND_MS = 2_000;

/** Die Kennung eines Containers, wie die Sendung sie merkt: `container:<Ziffern>`. */
export const containerKennung = (id: string): string => `container:${id}`;
export function containerAus(externId: string | null): string | undefined {
    const treffer = externId === null ? null : /^container:([0-9]{1,40})$/u.exec(externId);
    return treffer?.[1];
}

/** Die Adresse, die der Hub nennt, wenn Meta keinen Permalink liefert: das Konto, nicht der Beitrag. */
export const INSTAGRAM_ALLGEMEIN = "https://www.instagram.com/";

/**
 * Die öffentliche Adresse der Instagram-Fassung eines veröffentlichten Bilds: `PUBLIC_ORIGIN` der Umgebung plus `/media/sha256/aa/bb/<hash>.ig.jpg`. Der Hash steht im Speicherschlüssel der WebP
 * (`published/sha256/aa/bb/<hash>.webp`), die Fassung trägt denselben. `undefined`, wenn die Umgebung nicht öffentlich erreichbar ist (`leseOeffentlicheHerkunft`) oder der Schlüssel keine veröffentlichte WebP ist.
 * Die Adresse allein legt nichts an: Die Fassung muss vorher da sein (`sichereInstagramBild`).
 */
export function bildAdresse(umgebung: NodeJS.ProcessEnv, speicherSchluessel: string): string | undefined {
    const herkunft = leseOeffentlicheHerkunft(umgebung);
    const hash = /^published\/sha256\/[0-9a-f]{2}\/[0-9a-f]{2}\/([0-9a-f]{64})\.webp$/u.exec(speicherSchluessel)?.[1];
    if (herkunft === undefined || hash === undefined) return undefined;
    return new URL(mediaInstagramUrl(hash), herkunft).toString();
}

/** Liest das Konto: Der Schlüssel gilt noch und gehört zu diesem Geschäftskonto. Wirft `MetaFehler`. */
export async function leseKonto(zugang: MetaZugang, deps: GraphDeps = {}): Promise<void> {
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "GET",
        pfad: `/${zugang.konto}`,
        abfrage: { fields: "id" },
    });
    if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
    if (!istObjekt(antwort.json) || antwort.json["id"] !== zugang.konto) {
        throw new MetaFehler(`${NAME}: Der Zugangsschlüssel gehört nicht zu diesem Konto`, true);
    }
}

export interface InstagramBeitrag {
    /** Die Unterschrift: Text und Hashtags, wie der Hub sie zählt. */
    readonly text: string;
    /** Die öffentliche Adresse des Bilds (`bildAdresse`). */
    readonly bildUrl: string;
    /** Die Bildbeschreibung (`alt_text`). */
    readonly beschreibung: string;
    /** Ein Container aus einem früheren Versuch dieser Sendung: Er wird weiterverwendet, nicht neu angelegt. */
    readonly container?: string | undefined;
}

export interface Gesendet {
    /** Die Kennung des veröffentlichten Beitrags bei Meta. */
    readonly id: string;
    /** Die Adresse (Permalink) des Beitrags auf Instagram (`https`). */
    readonly url: string;
}

/** Schritt 1: den Container anlegen. Gibt seine Kennung zurück. */
export async function legeContainerAn(
    zugang: MetaZugang,
    beitrag: Pick<InstagramBeitrag, "text" | "bildUrl" | "beschreibung">,
    deps: GraphDeps = {},
): Promise<string> {
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "POST",
        pfad: `/${zugang.konto}/media`,
        felder: {
            image_url: beitrag.bildUrl,
            caption: beitrag.text,
            ...(beitrag.beschreibung.trim() === "" ? {} : { alt_text: beitrag.beschreibung }),
        },
    });
    if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
    return leseKennung(NAME, antwort.json, "id", "des Containers");
}

/**
 * Wartet, bis Meta den Container verarbeitet hat (`status_code` `FINISHED`). `ERROR` ist ein dauerhafter Fehler des Bilds oder der Unterschrift; `EXPIRED` (Container älter als 24 Stunden) gibt `abgelaufen`
 * zurück, damit der Aufrufer einen neuen anlegt; `PUBLISHED` heißt: Ein früherer Versuch hat ihn schon veröffentlicht (und nur die Antwort ging verloren): Er wird nicht noch einmal veröffentlicht. Bleibt der Container länger als `CONTAINER_VERSUCHE` mal `CONTAINER_ABSTAND_MS` in Arbeit, ist das ein vorübergehender Fehler (der nächste Versuch nimmt denselben Container).
 */
export async function warteAufContainer(
    zugang: MetaZugang,
    container: string,
    deps: GraphDeps = {},
): Promise<"fertig" | "abgelaufen" | "veroeffentlicht"> {
    if (!META_KENNUNG.test(container))
        throw new MetaFehler(`${NAME}: Die Kennung des Containers ist unbrauchbar`, true);
    const warte = deps.warte ?? ((ms: number) => new Promise<void>((fertig) => setTimeout(fertig, ms)));
    for (let versuch = 0; versuch < CONTAINER_VERSUCHE; versuch += 1) {
        const antwort = await graphAufruf(NAME, zugang, deps, {
            methode: "GET",
            pfad: `/${container}`,
            abfrage: { fields: "status_code" },
        });
        if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
        const stand = istObjekt(antwort.json) ? antwort.json["status_code"] : undefined;
        if (stand === "FINISHED") return "fertig";
        if (stand === "PUBLISHED") return "veroeffentlicht";
        if (stand === "EXPIRED") return "abgelaufen";
        if (stand === "ERROR") {
            throw new MetaFehler(`${NAME}: Meta konnte das Bild oder den Text nicht verarbeiten`, true, antwort.status);
        }
        await warte(CONTAINER_ABSTAND_MS);
    }
    throw new MetaFehler(`${NAME}: Meta hat das Bild nicht rechtzeitig verarbeitet`, false);
}

/** Schritt 2: den Container veröffentlichen. Gibt die Kennung des Beitrags zurück. */
export async function veroeffentliche(zugang: MetaZugang, container: string, deps: GraphDeps = {}): Promise<string> {
    if (!META_KENNUNG.test(container))
        throw new MetaFehler(`${NAME}: Die Kennung des Containers ist unbrauchbar`, true);
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "POST",
        pfad: `/${zugang.konto}/media_publish`,
        felder: { creation_id: container },
    });
    if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
    return leseKennung(NAME, antwort.json, "id", "des Beitrags");
}

/** Gibt es diesen Beitrag auf Instagram noch? (Vor einem Wiederholungsversuch: Wer schon eine Kennung hat, sendet nicht noch einmal.) */
export async function gibtEs(zugang: MetaZugang, mediaId: string, deps: GraphDeps = {}): Promise<boolean> {
    if (!META_KENNUNG.test(mediaId))
        throw new MetaFehler(`${NAME}: Die Kennung des Beitrags bei Meta ist unbrauchbar`, true);
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "GET",
        pfad: `/${mediaId}`,
        abfrage: { fields: "id" },
    });
    if (antwort.status === 200) return true;
    const fehler = istObjekt(antwort.json) && istObjekt(antwort.json["error"]) ? antwort.json["error"] : {};
    // Code 100 mit Unterfehler 33 (Objekt nicht da) und Code 803 sind die Antworten für „gibt es nicht (mehr)“.
    if (
        antwort.status === 404 ||
        (antwort.status === 400 &&
            (fehler["code"] === 803 || (fehler["code"] === 100 && fehler["error_subcode"] === 33)))
    ) {
        return false;
    }
    throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
}

/** Der Permalink eines veröffentlichten Beitrags; `undefined`, wenn Meta ihn nicht (brauchbar) nennt oder der Beitrag nicht mehr da ist. */
export async function leseAdresse(
    zugang: MetaZugang,
    mediaId: string,
    deps: GraphDeps = {},
): Promise<string | undefined> {
    if (!META_KENNUNG.test(mediaId)) return undefined;
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "GET",
        pfad: `/${mediaId}`,
        abfrage: { fields: "permalink" },
    });
    if (antwort.status !== 200 || !istObjekt(antwort.json)) return undefined;
    const link = antwort.json["permalink"];
    // eslint-disable-next-line no-control-regex
    return typeof link === "string" && link.length <= 1000 && /^https:\/\/[^\s\u0000-\u001f\u007f]+$/u.test(link)
        ? link
        : undefined;
}

/**
 * Sendet den Beitrag in beiden Schritten. `beiContainer` bekommt die Kennung des neuen Containers, SOBALD Meta sie nannte (der Auftrag trägt sie als Zwischenstand ein): Scheitert Schritt 2, nimmt der nächste
 * Versuch diesen Container. Ein abgelaufener Container wird durch einen neuen ersetzt (einmal).
 */
export async function sende(
    zugang: MetaZugang,
    beitrag: InstagramBeitrag,
    deps: GraphDeps = {},
    beiContainer?: (container: string) => Promise<void>,
): Promise<Gesendet> {
    let container = beitrag.container;
    for (let runde = 0; runde < 2; runde += 1) {
        if (container === undefined) {
            container = await legeContainerAn(zugang, beitrag, deps);
            await beiContainer?.(container);
        }
        const stand = await warteAufContainer(zugang, container, deps);
        if (stand === "fertig") {
            const id = await veroeffentliche(zugang, container, deps);
            return { id, url: (await leseAdresse(zugang, id, deps)) ?? INSTAGRAM_ALLGEMEIN };
        }
        // Schon veröffentlicht, nur die Antwort ging verloren: kein zweiter Beitrag. Die Kennung des Beitrags kennt der Hub nicht; der Container steht stellvertretend, die Adresse ist die des Kontos.
        if (stand === "veroeffentlicht") return { id: container, url: INSTAGRAM_ALLGEMEIN };
        container = undefined;
    }
    throw new MetaFehler(`${NAME}: Der Container ist abgelaufen`, false);
}
