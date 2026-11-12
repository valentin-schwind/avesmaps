import type { MetaZugang } from "./konfiguration.ts";
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
 * Die Anbindung an die Facebook-Seite (WI-0268 C12b; Fachkonzept §15.7, Recherche `project-control/discovery/social-zeichengrenzen-2026-10-31.md` §2). Nur diese Datei redet mit Meta für Facebook; sie kennt keine Datenbank.
 *
 * - **Zugang prüfen** (`leseKonto`): `GET /{page-id}?fields=id` mit dem Seitenschlüssel. Meta nennt keine Grenzen (die Zahlen stehen im Hub, `ZAEHLREGELN.facebook`); der tägliche Lauf liest nur, ob der Schlüssel noch gilt.
 * - **Senden** (`sende`): ein Text als `POST /{page-id}/feed` (`message`, optional `link`), ein Beitrag mit Bild als `POST /{page-id}/photos` (Datei als `source`, `caption`, Bildbeschreibung als `alt_text_custom`).
 *   `veroeffentlicht: false` legt einen unveröffentlichten Beitrag an (nur Administratoren der Seite sehen ihn): so prüft `social:pruefen` die Zählregel, ohne etwas Öffentliches zu zeigen.
 * - **Zurücknehmen** (`nimmZurueck`): `DELETE /{post-id}`; „nicht (mehr) da“ zählt als zurückgenommen.
 * - 🔴 **Kein Ändern nach dem Senden** (Fachkonzept §15.7): Der Hub schickt nie einen zweiten Aufruf, um einen Beitrag zu ändern.
 * - 🔴 **Meta kennt keinen Idempotenz-Kopf:** Gegen Doppeltes schützt der Auftrag (`gibtEs` vor einem Wiederholungsversuch, Reservierung der Sendung). Grenzen des Aufrufs und Fehlertexte: `meta-graph.ts`.
 */

const NAME = "Facebook";

/** Die Adresse eines Beitrags auf Facebook; `facebook.com/<Kennung>` führt zu Beitrag und Foto. */
export const facebookAdresse = (kennung: string): string => `https://www.facebook.com/${kennung}`;

/** Liest das Konto: Der Schlüssel gilt noch und gehört zu dieser Seite. Wirft `MetaFehler`. */
export async function leseKonto(zugang: MetaZugang, deps: GraphDeps = {}): Promise<void> {
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "GET",
        pfad: `/${zugang.konto}`,
        abfrage: { fields: "id" },
    });
    if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
    if (!istObjekt(antwort.json) || antwort.json["id"] !== zugang.konto) {
        throw new MetaFehler(`${NAME}: Der Zugangsschlüssel gehört nicht zu dieser Seite`, true);
    }
}

export interface FacebookBeitrag {
    readonly text: string;
    /** Eine Adresse als Vorschaukarte (`link`); der Hub setzt sie nicht, die Schnittstelle kennt sie. */
    readonly link?: string | undefined;
    /** Ein Bild: die Datei, ihr Medientyp und die Bildbeschreibung (Pflicht im Hub). */
    readonly bild?: { readonly bytes: Uint8Array; readonly mime: string; readonly beschreibung: string } | undefined;
    /** `false`: unveröffentlicht, nur für die Administratoren der Seite sichtbar (Prüflauf). Vorgabe `true`. */
    readonly veroeffentlicht?: boolean | undefined;
}

export interface Gesendet {
    /** Die Kennung bei Meta, mit der der Beitrag zurückgenommen wird (bei einem Foto die des Fotos). */
    readonly id: string;
    /** Die Adresse des Beitrags auf Facebook (`https`). */
    readonly url: string;
}

/** Die Dateiendung zum Typ; Facebook erkennt den Typ an den Bytes, die Endung hilft nur dem Namen. */
const endungZu = (mime: string): string =>
    (mime.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gu, "").slice(0, 8) || "bin";

