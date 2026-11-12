/**
 * Misst die Ableitung der Regelvorschläge (WI-0253 Scheibe Regelvorschläge, §24) am echten Wiki-Dump und gegen die Ergebnisse der Regelbuch-Analyse. NUR LESEND: kein Datenbankzugriff, kein Abruf
 * beim Wiki, nichts wird geschrieben (die Zahlen gehen auf die Standardausgabe).
 *
 *     node scripts/dev/regeln-messen-cli.ts [--dump <Datei.xml|.bz2>] [--flaechen <legacy-list-regions.json>] [--referenz <bewertung.json>] [--beispiele <n>]
 *
 * - Der Dump liefert die Artikel der vier Vorkommen-Infoboxen und die Auskunft über die Linkziele (wie die Vorschau, `wiki/dump/seiten-sammler.ts`).
 * - Die Flächen sind die des Legacy-Abzugs (`legacy-list-regions.json`, wie nach 3D migriert), über ihren Wiki-Schlüssel; die Analyse rechnete mit demselben Abzug.
 * - `--referenz`: die `bewertung.json` der Analyse (`C:/avesmaps3d-data/scratch/regelbuch/`, Stufen `K` und, mit `bewertung.py` um `{ohne, katalog}` erweitert, `KF`). Dann steht je Stufe, wie viele
 *   Einträge denselben Status haben wie in der Analyse, und die ersten Abweichungen mit Titel.
 *
 * Drei Läufe: (1) Stufe K der Analyse nachgestellt (nur `ohne`, mehrdeutige Wörter mit allen Kandidaten): die Gleichheit mit der Analyse; (2) Stufe KF (dazu die offene Bedingung, F4): wie das Produkt
 * mit Kandidaten; (3) das Produkt: Startwerte der Begriffstafel, mehrdeutige Wörter ohne Pille (F5). Der Unterschied von (2) zu (3) sind genau die mehrdeutigen Wörter.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { wikiNamespaceTafel } from "@avesmaps3d/shared";
import { Begriffstafel, BEGRIFFE_VORGABE } from "../../apps/server/src/wiki/regeln/begriffe.ts";
import { leiteAb } from "../../apps/server/src/wiki/regeln/ableiten.ts";
import { RegelSammler } from "../../apps/server/src/wiki/regeln/vorschlag.ts";
import type { Flaeche, RegelWissen } from "../../apps/server/src/wiki/regeln/lesen.ts";
import { sammleSeiten } from "../../apps/server/src/wiki/dump/seiten-sammler.ts";
import { analysiere } from "../../apps/server/src/wiki/infobox/seite.ts";
import { leseVorkommen } from "../../apps/server/src/wiki/infobox/vorkommen.ts";
import { aufgeloesterTitel, normTitel, type ZielWissen } from "../../apps/server/src/wiki/abgleich/ortsrolle.ts";

const { values } = parseArgs({
    options: {
        dump: { type: "string", default: "C:/avesmaps3d-data/uploads/dumps/dewa_dump_small.xml" },
        flaechen: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/aktuell/legacy-list-regions.json" },
        referenz: { type: "string" },
        beispiele: { type: "string", default: "12" },
        zeige: { type: "string", multiple: true },
    },
});

interface LegacyRegion {
    public_id: string;
    name?: string;
    kind?: string;
    wiki_region_key?: string | null;
}

/** Legacys Schlüssel des Wiki-Titels (Umlaute fallen weg), wie `wiki_slug` der Analyse. */
const wikiSlug = (titel: string): string =>
    titel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-+|-+$/gu, "");

function baueFlaechen(pfad: string): { nachSchluessel: Map<string, Flaeche[]>; nachName: Map<string, Flaeche[]> } {
    const daten = JSON.parse(readFileSync(pfad, "utf8")) as { regions: LegacyRegion[] };
    const nachSchluessel = new Map<string, Flaeche[]>();
    const nachName = new Map<string, Flaeche[]>();
    for (const region of daten.regions) {
        if (region.kind === "klima") continue;
        const flaeche: Flaeche = {
            id: region.public_id,
            kennung: region.public_id,
            name: region.name ?? "",
            titel: null,
        };
        if (region.wiki_region_key) {
            const liste = nachSchluessel.get(region.wiki_region_key) ?? [];
            liste.push(flaeche);
            nachSchluessel.set(region.wiki_region_key, liste);
        }
        const name = (region.name ?? "").trim();
        if (name !== "" && !/-\d+$/u.test(name) && name.length >= 4) {
            const liste = nachName.get(name.toLowerCase()) ?? [];
            liste.push(flaeche);
            nachName.set(name.toLowerCase(), liste);
        }
    }
    return { nachSchluessel, nachName };
}

