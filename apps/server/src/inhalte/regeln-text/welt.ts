import {
    INHALTE_VORKOMMEN_ARTEN,
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_RICHTUNGEN,
    WIKISYNC_LANDSCHAFTSARTEN,
    isLandscapeHandle,
    type InhalteVorkommenArt,
    type InhalteVorkommenBedingung,
    type InhalteVorkommenBeziehung,
    type WikisyncLageRichtung,
} from "@avesmaps3d/shared";
import { norm, kurz } from "./hilfen.ts";
import {
    ARTEN_NAMEN,
    BEZIEHUNGS_NAMEN,
    EBENEN_NAMEN,
    KATEGORIE_NAMEN,
    ORTSARTEN_NAMEN,
    RICHTUNG_NAMEN,
    ZONEN_NAMEN,
} from "./namen.ts";
import { eintragsSchluessel, schluesselAusVertrag } from "./schluessel.ts";

/**
 * Die Welt des Lesers „Regeln als Text“ (WI-0254 §13; Port von `txBaueWelt` im Entwurf): alles, was `lies` nachschlägt (Flächen, Orte, Einträge, Quellen, die Regeln, die es schon gibt) und die festen Wortlisten
 * (Landschaftsarten, Klimazonen, Richtungen, Beziehungen, Kategorien) mit ihren Anzeigenamen. `baueWelt` ist rein; `ladeWelt` (`laden.ts`) liest die Daten aus der Datenbank.
 */

/** Eine Fläche: aktive Landschaft außerhalb der Klima-Ebene; oder (`nurKennung`) eine, die vorhandene Regeln nennen und der Katalog nicht führt (stillgelegt, ohne Namen): nur zum Lesen von `[[#Kennung|Name]]`. */
export interface WeltFlaeche {
    id: string;
    name: string;
    ebene: string;
    art: string;
    aktiv: boolean;
    wikiTitel: string;
    nurKennung?: boolean;
}
/** Eine Siedlung (`WIKISYNC_LAGE_ORTSARTEN`) der Karte. */
export interface WeltOrt {
    id: string;
    name: string;
    art: string;
    x: number;
    y: number;
}
/** Ein aktiver Eintrag; `titel` der Wiki-Titel (leer, wo es keinen gibt). */
export interface WeltEintrag {
    id: string;
    name: string;
    kind: InhalteVorkommenArt;
    titel: string;
    wikiKey: string | null;
}
export interface WeltQuelle {
    id: string;
    titel: string;
    typ: string;
}
/** Eine aktive Regel eines Eintrags: ihr gespeicherter Fingerabdruck und die Kette im Lesemodell. */
export interface WeltRegel {
    relation: string;
    ruleKey: string;
    bedingungen: InhalteVorkommenBedingung[];
}

/** Was `ladeWelt` liefert und `baueWelt` braucht. */
export interface WeltDaten {
    flaechen: readonly WeltFlaeche[];
    orte: readonly WeltOrt[];
    eintraege: readonly WeltEintrag[];
    quellen: readonly WeltQuelle[];
    /** Die aktiven Regeln je Eintrag (`lore_entry.public_id`). */
    regeln: ReadonlyMap<string, readonly WeltRegel[]>;
    /** Die Quellen, die ein Eintrag aktiv nennt (`feature_source.public_id`). */
    eintragsQuellen: ReadonlyMap<string, ReadonlySet<string>>;
    /** Die Titel, auf die ein Eintrag schon wartet (Schlüssel `titelNorm`, Wert der Titel, wie er gespeichert ist): aus seinen Regeln und dem Vorschlag des WikiSync. */
    wartendeTitel: ReadonlyMap<string, ReadonlyMap<string, string>>;
    /** Die Wiki-Titel (`titelNorm`), die inzwischen eine aktive Fläche trägt: Auf sie wartet keine Regel mehr. */
    titelMitFlaeche: ReadonlySet<string>;
}

export interface ArtEintrag {
    ebene: string;
    art: string;
    name: string;
    norm: string;
}
export interface Benannt<K extends string> {
    key: K;
    name: string;
    norm: string;
}

