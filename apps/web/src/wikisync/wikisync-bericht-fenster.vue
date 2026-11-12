<script setup lang="ts">
/**
 * Das Fenster „Dump-Bericht“ (Mockup; Vali 2026-10-25: „Kandidaten und Regelvorschläge je in einem eigenen Fenster“): alle Zeilen der jüngsten Vorschau je
 * Bereich, gelesen über `GET /api/admin/wikisync/bericht` (ab Tester), mit Freitext und dem Trichter für Bereich, Wirkung, Eigentümer, Status und Befund.
 *
 * - **Oben, ohne Filter:** die Zuweisungen gegen den Dump (nur mit gespeicherter Wiki-Adresse; Eigenkennungen nur gezählt) und die Befunde zum Dump (Namensräume,
 *   die die Tafel nicht kennt). Wer einen Bereich beliefert und ob er im Lauf übernommen wird, steht seit §20 in der Tafel der Bereiche (Spalte „Quelle“), nicht mehr hier.
 * - **Die Liste** ist ein Raster wie im Mockup: Kreis, Objekt, Feld, Heute → Wiki, Status, Eigentümer; ein Klick klappt die Einzelheiten auf. Unbekannt ist
 *   nicht leer: „unbekannt“ steht kursiv, ein bewusst leerer Wert als „(bewusst leer)“.
 * - Der Bericht ändert nichts; übernommen wird mit „WikiSync starten“ (der Lauf liest den Dump und die Kategorien-Datei und übernimmt).
 * - **Mit `artikelId`** zeigt dasselbe Fenster das Ergebnis EINES Artikelvergleichs (D-2, `GET /api/admin/wikisync/artikel`): dieselben Zeilen und Filter, nur über die Zeilen
 *   dieses Vergleichs (sie liegen ganz im Browser, eine Handvoll), ohne die Blöcke zum Dump. Der Vergleich ändert nichts.
 */
import { computed, ref, watch } from "vue";
import {
    WIKISYNC_BEFUNDE,
    WIKISYNC_BEREICHE,
    WIKISYNC_BERICHT_URL,
    WIKISYNC_EIGENTUEMER,
    WIKISYNC_STATUS,
    WIKISYNC_WIRKUNG,
    type WikisyncBereich,
    type WikisyncArtikelVergleich,
    type WikisyncBereichZahlen,
    type WikisyncBericht,
    type WikisyncZeile,
} from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { getJson } from "../auth/api";
import { withConfirmation } from "../auth/bestaetigen";
import { entprellt } from "../system/entprellt";
import { wikisyncProbleme, type Wikisync } from "./wikisync";
import WikisyncInfo from "./wikisync-info.vue";
import {
    BERICHT_LEGENDE,
    STATUS_TON,
    anzahl,
    befundName,
    bereichName,
    berichtKreisName,
    datumText,
    eigentuemerName,
    feldName,
    objektArtName,
    statusName,
    weitereLadenText,
    wertText,
    wirkungName,
    zahl,
    zeilenKreis,
    zeitpunkt,
} from "./wikisync-text";
import type { Phrase } from "../auth/formular";

const SEITE = 100;

const offen = defineModel<boolean>("offen", { required: true });
const props = defineProps<{
    wikisync: Wikisync;
    /** Ein Filter beim Öffnen (etwa „Nur Befunde zeigen“). */
    vorfilter: FilterWahl;
    /** Der Vergleich eines einzelnen Artikels, dessen Zeilen das Fenster zeigt; `null`: der Bericht zum Dump. */
    artikelId: number | null;
    /** Namensräume im Dump, die die Tafel nicht kennt. */
    unbekannteRaeume: readonly { nr: number; name: string | null; seiten: number }[];
}>();