const START = Date.now();
const log = (text: string): void => console.log(`[${((Date.now() - START) / 1000).toFixed(1)} s] ${text}`);

log("Dump lesen (1/2: Auskunft über Linkziele und Artikel) …");
const tafel = wikiNamespaceTafel();
const erster = await sammleSeiten(values.dump as string, new Set(), tafel, { vorkommen: true });
if (!erster.vollstaendig) throw new Error("Der Dump ist abgeschnitten");
const kandidaten = erster.kandidaten.filter((kandidat) => kandidat.art === "vorkommen");
log(
    `${String(erster.seiten)} Seiten, ${String(kandidaten.length)} Artikel mit einer Vorkommen-Infobox, ${String(erster.ziele?.size ?? 0)} Auskünfte`,
);
log("Dump lesen (2/2: die Texte der Artikel) …");
const zweiter = await sammleSeiten(
    values.dump as string,
    new Set(kandidaten.map((kandidat) => kandidat.titel)),
    tafel,
    {},
);
const ziele = erster.ziele ?? new Map();

const katalog = baueFlaechen(values.flaechen as string);
const zielWissen = (): ZielWissen => ({
    info: (titel) => ziele.get(titel),
    istFlaeche: (titel) => (katalog.nachSchluessel.get(wikiSlug(titel))?.length ?? 0) > 0,
});
const wissenMit = (tafelDerStufe: Begriffstafel): RegelWissen => {
    const basis = zielWissen();
    return {
        ...basis,
        flaechen: (titel) => katalog.nachSchluessel.get(wikiSlug(aufgeloesterTitel(normTitel(titel), basis))) ?? [],
        flaechenNamen: () => katalog.nachName,
        tafel: tafelDerStufe,
    };
};

interface Eintrag {
    titel: string;
    art: string;
    felder: Record<string, string>;
}
const eintraege: Eintrag[] = [];
for (const kandidat of kandidaten) {
    const seite = zweiter.gefunden.get(kandidat.titel)?.[0];
    if (seite === undefined || seite.weiterleitung !== null) continue;
    const gelesen = leseVorkommen(analysiere(seite.titel, seite.text));
    if (!gelesen.ok) continue;
    eintraege.push({ titel: seite.titel, art: gelesen.art, felder: { ...gelesen.felder } });
}
log(`${String(eintraege.length)} Einträge gelesen`);

// Die Tafel der Stufen: mehrdeutige Wörter mit ihren Kandidaten (wie die Analyse sie las) oder leer (Produkt).
const mitKandidaten = new Map<string, readonly string[]>();
for (const [wort, eintrag] of BEGRIFFE_VORGABE)
    if (eintrag.lage === "offen" && eintrag.kandidaten !== undefined) mitKandidaten.set(wort, eintrag.kandidaten);

type Zaehler = Record<string, number>;
const ARTEN = ["fauna", "flora", "spezies", "ware"] as const;

