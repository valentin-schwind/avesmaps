<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { LOKAL_IM_MENUE } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t, type MessageKey } from "../i18n/i18n";
import type { LokalProbe } from "./freigabe";
import type { LokalEinstellungen, LokalFeld } from "./lokal-einstellungen";

/**
 * Das Panel „Lokal im Tailnet“ im Reiter „Umgebungen“ (WI-0204 Stufe 2; Fassung 2 der Probierseite, Betreiber 2026-10-16 „Direkt
 * bauen“). Hausform der Seiten mit vielen Einstellungen (Guide §8, wie die Karteneinstellungen): Name und Satz links, das Feld im
 * Goldenen Schnitt, ↺ am Zeilenende, darunter, was eine Änderung bewirkt. Ein getippter Wert wird beim Verlassen des Feldes oder mit
 * Enter übernommen, eine Wahl sofort; der Passkey fragt dabei (Stufe S).
 *
 * Nur für Betreiber (`switch_environment`); die Ansicht zeigt das Panel sonst gar nicht.
 */
const props = defineProps<{ einstellungen: LokalEinstellungen; probe: LokalProbe; adresse: string | null }>();
const emit = defineEmits<{ pruefen: [] }>();

const werte = computed(() => props.einstellungen.werte.value);
const gesperrt = computed(() => (props.einstellungen.busy.value === null ? undefined : ""));

/** Was in den Feldern steht, solange jemand tippt; danach wieder der Stand des Servers. */
const getippt = ref<Partial<Record<LokalFeld, string>>>({});
watch(werte, () => (getippt.value = {}));
const feld = (id: LokalFeld): string => getippt.value[id] ?? String(werte.value?.[id] ?? "");
const tippe = (id: LokalFeld, text: string): void => {
    getippt.value = { ...getippt.value, [id]: text };
};
const uebernimm = async (id: LokalFeld): Promise<void> => {
    const text = getippt.value[id];
    if (text === undefined) return;
    await props.einstellungen.setze(id, text);
};
const problem = (id: LokalFeld) => props.einstellungen.probleme.value[id];

const optionen = computed(() =>
    LOKAL_IM_MENUE.map((wert) => ({ wert, text: t(`admin.umgebungen.imMenue.${wert}` as MessageKey) })),
);

/**
 * `breit`: Die Zeile steht über beiden Säulen, das Feld beginnt trotzdem am Goldenen Schnitt der linken. Der Tailscale-Name ist zu
 * lang für eine halbe Säule, und eine Auswahl braucht ihre ganze Wahl (Sprachen mit langen Wörtern).
 */
const ZEILEN: { id: LokalFeld; folge: MessageKey; vorgabe: MessageKey | null; breit: boolean }[] = [
    { id: "lokalName", folge: "admin.umgebungen.folge.menue", vorgabe: "admin.umgebungen.lokal.leer", breit: true },
    { id: "lokalPort", folge: "admin.umgebungen.folge.menue", vorgabe: null, breit: false },
    {
        id: "lokalImMenue",
        folge: "admin.umgebungen.folge.menue",
        vorgabe: "admin.umgebungen.imMenue.erreichbar",
        breit: true,
    },
];
const vorgabeText = (zeile: (typeof ZEILEN)[number]): string => (zeile.vorgabe === null ? "443" : t(zeile.vorgabe));

const probeText = computed(() => {
    if (props.adresse === null) return t("admin.umgebungen.lokal.ohneAdresse");
    if (props.probe.zustand === "laeuft") return t("admin.umgebungen.lokal.prueft");
    // Die Zeit steht nur, wenn die Probe sie gemessen hat.
    if (props.probe.zustand === "ok")
        return props.probe.ms === null
            ? t("admin.umgebungen.erreichbar")
            : t("admin.umgebungen.lokal.erreichbar", { ms: props.probe.ms });
    if (props.probe.zustand === "nein") return t("admin.umgebungen.lokal.nicht");
    return t("admin.umgebungen.lokal.ungeprueft");
});
</script>

