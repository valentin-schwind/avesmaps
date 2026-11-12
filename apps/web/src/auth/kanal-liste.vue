<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
    KANAL_KATEGORIEN,
    KANAL_PRIORITAETEN,
    fortschrittDerZeile,
    type KanalReiter,
    type KanalZeile,
} from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { formatNumber, t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import KanalSiegel from "./kanal-siegel.vue";
import KanalWer from "./kanal-wer.vue";
import {
    abholSatz,
    aufbewahrung,
    kategorieName,
    prioritaetName,
    prioritaetTon,
    statusName,
    statusTon,
    zustandName,
    discordName,
    zeit,
    type Kanal,
} from "./kanal";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";

/**
 * Die Liste der Vorgänge (Blatt WI-0124 A1, A2): oben der Satz zum 30-Minuten-Takt, dann die Reiter Offen, Zur Abnahme und Archiv mit
 * Zahl und „Vorgang melden“, darunter die Leiste (Hausregel §13.45, `AvmListenleiste`): links die Suche nach Freitext (im Server: Nummer,
 * Titel, Meldung, Verlauf), rechts der Trichter (Kategorie, Priorität, Zuständig). Je Zeile OPS-Nummer, Titel, Kategorie, wer und wann gemeldet,
 * Priorität, Status mit den vier Nachweisen, Zuständig mit Siegel. Am Telefon Karten statt Zeilen. Im Archiv steht, bis wann Meldung und
 * Bilder bleiben; gelöschte stehen leiser mit dem Kurztitel.
 */
const props = defineProps<{ kanal: Kanal; telefon: boolean }>();
const emit = defineEmits<{ oeffne: [ops: string]; melden: [] }>();

const now = computed(() => new Date(props.kanal.liste.value?.now ?? Date.now()));
/** Die Wahl im Trichter je Abschnitt; leer heißt alle. Sie gilt in allen drei Reitern, wie die Suche. */
const wahl = ref<FilterWahl>({});
/** Der Suchtext; nach einer Tipp-Pause fragt der Kanal den Server (der Meldungstext steht nicht in der Liste). */
const sucheText = ref(props.kanal.suche.value);
const gesucht = entprellt(sucheText);
watch(gesucht, (text) => {
    if (text !== props.kanal.suche.value) void props.kanal.suchen(text);
});

const zaehler = computed(() => props.kanal.liste.value?.zaehler ?? { offen: 0, abnahme: 0, archiv: 0 });
const reiter = computed(() =>
    (["offen", "abnahme", "archiv"] as const).map((id) => ({
        id,
        name: `${t(`kanal.tab.${id}`)} (${formatNumber(zaehler.value[id], 0)})`,
    })),
);
const aktiv = computed<KanalReiter>({
    get: () => props.kanal.reiter.value,
    set: (wert) => void props.kanal.ladeListe(wert),
});

/** Was ein Abschnitt an einer Zeile prüft. */
const FELD = { kategorie: "kategorie", prioritaet: "prioritaet", zustaendig: "zustaendig" } as const satisfies Record<
    string,
    keyof KanalZeile
>;
type Abschnitt = keyof typeof FELD;
const passt = (z: KanalZeile, abschnitt: Abschnitt): boolean => {
    const gesetzt = wahl.value[abschnitt] ?? [];
    return gesetzt.length === 0 || gesetzt.includes(String(z[FELD[abschnitt]]));
};
const alleZeilen = computed(() => props.kanal.liste.value?.zeilen ?? []);

/**
 * Die Ordnung der Liste (Betreiber 2026-10-15: „schön wärs auch mann die liste nach datum sortieren könnte“). Sortiert wird nach
 * dem Datum der MELDUNG — das steht je Zeile unter dem Titel. „Wie bisher“ bleibt die Vorgabe und ist die Ordnung des Servers:
 * Störung zuerst, dann Priorität, dann Alter; im Archiv die zuletzt abgenommenen oben.
 */
const ORDNUNGEN = ["standard", "neu", "alt"] as const;
type Ordnung = (typeof ORDNUNGEN)[number];
const ordnung = ref<Ordnung>("standard");
const sortierungen = computed(() => ORDNUNGEN.map((wert) => ({ wert, text: t(`kanal.sort.${wert}`) })));
const sortierName = computed(() => t(`kanal.sort.${ordnung.value}`));

const zeilen = computed<KanalZeile[]>(() => {
    const gefiltert = alleZeilen.value.filter((z) =>
        (Object.keys(FELD) as Abschnitt[]).every((abschnitt) => passt(z, abschnitt)),
    );
    if (ordnung.value === "standard") return gefiltert;
    const richtung = ordnung.value === "neu" ? -1 : 1;
    // Kopie: `zeilen` ist abgeleitet, die Antwort des Servers bleibt, wie sie kam.
    return [...gefiltert].sort((a, b) => richtung * (Date.parse(a.gemeldetAt) - Date.parse(b.gemeldetAt)));
});

/**
 * Der Fortschritt je Zeile — dieselbe Regel wie die Leiste im Vorgang (`fortschrittDerZeile`, WI-0162).
 *
 * 💣 Vorher zeichnete die Liste stur vier Punkte und füllte sie mit der Zahl der Nachweise. An einer Frage und an einer
 * Datenänderung gibt es keine, also standen dort vier leere Kreise, auch wenn längst geantwortet war (Betreiber 2026-10-15:
 * „kann man da den fortschritt anzeigen - war das nicht dafür gedacht?“).
 */
const fortschritt = (z: KanalZeile): ReturnType<typeof fortschrittDerZeile> => fortschrittDerZeile(z);
/** Die Zahl der Vorgänge, die ein Wert im Reiter hätte, mit den übrigen Abschnitten wie gewählt (wie die Ortsliste). */
const treffer = (abschnitt: Abschnitt, wert: string): number =>
    alleZeilen.value.filter(
        (z) =>
            String(z[FELD[abschnitt]]) === wert &&
            (Object.keys(FELD) as Abschnitt[]).every((andere) => andere === abschnitt || passt(z, andere)),
    ).length;
const abschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "kategorie",
        titel: t("kanal.filter.category"),
        art: "mehrere",
        werte: KANAL_KATEGORIEN.map((k) => ({ wert: k, text: kategorieName(k), zahl: treffer("kategorie", k) })),
    },
    {
        id: "prioritaet",
        titel: t("kanal.filter.priority"),
        art: "mehrere",
        werte: [...KANAL_PRIORITAETEN]
            .reverse()
            .map((p) => ({ wert: p, text: prioritaetName(p), zahl: treffer("prioritaet", p) })),
    },
    {
        id: "zustaendig",
        titel: t("kanal.filter.assignee"),
        art: "mehrere",
        werte: (["claudio", "claudia"] as const).map((a) => ({
            wert: a,
            text: a === "claudio" ? "Claudio" : "Claudia",
            zahl: treffer("zustaendig", a),
        })),
    },
]);