const sammle = <T>(karte: Map<string, T[]>, k: string, wert: T): void => {
    const liste = karte.get(k);
    if (liste === undefined) karte.set(k, [wert]);
    else liste.push(wert);
};

export interface Welt {
    artName(art: string): string;
    zoneName(zone: string): string;
    ebeneName(ebene: string): string;
    kategorieName(kind: string): string;
    beziehungName(beziehung: string): string;
    richtungName(richtung: string): string;
    ortsartName(art: string): string;
    zonenIndex: ReadonlyMap<string, number>;
    /** Anzeigename, Schlüssel und Schlüssel mit Leerzeichen (alle `kurz`) → Landschaftsart. */
    arten: ReadonlyMap<string, ArtEintrag>;
    artenListe: readonly ArtEintrag[];
    zonen: ReadonlyMap<string, string>;
    zonenListe: readonly Benannt<string>[];
    richtungen: ReadonlyMap<string, WikisyncLageRichtung>;
    richtungenListe: readonly Benannt<WikisyncLageRichtung>[];
    beziehungen: ReadonlyMap<string, InhalteVorkommenBeziehung>;
    beziehungenListe: readonly Benannt<InhalteVorkommenBeziehung>[];
    kategorien: ReadonlyMap<string, InhalteVorkommenArt>;
    kategorienListe: readonly Benannt<InhalteVorkommenArt>[];
    flaechen: readonly WeltFlaeche[];
    flaecheNachId: ReadonlyMap<string, WeltFlaeche>;
    flaechenNamen: readonly { norm: string; name: string }[];
    flaechenTitel: readonly { norm: string; name: string }[];
    /** Flächen zum Ziel eines Links: zuerst der Wiki-Titel, dann der Name. */
    flaechenZu(ziel: string): readonly WeltFlaeche[];
    orte: ReadonlyMap<string, WeltOrt>;
    orteNachName: ReadonlyMap<string, readonly WeltOrt[]>;
    orteNamen: readonly { norm: string; name: string }[];
    eintraege: readonly WeltEintrag[];
    eintragNachId: ReadonlyMap<string, WeltEintrag>;
    eintraegeNachName: ReadonlyMap<string, readonly WeltEintrag[]>;
    eintragNamen: readonly { norm: string; name: string; eintraege: readonly WeltEintrag[] }[];
    quellen: readonly WeltQuelle[];
    quellenNachTitel: ReadonlyMap<string, readonly WeltQuelle[]>;
    quellenNamen: readonly { norm: string; titel: string; quellen: readonly WeltQuelle[] }[];
    /** Die aktiven Regeln eines Eintrags (leer, wo es keine gibt). */
    regelnVon(eintragId: string): readonly WeltRegel[];
    /** Die Fingerabdrücke der aktiven Regeln eines Eintrags: die gespeicherten UND die aus der Kette neu gerechneten (eine Regel aus Legacy trägt mitunter den Fingerabdruck einer anderen Fläche-Kennung). */
    bestehendeSchluessel(eintrag: WeltEintrag): ReadonlySet<string>;
    /** Die Kennungen der Flächen (klein), die die aktiven Regeln des Eintrags nennen: nur sie lassen sich stillgelegt über `[[#Kennung|Name]]` lesen. */
    kennungenDerRegeln(eintragId: string): ReadonlySet<string>;
    hatQuelle(eintragId: string, quelleId: string): boolean;
    wartendeTitel(eintragId: string): ReadonlyMap<string, string>;
    titelMitFlaeche: ReadonlySet<string>;
}

