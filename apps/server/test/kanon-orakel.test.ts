import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KANON_OBJEKTARTEN, wikiNamespaceTafel, type KanonObjektart } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { KANON_ABGELEITET_VON } from "../src/kanon/neu-berechnen.ts";
import type { KanonErgebnis } from "../src/kanon/ableitung.ts";
import {
    KANON_TRAEGER,
    kanonDesTraegers,
    ladeGespeicherteKanonZeilen,
    ladeKanonTraeger,
    type GespeicherterKanon,
    type KanonTraeger,
} from "../src/kanon/laden.ts";

/**
 * Das Orakel (WI-0253 B-2): Die Neuberechnung der Kanon-Regel gegen Legacys importierte Zeilen (`<träger>_canon`, Quelle `sources.yaml`
 * `zeilen_im_satz`). Gelesen wird die ENTWICKLUNGSDATENBANK (`DATABASE_URL`, nur lesend) mit den echten Kartendaten; ohne sie überspringt die
 * Datei, wie die anderen Dateninvarianten.
 *
 * - **Teil 1, Legacys Regelstand gegen die Zeilen:** Die Rechnung im Stand bis 2026-10-25 muss Legacys Ergebnis treffen. Jede Abweichung wird
 *   NAMENTLICH erklärt (Zeitpunkt, Adresse ohne Schlüssel, Eigenkennung, Beschriftung der Landschaft, lokal gelöste Zuweisung); was keine
 *   Klasse trifft, lässt den Test fallen. Nichts wird pauschal geduldet, die Zahlen stehen in der Ausgabe.
 * - **Teil 2, der neue Regelstand gegen den alten:** Jeder Unterschied ist eine gewollte Folge der Entscheidung vom 2026-10-25 (ohne Wiki
 *   zählen Publikationen wie Quellen, OFFIZIELL trägt die Art) und trifft nie einen Träger mit Wiki-Zuweisung.
 * - **Rang 4 bei „nein“** (die Vorgabe) ändert die Zeilen nicht: er wird beim Lesen aufgelöst; das prüft `kanon-neu-berechnen.test.ts`.
 *
 * Die Zeilen müssen aus Legacys Import stammen: Hat jemand lokal mit `npm run kanon:neu` neu berechnet (`derived_from = avesmaps_regel`), gibt
 * es kein Orakel mehr, und die Datei meldet es und überspringt.
 */

const url = process.env["DATABASE_URL"];
const describeMitDaten = url ? describe : describe.skip;

type Wirkung = string;

const wirkungVon = (
    zeile: Pick<GespeicherterKanon, "kanon" | "designatorType" | "designatorCount" | "designatorLabel"> | null,
): Wirkung =>
    zeile === null || zeile.kanon === "unlabelled"
        ? "keins"
        : `${zeile.kanon === "official" ? "OFFIZIELL" : "INOFFIZIELL"}|${zeile.designatorType ?? ""}|${zeile.designatorCount ?? ""}|${zeile.designatorLabel ?? ""}`;

const ergebnisWirkung = (ergebnis: KanonErgebnis | null): Wirkung =>
    ergebnis === null
        ? "keins"
        : wirkungVon({
              kanon: ergebnis.kanon,
              designatorType: ergebnis.designatorType,
              designatorCount: ergebnis.designatorCount,
              designatorLabel: ergebnis.designatorLabel,
          });

interface Abweichung {
    art: KanonObjektart;
    traeger: KanonTraeger;
    soll: Wirkung;
    ist: Wirkung;
}

/** Was der Klassifizierer über einen Träger zusätzlich wissen muss. */
interface Zusatz {
    /** Wann kam der Träger in die Datenbank (Import oder Anlage)? */
    stand: Date | null;
    /** Zustand der Hauptzuweisung (Tafeln `<träger>_wiki_assignment`), `null`: keine aktive. */
    zuweisungZustand: string | null;
    /** Ein Schlüssel ohne Adresse (Gebiet, Landschaft). */
    schluesselOhneAdresse: boolean;
    /** Eine Zuweisung des Trägers oder seiner Wegegruppe ist stillgelegt (Legacy-Zug oder Editor). */
    zuweisungZurueckgenommen: boolean;
}

interface Klasse {
    name: string;
    grund: string;
    trifft(abweichung: Abweichung, zusatz: Zusatz, kanonStand: Date | null): boolean;
}

