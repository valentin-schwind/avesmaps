<script setup lang="ts">
/**
 * Die Übersicht der offenen Flächen im Fenster „Regelvorschläge“ (WI-0253 §25; Vali 2026-10-27: „bau im Regelfenster einen Knopf, der einer gleichnamigen Fläche ohne Wiki-Schlüssel den Schlüssel zuweist“).
 *
 * Eine Regel wartet (F4, „!“), wenn ihre Bedingung auf einen Artikel zeigt, den keine Fläche der Karte trägt. Gibt es eine Fläche GLEICHEN NAMENS ohne Wiki-Schlüssel, steht sie hier mit der Zahl der
 * Vorschläge, die auf sie warten, und einem Knopf, der ihr den Artikel zuweist. Der Name allein rät nichts: Der Mensch drückt, der Server prüft. Danach muss neu abgeleitet werden; eine Zuweisung aus
 * diesem Fenster lässt sich zurücknehmen, solange die Zuordnung der Fläche noch so dasteht.
 *
 * - Nur Anzeige und zwei Ereignisse (`zuweisen`, `zuruecknehmen`); die Rückfrage und das Senden gehören dem Fenster. Mehrere Flächen gleichen Namens ohne Schlüssel (`mehrdeutig`) bekommen keinen Knopf.
 * - Der Knopf trägt den Namen der Kartenfläche („Südaventurien“ zuweisen), damit man sieht, WEM der Artikel zugewiesen wird.
 */
import { computed } from "vue";
import type { WikisyncRegelOffeneFlaeche } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { anzahl, zahl, zeitpunkt } from "./wikisync-text";

const props = defineProps<{
    flaechen: readonly WikisyncRegelOffeneFlaeche[];
    /** Warum die Knöpfe gerade nicht gehen (fehlendes Recht, andere Handlung unterwegs); `undefined`: sie gehen. */
    sperre: string | undefined;
    jetzt: Date;
}>();
const emit = defineEmits<{
    zuweisen: [eintrag: WikisyncRegelOffeneFlaeche];
    zuruecknehmen: [eintrag: WikisyncRegelOffeneFlaeche];
}>();

/** Wie viele Flächen noch ohne Wiki-Schlüssel dastehen (zuweisbar oder mehrdeutig). */
const offene = computed(() => props.flaechen.filter((eintrag) => eintrag.zustand !== "zugewiesen").length);
const titel = computed(() =>
    offene.value > 0
        ? t("admin.wikisync.regeln.flaechen.titel", { flaechen: anzahl.flaechen(offene.value) })
        : t("admin.wikisync.regeln.flaechen.titelFertig"),
);
/** Der Artikel nur dann, wenn er sich vom Namen der Fläche unterscheidet („Transysilien“ trägt „Transysilien (Region)“). */
const artikel = (eintrag: WikisyncRegelOffeneFlaeche): string | null =>
    eintrag.titel.trim().toLowerCase() === eintrag.name.trim().toLowerCase()
        ? null
        : t("admin.wikisync.regeln.flaechen.artikel", { titel: eintrag.titel });
const schluessel = (eintrag: WikisyncRegelOffeneFlaeche): string => `${eintrag.titel}|${eintrag.name}`;
</script>

<template>
    <section class="wsync-flaechen" data-testid="wsync-regeln-flaechen">
        <h4 class="wsync-flaechen__titel" data-testid="wsync-regeln-flaechen-titel">{{ titel }}</h4>
        <p v-if="offene > 0" class="wsync-flaechen__leise">{{ t("admin.wikisync.regeln.flaechen.satz") }}</p>
        <ul class="wsync-flaechen__liste">
            <li
                v-for="eintrag in flaechen"
                :key="schluessel(eintrag)"
                class="wsync-flaechen__zeile"
                :data-flaeche="eintrag.kennung ?? undefined"
                :data-zustand="eintrag.zustand"
            >
                <span class="wsync-flaechen__text">
                    <span class="wsync-flaechen__name">{{ eintrag.name }}</span>
                    <span class="wsync-flaechen__klein">
                        <template v-if="artikel(eintrag) !== null">{{ artikel(eintrag) }} · </template
                        >{{ t("admin.wikisync.regeln.flaechen.warten", { n: zahl(eintrag.vorschlaege) }) }}
                    </span>
                    <span v-if="eintrag.zustand === 'zugewiesen'" class="wsync-flaechen__klein">
                        {{ t("admin.wikisync.regeln.flaechen.traegt", { titel: eintrag.titel }) }}
                        <template v-if="eintrag.zuruecknehmbar && eintrag.zugewiesenAm !== null">
                            ·
                            {{
                                t("admin.wikisync.regeln.flaechen.zugewiesenVon", {
                                    zeit: zeitpunkt(eintrag.zugewiesenAm, jetzt),
                                    von: eintrag.zugewiesenVon ?? "—",
                                })
                            }}
                        </template>
                    </span>
                    <span v-else-if="eintrag.zustand === 'mehrdeutig'" class="wsync-flaechen__klein">{{
                        t("admin.wikisync.regeln.flaechen.mehrdeutig")
                    }}</span>
                </span>
                <span class="wsync-flaechen__aktion">
                    <AvmKnopf
                        v-if="eintrag.zustand === 'zuweisbar'"
                        groesse="zeile"
                        :gesperrt="sperre"
                        :testid="`wsync-regeln-flaeche-zuweisen-${eintrag.kennung ?? ''}`"
                        @click="emit('zuweisen', eintrag)"
                        >{{ t("admin.wikisync.regeln.flaechen.zuweisen", { name: eintrag.name }) }}</AvmKnopf
                    >
                    <template v-else-if="eintrag.zustand === 'zugewiesen'">
                        <AvmPille ton="erfolg">{{ t("admin.wikisync.regeln.flaechen.zugewiesenPille") }}</AvmPille>
                        <AvmKnopf
                            v-if="eintrag.zuruecknehmbar"
                            groesse="zeile"
                            :gesperrt="sperre"
                            :testid="`wsync-regeln-flaeche-zurueck-${eintrag.kennung ?? ''}`"
                            @click="emit('zuruecknehmen', eintrag)"
                            >{{ t("admin.wikisync.regeln.flaechen.zuruecknehmen") }}</AvmKnopf
                        >
                    </template>
                </span>
            </li>
        </ul>
    </section>
</template>

<style scoped>
.wsync-flaechen {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.wsync-flaechen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}

.wsync-flaechen__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wsync-flaechen__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.wsync-flaechen__zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4) var(--space-8);
    align-items: center;
    padding: var(--space-4) 0;
    border-top: 1px solid var(--color-divider);
}

.wsync-flaechen__zeile:first-child {
    border-top: 0;
}

.wsync-flaechen__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
}

.wsync-flaechen__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.wsync-flaechen__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.wsync-flaechen__aktion {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4) var(--space-6);
}

@container wsync-regeln (max-width: 44em) {
    .wsync-flaechen__zeile {
        grid-template-columns: minmax(0, 1fr);
    }

    .wsync-flaechen__aktion {
        justify-content: flex-start;
    }
}
</style>