<template>
    <FensterKarte :titel="t('admin.umgebungen.panel.titel')" data-testid="umgebungen-lokal-panel">
        <p class="panel__satz">{{ t("admin.umgebungen.panel.satz") }}</p>
        <div class="panel__werte">
            <div
                v-for="zeile in ZEILEN"
                :key="zeile.id"
                class="wert"
                :class="{ 'wert--breit': zeile.breit, 'wert--zuletzt': zeile.id === 'lokalImMenue' }"
                :data-testid="`umgebungen-${zeile.id}`"
            >
                <span class="wert__name">{{ t(`admin.umgebungen.${zeile.id}` as MessageKey) }}</span>
                <span class="wert__feld">
                    <AvmAuswahl
                        v-if="zeile.id === 'lokalImMenue'"
                        :model-value="feld(zeile.id)"
                        :optionen="optionen"
                        :gesperrt="gesperrt"
                        :aria-label="t(`admin.umgebungen.${zeile.id}` as MessageKey)"
                        :testid="`umgebungen-feld-${zeile.id}`"
                        @update:model-value="void props.einstellungen.setze(zeile.id, $event)"
                    />
                    <AvmEingabe
                        v-else
                        :model-value="feld(zeile.id)"
                        :gesperrt="gesperrt"
                        :ungueltig="problem(zeile.id) !== undefined"
                        :aria-label="t(`admin.umgebungen.${zeile.id}` as MessageKey)"
                        :inputmode="zeile.id === 'lokalPort' ? 'numeric' : undefined"
                        spellcheck="false"
                        autocomplete="off"
                        :testid="`umgebungen-feld-${zeile.id}`"
                        @update:model-value="tippe(zeile.id, $event)"
                        @blur="void uebernimm(zeile.id)"
                        @keyup.enter="void uebernimm(zeile.id)"
                    />
                </span>
                <AvmKnopf
                    art="weich"
                    groesse="zeile"
                    class="wert__zurueck"
                    :gesperrt="!props.einstellungen.abweichend.value[zeile.id] || gesperrt === '' ? '' : undefined"
                    :title="
                        props.einstellungen.abweichend.value[zeile.id]
                            ? t('admin.umgebungen.reset.to', { wert: vorgabeText(zeile) })
                            : t('admin.umgebungen.reset.ruht')
                    "
                    :aria-label="
                        t('admin.umgebungen.reset.label', { name: t(`admin.umgebungen.${zeile.id}` as MessageKey) })
                    "
                    :testid="`umgebungen-zurueck-${zeile.id}`"
                    @click="void props.einstellungen.zuruecksetzen(zeile.id)"
                >
                    <span aria-hidden="true">↺</span>
                </AvmKnopf>
                <p class="wert__satz">
                    {{ t(`admin.umgebungen.${zeile.id}.satz` as MessageKey) }}
                    <span class="wert__wirkt">{{ t(zeile.folge) }}</span>
                </p>
                <p v-if="problem(zeile.id) !== undefined" class="wert__problem" role="alert">
                    {{ t(problem(zeile.id)!.key, problem(zeile.id)!.params) }}
                </p>
            </div>

            <div class="wert" data-testid="umgebungen-probe">
                <span class="wert__name">{{ t("admin.umgebungen.probe") }}</span>
                <span class="wert__feld">
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.adresse === null || props.probe.zustand === 'laeuft' ? '' : undefined"
                        testid="umgebungen-pruefen"
                        @click="emit('pruefen')"
                        >{{ t("admin.umgebungen.pruefen") }}</AvmKnopf
                    >
                </span>
                <span></span>
                <p class="wert__satz">
                    {{ t("admin.umgebungen.probe.satz") }}
                    <span class="wert__wirkt">{{ t("admin.umgebungen.folge.nichts") }}</span>
                </p>
                <p
                    class="wert__ergebnis"
                    :class="{
                        'wert__ergebnis--gut': props.probe.zustand === 'ok',
                        'wert__ergebnis--rot': props.probe.zustand === 'nein',
                    }"
                    data-testid="umgebungen-probe-ergebnis"
                >
                    {{ probeText }}
                </p>
            </div>
        </div>
    </FensterKarte>
</template>

<style scoped>
.panel__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Zwei Säulen wie in den Karteneinstellungen; schmal eine. */
.panel__werte {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    align-items: start;
}

/* Das Feld beginnt in jeder Zeile an derselben Stelle: im Goldenen Schnitt der Säule. */
.wert {
    display: grid;
    grid-template-columns: minmax(0, 61.8%) minmax(0, 1fr) var(--space-24);
    gap: var(--space-2) var(--space-6);
    align-items: center;
    min-width: 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

/*
 * Über beide Säulen: Der Name nimmt so viel wie in der linken Säule (61,8 % der halben Breite ohne die Fuge), damit das Feld an
 * derselben Stelle beginnt wie darunter. Die Probe steht neben dem Port, die Wahl fürs Menü darunter (`order`).
 */
.wert--breit {
    grid-column: 1 / -1;
    grid-template-columns: calc((100% - var(--space-24)) * 0.309) minmax(0, 1fr) var(--space-24);
}

.wert--zuletzt {
    order: 1;
}

.wert--breit .wert__feld :deep(.auswahl-huelle) {
    flex: none;
    width: auto;
}

.wert__name {
    min-width: 0;
}

.wert__feld {
    display: flex;
    align-items: center;
    min-width: 0;
}

.wert__feld :deep(.eingabe-huelle),
.wert__feld :deep(.eingabe),
.wert__feld :deep(.auswahl-huelle),
.wert__feld :deep(.auswahl) {
    width: 100%;
    min-width: 0;
}

.wert__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.wert__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

.wert__satz,
.wert__problem,
.wert__ergebnis {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wert__wirkt {
    color: var(--color-accent-strong);
}

.wert__problem,
.wert__ergebnis--rot {
    color: var(--color-danger-soft-text);
}

.wert__ergebnis--gut {
    color: var(--color-success-soft-text);
}

@media (max-width: 900px) {
    .panel__werte {
        grid-template-columns: minmax(0, 1fr);
    }

    .wert--breit {
        grid-template-columns: minmax(0, 61.8%) minmax(0, 1fr) var(--space-24);
    }
}
</style>