/** Sendet einen Beitrag auf die Seite: ein Text als Eintrag (`feed`), mit Bild als Foto (`photos`). */
export async function sende(zugang: MetaZugang, beitrag: FacebookBeitrag, deps: GraphDeps = {}): Promise<Gesendet> {
    const veroeffentlicht = beitrag.veroeffentlicht === false ? "false" : "true";
    if (beitrag.bild === undefined) {
        const antwort = await graphAufruf(NAME, zugang, deps, {
            methode: "POST",
            pfad: `/${zugang.konto}/feed`,
            felder: {
                message: beitrag.text,
                published: veroeffentlicht,
                ...(beitrag.link === undefined ? {} : { link: beitrag.link }),
            },
        });
        if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
        const id = leseKennung(NAME, antwort.json, "id", "des Beitrags");
        return { id, url: facebookAdresse(id) };
    }
    const form = new FormData();
    form.append(
        "source",
        new Blob([Buffer.from(beitrag.bild.bytes)], { type: beitrag.bild.mime }),
        `bild.${endungZu(beitrag.bild.mime)}`,
    );
    form.append("caption", beitrag.text);
    form.append("published", veroeffentlicht);
    if (beitrag.bild.beschreibung.trim() !== "") form.append("alt_text_custom", beitrag.bild.beschreibung);
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "POST",
        pfad: `/${zugang.konto}/photos`,
        felder: form,
    });
    if (antwort.status !== 200) throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
    const id = leseKennung(NAME, antwort.json, "id", "des Fotos");
    const beitragsId = istObjekt(antwort.json) ? antwort.json["post_id"] : undefined;
    return {
        id,
        url: facebookAdresse(typeof beitragsId === "string" && META_KENNUNG.test(beitragsId) ? beitragsId : id),
    };
}

/** Ist die Antwort die eines Objekts, das es nicht (mehr) gibt? (Code 100 mit Unterfehler 33, oder Code 803.) */
function istNichtDa(status: number, json: unknown): boolean {
    if (status === 404) return true;
    const fehler = istObjekt(json) && istObjekt(json["error"]) ? json["error"] : {};
    return status === 400 && (fehler["code"] === 803 || (fehler["code"] === 100 && fehler["error_subcode"] === 33));
}

/** Gibt es diesen Beitrag auf der Seite noch? (Vor einem Wiederholungsversuch: Wer schon eine Kennung hat, sendet nicht noch einmal.) */
export async function gibtEs(zugang: MetaZugang, externId: string, deps: GraphDeps = {}): Promise<boolean> {
    if (!META_KENNUNG.test(externId))
        throw new MetaFehler(`${NAME}: Die Kennung des Beitrags bei Meta ist unbrauchbar`, true);
    const antwort = await graphAufruf(NAME, zugang, deps, {
        methode: "GET",
        pfad: `/${externId}`,
        abfrage: { fields: "id" },
    });
    if (antwort.status === 200) return true;
    if (istNichtDa(antwort.status, antwort.json)) return false;
    throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
}

/** Löscht einen Beitrag (`DELETE /{post-id}`). Ist er dort nicht (mehr) da, ist das Ziel erreicht. */
export async function nimmZurueck(zugang: MetaZugang, externId: string, deps: GraphDeps = {}): Promise<void> {
    if (!META_KENNUNG.test(externId))
        throw new MetaFehler(`${NAME}: Die Kennung des Beitrags bei Meta ist unbrauchbar`, true);
    const antwort = await graphAufruf(NAME, zugang, deps, { methode: "DELETE", pfad: `/${externId}` });
    if (antwort.status === 200 && istObjekt(antwort.json) && antwort.json["success"] === false) {
        throw new MetaFehler(`${NAME}: Meta hat das Löschen nicht ausgeführt`, true, antwort.status);
    }
    if (antwort.status === 200 || istNichtDa(antwort.status, antwort.json)) return;
    throw graphFehlerZu(NAME, antwort.status, antwort.json, zugang);
}