function lauf(
    name: string,
    f: ReadonlySet<string>,
    abweichungen: ReadonlyMap<string, readonly string[]>,
): Map<string, { status: string; modus: string }> {
    const wissen = wissenMit(new Begriffstafel(abweichungen));
    const ergebnis = new Map<string, { status: string; modus: string }>();
    const zahlen = new Map<string, Zaehler>();
    let mitBedingungen = 0;
    let mitOhne = 0;
    let offen = 0;
    let beginn = Date.now();
    for (const eintrag of eintraege) {
        const ableitung = leiteAb({ art: eintrag.art, felder: eintrag.felder }, wissen, f);
        const b = ableitung.bewertung;
        ergebnis.set(eintrag.titel, { status: b.status, modus: b.modus });
        const schluessel = b.status === "voll" ? `voll_${b.modus}` : b.status;
        for (const art of [eintrag.art, "gesamt"]) {
            const z = zahlen.get(art) ?? {};
            z[schluessel] = (z[schluessel] ?? 0) + 1;
            zahlen.set(art, z);
        }
        const bedingungen = ableitung.beziehungen.flatMap((x) => x.bedingungen);
        if (bedingungen.length > 0) mitBedingungen += 1;
        if (bedingungen.some((x) => x.verknuepfung === "ohne")) mitOhne += 1;
        if (bedingungen.some((x) => x.flaeche?.offen === true)) offen += 1;
    }
    beginn = Date.now() - beginn;
    console.log(
        `\n== ${name}  (${String(beginn)} ms)  Einträge mit Bedingungen ${String(mitBedingungen)}, davon mit \`ohne\` ${String(mitOhne)}, mit offener Fläche ${String(offen)}`,
    );
    for (const art of [...ARTEN, "gesamt"]) {
        const z = zahlen.get(art) ?? {};
        console.log(
            `   ${art.padEnd(8)} ${JSON.stringify(Object.fromEntries(Object.entries(z).sort(([a], [b]) => (a < b ? -1 : 1))))}`,
        );
    }
    return ergebnis;
}

const K = new Set(["ohne"]);
const KF = new Set(["ohne", "katalog"]);
const laufK = lauf("Stufe K nachgestellt (nur `ohne`, mehrdeutige Wörter mit Kandidaten)", K, mitKandidaten);
const laufKF = lauf("Stufe KF (dazu die offene Fläche, F4; mehrdeutige mit Kandidaten)", KF, mitKandidaten);
const laufProdukt = lauf("Produkt (`ohne` und offene Fläche; mehrdeutige Wörter starten leer, F5)", KF, new Map());

// Die Vorschläge des Produkts: ohne vorhandene Regeln, wie der erste Lauf auf einer Umgebung ohne abgeleitete Regel.
{
    const wissen = wissenMit(new Begriffstafel(new Map()));
    const sammler = new RegelSammler();
    for (const eintrag of eintraege) {
        sammler.fuegeHinzu(
            { art: eintrag.art, felder: eintrag.felder },
            wissen,
            {
                id: "00000000-0000-4000-8000-000000000000",
                name: eintrag.titel,
                art: eintrag.art,
                redaktion: false,
                bestand: { wikiKey: eintrag.titel, regeln: [] },
            },
            eintrag.titel,
        );
    }
    const zaehle = (schluessel: (v: (typeof sammler.vorschlaege)[number]) => string): string => {
        const z: Record<string, number> = {};
        for (const v of sammler.vorschlaege) z[schluessel(v)] = (z[schluessel(v)] ?? 0) + 1;
        return JSON.stringify(Object.fromEntries(Object.entries(z).sort(([a], [b]) => (a < b ? -1 : 1))));
    };
    const groesse = sammler.vorschlaege.reduce(
        (summe, v) => summe + JSON.stringify({ original: v.original, regeln: v.regeln }).length,
        0,
    );
    console.log(`
== Vorschläge des Produkts: ${String(sammler.vorschlaege.length)} (Nutzlast ${(groesse / 1e6).toFixed(1)} MB), vorgewählt ${String(sammler.vorschlaege.filter((v) => v.vorgewaehlt).length)}, wählbar ${String(sammler.vorschlaege.filter((v) => v.waehlbar).length)}, wartend ${String(sammler.vorschlaege.filter((v) => v.wartet).length)}`);
    console.log(`   Art:    ${zaehle((v) => v.art)}`);
    console.log(`   Typ:    ${zaehle((v) => v.typ)}`);
    console.log(`   Status: ${zaehle((v) => v.status)}`);
    console.log(`   Sperre: ${zaehle((v) => v.sperre ?? "-")}`);
    console.log(`   Zahlen: ${JSON.stringify(sammler.zahlen)}`);
    const woerter = [...sammler.woerter];
    const ohneTafel = woerter.filter(([, w]) => !w.tafel);
    console.log(
        `   Wörter: ${String(woerter.length)}, davon ohne Tafel ${String(ohneTafel.length)} (Nennungen ${String(ohneTafel.reduce((a, [, w]) => a + w.n, 0))}); mit mindestens 2 Nennungen ${String(ohneTafel.filter(([, w]) => w.n >= 2).length)}`,
    );
    console.log(
        `   häufigste Wörter ohne Tafel: ${ohneTafel
            .sort((a, b) => b[1].n - a[1].n)
            .slice(0, 40)
            .map(([wort, w]) => `${wort} ${String(w.n)}`)
            .join(", ")}`,
    );
}

