import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { corpusKeyOfUrl } from "../migration/subject-details.ts";

/**
 * Dieselbe Seite unter einer anderen Schreibweise der Adresse erkennen (WI-0277, Vali: „wär natürlich cool, wenn es einen kurzen check gibt, ob eine quelle bei uns existiert“).
 *
 * - 🔴 **Die Identität bleibt, wie sie ist:** `source_key` ist der Hash der Adresse, genau wie geliefert (Migration 0066). Der Vergleichswert wird nirgends gespeichert und ändert keine Quelle; er entscheidet nur, ob eine neue
 *   Adresse dieselbe Seite meint wie eine vorhandene.
 * - **Gleich ist:** http und https, mit oder ohne `www.`, mit oder ohne Schrägstrich am Schluss des Pfads, Groß und Klein im Namen, die Standardports, Groß und Klein in `%c3` und `%C3`.
 * - 🔴 **Verschieden bleibt:** Groß und Klein im Pfad, die Abfrage (`index.php?title=A` ist eine andere Seite als `?title=B`) und der Anker (zwei Abschnitte eines Wiki-Artikels können zwei Quellen sein). Lieber eine Dublette zu viel
 *   als zwei Seiten in einer; Zusammenlegen lässt sich später, Trennen nicht.
 * - **Dieselbe Seite unter zwei Domains** (`GLEICHE_DOMAINS`): Beim Link löst die Domain auf den Korpusschlüssel auf, der gilt, und eine Seite gilt unter beiden als dieselbe. Das gilt nur beim Anlegen per Link und in der Auskunft; vorhandene
 *   Quellen und Korpora bleiben, wie sie sind.
 */

/**
 * Domains, die dieselbe Seite zeigen, ohne weiterzuleiten, und der Korpusschlüssel, der für sie gilt (Vali 2026-11-03: „der schlüssel ist herzogtum-weiden.net“). Eine feste Liste, nie nach Namensähnlichkeit (WI-0254 §5): Ein weiteres Paar
 * ist eine Betreiberentscheidung.
 */
const GLEICHE_DOMAINS: Readonly<Record<string, string>> = { "herzogtum-weiden.de": "herzogtum-weiden.net" };

/** Der Korpusschlüssel einer Adresse beim Anlegen per Link: die registrierbare Domain, aufgelöst über `GLEICHE_DOMAINS`. */
export function korpusSchluesselDerAdresse(url: string): string {
    const domain = corpusKeyOfUrl(url);
    return GLEICHE_DOMAINS[domain] ?? domain;
}

/** Der Name mit dem geltenden Schlüssel statt der gleichen Domain (`www2.herzogtum-weiden.de` wird `www2.herzogtum-weiden.net`). */
function geltenderHost(host: string): string {
    for (const [domain, schluessel] of Object.entries(GLEICHE_DOMAINS)) {
        if (host === domain || host.endsWith(`.${domain}`)) return `${host.slice(0, -domain.length)}${schluessel}`;
    }
    return host;
}

/** Alle Schreibweisen des geltenden Namens, für den groben Vorlauf in SQL. */
function hostSchreibweisen(host: string): string[] {
    const namen = [host];
    for (const [domain, schluessel] of Object.entries(GLEICHE_DOMAINS)) {
        if (host === schluessel || host.endsWith(`.${schluessel}`)) {
            namen.push(`${host.slice(0, -schluessel.length)}${domain}`);
        }
    }
    return namen;
}

const hexGross = (text: string): string => text.replace(/%[0-9a-f]{2}/giu, (stelle) => stelle.toUpperCase());

const hostOhneWww = (url: URL): string =>
    url.hostname
        .toLowerCase()
        .replace(/\.+$/u, "")
        .replace(/^www\./u, "");

const geparst = (roh: string): URL | undefined => {
    try {
        const url = new URL(roh.trim());
        return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "" ? url : undefined;
    } catch {
        return undefined;
    }
};

/** Der Vergleichswert einer Adresse; `undefined`, wo sie keine Webadresse ist. */
export function adressVergleich(roh: string): string | undefined {
    const url = geparst(roh);
    if (url === undefined) return undefined;
    const port = url.port === "" ? "" : `:${url.port}`;
    const pfad = hexGross(url.pathname).replace(/\/+$/u, "");
    return `${geltenderHost(hostOhneWww(url))}${port}${pfad}${hexGross(url.search)}${hexGross(url.hash)}`;
}

export interface GleicheQuelle {
    id: string;
    title: string;
    url: string;
    source_type: string;
    is_active: boolean;
}

/**
 * Die Quelle des Katalogs, die dieselbe Seite meint; `undefined`, wo es keine gibt. Gibt es mehrere (der Bestand kennt beide Schreibweisen): eine aktive vor einer stillgelegten, dann die genau gleiche Adresse, dann die älteste.
 * 🪤 Der Filter in SQL ist nur der grobe Vorlauf über den Namen; es entscheidet `adressVergleich`, damit es eine Regel bleibt.
 */
export async function findeGleicheQuelle(database: Queryable, roh: string): Promise<GleicheQuelle | undefined> {
    const url = geparst(roh);
    const vergleich = adressVergleich(roh);
    if (url === undefined || vergleich === undefined) return undefined;
    const [erster, zweiter] = hostSchreibweisen(geltenderHost(hostOhneWww(url)));
    const kandidaten = await database<GleicheQuelle[]>`
        SELECT f.public_id::text AS id, f.title, f.url, f.source_type, f.is_active
          FROM feature_source f
         WHERE f.url ILIKE ${likeMuster(erster!)} ESCAPE '\' OR f.url ILIKE ${likeMuster(zweiter ?? erster!)} ESCAPE '\'
         ORDER BY f.id
    `;
    const gleiche = kandidaten.filter((eine) => adressVergleich(eine.url) === vergleich);
    const genau = roh.trim();
    const vorn = gleiche.some((eine) => eine.is_active) ? gleiche.filter((eine) => eine.is_active) : gleiche;
    return vorn.find((eine) => eine.url === genau) ?? vorn[0];
}
