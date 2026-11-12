<script setup lang="ts">
/**
 * Die Liste der Token-Links oder API-Schlüssel (WI-0280). Der Kreis sagt den Zustand: ● aktiv · ◐ läuft bald ab · ○ beendet; Legende und Zählung als EINE Zeile unter der
 * Liste (Editor-Stilregeln). Eine Zeile klappt auf: wer sie anlegte, die letzten Abrufe, „Neu ausstellen“ und „Zurücknehmen“. Der Wert selbst steht nie hier: Gespeichert ist nur
 * sein Hash, verloren heißt neu ausstellen.
 */
import { computed, ref } from "vue";
import {
    KARTEN_BALD_TAGE,
    KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE,
    KARTEN_ZUGANG_HOECHSTENS,
    type KartenAbruf,
    type KartenExportStand,
    type KartenZugang,
    type KartenZugangArt,
} from "@avesmaps3d/shared";
import { datumText, groesseText, kartenName, zeitText, type KartenExportSicht } from "./karten-export";
import { formProblems } from "../auth/formular";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKopierfeld from "../controls/avm-kopierfeld.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import { t } from "../i18n/i18n";

const props = defineProps<{ art: KartenZugangArt; sicht: KartenExportSicht; stand: KartenExportStand }>();
const emit = defineEmits<{ neu: [] }>();

type Lage = "aktiv" | "bald" | "aus";
type Sortierung = "neu" | "frist" | "name";
const TAG_MS = 86_400_000;
const KREIS: Record<Lage, string> = { aktiv: "●", bald: "◐", aus: "○" };
const SORT_ZEICHEN = { neu: "zeit", frist: "zustand", name: "name" } as const;

const suche = ref("");
const wahl = ref<FilterWahl>({});
const sortierung = ref<Sortierung>("neu");
const offen = ref<string | null>(null);
const neuerWert = ref<{ id: string; wert: string } | null>(null);
const fehler = ref<string | null>(null);

const zugaenge = computed(() => (props.art === "link" ? props.stand.links : props.stand.schluessel));
const jetzt = computed(() => new Date(props.stand.jetzt).getTime());

function restTage(zugang: KartenZugang): number {
    return Math.ceil((new Date(zugang.laeuftAb).getTime() - jetzt.value) / TAG_MS);
}

function lage(zugang: KartenZugang): Lage {
    if (zugang.zustand !== "aktiv") return "aus";
    return restTage(zugang) <= KARTEN_BALD_TAGE ? "bald" : "aktiv";
}

function fristText(zugang: KartenZugang): string {
    if (zugang.zustand === "abgelaufen")
        return t("kartenExport.frist.abgelaufen", { datum: datumText(zugang.laeuftAb) });
    if (zugang.zustand === "widerrufen") {
        return t("kartenExport.frist.widerrufen", { datum: datumText(zugang.widerrufen ?? zugang.laeuftAb) });
    }
    const rest = restTage(zugang);
    return rest <= 1 ? t("kartenExport.frist.tag") : t("kartenExport.frist.tage", { n: rest });
}

const namen = computed(() => new Map(props.stand.karten.map((k) => [k.id, kartenName(k)])));
function kartenListe(zugang: KartenZugang): string {
    return zugang.karten.map((id) => namen.value.get(id) ?? id).join(" · ");
}

function groesse(zugang: KartenZugang): string {
    const bytes = zugang.karten.reduce((n, id) => n + (props.stand.karten.find((k) => k.id === id)?.bytes ?? 0), 0);
    return groesseText(bytes);
}

function abrufText(abruf: KartenAbruf): string {
    if (abruf.zustand === "laeuft") return t("kartenExport.abruf.laeuft");
    return abruf.zustand === "vollstaendig"
        ? t("kartenExport.abruf.vollstaendig", { groesse: groesseText(abruf.bytes) })
        : t("kartenExport.abruf.abgebrochen", { groesse: groesseText(abruf.geliefert) });
}

const abschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "zustand",
        titel: t("kartenExport.liste.filter.zustand"),
        art: "mehrere",
        werte: (["aktiv", "bald", "aus"] as const).map((wert) => ({
            wert,
            text: t(`kartenExport.zustand.${wert}`),
            zahl: zugaenge.value.filter((z) => lage(z) === wert).length,
        })),
    },
]);

function setzeFilter(abschnitt: string, werte: string[]): void {
    wahl.value = { ...wahl.value, [abschnitt]: werte };
}