const KLASSEN: readonly Klasse[] = [
    {
        name: "traeger_neuer_als_kanon_stand",
        grund:
            "Der Träger kam nach dem Import der Kanon-Tafel (Schritt Quellen, map_revision 182205) in die Datenbank; seine Zeile gibt es dort nicht. Die " +
            "Neuberechnung gibt ihm das Etikett seiner Zuweisung oder seiner Wegegruppe.",
        trifft: (a, z, kanonStand) =>
            a.soll === "keins" && z.stand !== null && kanonStand !== null && z.stand.getTime() > kanonStand.getTime(),
    },
    {
        name: "traeger_nach_dem_kanon_stand_geaendert",
        grund:
            "Der Träger wurde nach dem Import der Kanon-Zeile neu importiert und hat sich dabei geändert (etwa eine andere Wegart: der Abschnitt " +
            "gehört dann zu einer anderen Wegegruppe, die Gruppe erbt ihren Namensraum). Die Zeile kennt den neuen Stand nicht.",
        trifft: (a, z, kanonStand) =>
            a.art === "path" &&
            a.soll !== "keins" &&
            z.stand !== null &&
            kanonStand !== null &&
            z.stand.getTime() > kanonStand.getTime(),
    },
    {
        name: "adresse_ohne_schluessel",
        grund:
            "Die Zuweisung ist `address_only`, eine Wiki-Adresse ohne Schlüssel. Legacy zählt sie nicht als Zuweisung (sie lag dort nur als Adresse der " +
            "Eigenschaften, nicht im Zuweisungsnest); Avesmaps zählt jede gespeicherte Wiki-Adresse, und der Editor legt genau diesen Zustand an.",
        trifft: (a, z) => a.soll === "keins" && z.zuweisungZustand === "address_only",
    },
    {
        name: "eigenkennung_ohne_adresse",
        grund:
            "Der Träger hat nur einen Schlüssel, keine Wiki-Adresse (Eigenkennung). Legacy löste den Schlüssel über seinen Wiki-Spiegel zu einer Adresse " +
            "auf und rechnete OFFIZIELL; Vali 2026-10-25: Eine Eigenkennung ist kein Rang 1, es gelten die lokalen Daten.",
        trifft: (a, z) => a.soll !== "keins" && a.ist === "keins" && z.schluesselOhneAdresse,
    },
    {
        name: "zuweisung_zurueckgenommen",
        grund:
            "Die Zuweisung des Trägers oder seiner Wegegruppe wurde nach dem Import der Kanon-Zeile stillgelegt (ein späterer Legacy-Zug oder ein Editor); " +
            "die Zeile kennt das noch nicht, die Neuberechnung sieht die Zuweisung nicht mehr.",
        trifft: (a, z) => a.soll !== "keins" && z.zuweisungZurueckgenommen,
    },
    {
        name: "landschaft_zuweisung_an_der_beschriftung",
        grund:
            "Legacy fällt bei einer Landschaft ohne eigene Adresse auf den Namensraum ihrer gebundenen Beschriftung zurück (Owner 2026-09-10); die " +
            "Zuweisung der Beschriftung hält Avesmaps3D nicht, die Landschaft liest nur ihre eigene.",
        trifft: (a) => a.art === "area" && a.soll !== "keins" && a.soll !== a.ist,
    },
];

