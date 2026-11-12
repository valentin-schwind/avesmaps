import { onScopeDispose, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type {
    InhalteQuellenZeile,
    InhalteVorkommen,
    InhalteVorkommenAendernBody,
    InhalteVorkommenArt,
    InhalteVorkommenBeziehung,
    InhalteVorkommenFlaeche,
    InhalteVorkommenLageOrt,
    InhalteVorkommenListe,
    InhalteVorkommenSortierung,
    InhalteVorkommenUmriss,
    InhalteVorkommenZeile,
    InhalteVorkommenZiel,
} from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import { createTextSuche } from "../fenster/text-suche";
import type { InhalteClient } from "./inhalte-client";
import { createKatalog, type Katalog, type KatalogAdapter } from "./inhalte-katalog-steuerung";
import {
    aendereQuelle,
    entwurfAlsKoerper,
    haengeNamenAn,
    haengeOrtAn,
    haengeQuelleAn,
    loeseOrt,
    loeseQuelle,
    setzeFeld,
    standAusVorkommen,
    stelleOrtWiederHer,
    stelleQuelleWiederHer,
    zaehleAenderungen,
    type EntwurfQuelle,
    type QuelleZumAnhaengen,
    type Unterreiter,
    type VorkommenFelder,
    type VorkommenStand,
} from "./inhalte-vorkommen-modell";
import {
    loescheRegel,
    regelAenderungSchluessel,
    regelAenderungen,
    regelAusEditor,
    stelleWikiHer,
    uebernimmVorschlag,
    uebertrageRegeln,
    type EntwurfRegel,
    type RegelEingabe,
} from "./inhalte-vorkommen-regeln-modell";

/**
 * Der Zustand des Reiters „Vorkommen“ im Fenster „Inhalte bearbeiten“ (WI-0254, Runde 3): der gemeinsame Kern der Reiter (`inhalte-katalog-
 * steuerung.ts`) mit dem, was nur die Vorkommen wissen: der Unterreiter der Liste (Alle, Fauna, Flora, Waren, Spezies), die Rechnung am Entwurf
 * (`inhalte-vorkommen-modell.ts`, ohne Vue, von Vitest geprüft), die Suche nach Zielen einer Ortszeile (Kartenobjekte MIT Wiki-Schlüssel und
 * Kontinentbegriffe) und die Suche nach Quellen des Katalogs.
 *
 * - 🔴 **Ein Entwurf gehört zu EINEM Eintrag**; wer einen anderen wählt, während der Entwurf Änderungen trägt, bekommt die Frage.
 * - **Einen Eintrag legt dieser Reiter nicht an** (die Identität ist der Wiki-Schlüssel; Betreiber-Gate WI-0254 §10). `✚ Neu` steht gesperrt da.
 * - **Konflikt (409):** „eigene Änderungen anwenden“ legt die Felder, die Ortszeilen, die Quellen und die Regeln auf den fremden Stand; was beide Seiten an
 *   derselben Zeile geändert haben, gilt als Überschneidung. Eine Regel steht dabei unter `regel:<id>` (die Regel des Servers, die eine Änderung trifft).
 * - **Regeln** (Regeleditor, WI-0254 `--weiter`): Der Editor gibt seine Eingabe an `uebernimmRegel`, ein Vorschlag des Wikis wird übernommen, eine Regel gelöscht oder auf die Wiki-Fassung zurückgeholt;
 *   alles wirkt im Entwurf und erst mit „Speichern“. Die Suche nach Flächen für eine Bedingung ist wie die nach Zielen eine entprellte Suche ab zwei Zeichen.
 * - **Die Lage zu einer Linie** braucht zwei Dinge vom Server: die Ortssuche (entprellt, aber schon ohne Text: Dann stehen die Metropolen und Großstädte da) und den Umriss Aventuriens für die Skizze. Den Umriss
 *   holt der erste Aufruf von `ladeUmriss` EINMAL (er ändert sich nur mit der Karte); fehlt er oder scheitert die Anfrage, bleibt `umriss` leer, die Felder zeigen keine Skizze, und der nächste Aufruf versucht es wieder.
 */

type VorkommenKatalog = Katalog<
    InhalteVorkommen,
    InhalteVorkommenZeile,
    InhalteVorkommenListe,
    InhalteVorkommenSortierung,
    VorkommenStand
>;

export interface VorkommenSteuerung extends Omit<
    VorkommenKatalog,
    "legeAn" | "dokument" | "dokumentLaedt" | "dokumentFehler" | "jetzt" | "schritt"
> {
    /** Einen Eintrag OHNE Wiki-Artikel anlegen (Vali wählte B am Gate): Name und Art, alles Weitere folgt im Entwurf. */
    legeAn(name: string, art: InhalteVorkommenArt): Promise<void>;
    readonly eintrag: VorkommenKatalog["dokument"];
    readonly eintragLaedt: VorkommenKatalog["dokumentLaedt"];
    readonly eintragFehler: VorkommenKatalog["dokumentFehler"];
    /** Der Unterreiter der Liste. */
    readonly unter: Ref<Unterreiter>;
    setzeFeldWert<K extends keyof VorkommenFelder>(feld: K, wert: VorkommenFelder[K]): void;
    haengeZielAn(ziel: InhalteVorkommenZiel, relation: InhalteVorkommenBeziehung): void;
    /** Einen ungeklärten Namen als Ziel anhängen („ungeklärt übernehmen“): kein Schlüssel, nie Treffer. */
    haengeNamenAn(name: string, relation: InhalteVorkommenBeziehung): void;
    loeseOrt(schluessel: string): void;
    stelleOrtHer(schluessel: string): void;
    haengeQuelleAn(quelle: QuelleZumAnhaengen): void;
    aendereQuelleAngaben(
        sourceId: string,
        angaben: Partial<Pick<EntwurfQuelle, "referenceKind" | "pages" | "note">>,
    ): void;
    loeseQuelle(sourceId: string): void;
    stelleQuelleHer(sourceId: string): void;
    /**
     * „↺ Wiki-Wert“ (WI-0254 §12): Art, Fundstelle und Notiz einer Quelle auf das setzen, was das Wiki an diesem Eintrag zitiert (`wikiAngaben`). EIN Schritt im Entwurf, der sich nicht mit dem Tippen in einem Feld
     * verschmilzt; geschrieben wird erst mit „Speichern“.
     */
    stelleQuelleWikiHer(sourceId: string, angaben: Pick<EntwurfQuelle, "referenceKind" | "pages" | "note">): void;
    // --- Regeln ---
    /** Das Ergebnis des Regeleditors in den Entwurf: eine neue Regel, eine geänderte oder ein Vorschlag, gleich ob unverändert oder bearbeitet. */
    uebernimmRegel(eingabe: RegelEingabe): void;
    /** „Übernehmen“ an einem Vorschlag des Wikis (die Stelle in `wikiVorschlag.regeln`). */
    uebernimmVorschlag(index: number): void;
    loescheRegel(schluessel: string): void;
    /** „↺ Wiki-Fassung“: die Regel von Hand weicht der Fassung des Wikis. */
    stelleRegelWikiHer(schluessel: string): void;
    // --- Flächen einer Bedingung ---
    readonly flaechenText: Ref<string>;
    readonly flaechenTreffer: ShallowRef<readonly InhalteVorkommenFlaeche[]>;
    readonly flaechenLaedt: Ref<boolean>;
    leereFlaechen(): void;
    // --- Orte und Umriss der Lage zu einer Linie ---
    readonly orteTreffer: ShallowRef<readonly InhalteVorkommenLageOrt[]>;
    readonly orteLaedt: Ref<boolean>;
    /** Die Orte zu einem Text suchen; leer heißt: die Metropolen und Großstädte. */
    sucheOrte(text: string): void;
    leereOrte(): void;
    /** Der Umriss Aventuriens für die Skizze; `undefined`, solange er fehlt. */
    readonly umriss: ShallowRef<InhalteVorkommenUmriss | undefined>;
    /** Den Umriss holen, wo er noch fehlt (einmal; ein zweiter Aufruf, während er unterwegs oder da ist, tut nichts). */
    ladeUmriss(): void;
    // --- Ziele einer Ortszeile ---
    readonly zielText: Ref<string>;
    readonly zielTreffer: ShallowRef<readonly InhalteVorkommenZiel[]>;
    readonly zielLaedt: Ref<boolean>;
    leereZiele(): void;
    // --- Quellen des Katalogs zum Anhängen ---
    readonly quelleText: Ref<string>;
    readonly quelleTreffer: ShallowRef<readonly InhalteQuellenZeile[]>;
    readonly quelleLaedt: Ref<boolean>;
    leereQuellen(): void;
}

export interface VorkommenSteuerungOptionen {
    client: InhalteClient;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number;
    neueOperationId?: () => string;
}

const ENTPRELL_VORGABE = 250;

/** Der Schlüssel einer Zeile für die Überschneidung: das Ziel in seiner Beziehung. */
const ortSchluessel = (o: {
    rowId?: string | undefined;
    kind?: string;
    carrierId?: string;
    kontinent?: string;
    relation?: string;
}): string =>
    o.rowId !== undefined
        ? `zeile:${o.rowId}`
        : `neu:${o.kind ?? o.kontinent ?? ""}:${o.carrierId ?? ""}:${o.relation ?? ""}`;

/** Die Fassung des Kerns für die Vorkommen: was nur sie über Stand, Körper, Überschneidung und Übertragen wissen. */
export function vorkommenAdapter(
    client: InhalteClient,
): KatalogAdapter<
    InhalteVorkommen,
    InhalteVorkommenZeile,
    InhalteVorkommenListe,
    InhalteVorkommenSortierung,
    VorkommenStand,
    Pick<InhalteVorkommenAendernBody, "fields" | "orte" | "quellen" | "regeln">
> {
    return {
        quittungsArt: "lore",
        idVon: (eintrag) => eintrag.id,
        revisionVon: (eintrag) => eintrag.revision,
        zeileId: (zeile) => zeile.id,
        zeilenVon: (liste) => liste.items,
        totalVon: (liste) => liste.total,
        haengeAn: (alt, neu) => ({ ...neu, items: [...alt.items, ...neu.items] }),
        ladeListe: (wunsch, signal) =>
            client.vorkommen(
                {
                    q: wunsch.q,
                    offset: wunsch.offset,
                    limit: wunsch.limit,
                    sort: wunsch.sort,
                    ...(wunsch.herkunft === "alle" ? {} : { herkunft: wunsch.herkunft }),
                    stand: wunsch.stand,
                    ...(wunsch.unter === undefined || wunsch.unter === "alle"
                        ? {}
                        : { art: wunsch.unter as InhalteVorkommenArt }),
                },
                signal,
            ),
        ladeDokument: (id, signal) => client.vorkommenEintrag(id, signal),
        aendere: (id, body) => client.vorkommenAendern(id, body),
        standAus: standAusVorkommen,
        koerperAus: entwurfAlsKoerper,
        zaehle: zaehleAenderungen,
        pruefe: (jetzt) => (jetzt.felder.name.trim() === "" ? { code: "titel_leer", satz: "" } : undefined),
        konflikt(start, eigen, fremd) {
            const meins = entwurfAlsKoerper(start, eigen);
            const seins = entwurfAlsKoerper(start, fremd);
            const eigene = Object.keys(meins?.fields ?? {});
            const fremde = Object.keys(seins?.fields ?? {});
            const eigeneOrte = new Set((meins?.orte ?? []).map((o) => ortSchluessel("rowId" in o ? o : { ...o })));
            const fremdeOrte = new Set((seins?.orte ?? []).map((o) => ortSchluessel("rowId" in o ? o : { ...o })));
            const eigeneQuellen = new Set((meins?.quellen ?? []).map((q) => `quelle:${q.sourceId}`));
            const fremdeQuellen = new Set((seins?.quellen ?? []).map((q) => `quelle:${q.sourceId}`));
            const eigeneRegeln = new Set((meins?.regeln ?? []).map(regelAenderungSchluessel));
            const fremdeRegeln = new Set((seins?.regeln ?? []).map(regelAenderungSchluessel));
            return {
                eigene: [...eigene, ...eigeneOrte, ...eigeneQuellen, ...eigeneRegeln],
                fremde: [...fremde, ...fremdeOrte, ...fremdeQuellen, ...fremdeRegeln],
                beide: [
                    ...eigene.filter((feld) => fremde.includes(feld)),
                    ...[...eigeneOrte].filter((k) => fremdeOrte.has(k)),
                    ...[...eigeneQuellen].filter((k) => fremdeQuellen.has(k)),
                    ...[...eigeneRegeln].filter((k) => fremdeRegeln.has(k)),
                ],
            };
        },
        uebertrage(fremd, start, eigen) {
            const koerper = entwurfAlsKoerper(start, eigen);
            let stand = fremd;
            for (const feld of Object.keys(koerper?.fields ?? {})) {
                const key = feld as keyof VorkommenFelder;
                stand = setzeFeld(stand, key, eigen.felder[key] as never);
            }
            // Ortszeilen: was der Entwurf angehängt hat, hängt wieder an; was er gelöst oder zurückgeholt hat, wird es wieder.
            for (const o of eigen.orte) {
                const vorher = o.rowId === undefined ? undefined : start.orte.find((s) => s.rowId === o.rowId);
                if (o.rowId === undefined) {
                    if (o.state === "active" && o.ziel !== undefined) {
                        if ("name" in o.ziel) {
                            stand = haengeNamenAn(stand, o.ziel.name, o.relation);
                        } else if (o.wikiKey !== null) {
                            stand = haengeOrtAn(
                                stand,
                                "kontinent" in o.ziel
                                    ? { kontinent: o.ziel.kontinent, name: o.name, wikiKey: o.wikiKey }
                                    : {
                                          kind: o.ziel.kind,
                                          carrierId: o.ziel.carrierId,
                                          name: o.name,
                                          wikiKey: o.wikiKey,
                                      },
                                o.relation,
                            );
                        }
                    }
                } else if (vorher !== undefined && vorher.state === "active" && o.state !== "active") {
                    stand = loeseOrt(stand, o.rowId);
                } else if (vorher !== undefined && vorher.state !== "active" && o.state === "active") {
                    stand = stelleOrtWiederHer(stand, o.rowId);
                }
            }
            // Quellen ebenso, dazu die geänderte Fundstelle.
            for (const q of eigen.quellen) {
                const vorher = start.quellen.find((s) => s.sourceId === q.sourceId);
                if (vorher === undefined) {
                    if (q.state === "active")
                        stand = haengeQuelleAn(stand, {
                            sourceId: q.sourceId,
                            title: q.title,
                            sourceType: q.sourceType,
                            url: q.url,
                        });
                } else if (vorher.state === "active" && q.state !== "active") {
                    stand = loeseQuelle(stand, q.sourceId);
                } else if (vorher.state !== "active" && q.state === "active") {
                    stand = stelleQuelleWiederHer(stand, q.sourceId);
                }
                if (q.state === "active") {
                    stand = aendereQuelle(stand, q.sourceId, {
                        referenceKind: q.referenceKind,
                        pages: q.pages,
                        note: q.note,
                    });
                }
            }
            // Regeln: was der Entwurf gelöscht, geändert oder angelegt hat, gilt auch auf dem fremden Stand.
            if (regelAenderungen(start.regeln, eigen.regeln).length > 0) {
                stand = { ...stand, regeln: uebertrageRegeln(stand.regeln, start.regeln, eigen.regeln) };
            }
            return stand;
        },
    };
}

export function createVorkommenSteuerung(optionen: VorkommenSteuerungOptionen): VorkommenSteuerung {
    const { client } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;
    const unter = ref<Unterreiter>("alle");
    const k = createKatalog({
        adapter: vorkommenAdapter(client),
        vorgabeSortierung: "title",
        unter,
        entprellMs,
        neueOperationId,
    });

    function aendere(rechne: (stand: VorkommenStand) => VorkommenStand, verschmelze?: string): void {
        const aktuell = k.jetzt();
        if (aktuell !== undefined) k.schritt(rechne(aktuell), verschmelze);
    }

    // Ziele einer Ortszeile: Kartenobjekte mit Wiki-Schlüssel und Kontinentbegriffe.
    const ziele = createTextSuche<InhalteVorkommenZiel>(
        async (text, signal) => (await client.vorkommenZiele(text, signal)).items,
        entprellMs,
    );
    // Quellen des Katalogs zum Anhängen: nach Titel, Adresse oder Korpus.
    const quellen = createTextSuche<InhalteQuellenZeile>(
        async (text, signal) =>
            (await client.liste({ q: text, limit: 8, sort: "title", stand: "aktiv" }, signal)).items,
        entprellMs,
    );

    // Flächen für die Bedingung einer Regel: aktive Landschaften außerhalb der Klima-Ebene.
    const flaechen = createTextSuche<InhalteVorkommenFlaeche>(
        async (text, signal) => (await client.vorkommenFlaechen(text, signal)).items,
        entprellMs,
    );

    // Orte der Lage zu einer Linie: schon ohne Text die Metropolen und Großstädte.
    const orte = createTextSuche<InhalteVorkommenLageOrt>(
        async (text, signal) => (await client.vorkommenOrte(text, signal)).items,
        entprellMs,
        0,
    );
    function sucheOrte(wert: string): void {
        orte.text.value = wert;
        orte.anstossen();
    }

    // Der Umriss Aventuriens: einmal holen, solange er fehlt.
    const umriss = shallowRef<InhalteVorkommenUmriss | undefined>(undefined);
    let umrissUnterwegs = false;
    const umrissAbbruch = new AbortController();
    function ladeUmriss(): void {
        if (umriss.value !== undefined || umrissUnterwegs) return;
        umrissUnterwegs = true;
        client
            .vorkommenUmriss(umrissAbbruch.signal)
            .then((antwort) => {
                umriss.value = antwort;
            })
            // Ohne Umriss (404 oder ein Fehler) zeigt das Feld keine Skizze; alles andere geht weiter.
            .catch(() => undefined)
            .finally(() => {
                umrissUnterwegs = false;
            });
    }
    onScopeDispose(() => umrissAbbruch.abort());

    /** Eine Änderung an den Regeln; bleibt die Liste, wie sie ist (nichts geändert), ist es auch kein Schritt. */
    function aendereRegeln(rechne: (regeln: readonly EntwurfRegel[]) => readonly EntwurfRegel[]): void {
        const aktuell = k.jetzt();
        if (aktuell === undefined) return;
        const regeln = rechne(aktuell.regeln);
        if (regeln !== aktuell.regeln) k.schritt({ ...aktuell, regeln });
    }
    /** Der Vorschlag des WikiSync zum gewählten Eintrag: Er gehört dem gespeicherten Stand, nicht dem Entwurf. */
    const vorschlag = () => k.dokument.value?.wikiVorschlag;

    const legeAn = (name: string, art: InhalteVorkommenArt): Promise<void> =>
        k.legeAn(() => client.vorkommenAnlegen({ operationId: neueOperationId(), name: name.trim(), art }));

    const { dokument, dokumentLaedt, dokumentFehler, jetzt: _jetzt, schritt: _schritt, legeAn: _legeAn, ...kern } = k;
    void _legeAn;
    void _jetzt;
    void _schritt;
    return {
        ...kern,
        eintrag: dokument,
        eintragLaedt: dokumentLaedt,
        eintragFehler: dokumentFehler,
        unter,
        setzeFeldWert: (feld, wert) => aendere((stand) => setzeFeld(stand, feld, wert), `feld:${feld}`),
        legeAn,
        haengeZielAn: (ziel, relation) => aendere((stand) => haengeOrtAn(stand, ziel, relation)),
        haengeNamenAn: (name, relation) => aendere((stand) => haengeNamenAn(stand, name, relation)),
        loeseOrt: (schluessel) => aendere((stand) => loeseOrt(stand, schluessel)),
        stelleOrtHer: (schluessel) => aendere((stand) => stelleOrtWiederHer(stand, schluessel)),
        haengeQuelleAn: (quelle) => aendere((stand) => haengeQuelleAn(stand, quelle)),
        aendereQuelleAngaben: (sourceId, angaben) =>
            aendere(
                (stand) => aendereQuelle(stand, sourceId, angaben),
                angaben.pages !== undefined
                    ? `seiten:${sourceId}`
                    : angaben.note !== undefined
                      ? `notiz:${sourceId}`
                      : undefined,
            ),
        loeseQuelle: (sourceId) => aendere((stand) => loeseQuelle(stand, sourceId)),
        stelleQuelleHer: (sourceId) => aendere((stand) => stelleQuelleWiederHer(stand, sourceId)),
        stelleQuelleWikiHer: (sourceId, angaben) => aendere((stand) => aendereQuelle(stand, sourceId, angaben)),
        uebernimmRegel: (eingabe) => aendereRegeln((regeln) => regelAusEditor(regeln, eingabe, vorschlag())),
        uebernimmVorschlag: (index) => aendereRegeln((regeln) => uebernimmVorschlag(regeln, vorschlag(), index)),
        loescheRegel: (schluessel) => aendereRegeln((regeln) => loescheRegel(regeln, schluessel)),
        stelleRegelWikiHer: (schluessel) => aendereRegeln((regeln) => stelleWikiHer(regeln, schluessel, vorschlag())),
        flaechenText: flaechen.text,
        flaechenTreffer: flaechen.treffer,
        flaechenLaedt: flaechen.laedt,
        leereFlaechen: flaechen.leere,
        orteTreffer: orte.treffer,
        orteLaedt: orte.laedt,
        sucheOrte,
        leereOrte: orte.leere,
        umriss,
        ladeUmriss,
        zielText: ziele.text,
        zielTreffer: ziele.treffer,
        zielLaedt: ziele.laedt,
        leereZiele: ziele.leere,
        quelleText: quellen.text,
        quelleTreffer: quellen.treffer,
        quelleLaedt: quellen.laedt,
        leereQuellen: quellen.leere,
    };
}
