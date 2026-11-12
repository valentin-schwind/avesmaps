<script setup lang="ts">
/**
 * Der Laufbericht (WI-0253 §20, Entwurf `review/wi-0253/wikisync-ablauf-mockup.html`): was die letzte Übernahme je Bereich tat, mit „Zurücknehmen“ je Bereich (und, wo mehr als ein Bereich eines Laufs
 * noch steht, dem ganzen Lauf). Der Bericht klappt von selbst auf, wenn ein Lauf endet; darunter die Summe und woher sie stammt (Dump, Kategorien-Datei, Dauer).
 *
 * - **Zurücknehmen** ab Admin mit Passkey (Vali 2026-10-25); die anderen Bereiche des Laufs bleiben stehen. Ein Satz nennt den Grund, wo der Knopf gesperrt ist.
 * - Der Bericht ändert nichts, was nicht ausdrücklich zurückgenommen wird; die Zahlen sind die des Protokolls der Übernahme (`wikisync_uebernahme`).
 */
import { computed, ref, watch } from "vue";
import type { WikisyncBereich, WikisyncBereichStand, WikisyncStand } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import type { Wikisync } from "./wikisync";
import { berichtZeile, herkunftSatz, laufAktiv, laufBilanz, type AblaufDaten } from "./wikisync-ablauf";
import { anzahl, auftragVon, bereichName, laeuftSchonSatz, zahl, zeitpunkt } from "./wikisync-text";

const props = defineProps<{
    wikisync: Wikisync;
    stand: WikisyncStand;
    jetzt: Date;
    darfZurueck: boolean;
    rechtSatz: (recht: string) => string;
}>();

const ws = props.wikisync;
const offen = ref(false);
const frage = ref<"ganz" | `zurueck:${WikisyncBereich}` | null>(null);

const daten = computed((): AblaufDaten | null =>
    ws.bereiche.value === null ? null : { stand: props.stand, bereiche: ws.bereiche.value },
);
const auftrag = computed(() => auftragVon(props.stand, "wiki_uebernehmen", "wiki_zuruecknehmen"));

/** Endet ein Lauf, klappt sein Bericht auf; ein alter Bericht bleibt zu, bis jemand ihn öffnet. */
const aktiv = computed(() => daten.value !== null && laufAktiv(daten.value));
watch(aktiv, (jetztAktiv, vorher) => {
    if (vorher && !jetztAktiv) offen.value = true;
});

const zeilen = computed(() =>
    (ws.bereiche.value?.bereiche ?? []).filter(
        (
            stand,
        ): stand is WikisyncBereichStand & {
            letzteUebernahme: NonNullable<WikisyncBereichStand["letzteUebernahme"]>;
        } => stand.letzteUebernahme !== null,
    ),
);
const juengste = computed(
    () => zeilen.value.map((stand) => stand.letzteUebernahme.gestartetAm).sort((a, b) => b.localeCompare(a))[0],
);

function zuruecknehmbar(stand: WikisyncBereichStand): boolean {
    const u = stand.letzteUebernahme;
    return u !== null && u.art === "uebernahme" && u.status === "fertig" && u.felder > 0 && !u.zurueckgenommen;
}

function zurueckSperre(): string | undefined {
    if (!props.darfZurueck) return props.rechtSatz("undo_wikisync_run");
    if (aktiv.value && auftrag.value !== undefined)
        return laeuftSchonSatz(auftrag.value, "admin.wikisync.fehler.uebernahme_laeuft");
    if (aktiv.value) return t("admin.wikisync.tafel.sperre.laeuft");
    return undefined;
}

