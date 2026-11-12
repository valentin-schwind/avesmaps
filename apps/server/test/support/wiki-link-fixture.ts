import type { LinkArt, X2Art } from "../../src/migration/wiki-link-targets.ts";

/**
 * Antworten von Legacys Exporten X1 (Linkziele je ARTIKEL, Legacy-Commit `04a85a54f`) und X2 (Zuordnung) in Legacys Form für die Tests (WI-0063 27.12). Die
 * Köpfe werden aus den Zeilen gerechnet, damit keine Probe an einem Kopf scheitert, den niemand prüfen wollte; ein Test, der ihn verstellen will, ändert das
 * Ergebnis danach.
 *
 * Die Zuordnung der P4-Welt (`p4WikiLinkPayloads`) steht in `subject-fixture.ts`, weil sie deren Kennungen braucht: Ihre Objekte tragen den Key `wiki:` +
 * Schlüssel des Schnappschusses (so stimmen X2 und die eigenen Zuweisungen überein, der Prüfer bleibt still), Objekte nur mit Adresse `wiki:p4-…`.
 */

export interface X2Spec {
    art: X2Art;
    id: string;
    key: string;
    url?: string | null;
    title?: string | null;
    ns?: number | null;
    nsName?: string | null;
    redirect?: { titel: string | null; ns: number | null; nsName: string | null };
}

export interface LinkSpec {
    anzeige: string;
    /** Das rohe Linkziel; ohne Angabe der Anzeigetext. */
    ziel?: string;
    key: string;
    /** `wikilink` (Vorgabe) oder `vorlage` ({{Pol|X}} im Staat, {{Reg|X}} in der Region). */
    art?: LinkArt;
    /** Bei `art` `vorlage` der Name der Vorlage (Vorgabe `Pol`). */
    vorlage?: string;
    ns?: number;
    nsName?: string;
    redirect?: { titel: string | null; ns: number | null; nsName: string | null };
}

/** Ein ARTIKEL (eine Wiki-Seite) von X1: der Key ist der kanonische Key der Seite; welche Objekte daran hängen, sagt X2. */
export interface X1Spec {
    key: string;
    kind: "settlement" | "building" | "region" | "path" | "powerline";
    title: string;
    ns?: number;
    nsName?: string;
    felder: Record<string, LinkSpec[]>;
}

const STAMPS = {
    map_revision: 164000,
    ecosystem_revision: 141459,
    territories_revision: "pt-wiki-links-test",
    aliase_stempel: "ra-wiki-links-test",
};

export function x2Object(spec: X2Spec): Record<string, unknown> {
    return {
        public_id: spec.id,
        art: spec.art,
        wiki_url: spec.url === undefined ? `https://de.wiki-aventurica.de/wiki/${spec.key.slice(5)}` : spec.url,
        wiki_key: spec.key,
        wiki_titel: spec.title === undefined ? spec.key.slice(5) : spec.title,
        ns: spec.ns === undefined ? 0 : spec.ns,
        ns_name: spec.nsName === undefined ? "" : spec.nsName,
        ...(spec.redirect === undefined
            ? {}
            : {
                  weiterleitung_auf: {
                      wiki_key: spec.key,
                      titel: spec.redirect.titel,
                      ns: spec.redirect.ns,
                      ns_name: spec.redirect.nsName,
                  },
              }),
    };
}

export function x2Payload(specs: readonly X2Spec[], over: Record<string, unknown> = {}): Record<string, unknown> {
    const arts: X2Art[] = ["siedlung", "weg", "region", "kraftlinie", "landschaft", "gebiet"];
    return {
        ok: true,
        ...STAMPS,
        kopf: {
            objekte_mit_zuweisung: specs.length,
            objekte_ohne_schluessel: 0,
            verschiedene_schluessel: new Set(specs.map((spec) => spec.key)).size,
            je_art: Object.fromEntries(
                arts.map((art) => [
                    art,
                    { zugewiesen: specs.filter((spec) => spec.art === art).length, ohne_zuweisung: 7 },
                ]),
            ),
        },
        objekte: specs.map(x2Object),
        ...over,
    };
}

function linkObject(link: LinkSpec): Record<string, unknown> {
    const art = link.art ?? "wikilink";
    return {
        anzeige: link.anzeige,
        ziel: link.ziel ?? link.anzeige,
        art,
        ...(art === "vorlage" ? { vorlage: link.vorlage ?? "Pol" } : {}),
        ns: link.ns ?? 0,
        ns_name: link.nsName ?? "",
        ziel_key: link.key,
        ...(link.redirect === undefined
            ? {}
            : {
                  weiterleitung_auf: {
                      wiki_key: link.key,
                      titel: link.redirect.titel,
                      ns: link.redirect.ns,
                      ns_name: link.redirect.nsName,
                  },
              }),
    };
}

/** X1 in Legacys Form: die Artikel nach Key sortiert (wie der Export), der Kopf aus den Artikeln gerechnet. */
export function x1Payload(specs: readonly X1Spec[], over: Record<string, unknown> = {}): Record<string, unknown> {
    const articles = [...specs].sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    let fields = 0;
    let links = 0;
    let pipe = 0;
    let template = 0;
    const targets = new Set<string>();
    for (const spec of articles) {
        for (const list of Object.values(spec.felder)) {
            if (list.length === 0) continue;
            fields += 1;
            for (const link of list) {
                links += 1;
                pipe += (link.ziel ?? link.anzeige) !== link.anzeige ? 1 : 0;
                template += link.art === "vorlage" ? 1 : 0;
                targets.add(link.key);
            }
        }
    }
    return {
        ok: true,
        ...STAMPS,
        dump: { run_id: 155, abgeschlossen: "2026-09-08 04:00:00" },
        kopf: {
            objekte_je_art: {},
            objekte_ohne_schluessel: 0,
            artikel: {
                mit_wikitext: articles.length,
                felder_befuellt: fields,
                felder_mit_link: fields,
                links_gesamt: links,
                links_pipe: pipe,
                links_vorlage: template,
                ziele_verschieden: targets.size,
                ziele_mit_kartenobjekt: 0,
                ziele_ohne_kartenobjekt: targets.size,
            },
            haeufigste_ziele_ohne_kartenobjekt: [],
            vorlagen_in_feldern: {},
            seiten_schluesselkollision: 0,
        },
        artikel: articles.map((spec) => ({
            wiki_key: spec.key,
            ns: spec.ns ?? 0,
            ns_name: spec.nsName ?? "",
            seite_art: spec.kind,
            seite_titel: spec.title,
            felder: Object.fromEntries(
                Object.entries(spec.felder).map(([field, list]) => [field, list.map(linkObject)]),
            ),
        })),
        ohne_wikitext: [],
        ...over,
    };
}

/** Der Key eines Objekts der P4-Welt: `wiki:` + Schlüssel des Schnappschusses (so steht er auch in `place_wiki_assignment` und den anderen Zuweisungen). */
export const p4Key = (slug: string): string => `wiki:${slug}`;