/** Holt Claudio gerade ab, steht der Satz zum Takt da; sonst sagt die Liste es ruhig, aber deutlich (Arbeitsanweisung WI-0124 §6). */
const stand = computed(() => props.kanal.abholung.value);
const takt = computed(() =>
    stand.value?.zuletzt ? t("kanal.cadence.last", { time: zeit(stand.value.zuletzt, props.kanal.jetzt.value) }) : "",
);

const titelVon = (z: KanalZeile): string => z.titel ?? z.kurztitel ?? `${kategorieName(z.kategorie)} · ${z.ops}`;
const unterzeile = (z: KanalZeile): string =>
    [
        kategorieName(z.kategorie),
        z.gemeldetVon?.name ?? (z.discordMelder === undefined ? null : discordName(z.discordMelder)),
        zeit(z.gemeldetAt, now.value),
    ]
        .filter((teil) => teil !== null)
        .join(" · ");
const leer = computed(() =>
    props.kanal.suche.value === ""
        ? t(`kanal.empty.${props.kanal.reiter.value}`)
        : t("kanal.empty.search", { q: props.kanal.suche.value }),
);
</script>

<template>
    <div class="liste" :class="{ 'liste--telefon': props.telefon }" data-testid="kanal-liste">
        <p v-if="stand?.laeuft" class="liste__takt" data-testid="kanal-takt">
            {{ takt }} <KanalSiegel agent="claudio" groesse="klein" /> <span class="liste__claudio">Claudio</span>
        </p>
        <AvmHinweis v-else-if="stand" ton="warnung" testid="kanal-abholung"
            >{{ abholSatz(stand, props.kanal.jetzt.value) }} {{ t("kanal.pickup.waitsMany") }}</AvmHinweis
        >
        <VerwaltungLadeproblem
            :problems="props.kanal.loadProblems.value"
            :fehlt="props.kanal.unconfirmed.value"
            testid="kanal-ladefehler"
            @bestaetigen="props.kanal.confirmAgain()"
        />
        <div class="liste__kopf">
            <FensterReiter v-model="aktiv" :reiter="reiter" :beschriftung="t('kanal.tabs')" kennung="kanal" />
            <AvmKnopf testid="kanal-melden" @click="emit('melden')">{{ t("kanal.report.open") }}</AvmKnopf>
        </div>
        <AvmListenleiste
            v-model="sucheText"
            :platzhalter="t('kanal.search.placeholder')"
            :beschriftung="t('kanal.search.label')"
            testid="kanal-leiste"
        >
            <AvmFilterknopf
                :abschnitte="abschnitte"
                :wahl="wahl"
                testid="kanal-filter"
                @setze="(abschnitt, werte) => (wahl = { ...wahl, [abschnitt]: werte })"
                @loesen="wahl = {}"
            />
            <AvmMenueknopf
                v-model="ordnung"
                :optionen="sortierungen"
                :bezeichnung="t('kanal.sort.knopf', { wahl: sortierName })"
                :menue-bezeichnung="t('kanal.sort.menue')"
                testid="kanal-sortierung"
                im-fenster
            >
                <template #zeichen="{ wert }"><AvmSortierzeichen art="zeit" :umgekehrt="wert === 'alt'" /></template>
            </AvmMenueknopf>
        </AvmListenleiste>

        <p v-if="props.kanal.liste.value !== null && zeilen.length === 0" class="liste__leer" data-testid="kanal-leer">
            {{ leer }}
        </p>

        <ul v-else-if="props.telefon" class="liste__karten">
            <li v-for="z in zeilen" :key="z.ops">
                <button
                    type="button"
                    class="karte"
                    :class="{ 'karte--rest': z.abgelaufenAt !== null }"
                    :data-testid="`kanal-zeile-${z.ops}`"
                    @click="emit('oeffne', z.ops)"
                >
                    <span class="karte__kopf">
                        <span class="liste__ops">{{ z.ops }}</span>
                        <span class="status" :class="`status--${statusTon(z.status)}`"
                            ><span class="status__punkt" />{{ statusName(z.status) }}</span
                        >
                    </span>
                    <span class="karte__titel">{{ titelVon(z) }}</span>
                    <span class="karte__zeile">
                        <span>{{ kategorieName(z.kategorie) }}</span>
                        <AvmPille :ton="prioritaetTon(z.prioritaet)">{{ prioritaetName(z.prioritaet) }}</AvmPille>
                    </span>
                    <span class="karte__zeile"
                        ><KanalWer :wer="{ art: z.zustaendig === 'claudia' ? 'claudia' : 'claudio' }"
                    /></span>
                </button>
            </li>
        </ul>

        <table v-else class="tafel">
            <thead>
                <tr>
                    <th scope="col">{{ t("kanal.col.vorgang") }}</th>
                    <th scope="col">{{ t("kanal.col.prioritaet") }}</th>
                    <th scope="col">{{ t("kanal.col.status") }}</th>
                    <th scope="col">{{ t("kanal.col.zustaendig") }}</th>
                    <th scope="col">
                        {{
                            props.kanal.reiter.value === "archiv" ? t("kanal.col.aufbewahrung") : t("kanal.col.zuletzt")
                        }}
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="z in zeilen"
                    :key="z.ops"
                    class="tafel__zeile"
                    :class="{ 'tafel__zeile--rest': z.abgelaufenAt !== null }"
                    tabindex="0"
                    :data-testid="`kanal-zeile-${z.ops}`"
                    @click="emit('oeffne', z.ops)"
                    @keydown.enter="emit('oeffne', z.ops)"
                >
                    <td>
                        <span class="tafel__erste"
                            ><span class="liste__ops">{{ z.ops }}</span> {{ titelVon(z) }}</span
                        >
                        <span class="tafel__zweite">{{ unterzeile(z) }}</span>
                    </td>
                    <td>
                        <AvmPille :ton="prioritaetTon(z.prioritaet)">{{ prioritaetName(z.prioritaet) }}</AvmPille>
                    </td>
                    <td>
                        <span class="status" :class="`status--${statusTon(z.status)}`"
                            ><span class="status__punkt" />{{
                                z.abgelaufenAt === null ? zustandName(z) : t("kanal.status.geloescht")
                            }}</span
                        >
                        <span
                            class="punkte"
                            :aria-label="
                                t(fortschritt(z).weg === 'fix' ? 'kanal.proofs.count' : 'kanal.progress.count', {
                                    n: fortschritt(z).erreicht,
                                    von: fortschritt(z).von,
                                })
                            "
                        >
                            <span
                                v-for="i in fortschritt(z).von"
                                :key="i"
                                class="punkt"
                                :class="{ 'punkt--voll': i <= fortschritt(z).erreicht }"
                            />
                        </span>
                    </td>
                    <td><KanalWer :wer="{ art: z.zustaendig === 'claudia' ? 'claudia' : 'claudio' }" /></td>
                    <td>
                        <span class="tafel__leise">{{
                            props.kanal.reiter.value === "archiv"
                                ? (aufbewahrung(z, now) ?? "—")
                                : zeit(z.letzteAktivitaet, now)
                        }}</span>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>