const emit = defineEmits<{ zumDump: [] }>();
const ws = props.wikisync;
const artikelModus = computed(() => props.artikelId !== null);
const vergleich = computed((): WikisyncArtikelVergleich | undefined =>
    ws.artikel.value?.vergleiche.find((eintrag) => eintrag.id === props.artikelId),
);
const suche = ref("");
const q = entprellt(suche);
const wahl = ref<FilterWahl>({});
const zeilen = ref<WikisyncZeile[]>([]);
const antwort = ref<WikisyncBericht | null>(null);
const laedt = ref(false);
const probleme = ref<Phrase[]>([]);
const offenId = ref<number | null>(null);
let ticket = 0;

watch(
    offen,
    (jetzt) => {
        if (!jetzt) return;
        wahl.value = { ...props.vorfilter };
        suche.value = "";
        void laden(true);
    },
    { immediate: true },
);
watch([q, wahl, () => props.artikelId, () => ws.artikel.value], () => {
    if (offen.value) void laden(true);
});

function abfrage(offset: number): string {
    const teile = new URLSearchParams({ limit: String(SEITE), offset: String(offset) });
    for (const name of ["bereich", "wirkung", "eigentuemer", "status", "befund"] as const) {
        const [wert] = wahl.value[name] ?? [];
        if (wert !== undefined) teile.set(name, wert);
    }
    if (q.value !== "") teile.set("q", q.value);
    return `${WIKISYNC_BERICHT_URL}?${teile.toString()}`;
}

/** Die Antwort eines Artikelvergleichs, wie der Server sie für den Dump gäbe: dieselben Filter, die Zähler nach dem Bereich, nicht nach den anderen Filtern. */
function ausVergleich(eintrag: WikisyncArtikelVergleich): WikisyncBericht {
    const nurBereich = wahl.value["bereich"]?.[0];
    const imBereich = eintrag.zeilen.filter((zeile) => nurBereich === undefined || zeile.bereich === nurBereich);
    const zaehler = (feld: "wirkung" | "eigentuemer" | "status" | "befund"): Record<string, number> => {
        const summe: Record<string, number> = {};
        for (const zeile of imBereich) {
            const wert = zeile[feld];
            if (wert !== null) summe[wert] = (summe[wert] ?? 0) + 1;
        }
        return summe;
    };
    const filter = (name: "wirkung" | "eigentuemer" | "status" | "befund"): string | undefined => wahl.value[name]?.[0];
    const gesucht = q.value.trim().toLowerCase();
    const treffer = imBereich.filter(
        (zeile) =>
            (filter("wirkung") === undefined || zeile.wirkung === filter("wirkung")) &&
            (filter("eigentuemer") === undefined || zeile.eigentuemer === filter("eigentuemer")) &&
            (filter("status") === undefined || zeile.status === filter("status")) &&
            (filter("befund") === undefined || zeile.befund === filter("befund")) &&
            (gesucht === "" ||
                [zeile.objektName, zeile.artikel, zeile.feld].some(
                    (text) => text?.toLowerCase().includes(gesucht) === true,
                )),
    );
    return {
        jetzt: new Date().toISOString(),
        laeufe: [],
        gesamt: treffer.length,
        offset: 0,
        limit: Math.max(treffer.length, 1),
        facetten: {
            wirkung: zaehler("wirkung"),
            eigentuemer: zaehler("eigentuemer"),
            status: zaehler("status"),
            befund: zaehler("befund"),
        },
        zeilen: treffer,
    };
}

async function laden(neu: boolean): Promise<void> {
    if (props.artikelId !== null) {
        // Der Vergleich liegt schon im Browser (er kam mit dem Stand des Reiters); eine Seite gibt es nicht.
        const eintrag = vergleich.value;
        antwort.value = eintrag === undefined ? null : ausVergleich(eintrag);
        zeilen.value = antwort.value?.zeilen ?? [];
        probleme.value = [];
        return;
    }
    const mine = ++ticket;
    laedt.value = true;
    try {
        const body = await withConfirmation(() => getJson<WikisyncBericht>(abfrage(neu ? 0 : zeilen.value.length)));
        if (mine !== ticket) return;
        antwort.value = body;
        zeilen.value = neu ? body.zeilen : [...zeilen.value, ...body.zeilen];
        probleme.value = [];
    } catch (error) {
        if (mine === ticket) probleme.value = wikisyncProbleme(error);
    } finally {
        if (mine === ticket) laedt.value = false;
    }
}