/** Der Lauf, dessen Übernahmen in mehr als einem Bereich noch stehen: Er lässt sich ganz zurücknehmen. */
const ganzerLauf = computed((): { lauf: number; bereiche: number } | null => {
    const jeLauf = new Map<number, number>();
    for (const stand of zeilen.value) {
        if (zuruecknehmbar(stand)) {
            jeLauf.set(stand.letzteUebernahme.lauf, (jeLauf.get(stand.letzteUebernahme.lauf) ?? 0) + 1);
        }
    }
    const [bester] = [...jeLauf.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    return bester === undefined || bester[1] < 2 ? null : { lauf: bester[0], bereiche: bester[1] };
});

async function ganzZuruecknehmen(): Promise<void> {
    frage.value = null;
    if (ganzerLauf.value !== null) await ws.zuruecknehmen(ganzerLauf.value.lauf);
}

async function zuruecknehmen(stand: WikisyncBereichStand): Promise<void> {
    frage.value = null;
    const u = stand.letzteUebernahme;
    if (u === null) return;
    await ws.zuruecknehmen(u.lauf, stand.bereich);
}

const bilanz = computed(() => (daten.value === null ? null : laufBilanz(daten.value)));
const summe = computed(() => {
    const b = bilanz.value;
    if (b === null) return "";
    return t("admin.wikisync.laufbericht.summe", {
        teile: [
            t("admin.wikisync.laufbericht.uebernommen", { felder: anzahl.felder(b.felder) }),
            ...(b.gleich === null ? [] : [t("admin.wikisync.laufbericht.unveraendert", { n: zahl(b.gleich) })]),
            anzahl.befunde(b.befunde),
        ].join(" · "),
    });
});
const herkunft = computed(() => (bilanz.value === null ? "" : herkunftSatz(bilanz.value)));
</script>

<template>
    <AvmDisclosure
        v-if="zeilen.length > 0 && daten !== null"
        v-model:open="offen"
        :label="t('admin.wikisync.laufbericht.titel')"
        v-bind="juengste === undefined ? {} : { secondary: zeitpunkt(juengste, jetzt) }"
        toggle-testid="wsync-laufbericht"
    >
        <ul class="wsync-bericht">
            <li
                v-for="bs in zeilen"
                :key="bs.bereich"
                class="wsync-bericht__bereich"
                :data-testid="`wsync-laufbericht-${bs.bereich}`"
            >
                <div class="wsync-bericht__kopf">
                    <span
                        class="wsync-bericht__name"
                        :class="{
                            'wsync-bericht__name--zurueck':
                                bs.letzteUebernahme.zurueckgenommen || bs.letzteUebernahme.art === 'zuruecknahme',
                        }"
                        >{{ bereichName(bs.bereich) }}</span
                    >
                    <AvmKnopf
                        v-if="zuruecknehmbar(bs)"
                        groesse="zeile"
                        :gesperrt="frage === `zurueck:${bs.bereich}` ? undefined : zurueckSperre()"
                        :testid="`wsync-zurueck-${bs.bereich}`"
                        @click="frage = frage === `zurueck:${bs.bereich}` ? null : `zurueck:${bs.bereich}`"
                        ><span aria-hidden="true">↺ </span>{{ t("admin.wikisync.laufbericht.zurueck") }}</AvmKnopf
                    >
                </div>
                <p class="wsync-bericht__zahlen">
                    {{ berichtZeile(daten, bs, jetzt) }} ·
                    {{
                        t("admin.wikisync.laufbericht.wann", {
                            zeit: zeitpunkt(bs.letzteUebernahme.beendetAm ?? bs.letzteUebernahme.gestartetAm, jetzt),
                            wer: bs.letzteUebernahme.ausgeloestVon ?? t("admin.wikisync.automatisch"),
                        })
                    }}
                </p>
                <AvmBestaetigung
                    v-if="frage === `zurueck:${bs.bereich}`"
                    :frage="t('admin.wikisync.zurueck.frage', { bereich: bereichName(bs.bereich) })"
                    :folge="t('admin.wikisync.zurueck.folge')"
                    :bestaetigen="t('admin.wikisync.laufbericht.zurueck')"
                    :gesperrt="ws.busy.value === null ? undefined : ''"
                    :testid="`wsync-zurueck-${bs.bereich}-frage`"
                    @bestaetigen="zuruecknehmen(bs)"
                    @abbrechen="frage = null"
                />
            </li>
        </ul>
        <div v-if="bilanz !== null" class="wsync-bericht__fuss">
            <p class="wsync-bericht__summe" data-testid="wsync-bericht-summe">{{ summe }}</p>
            <p class="wsync-bericht__herkunft">{{ herkunft }}</p>
        </div>
        <div v-if="ganzerLauf !== null" class="wsync-bericht__ganz">
            <AvmKnopf
                groesse="zeile"
                :gesperrt="frage === 'ganz' ? undefined : zurueckSperre()"
                :aria-expanded="frage === 'ganz'"
                testid="wsync-zurueck-ganz"
                @click="frage = frage === 'ganz' ? null : 'ganz'"
                ><span aria-hidden="true">↺ </span>{{ t("admin.wikisync.laufbericht.ganzZurueck") }}</AvmKnopf
            >
            <AvmBestaetigung
                v-if="frage === 'ganz'"
                :frage="t('admin.wikisync.zurueck.frageGanz', { lauf: ganzerLauf.lauf })"
                :folge="t('admin.wikisync.zurueck.folgeGanz')"
                :bestaetigen="t('admin.wikisync.zurueck.bestaetigenGanz')"
                :gesperrt="ws.busy.value === null ? undefined : ''"
                testid="wsync-zurueck-ganz-frage"
                @bestaetigen="ganzZuruecknehmen()"
                @abbrechen="frage = null"
            />
        </div>
    </AvmDisclosure>
</template>

<style scoped>
.wsync-bericht {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.wsync-bericht__bereich {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--color-divider);
}

.wsync-bericht__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-8);
}

.wsync-bericht__name {
    color: var(--color-text-strong);
}

.wsync-bericht__name--zurueck {
    color: var(--color-text-muted);
    text-decoration: line-through;
}

.wsync-bericht__zahlen {
    margin: 0;
    color: var(--color-text-muted);
}

.wsync-bericht__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2) var(--space-10);
    padding-top: var(--space-4);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.wsync-bericht__summe,
.wsync-bericht__herkunft {
    margin: 0;
}

.wsync-bericht__summe {
    color: var(--color-text-strong);
}

.wsync-bericht__herkunft {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wsync-bericht__ganz {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
    margin-top: var(--space-6);
}
</style>