<style scoped>
.liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.liste__takt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.liste__claudio {
    color: var(--color-agent-claudio);
}

.liste__kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
}

/* Am Telefon stehen die drei Reiter auf einer Zeile, „Vorgang melden“ darunter. */
.liste--telefon .liste__kopf {
    flex-direction: column;
    align-items: flex-start;
}

.liste__leer {
    margin: 0;
    padding: var(--space-16) var(--space-4);
    color: var(--color-text-muted);
    text-align: center;
}

.liste__ops {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.tafel {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-small);
}

.tafel th {
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: 400;
    letter-spacing: var(--letter-spacing-caps);
    text-align: left;
    text-transform: uppercase;
}

.tafel td {
    padding: var(--space-6);
    border-bottom: 1px solid var(--color-divider);
    vertical-align: top;
}

.tafel__zeile {
    cursor: pointer;
    transition: background-color 120ms ease;
}

.tafel__zeile:hover {
    background: var(--color-hover-wash);
}

.tafel__zeile:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.tafel__zeile--rest td {
    background: var(--color-panel-soft);
}

.tafel__erste {
    display: block;
    color: var(--color-text-strong);
}

.tafel__zeile--rest .tafel__erste {
    color: var(--color-text);
}

.tafel__zweite,
.tafel__leise {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
}

.status__punkt {
    width: var(--avm-status-dot);
    height: var(--avm-status-dot);
    border-radius: 50%;
    background: var(--color-text-muted);
}

.status--arbeit .status__punkt {
    background: var(--color-warning);
}

.status--abnahme .status__punkt {
    background: var(--color-accent);
}

.status--fertig .status__punkt {
    background: var(--color-success);
}

.punkte {
    display: inline-flex;
    gap: var(--space-2);
    margin-left: var(--space-6);
    vertical-align: middle;
}

.punkt {
    width: var(--avm-status-dot);
    height: var(--avm-status-dot);
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px var(--color-success);
}

.punkt--voll {
    background: var(--color-success);
}

.liste__karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karte {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.karte:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.karte--rest {
    background: var(--color-panel-soft);
}

.karte__kopf,
.karte__zeile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    font-size: var(--font-size-small);
}

.karte__titel {
    color: var(--color-text-strong);
}
</style>