const facetten = computed(() => antwort.value?.facetten);
const zaehle = (art: "wirkung" | "eigentuemer" | "status" | "befund", wert: string): number =>
    facetten.value?.[art][wert] ?? 0;
const abschnitte = computed((): FilterAbschnitt[] => [
    {
        id: "bereich",
        titel: t("admin.wikisync.bericht.filter.bereich"),
        art: "eins",
        werte: WIKISYNC_BEREICHE.map((bereich) => ({ wert: bereich, text: bereichName(bereich) })),
    },
    {
        id: "wirkung",
        titel: t("admin.wikisync.bericht.filter.wirkung"),
        art: "eins",
        werte: WIKISYNC_WIRKUNG.map((wert) => ({ wert, text: wirkungName(wert), zahl: zaehle("wirkung", wert) })),
    },
    {
        id: "eigentuemer",
        titel: t("admin.wikisync.bericht.filter.eigentuemer"),
        art: "eins",
        werte: WIKISYNC_EIGENTUEMER.map((wert) => ({
            wert,
            text: eigentuemerName(wert),
            zahl: zaehle("eigentuemer", wert),
        })),
    },
    {
        id: "status",
        titel: t("admin.wikisync.bericht.filter.status"),
        art: "eins",
        werte: WIKISYNC_STATUS.map((wert) => ({ wert, text: statusName(wert), zahl: zaehle("status", wert) })),
    },
    {
        id: "befund",
        titel: t("admin.wikisync.bericht.filter.befund"),
        art: "eins",
        werte: WIKISYNC_BEFUNDE.map((wert) => ({ wert, text: befundName(wert), zahl: zaehle("befund", wert) })),
    },
]);
const gefiltert = computed(() => q.value !== "" || Object.values(wahl.value).some((werte) => (werte?.length ?? 0) > 0));

const bilanz = computed(() => {
    const a = antwort.value;
    if (a === null) return "";
    const w = a.facetten.wirkung;
    // Die Quellen legen an und legen still (WI-0253 §21): Ihre Zahlen stehen dabei, solange der Filter den Bereich nicht ausschließt.
    const bereiche = wahl.value["bereich"] ?? [];
    const zahlenDes = (bereich: WikisyncBereich): WikisyncBereichZahlen | null =>
        bereiche.length === 0 || bereiche.includes(bereich)
            ? (a.laeufe.find((lauf) => lauf.zahlen[bereich] !== undefined)?.zahlen[bereich] ?? null)
            : null;
    const quellen = zahlenDes("quelle");
    // Die Vorkommen legen Ortszeilen an und legen sie still wie die Quellen ihre Verknüpfungen, und sie zählen, was Legacy als Ort geführt hätte, das keiner ist (WI-0253 §23).
    const vorkommen = zahlenDes("vorkommen");
    // Die Sprachen legen ihre Sprachartikel an und still (WI-0261 S3).
    const sprachen = zahlenDes("sprachen");
    const angelegt = (quellen?.angelegt ?? 0) + (vorkommen?.angelegt ?? 0) + (sprachen?.angelegt ?? 0);
    const stillgelegt = (quellen?.stillgelegt ?? 0) + (vorkommen?.stillgelegt ?? 0) + (sprachen?.stillgelegt ?? 0);
    // Keine Orte: jede Rolle außer Ort und andere Welt (Links in andere Welten trafen auch bei Legacy nichts).
    const keineOrte = Object.entries(vorkommen?.rollen ?? {})
        .filter(([rolle]) => rolle !== "ort" && rolle !== "andere_welt")
        .reduce((summe, [, n]) => summe + n, 0);
    return [
        anzahl.zeilen(a.gesamt),
        t("admin.wikisync.bericht.bilanz.uebernommen", { n: zahl(w["uebernommen"] ?? 0) }),
        ...(angelegt > 0 ? [t("admin.wikisync.bericht.bilanz.angelegt", { n: zahl(angelegt) })] : []),
        ...(stillgelegt > 0 ? [t("admin.wikisync.bericht.bilanz.stillgelegt", { n: zahl(stillgelegt) })] : []),
        ...(keineOrte > 0 ? [t("admin.wikisync.bericht.bilanz.keineOrte", { n: zahl(keineOrte) })] : []),
        ...((vorkommen?.rueckfragen ?? 0) > 0
            ? [t("admin.wikisync.bericht.bilanz.rueckfragen", { n: zahl(vorkommen?.rueckfragen ?? 0) })]
            : []),
        ...((vorkommen?.weiterleitungen ?? 0) > 0
            ? [t("admin.wikisync.bericht.bilanz.weiterleitungen", { n: zahl(vorkommen?.weiterleitungen ?? 0) })]
            : []),
        t("admin.wikisync.bericht.bilanz.eigen", { n: zahl(w["eigen"] ?? 0) }),
        anzahl.befunde(w["befund"] ?? 0),
    ].join(" · ");
});

