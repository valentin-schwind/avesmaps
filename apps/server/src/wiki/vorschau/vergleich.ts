import { wikiNamespaceTafel, wikiNamespaceZeile, type WikiNamespaceTafel } from "@avesmaps3d/shared";
import type { GefundeneSeite, TitelErgebnis } from "../dump/titel-sammler.ts";
import { titelAusWikiAdresse, titelKandidaten } from "./adresse.ts";

/**
 * Der Vergleich der gespeicherten Wiki-Zuweisungen mit dem Dump (WI-0253 B-1, `wiki_vorschau`): NUR ZAHLEN, nichts wird geschrieben.
 * Gerechnet wird über die gespeicherte ADRESSE und den Titel; ein Key wird nie gerechnet (Vertrag `wiki-link-targets.yaml`).
 *
 * 🔴 VORSICHT BEI KENNUNGEN OHNE ADRESSE (Vali 2026-10-25: „avesmaps legacy hat sich glaub mal seine eigenen keys gebaut, weil das unser
 * unique key war, aber viele objekte keinen hatten“). Eine Zuweisung zählt nur dann als Wiki-Zuweisung, wenn sie eine gespeicherte Adresse
 * des Wiki Aventurica trägt (`wiki_url` mit Wirt `wiki-aventurica.de` und einem Titel). Alles andere ist eine Kennung ohne Wiki-Adresse:
 * ein Key, den Legacy für eigene Zwecke führt, oder ein gespeicherter Key ohne Seite (`ns` ist NULL). Sie zählt nie als „nicht im
 * Dump“ und nie als „entfällt“, sie wird nicht angefasst und nirgends bewertet. Der Bericht nennt sie als ruhige Zahl je Art
 * (`kennungOhneWikiAdresse`, Vali 2026-10-25): kein Befund, keine Wirkung. Wo die Daten die Unterscheidung nicht sicher hergeben (nur
 * ein Titel ohne Adresse, eine fremde Adresse), gilt die vorsichtige Seite: Eigenkennung.
 *
 * ⭐ DIE MESSUNG, DIE VALI SEHEN WILL: `nichtImDump` bei Zuweisungen MIT Adresse, getrennt je Art (`nachArt`: siedlung, weg, region, kraftlinie,
 * landschaft, gebiet): „Wie viele erfundene Kennungen trotz Adresse gibt es?“ Der Wert heißt, der Titel steht in DIESEM Dump nicht, nicht
 * „die Seite gibt es nicht mehr“ (der Dump ist vom Monatsanfang). Und `mitAdresse = gefunden + umgeleitet + nichtImDump`,
 * `zuweisungen = mitAdresse + kennungOhneWikiAdresse`.
 *
 * Quelle sind allein die Zuweisungen der Zuordnungstafel X2 (`wiki_key_assignment`), die Identität des Lookups. Die Stätten
 * (`site.wiki_url`) und die artbezogenen Zuweisungstafeln (`place_wiki_assignment` …) sind der Abgleich dazu und kommen mit den Datendomänen.
 */

/** Eine gespeicherte Zuweisung (`wiki_key_assignment`), so weit der Vergleich sie braucht. */
export interface Zuweisung {
    /** Legacys Art des Objekts (`siedlung`, `weg`, `region`, `kraftlinie`, `landschaft`, `gebiet`). */
    art: string;
    wikiUrl: string | null;
    wikiTitel: string | null;
    ns: number | null;
    /** Hat eine Weiterleitung den Key schon verändert (`is_redirect`)? */
    istWeiterleitung: boolean;
}

export interface ArtZahlen {
    zuweisungen: number;
    mitAdresse: number;
    kennungOhneWikiAdresse: number;
    gefunden: number;
    umgeleitet: number;
    nichtImDump: number;
}

export interface VorschauZahlen extends ArtZahlen {
    /** Davon: im Dump eine Weiterleitung, die die Zuweisung schon als Weiterleitung führt. */
    umgeleitetBereitsVermerkt: number;
    /** Der Namensraum der Seite im Dump weicht vom gespeicherten ab (nur wo beide bekannt sind). */
    namensraumAbweichend: number;
    nachArt: Record<string, ArtZahlen>;
}

export interface NamensraumBefund {
    code: "namensraum_unbekannt";
    nr: number;
    name: string | null;
    seiten: number;
}

function leer(): ArtZahlen {
    return { zuweisungen: 0, mitAdresse: 0, kennungOhneWikiAdresse: 0, gefunden: 0, umgeleitet: 0, nichtImDump: 0 };
}

/** Die Titel, die eine Zuweisung im Dump sucht; leer, wenn sie keine Wiki-Adresse trägt (dann ist sie eine Kennung ohne Adresse). */
export function gesuchteTitel(zuweisung: Zuweisung): string[] {
    const ausAdresse = titelAusWikiAdresse(zuweisung.wikiUrl);
    if (ausAdresse === null) return [];
    const titel = [...titelKandidaten(ausAdresse)];
    const gespeichert = zuweisung.wikiTitel?.trim() ?? "";
    // Der gespeicherte Titel hilft nur MIT Adresse, nie allein.
    if (gespeichert !== "" && !titel.includes(gespeichert)) titel.push(gespeichert);
    return titel;
}

export function berechneVorschau(zuweisungen: readonly Zuweisung[], dump: TitelErgebnis): VorschauZahlen {
    const summe: VorschauZahlen = { ...leer(), umgeleitetBereitsVermerkt: 0, namensraumAbweichend: 0, nachArt: {} };
    for (const zuweisung of zuweisungen) {
        const art = (summe.nachArt[zuweisung.art] ??= leer());
        summe.zuweisungen += 1;
        art.zuweisungen += 1;
        const kandidaten = gesuchteTitel(zuweisung);
        if (kandidaten.length === 0) {
            summe.kennungOhneWikiAdresse += 1;
            art.kennungOhneWikiAdresse += 1;
            continue;
        }
        summe.mitAdresse += 1;
        art.mitAdresse += 1;
        let seite: GefundeneSeite | undefined;
        for (const titel of kandidaten) {
            seite = dump.gefunden.get(titel);
            if (seite !== undefined) break;
        }
        if (seite === undefined) {
            summe.nichtImDump += 1;
            art.nichtImDump += 1;
            continue;
        }
        if (seite.weiterleitung !== null) {
            summe.umgeleitet += 1;
            art.umgeleitet += 1;
            if (zuweisung.istWeiterleitung) summe.umgeleitetBereitsVermerkt += 1;
        } else {
            summe.gefunden += 1;
            art.gefunden += 1;
        }
        if (zuweisung.ns !== null && zuweisung.ns !== seite.ns) summe.namensraumAbweichend += 1;
    }
    return summe;
}

/**
 * Die Namensräume, die der Dump führt und die Tafel der Umgebung nicht kennt (ohne Angabe: die Vorgabe), mit Nummer und Zahl der Seiten: ein
 * Befund, kein Fehler.
 */
export function unbekannteNamensraeume(
    dump: TitelErgebnis,
    tafel: WikiNamespaceTafel = wikiNamespaceTafel(),
): NamensraumBefund[] {
    return [...dump.namensraeume.entries()]
        .filter(([nr]) => wikiNamespaceZeile(tafel, nr) === undefined)
        .sort(([links], [rechts]) => links - rechts)
        .map(([nr, seiten]) => ({
            code: "namensraum_unbekannt" as const,
            nr,
            name: dump.kopf?.namensraeume[nr] ?? null,
            seiten,
        }));
}