/** Die Welt aus den Daten. Rein. */
export function baueWelt(daten: WeltDaten): Welt {
    const nameVon = (tafel: Readonly<Record<string, string>>) => (k: string) => tafel[k] ?? k;
    const artName = nameVon(ARTEN_NAMEN);
    const zoneName = nameVon(ZONEN_NAMEN);
    const ebeneName = nameVon(EBENEN_NAMEN);
    const kategorieName = nameVon(KATEGORIE_NAMEN);
    const beziehungName = nameVon(BEZIEHUNGS_NAMEN);
    const richtungName = nameVon(RICHTUNG_NAMEN);
    const ortsartName = nameVon(ORTSARTEN_NAMEN);

    const zonenIndex = new Map<string, number>(WIKISYNC_KLIMAZONEN.map((z, i) => [z, i]));

    // feste Wortlisten: Anzeigename und Schlüssel
    const arten = new Map<string, ArtEintrag>();
    const artenListe: ArtEintrag[] = [];
    for (const { ebene, art } of WIKISYNC_LANDSCHAFTSARTEN) {
        const eine: ArtEintrag = { ebene, art, name: artName(art), norm: norm(artName(art)) };
        artenListe.push(eine);
        for (const s of [eine.name, art, art.replaceAll("_", " ")]) arten.set(kurz(s), eine);
    }
    const zonen = new Map<string, string>();
    const zonenListe: Benannt<string>[] = [];
    for (const z of WIKISYNC_KLIMAZONEN) {
        const name = zoneName(z);
        // zum Vorschlagen auch die kurzen Formen („boreal“, „Boreale“, „subtropen winterfeucht“) als eigene Kandidaten
        for (const k of new Set([norm(name), norm(name.replace(/ Zone$/u, "")), norm(z.replaceAll("_", " "))])) {
            zonenListe.push({ key: z, name, norm: k });
        }
        for (const s of [name, name.replace(/ Zone$/u, ""), z, z.replaceAll("_", " ")]) zonen.set(kurz(s), z);
    }
    const richtungen = new Map<string, WikisyncLageRichtung>(
        WIKISYNC_LAGE_RICHTUNGEN.flatMap((r) => [[kurz(richtungName(r)), r] as const, [kurz(r), r] as const]),
    );
    const richtungenListe: Benannt<WikisyncLageRichtung>[] = WIKISYNC_LAGE_RICHTUNGEN.map((r) => ({
        key: r,
        name: richtungName(r),
        norm: norm(richtungName(r)),
    }));
    const beziehungen = new Map<string, InhalteVorkommenBeziehung>(
        INHALTE_VORKOMMEN_BEZIEHUNGEN.flatMap((b) => [[kurz(beziehungName(b)), b] as const, [kurz(b), b] as const]),
    );
    const beziehungenListe: Benannt<InhalteVorkommenBeziehung>[] = INHALTE_VORKOMMEN_BEZIEHUNGEN.map((b) => ({
        key: b,
        name: beziehungName(b),
        norm: norm(beziehungName(b)),
    }));
    const kategorien = new Map<string, InhalteVorkommenArt>(
        INHALTE_VORKOMMEN_ARTEN.flatMap((k) => [[kurz(kategorieName(k)), k] as const, [kurz(k), k] as const]),
    );
    // in der Folge der Notation: Flora, Fauna, Waren, Spezies
    const kategorienListe: Benannt<InhalteVorkommenArt>[] = (["flora", "fauna", "ware", "spezies"] as const).map(
        (k) => ({ key: k, name: kategorieName(k), norm: norm(kategorieName(k)) }),
    );

    // Flächen: aktiv und nicht Klima (Herrschaftsgebiete sind keine Flächen einer Regel); die Namen eines automatischen Griffs („Wald-925“) sind kein Name.
    const flaechen = [...daten.flaechen];
    const flaecheNachId = new Map(flaechen.map((f) => [f.id, f]));
    const flaechenNachName = new Map<string, WeltFlaeche[]>();
    const flaechenNachTitel = new Map<string, WeltFlaeche[]>();
    for (const f of flaechen) {
        if (!f.aktiv || f.nurKennung === true) continue;
        if (!isLandscapeHandle(f.name, f.art)) sammle(flaechenNachName, norm(f.name), f);
        if (f.wikiTitel !== "") sammle(flaechenNachTitel, norm(f.wikiTitel), f);
    }
    const flaechenNamen = [...flaechenNachName].map(([n, liste]) => ({ norm: n, name: liste[0]!.name }));
    const flaechenTitel = [...flaechenNachTitel].map(([n, liste]) => ({ norm: n, name: liste[0]!.wikiTitel }));
    const flaechenZu = (ziel: string): readonly WeltFlaeche[] =>
        flaechenNachTitel.get(norm(ziel)) ?? flaechenNachName.get(norm(ziel)) ?? [];

    // Orte: nur Siedlungen
    const orte = new Map(daten.orte.map((o) => [o.id, o]));
    const orteNachName = new Map<string, WeltOrt[]>();
    for (const o of daten.orte) sammle(orteNachName, norm(o.name), o);
    const orteNamen = [...orteNachName].map(([n, liste]) => ({ norm: n, name: liste[0]!.name }));

    // Einträge
    const eintragNachId = new Map(daten.eintraege.map((e) => [e.id, e]));
    const eintraegeNachName = new Map<string, WeltEintrag[]>();
    for (const e of daten.eintraege) sammle(eintraegeNachName, norm(e.name), e);
    const eintragNamen = [...eintraegeNachName].map(([n, liste]) => ({
        norm: n,
        name: liste[0]!.name,
        eintraege: liste as readonly WeltEintrag[],
    }));

    // Quellenkatalog
    const quellenNachTitel = new Map<string, WeltQuelle[]>();
    for (const q of daten.quellen) sammle(quellenNachTitel, norm(q.titel), q);
    const quellenNamen = [...quellenNachTitel].map(([n, liste]) => ({
        norm: n,
        titel: liste[0]!.titel,
        quellen: liste as readonly WeltQuelle[],
    }));

    const leer: readonly WeltRegel[] = [];
    const schluesselMerker = new Map<string, ReadonlySet<string>>();
    const kennungMerker = new Map<string, ReadonlySet<string>>();
    return {
        artName,
        zoneName,
        ebeneName,
        kategorieName,
        beziehungName,
        richtungName,
        ortsartName,
        zonenIndex,
        arten,
        artenListe,
        zonen,
        zonenListe,
        richtungen,
        richtungenListe,
        beziehungen,
        beziehungenListe,
        kategorien,
        kategorienListe,
        flaechen,
        flaecheNachId,
        flaechenNamen,
        flaechenTitel,
        flaechenZu,
        orte,
        orteNachName,
        orteNamen,
        eintraege: daten.eintraege,
        eintragNachId,
        eintraegeNachName,
        eintragNamen,
        quellen: daten.quellen,
        quellenNachTitel,
        quellenNamen,
        regelnVon: (id) => daten.regeln.get(id) ?? leer,
        bestehendeSchluessel(eintrag) {
            let schluessel = schluesselMerker.get(eintrag.id);
            if (schluessel === undefined) {
                const key = eintragsSchluessel(eintrag);
                const menge = new Set<string>();
                for (const regel of daten.regeln.get(eintrag.id) ?? leer) {
                    menge.add(regel.ruleKey);
                    menge.add(schluesselAusVertrag(key, regel.relation, regel.bedingungen));
                }
                schluessel = menge;
                schluesselMerker.set(eintrag.id, menge);
            }
            return schluessel;
        },
        kennungenDerRegeln(id) {
            let kennungen = kennungMerker.get(id);
            if (kennungen === undefined) {
                kennungen = new Set(
                    (daten.regeln.get(id) ?? leer).flatMap((r) =>
                        r.bedingungen.flatMap((b) =>
                            b.flaeche === undefined ? [] : [b.flaeche.kennung.toLowerCase()],
                        ),
                    ),
                );
                kennungMerker.set(id, kennungen);
            }
            return kennungen;
        },
        hatQuelle: (eintragId, quelleId) => daten.eintragsQuellen.get(eintragId)?.has(quelleId) ?? false,
        wartendeTitel: (eintragId) => daten.wartendeTitel.get(eintragId) ?? new Map<string, string>(),
        titelMitFlaeche: daten.titelMitFlaeche,
    };
}