if (values.referenz !== undefined) {
    const referenz = JSON.parse(readFileSync(values.referenz, "utf8")) as {
        stufen: Record<string, { status: string; modus: string }[]>;
        titel: string[];
    };
    const vergleiche: [string, string, Map<string, { status: string; modus: string }>][] = [
        ["K", "K", laufK],
        ["KF", "KF", laufKF],
        ["KF", "Produkt gegen KF", laufProdukt],
    ];
    for (const [stufe, name, ergebnis] of vergleiche) {
        const soll = referenz.stufen[stufe];
        if (soll === undefined) {
            console.log(`\n(keine Stufe ${stufe} in der Referenz)`);
            continue;
        }
        let gleich = 0;
        let gleichMitModus = 0;
        const abweichungen: string[] = [];
        const uebergaenge = new Map<string, number>();
        referenz.titel.forEach((titel, index) => {
            const s = soll[index];
            const ist = ergebnis.get(titel);
            if (s === undefined || ist === undefined) return;
            const sollStatus = s.status.split(":")[0] as string;
            if (sollStatus === ist.status) {
                gleich += 1;
                if (s.modus === ist.modus) gleichMitModus += 1;
            } else {
                const schluessel = `${sollStatus} -> ${ist.status}`;
                uebergaenge.set(schluessel, (uebergaenge.get(schluessel) ?? 0) + 1);
                if (abweichungen.length < Number(values.beispiele))
                    abweichungen.push(`${titel}: Analyse ${sollStatus}, hier ${ist.status}`);
            }
        });
        console.log(
            `\n== Vergleich ${name}: ${String(gleich)} von ${String(referenz.titel.length)} Einträgen mit gleichem Status (davon ${String(gleichMitModus)} auch mit gleichem Modus)`,
        );
        for (const [uebergang, n] of [...uebergaenge].sort((a, b) => b[1] - a[1]))
            console.log(`   ${uebergang}: ${String(n)}`);
        for (const zeile of abweichungen) console.log(`   · ${zeile}`);
    }
}
for (const titel of values.zeige ?? []) {
    const eintrag = eintraege.find((kandidat) => kandidat.titel === titel);
    if (eintrag === undefined) {
        console.log(`
(${titel}: kein solcher Eintrag)`);
        continue;
    }
    const ableitung = leiteAb(
        { art: eintrag.art, felder: eintrag.felder },
        wissenMit(new Begriffstafel(new Map())),
        KF,
    );
    console.log(`
== ${titel} (${eintrag.art})`);
    for (const feld of ["roh_verbreitung", "roh_herkunft", "roh_regionen", "roh_vorkommen"])
        if (eintrag.felder[feld] !== undefined) console.log(`   ${feld}: ${eintrag.felder[feld]}`);
    console.log(`   Status ${ableitung.bewertung.status}/${ableitung.bewertung.modus}`);
    for (const [beziehung, liste] of ableitung.bewertung.felder)
        for (const { eintrag: gl, urteil } of liste)
            console.log(
                `   Glied [${beziehung}] "${gl.glied.text}" -> ${urteil.res} ${urteil.gruende.join(",")} | ${gl.bausteine.map((b) => b.art + ":" + b.wert).join(" ; ")}`,
            );
    console.log(
        `   Lebensraum ${ableitung.bewertung.lebensraum.res} ${ableitung.bewertung.lebensraum.gruende.join(",")}`,
    );
    for (const b of ableitung.beziehungen) {
        console.log(`   Regel ${b.beziehung}:`);
        for (const x of b.bedingungen)
            console.log(
                `     ${x.verknuepfung} ${x.flaeche === null ? "(überall)" : x.flaeche.name + (x.flaeche.offen ? "!" : "")} [${x.arten.map((a) => a.art).join("|")}] ${x.klima === null ? "" : x.klima.von + "-" + x.klima.bis} ${x.rueckfragen.join(",")}`,
            );
        for (const t of b.teile) console.log(`     Teil: "${t.text}" -> ${t.grund}`);
    }
}
log("fertig");