const sichtbar = computed(() => {
    const text = suche.value.trim().toLowerCase();
    const zustaende = wahl.value["zustand"] ?? [];
    const liste = zugaenge.value.filter(
        (z) =>
            (zustaende.length === 0 || zustaende.includes(lage(z))) &&
            (text === "" || `${z.fuerWen} ${z.kennung} ${kartenListe(z)}`.toLowerCase().includes(text)),
    );
    if (sortierung.value === "name") return [...liste].sort((a, b) => a.fuerWen.localeCompare(b.fuerWen));
    if (sortierung.value === "frist") {
        const rang = (z: KartenZugang): number => (lage(z) === "aus" ? 1 : 0);
        return [...liste].sort((a, b) => rang(a) - rang(b) || a.laeuftAb.localeCompare(b.laeuftAb));
    }
    return liste;
});

const sortOptionen = computed(() =>
    (["neu", "frist", "name"] as const).map((wert) => ({ wert, text: t(`kartenExport.liste.sort.${wert}`) })),
);
const sortBezeichnung = computed(() => t(`kartenExport.liste.sort.${sortierung.value}`));

const zaehlung = computed(() => {
    const anzahl = (gesucht: Lage): number => zugaenge.value.filter((z) => lage(z) === gesucht).length;
    return { aktiv: anzahl("aktiv"), bald: anzahl("bald"), aus: anzahl("aus") };
});

async function handle(arbeit: () => Promise<void>): Promise<void> {
    fehler.value = null;
    try {
        await arbeit();
    } catch (error) {
        const [satz] = formProblems(error);
        fehler.value = satz === undefined ? t("auth.form.failed") : t(satz.key, satz.params);
    }
}

function stelleNeuAus(zugang: KartenZugang): void {
    void handle(async () => {
        const neu = await props.sicht.stelleNeuAus(zugang.id);
        offen.value = neu.id;
        neuerWert.value = { id: neu.id, wert: neu.wert };
    });
}

function nimmZurueck(zugang: KartenZugang): void {
    void handle(() => props.sicht.nimmZurueck(zugang.id));
}
</script>