describeMitDaten("Das Orakel: Legacys importierte Kanon-Zeilen gegen die Neuberechnung", { timeout: 120_000 }, () => {
    let database: Database;
    let vorhanden = false;
    const tafel = wikiNamespaceTafel();
    const traegerJeArt = new Map<KanonObjektart, KanonTraeger[]>();
    const zeilenJeArt = new Map<KanonObjektart, Map<string, GespeicherterKanon>>();
    const kanonStand = new Map<KanonObjektart, Date | null>();

    beforeAll(async () => {
        database = createDatabase(url as string, { max: 2 });
        let zeilenGesamt = 0;
        let eigene = 0;
        for (const art of KANON_OBJEKTARTEN) {
            const zeilen = await ladeGespeicherteKanonZeilen(database, art);
            zeilenJeArt.set(art, zeilen);
            traegerJeArt.set(art, await ladeKanonTraeger(database, art, tafel));
            zeilenGesamt += zeilen.size;
            eigene += [...zeilen.values()].filter((zeile) => zeile.derivedFrom === KANON_ABGELEITET_VON).length;
            const [stand] = await database.unsafe<{ stand: Date | null }[]>(
                `SELECT max(imported_at) AS stand FROM ${KANON_TRAEGER[art].kanon} WHERE derived_from LIKE 'legacy%'`,
            );
            kanonStand.set(art, stand?.stand ?? null);
        }
        vorhanden = zeilenGesamt > 1000 && eigene === 0;
        if (!vorhanden) {
            console.warn(
                zeilenGesamt <= 1000
                    ? "Orakel übersprungen: Die Datenbank hat keine importierten Kanon-Zeilen (weniger als tausend)."
                    : `Orakel übersprungen: ${String(eigene)} Zeilen sind schon mit der Regel von Avesmaps berechnet (kanon:neu), es gibt kein Legacy-Orakel mehr.`,
            );
        }
    });
    afterAll(async () => {
        await database?.end({ timeout: 5 });
    });

    async function zusatzFuer(art: KanonObjektart, traeger: readonly KanonTraeger[]): Promise<Map<string, Zusatz>> {
        const ids = traeger.map((eintrag) => eintrag.id);
        const tabellen = KANON_TRAEGER[art];
        const zusatz = new Map<string, Zusatz>(
            traeger.map((eintrag) => [
                eintrag.id,
                { stand: null, zuweisungZustand: null, schluesselOhneAdresse: false, zuweisungZurueckgenommen: false },
            ]),
        );
        const staende = await database.unsafe<{ id: string; stand: Date | null }[]>(
            `SELECT id::text AS id, coalesce(imported_at, created_at) AS stand FROM ${tabellen.traeger} WHERE id = ANY($1::bigint[])`,
            [ids],
        );
        for (const zeile of staende) zusatz.get(zeile.id)!.stand = zeile.stand;
        const zuweisungsTafel = { place: "place", path: "path", peak: "terrain_peak", powerline: "powerline" } as const;
        if (art === "place" || art === "path" || art === "peak" || art === "powerline") {
            const t = `${zuweisungsTafel[art]}_wiki_assignment`;
            const fk = tabellen.fremdschluessel;
            const haupt = art === "path" ? "AND a.role = 'main'" : "";
            const zeilen = await database.unsafe<{ id: string; zustand: string; aktiv: boolean; zurueck: boolean }[]>(
                `SELECT a.${fk}::text AS id, a.assignment_state AS zustand, a.is_active AS aktiv,
                        (NOT a.is_active) AS zurueck
                   FROM ${t} a WHERE a.${fk} = ANY($1::bigint[]) ${haupt}`,
                [ids],
            );
            for (const zeile of zeilen) {
                const eintrag = zusatz.get(zeile.id)!;
                if (zeile.aktiv) eintrag.zuweisungZustand = zeile.zustand;
                if (zeile.zurueck) eintrag.zuweisungZurueckgenommen = true;
            }
        }
        if (art === "territory" || art === "area") {
            const spalte = art === "territory" ? "wiki_key" : "wiki_region_key";
            const zeilen = await database.unsafe<{ id: string }[]>(
                `SELECT id::text AS id FROM ${tabellen.traeger} WHERE id = ANY($1::bigint[]) AND ${spalte} IS NOT NULL AND wiki_url IS NULL`,
                [ids],
            );
            for (const zeile of zeilen) zusatz.get(zeile.id)!.schluesselOhneAdresse = true;
        }
        if (art === "path") {
            // Die Wegegruppe: hat irgendein Abschnitt gleichen Namens und gleicher Art eine stillgelegte Hauptzuweisung?
            const gruppen = new Set(traeger.map((eintrag) => eintrag.gruppe).filter((g): g is string => g !== null));
            const geloest = await database.unsafe<{ gruppe: string }[]>(
                `SELECT DISTINCT p.subtype || '|' || btrim(p.name) AS gruppe
                   FROM path p JOIN path_wiki_assignment a ON a.path_id = p.id AND a.role = 'main'
                  WHERE NOT a.is_active AND btrim(coalesce(p.name, '')) <> ''`,
            );
            const geloesteGruppen = new Set(geloest.map((zeile) => zeile.gruppe).filter((g) => gruppen.has(g)));
            for (const eintrag of traeger) {
                if (eintrag.gruppe !== null && geloesteGruppen.has(eintrag.gruppe))
                    zusatz.get(eintrag.id)!.zuweisungZurueckgenommen = true;
            }
        }
        return zusatz;
    }

    it("🔴 Teil 1: Legacys Regelstand trifft die importierten Zeilen; jede Abweichung hat eine benannte Klasse", async (context) => {
        if (!vorhanden) context.skip();
        const zeilenAusgabe: string[] = [];
        const ungeklaert: Abweichung[] = [];
        let gesamt = 0;
        let abweichungen = 0;
        for (const art of KANON_OBJEKTARTEN) {
            const traeger = traegerJeArt.get(art)!;
            const zeilen = zeilenJeArt.get(art)!;
            const gefunden: Abweichung[] = [];
            for (const eines of traeger) {
                gesamt += 1;
                const bisher = zeilen.get(eines.id);
                const soll = wirkungVon(bisher ?? null);
                const ist = ergebnisWirkung(kanonDesTraegers(eines, tafel, "legacy"));
                if (soll !== ist) gefunden.push({ art, traeger: eines, soll, ist });
            }
            abweichungen += gefunden.length;
            const zusatz = await zusatzFuer(
                art,
                gefunden.map((a) => a.traeger),
            );
            const jeKlasse = new Map<string, number>();
            for (const abweichung of gefunden) {
                const klasse = KLASSEN.find((k) =>
                    k.trifft(abweichung, zusatz.get(abweichung.traeger.id)!, kanonStand.get(art) ?? null),
                );
                if (klasse === undefined) ungeklaert.push(abweichung);
                else jeKlasse.set(klasse.name, (jeKlasse.get(klasse.name) ?? 0) + 1);
            }
            zeilenAusgabe.push(
                `${art.padEnd(10)} Träger ${String(traeger.length).padStart(6)}, Zeilen ${String(zeilen.size).padStart(5)}, Abweichungen ${String(gefunden.length).padStart(4)}` +
                    (jeKlasse.size === 0 ? "" : `  (${[...jeKlasse].map(([n, c]) => `${n} ${String(c)}`).join(", ")})`),
            );
        }
        console.warn(
            `\nOrakel Teil 1, Legacys Regelstand gegen die importierten Kanon-Zeilen:\n${zeilenAusgabe.join("\n")}\nInsgesamt ${String(abweichungen)} von ${String(gesamt)} Trägern weichen ab.`,
        );
        expect(
            ungeklaert
                .slice(0, 10)
                .map(
                    (a) =>
                        `${a.art} ${a.traeger.publicId}: Zeile ${a.soll}, Rechnung ${a.ist} (raum ${String(a.traeger.raum)}, Quellen ${String(a.traeger.quellen.length)})`,
                ),
            "Abweichungen ohne benannte Klasse",
        ).toEqual([]);
        // Auch die erklärten bleiben die Ausnahme: Das Orakel trifft die große Masse.
        expect(abweichungen / gesamt).toBeLessThan(0.03);
    });

    it("🔴 Teil 2: der neue Regelstand weicht vom alten nur in den gewollten Fällen ab (Vali 2026-10-25) und nie bei einer Wiki-Zuweisung", async (context) => {
        if (!vorhanden) context.skip();
        const klassen = new Map<string, number>();
        const unerwartet: string[] = [];
        for (const art of KANON_OBJEKTARTEN) {
            for (const eines of traegerJeArt.get(art)!) {
                const alt = ergebnisWirkung(kanonDesTraegers(eines, tafel, "legacy"));
                const neu = ergebnisWirkung(kanonDesTraegers(eines, tafel, "avesmaps"));
                if (alt === neu) continue;
                const hatPublikation = eines.quellen.some((quelle) => quelle.publikation);
                const entschiedenDurchWiki =
                    eines.raum !== null && kanonDesTraegers({ ...eines, quellen: [] }, tafel) !== null;
                let klasse: string | null = null;
                if (entschiedenDurchWiki) klasse = null;
                else if (alt === "keins") klasse = "nur_publikationen_bekommen_ein_etikett";
                else if (alt === "OFFIZIELL|||" && neu.startsWith("OFFIZIELL|") && !hatPublikation)
                    klasse = "offiziell_traegt_die_art";
                else if (hatPublikation) klasse = "publikation_aendert_das_etikett";
                if (klasse === null) unerwartet.push(`${art} ${eines.publicId}: ${alt} -> ${neu}`);
                else klassen.set(klasse, (klassen.get(klasse) ?? 0) + 1);
            }
        }
        console.warn(
            `\nOrakel Teil 2, gewollte Abweichungen des neuen Regelstands: ${[...klassen].map(([n, c]) => `${n} ${String(c)}`).join(", ") || "keine"}`,
        );
        expect(unerwartet.slice(0, 10)).toEqual([]);
    });
});

export { KLASSEN };