/** Der Stand je Bereich (für den Kreis einer Zeile: gehört er dem WikiSync, ist seine Übernahme also angeschlossen?). */
const bereichStaende = computed(
    () => new Map((ws.bereiche.value?.bereiche ?? []).map((stand) => [stand.bereich, stand])),
);
const gehoertWikisync = (bereich: WikisyncBereich): boolean =>
    bereichStaende.value.get(bereich)?.angeschlossen === true;

// ── Zuweisungen gegen den Dump ───────────────────────────────────────────────────────────────────────────────────────────────────
const zuweisungen = computed(() => {
    const summe = { gefunden: 0, umgeleitet: 0, nichtImDump: 0, mehrdeutig: 0, ohneAdresse: 0 };
    const gesehen = new Set<string>();
    for (const lauf of antwort.value?.laeufe ?? []) {
        for (const [bereich, z] of Object.entries(lauf.zahlen) as [string, WikisyncBereichZahlen][]) {
            if (gesehen.has(bereich)) continue;
            gesehen.add(bereich);
            summe.gefunden += z.gefunden;
            summe.umgeleitet += z.umgeleitet;
            summe.nichtImDump += z.nichtImDump;
            summe.mehrdeutig += z.mehrdeutig;
            summe.ohneAdresse += z.kennungOhneWikiAdresse;
        }
    }
    return summe;
});
const dumpStand = computed(() => antwort.value?.laeufe.find((lauf) => lauf.dump.stand !== null)?.dump.stand ?? null);
const fensterTitel = computed(() =>
    t(artikelModus.value ? "admin.wikisync.artikel.fenster" : "admin.wikisync.bericht.titel"),
);
const fensterZusatz = computed((): string | undefined => {
    if (artikelModus.value) return vergleich.value?.titel;
    return dumpStand.value === null
        ? undefined
        : t("admin.wikisync.bericht.zusatz", { datum: datumText(dumpStand.value) });
});

function objektUnter(zeile: WikisyncZeile): string {
    const teile = [objektArtName(zeile.objektArt)];
    if (zeile.artikel !== null && zeile.artikel !== zeile.objektName) teile.push(zeile.artikel);
    if (zeile.objekte > 1) teile.push(anzahl.objekte(zeile.objekte));
    return teile.join(" · ");
}