<template>
    <div class="zugaenge" :data-testid="`karten-zugaenge-${art}`">
        <div class="zugaenge__leiste">
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('kartenExport.liste.suche')"
                :beschriftung="t('kartenExport.liste.sucheLabel')"
                class="zugaenge__suche"
                :testid="`karten-liste-${art}`"
            >
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="wahl"
                    :testid="`karten-liste-${art}-filter`"
                    @setze="setzeFilter"
                    @loesen="wahl = {}"
                />
                <AvmMenueknopf
                    :model-value="sortierung"
                    :optionen="sortOptionen"
                    :bezeichnung="sortBezeichnung"
                    :menue-bezeichnung="t('kartenExport.liste.sort.label')"
                    im-fenster
                    :testid="`karten-liste-${art}-sortierung`"
                    @update:model-value="(wert: string) => (sortierung = wert as Sortierung)"
                >
                    <template #zeichen="{ wert }">
                        <AvmSortierzeichen :art="SORT_ZEICHEN[wert as Sortierung]" />
                    </template>
                </AvmMenueknopf>
            </AvmListenleiste>
            <AvmKnopf :testid="`karten-liste-${art}-neu`" @click="emit('neu')">
                <span aria-hidden="true">✚ </span
                >{{ art === "link" ? t("kartenExport.liste.neuLink") : t("kartenExport.liste.neuSchluessel") }}
            </AvmKnopf>
        </div>
        <AvmHinweis v-if="fehler" ton="warnung" rolle="alert">{{ fehler }}</AvmHinweis>
        <p v-if="sichtbar.length === 0" class="zugaenge__leise">
            {{ zugaenge.length === 0 ? t("kartenExport.liste.leer") : t("kartenExport.liste.nichts") }}
        </p>
        <article
            v-for="zugang in sichtbar"
            :key="zugang.id"
            class="zugang"
            :class="{ 'is-aus': lage(zugang) === 'aus' }"
            :data-testid="`karten-zugang-${zugang.id}`"
        >
            <button
                type="button"
                class="zugang__zeile"
                :aria-expanded="offen === zugang.id"
                @click="offen = offen === zugang.id ? null : zugang.id"
            >
                <span class="zugang__kreis" :title="t(`kartenExport.zustand.${lage(zugang)}`)" aria-hidden="true">{{
                    KREIS[lage(zugang)]
                }}</span>
                <span class="zugang__text">
                    <span class="zugang__name">{{ zugang.fuerWen }}</span>
                    <span class="zugang__unter">
                        <template v-if="art === 'schluessel'">{{ zugang.kennung }}… · </template
                        >{{ kartenListe(zugang) }} · {{ groesse(zugang) }}
                    </span>
                </span>
                <span class="zugang__stand">
                    <span>{{ fristText(zugang) }}</span>
                    <span class="zugang__leise">{{ t("kartenExport.abrufe", { n: zugang.abrufe }) }}</span>
                </span>
            </button>
            <div v-if="offen === zugang.id" class="zugang__mehr">
                <p class="zugaenge__leise">
                    {{
                        zugang.von === null
                            ? t("kartenExport.erstelltOhne", { datum: datumText(zugang.angelegt) })
                            : t("kartenExport.erstellt", { name: zugang.von, datum: datumText(zugang.angelegt) })
                    }}
                </p>
                <ul v-if="zugang.letzteAbrufe.length > 0" class="abrufe">
                    <li v-for="abruf in zugang.letzteAbrufe" :key="abruf.zeit">
                        <span>{{ zeitText(abruf.zeit) }}</span>
                        <span class="zugang__leise">{{ abrufText(abruf) }}</span>
                    </li>
                </ul>
                <p v-else class="zugaenge__leise">{{ t("kartenExport.keineAbrufe") }}</p>
                <template v-if="neuerWert?.id === zugang.id">
                    <AvmKopierfeld
                        :wert="neuerWert.wert"
                        :beschriftung="t('kartenExport.weiter.wert')"
                        :testid="`karten-zugang-${art}-wert`"
                    />
                    <p class="zugaenge__leise">
                        {{
                            art === "link"
                                ? t("kartenExport.aktion.neuLink")
                                : t("kartenExport.aktion.neuSchluessel", { n: KARTEN_SCHLUESSEL_UEBERLAPPUNG_TAGE })
                        }}
                    </p>
                </template>
                <div class="zugang__knoepfe">
                    <AvmKnopf groesse="zeile" :testid="`karten-zugang-neu-${zugang.id}`" @click="stelleNeuAus(zugang)">
                        <span aria-hidden="true">↺ </span>{{ t("kartenExport.aktion.neu") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="lage(zugang) !== 'aus'"
                        groesse="zeile"
                        :testid="`karten-zugang-weg-${zugang.id}`"
                        @click="nimmZurueck(zugang)"
                    >
                        <span aria-hidden="true">✕ </span
                        >{{ art === "link" ? t("kartenExport.aktion.zurueck") : t("kartenExport.aktion.widerrufen") }}
                    </AvmKnopf>
                </div>
            </div>
        </article>
        <p class="zugaenge__legende" :data-testid="`karten-liste-${art}-legende`">
            {{ t("kartenExport.legende", zaehlung) }} ·
            {{ t("kartenExport.deckel", { n: zaehlung.aktiv + zaehlung.bald, max: KARTEN_ZUGANG_HOECHSTENS }) }}
        </p>
    </div>
</template>

<style scoped>
.zugaenge {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.zugaenge__leiste {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
}

.zugaenge__suche {
    flex: 1 1 auto;
    min-width: 0;
}

.zugaenge__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.zugaenge__legende {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.zugang {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.zugang.is-aus {
    background: var(--color-panel-soft);
}

.zugang__zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-8);
    align-items: center;
    width: 100%;
    padding: var(--space-6) var(--space-8);
    border: 0;
    border-radius: inherit;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.zugang__zeile:hover {
    background: var(--color-hover-wash);
}

.zugang__zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zugang__kreis {
    color: var(--color-accent-strong);
    font-size: var(--font-size-reading);
    line-height: 1;
}

.zugang__text {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.zugang__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    overflow-wrap: anywhere;
}

.zugang.is-aus .zugang__name {
    color: var(--color-text-muted);
}

.zugang__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.zugang__stand {
    display: grid;
    gap: var(--space-2);
    justify-items: end;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.zugang__leise {
    color: var(--color-text-muted);
}

.zugang__mehr {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-8) var(--space-8);
    border-top: 1px solid var(--color-divider);
}

.zugang__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.abrufe {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    list-style: none;
}

.abrufe li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 var(--space-8);
}

@media (max-width: 600px) {
    .zugang__zeile {
        grid-template-columns: auto minmax(0, 1fr);
    }

    .zugang__stand {
        grid-column: 2;
        grid-auto-flow: column;
        justify-content: start;
        gap: var(--space-8);
    }
}
</style>