function setze(abschnitt: string, werte: string[]): void {
    wahl.value = { ...wahl.value, [abschnitt]: werte };
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="werkzeug"
        :titel="fensterTitel"
        :zusatz="fensterZusatz"
        testid="wsync-bericht-fenster"
    >
        <template #leiste>
            <AvmListenleiste
                v-model="suche"
                class="wsync-berichtfenster__leiste"
                :platzhalter="t('admin.wikisync.bericht.suche')"
                :beschriftung="t('admin.wikisync.bericht.sucheName')"
                testid="wsync-bericht-leiste"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="wahl"
                    testid="wsync-bericht-filter"
                    @setze="setze"
                    @loesen="wahl = {}"
                />
            </AvmListenleiste>
        </template>

        <div class="wsync-berichtfenster">
            <AvmHinweis v-if="probleme.length > 0" ton="gefahr" rolle="alert">
                <span v-for="problem in probleme" :key="problem.key">{{ t(problem.key, problem.params) }}</span>
            </AvmHinweis>
            <p v-if="antwort !== null" class="wsync-berichtfenster__bilanz" data-testid="wsync-bericht-bilanz">
                {{ bilanz }}
            </p>

            <AvmHinweis v-if="artikelModus && vergleich !== undefined" ton="neutral" testid="wsync-bericht-artikel">
                {{
                    t("admin.wikisync.bericht.artikelHinweis", {
                        titel: vergleich.titel,
                        zeit: zeitpunkt(vergleich.beendetAm ?? vergleich.gestartetAm, new Date()),
                    })
                }}
                <button
                    type="button"
                    class="wsync-berichtfenster__link"
                    data-testid="wsync-bericht-zum-dump"
                    @click="emit('zumDump')"
                >
                    {{ t("admin.wikisync.bericht.zumDump") }}
                </button>
            </AvmHinweis>
            <template v-if="!gefiltert && antwort !== null && !artikelModus">
                <section class="wsync-berichtfenster__block" data-testid="wsync-bericht-zuweisungen">
                    <h4 class="wsync-berichtfenster__titel">{{ t("admin.wikisync.bericht.zuweisungen") }}</h4>
                    <p class="wsync-berichtfenster__leise">
                        {{ t("admin.wikisync.bericht.zuweisungenSatz")
                        }}<WikisyncInfo :text="t('admin.wikisync.bericht.zuweisungenInfo')" />
                    </p>
                    <dl class="wsync-berichtfenster__felder">
                        <dt>{{ t("admin.wikisync.bericht.gefunden") }}</dt>
                        <dd>{{ zahl(zuweisungen.gefunden) }}</dd>
                        <dt>{{ t("admin.wikisync.bericht.umgeleitet") }}</dt>
                        <dd>{{ zahl(zuweisungen.umgeleitet) }} · {{ t("admin.wikisync.bericht.jeFallBefund") }}</dd>
                        <dt>{{ t("admin.wikisync.bericht.nichtImDump") }}</dt>
                        <dd>{{ zahl(zuweisungen.nichtImDump) }} · {{ t("admin.wikisync.bericht.jeFallBefund") }}</dd>
                        <template v-if="zuweisungen.mehrdeutig > 0">
                            <dt>{{ t("admin.wikisync.befund.mehrdeutig") }}</dt>
                            <dd>{{ zahl(zuweisungen.mehrdeutig) }} · {{ t("admin.wikisync.bericht.jeFallBefund") }}</dd>
                        </template>
                    </dl>
                    <p class="wsync-berichtfenster__leise" data-testid="wsync-bericht-ohne-adresse">
                        {{ t("admin.wikisync.bericht.ohneAdresse", { n: zahl(zuweisungen.ohneAdresse) })
                        }}<WikisyncInfo :text="t('admin.wikisync.bericht.ohneAdresseInfo')" />
                    </p>
                </section>

                <section
                    v-if="unbekannteRaeume.length > 0"
                    class="wsync-berichtfenster__block"
                    data-testid="wsync-bericht-dumpbefunde"
                >
                    <h4 class="wsync-berichtfenster__titel">
                        {{ t("admin.wikisync.bericht.dumpBefunde", { n: unbekannteRaeume.length }) }}
                    </h4>
                    <ul class="wsync-berichtfenster__befunde">
                        <li v-for="raum in unbekannteRaeume" :key="raum.nr">
                            <AvmPille ton="warnung">{{ t("admin.wikisync.befund.namensraum_unbekannt") }}</AvmPille>
                            {{
                                t("admin.wikisync.bericht.raumUnbekannt", {
                                    nr: raum.nr,
                                    name: raum.name ?? "?",
                                    seiten: anzahl.seiten(raum.seiten),
                                })
                            }}
                        </li>
                    </ul>
                </section>
            </template>

            <div
                class="wsync-berichtfenster__liste"
                role="table"
                :aria-label="t('admin.wikisync.bericht.titel')"
                data-testid="wsync-bericht-liste"
            >
                <div class="wsync-berichtfenster__raster wsync-berichtfenster__kopf" role="row">
                    <span role="columnheader"></span>
                    <span role="columnheader">{{ t("admin.wikisync.bericht.kopf.objekt") }}</span>
                    <span role="columnheader">{{ t("admin.wikisync.bericht.kopf.feld") }}</span>
                    <span role="columnheader">{{ t("admin.wikisync.bericht.kopf.aenderung") }}</span>
                    <span role="columnheader">{{ t("admin.wikisync.bericht.filter.status") }}</span>
                    <span role="columnheader">{{ t("admin.wikisync.bericht.filter.eigentuemer") }}</span>
                    <span role="columnheader"></span>
                </div>
                <p v-if="antwort !== null && zeilen.length === 0" class="wsync-berichtfenster__leer">
                    {{
                        t(
                            artikelModus
                                ? "admin.wikisync.bericht.artikelLeer"
                                : antwort.laeufe.length === 0
                                  ? "admin.wikisync.bericht.keinLauf"
                                  : "admin.wikisync.bericht.keineZeilen",
                        )
                    }}
                </p>
                <div
                    v-for="zeile in zeilen"
                    :key="zeile.id"
                    class="wsync-berichtfenster__eintrag"
                    :class="{ 'is-offen': offenId === zeile.id }"
                    role="row"
                    :data-zeile="zeile.id"
                >
                    <button
                        type="button"
                        class="wsync-berichtfenster__raster wsync-berichtfenster__zeile"
                        :aria-expanded="offenId === zeile.id"
                        @click="offenId = offenId === zeile.id ? null : zeile.id"
                    >
                        <span class="z-k"
                            ><AvmKreis
                                :fuellung="zeilenKreis(zeile.wirkung, gehoertWikisync(zeile.bereich))"
                                :name="berichtKreisName(zeilenKreis(zeile.wirkung, gehoertWikisync(zeile.bereich)))"
                        /></span>
                        <span class="z-obj"
                            ><span class="wsync-berichtfenster__name">{{
                                zeile.objektName ?? zeile.artikel ?? "—"
                            }}</span
                            ><span class="wsync-berichtfenster__klein">{{ objektUnter(zeile) }}</span></span
                        >
                        <span class="z-feld">{{
                            zeile.feld === null && zeile.befund !== null
                                ? befundName(zeile.befund)
                                : feldName(zeile.feld)
                        }}</span>
                        <span class="z-aend wsync-berichtfenster__aend">
                            <span
                                class="wsync-berichtfenster__alt"
                                :class="{
                                    'wsync-berichtfenster__marke': wertText(
                                        zeile.alt,
                                        zeile.altZustand,
                                        'alt',
                                        zeile.feld,
                                    ).marke,
                                }"
                                >{{ wertText(zeile.alt, zeile.altZustand, "alt", zeile.feld).text }}</span
                            >
                            <span class="wsync-berichtfenster__pfeil" aria-hidden="true">→</span>
                            <span
                                class="wsync-berichtfenster__neu"
                                :class="{
                                    'wsync-berichtfenster__marke': wertText(
                                        zeile.neu,
                                        zeile.neuZustand,
                                        'neu',
                                        zeile.feld,
                                    ).marke,
                                }"
                                >{{ wertText(zeile.neu, zeile.neuZustand, "neu", zeile.feld).text }}</span
                            >
                        </span>
                        <span class="z-st"
                            ><AvmPille :ton="STATUS_TON[zeile.status]">{{ statusName(zeile.status) }}</AvmPille></span
                        >
                        <span class="z-own" :class="`wsync-berichtfenster__eig--${zeile.eigentuemer}`">{{
                            eigentuemerName(zeile.eigentuemer)
                        }}</span>
                        <span class="z-chev wsync-berichtfenster__chevron" aria-hidden="true">▾</span>
                    </button>
                    <dl v-if="offenId === zeile.id" class="wsync-berichtfenster__det">
                        <dt>{{ t("admin.wikisync.bericht.filter.bereich") }}</dt>
                        <dd>{{ bereichName(zeile.bereich) }}</dd>
                        <template v-if="zeile.artikel !== null">
                            <dt>{{ t("admin.wikisync.bericht.artikel") }}</dt>
                            <dd>
                                {{ zeile.artikel
                                }}<template v-if="zeile.namensraum !== null">
                                    · {{ t("admin.wikisync.bericht.namensraum", { nr: zeile.namensraum }) }}</template
                                >
                            </dd>
                        </template>
                        <dt>{{ t("admin.wikisync.bericht.filter.wirkung") }}</dt>
                        <dd>{{ wirkungName(zeile.wirkung) }}</dd>
                        <dt>{{ t("admin.wikisync.bericht.filter.eigentuemer") }}</dt>
                        <dd>{{ t(`admin.wikisync.eigentuemerSatz.${zeile.eigentuemer}`) }}</dd>
                        <template v-if="zeile.befund !== null">
                            <dt>{{ t("admin.wikisync.bericht.filter.befund") }}</dt>
                            <dd>
                                {{ befundName(zeile.befund)
                                }}<template v-if="zeile.grund !== null"> · {{ zeile.grund }}</template>
                            </dd>
                        </template>
                        <!-- Eine Feldzeile ohne Befundwort, aber mit Grund: das Feld gehört dem Wiki, doch das Objekt hat keinen Wiki-Stand (nur eine Adresse). -->
                        <template v-else-if="zeile.grund !== null">
                            <dt>{{ t("admin.wikisync.bericht.filter.befund") }}</dt>
                            <dd data-testid="wsync-bericht-grund">{{ zeile.grund }}</dd>
                        </template>
                    </dl>
                </div>
            </div>
            <div v-if="antwort !== null && zeilen.length < antwort.gesamt">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="laedt ? '' : undefined"
                    testid="wsync-bericht-mehr"
                    @click="laden(false)"
                    >{{ weitereLadenText(zeilen.length, antwort.gesamt, SEITE) }}</AvmKnopf
                >
            </div>
            <p class="wsync-berichtfenster__legende" data-testid="wsync-bericht-legende">
                <span v-for="kreis in BERICHT_LEGENDE" :key="kreis" class="wsync-berichtfenster__legende-teil">
                    <AvmKreis :fuellung="kreis" :name="berichtKreisName(kreis)" />{{ berichtKreisName(kreis) }}
                </span>
            </p>
        </div>

        <template #fuss-hinweis>{{ t("admin.wikisync.bericht.fuss") }}</template>
        <template #fuss-haupt>
            <button type="button" data-testid="wsync-bericht-schliessen" @click="offen = false">
                {{ t("fenster.close") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.wsync-berichtfenster__leiste {
    flex: 1 1 auto;
}

.wsync-berichtfenster__link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.wsync-berichtfenster__link:hover {
    text-decoration: underline;
}

.wsync-berichtfenster__link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}

.wsync-berichtfenster {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
    container: wsync-bericht / inline-size;
}

.wsync-berichtfenster__bilanz,
.wsync-berichtfenster__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.wsync-berichtfenster__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.wsync-berichtfenster__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-berichtfenster__felder {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
    font-variant-numeric: tabular-nums;
}

.wsync-berichtfenster__felder dt {
    color: var(--color-text-muted);
}

.wsync-berichtfenster__felder dd {
    margin: 0;
    color: var(--color-text-strong);
}

.wsync-berichtfenster__befunde {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.wsync-berichtfenster__liste {
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.wsync-berichtfenster__raster {
    box-sizing: border-box;
    display: grid;
    grid-template-columns:
        minmax(0, 2em) minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.8fr) minmax(0, 7em) minmax(0, 8.5em)
        minmax(0, 1.5em);
    column-gap: var(--space-6);
    align-items: center;
    width: 100%;
    padding: var(--space-4) var(--space-8);
}

.wsync-berichtfenster__kopf {
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wsync-berichtfenster__eintrag {
    border-bottom: 1px solid var(--color-divider);
}

.wsync-berichtfenster__eintrag:last-child {
    border-bottom: 0;
}

.wsync-berichtfenster__eintrag.is-offen {
    background: var(--color-panel-soft);
}

.wsync-berichtfenster__zeile {
    border: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    transition: background-color 120ms ease;
}

.wsync-berichtfenster__zeile > * {
    min-width: 0;
    overflow-wrap: anywhere;
}

.wsync-berichtfenster__zeile:hover {
    background: var(--color-hover-wash);
}

.wsync-berichtfenster__zeile:active {
    background: var(--color-active-wash);
}

.wsync-berichtfenster__zeile:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.wsync-berichtfenster__name {
    display: block;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.wsync-berichtfenster__klein {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wsync-berichtfenster__aend {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
}

.wsync-berichtfenster__alt,
.wsync-berichtfenster__pfeil {
    color: var(--color-text-muted);
}

.wsync-berichtfenster__neu {
    color: var(--color-text-strong);
}

.wsync-berichtfenster__marke {
    color: var(--color-placeholder);
    font-style: italic;
}

.wsync-berichtfenster__eig--manual {
    color: var(--color-accent-brown);
}

.wsync-berichtfenster__eig--unterdrueckt,
.wsync-berichtfenster__eig--getrennt {
    color: var(--color-text-muted);
}

.wsync-berichtfenster__eig--unbekannt {
    color: var(--color-placeholder);
    font-style: italic;
}

.wsync-berichtfenster__chevron {
    color: var(--color-link);
    text-align: center;
    transition: transform 120ms ease;
}

.wsync-berichtfenster__eintrag.is-offen .wsync-berichtfenster__chevron {
    transform: rotate(180deg);
}

.wsync-berichtfenster__det {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    margin: 0;
    padding: var(--space-6) var(--space-10) var(--space-10);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wsync-berichtfenster__det dt {
    color: var(--color-text-muted);
}

.wsync-berichtfenster__det dd {
    min-width: 0;
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.wsync-berichtfenster__leer {
    margin: 0;
    padding: var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-berichtfenster__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wsync-berichtfenster__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

@container wsync-bericht (max-width: 44em) {
    .wsync-berichtfenster__kopf {
        display: none;
    }

    .wsync-berichtfenster__raster.wsync-berichtfenster__zeile {
        grid-template-columns: var(--space-24) minmax(0, 1fr) auto;
        grid-template-areas:
            "k obj st"
            "k feld own"
            "k aend aend";
        row-gap: var(--space-2);
        padding: var(--space-6) var(--space-8);
    }

    .wsync-berichtfenster__zeile > .z-k {
        grid-area: k;
        align-self: start;
    }

    .wsync-berichtfenster__zeile > .z-obj {
        grid-area: obj;
    }

    .wsync-berichtfenster__zeile > .z-feld {
        grid-area: feld;
        color: var(--color-text-muted);
    }

    .wsync-berichtfenster__zeile > .z-aend {
        grid-area: aend;
    }

    .wsync-berichtfenster__zeile > .z-st {
        grid-area: st;
        justify-self: end;
    }

    .wsync-berichtfenster__zeile > .z-own {
        grid-area: own;
        justify-self: end;
    }

    .wsync-berichtfenster__zeile > .z-chev {
        display: none;
    }

    .wsync-berichtfenster__det,
    .wsync-berichtfenster__felder {
        grid-template-columns: minmax(0, 1fr);
    }
}

@media (prefers-reduced-motion: reduce) {
    .wsync-berichtfenster__zeile,
    .wsync-berichtfenster__chevron {
        transition: none;
    }
}
</style>
