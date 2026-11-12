<script setup lang="ts">
import { computed } from "vue";
import type { Kurzinfo, KURZINFO_ABSCHNITTE } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t, type MessageKey } from "../i18n/i18n";
import { wann } from "./versionen";

/**
 * Die Kurzinfo „Was ist neu?“ (WI-0137, VERSION-0001 §4, Blatt 2): Kopf mit Stand, die vorhandenen Abschnitte Anschauen · Prüfen ·
 * Beachten, unten „Alle Änderungen“ (nur mit `view_operations`, öffnet Systemsteuerung › Versionen) und „↺ Neu laden“. Ohne geschriebene
 * Kurzinfo nur „↺ Neu laden“ (Vorgabe 3). Ein Text bleibt Text.
 *
 * `eingebettet`: am Telefon im Eintrag „Neue Version verfügbar“ der Glocke, nur die Abschnitte; „Neu laden“ und „Alle Änderungen“ trägt der
 * Eintrag in seiner Knopfzeile.
 */
const props = defineProps<{ kurzinfo: Kurzinfo | null; betrieb?: boolean; eingebettet?: boolean }>();
const emit = defineEmits<{ neuLaden: []; alle: [] }>();

/** Überschrift und Kennung je Abschnitt; die Datei schreibt die deutschen Namen (`KURZINFO_ABSCHNITTE`). */
const ABSCHNITT: Record<(typeof KURZINFO_ABSCHNITTE)[number], { titel: MessageKey; id: string }> = {
    // Aus den Commits (Regel „Neu:/Achtung:“, Betreiber 2026-10-17).
    Neu: { titel: "version.section.new", id: "neu" },
    Achtung: { titel: "version.section.attention", id: "achtung" },
    Anschauen: { titel: "version.section.look", id: "anschauen" },
    Prüfen: { titel: "version.section.check", id: "pruefen" },
    Beachten: { titel: "version.section.note", id: "beachten" },
};
const abschnitte = computed(() => props.kurzinfo?.abschnitte ?? []);
const stand = computed(() => props.kurzinfo?.stand ?? null);
/** Punkte ohne `Neu:`-Zeile: nur die Titelzeile des Commits, gekennzeichnet. */
const unredigiert = computed(() => new Set(props.kurzinfo?.unredigiert ?? []));
</script>

<template>
    <div class="kurz" :class="{ 'kurz--eingebettet': props.eingebettet }" data-testid="kurzinfo">
        <div v-if="!props.eingebettet" class="kurz__kopf">
            <span class="kurz__titel">{{ t("version.whatsNew") }}</span>
            <span v-if="stand !== null" class="kurz__stand">{{ t("version.stand", { when: wann(stand) }) }}</span>
        </div>
        <section
            v-for="abschnitt in abschnitte"
            :key="abschnitt.titel"
            class="kurz__abschnitt"
            :data-testid="`kurzinfo-${ABSCHNITT[abschnitt.titel].id}`"
        >
            <h3 class="kurz__ueber">{{ t(ABSCHNITT[abschnitt.titel].titel) }}</h3>
            <ul class="kurz__punkte">
                <li
                    v-for="(punkt, i) in abschnitt.punkte"
                    :key="i"
                    :class="{ kurz__unredigiert: abschnitt.titel === 'Neu' && unredigiert.has(punkt) }"
                >
                    {{ punkt
                    }}<span v-if="abschnitt.titel === 'Neu' && unredigiert.has(punkt)" class="kurz__marke">
                        · {{ t("version.unedited") }}</span
                    >
                </li>
            </ul>
        </section>
        <p v-if="props.kurzinfo?.mehr === true" class="kurz__mehr" data-testid="kurzinfo-mehr">
            {{ t("version.more") }}
        </p>
        <div v-if="!props.eingebettet" class="kurz__fuss">
            <button
                v-if="props.betrieb"
                type="button"
                class="kurz__alle"
                data-testid="kurzinfo-alle"
                @click="emit('alle')"
            >
                {{ t("version.allChanges") }}
            </button>
            <AvmKnopf groesse="zeile" testid="kurzinfo-neu-laden" @click="emit('neuLaden')">
                <span aria-hidden="true">↺ </span>{{ t("version.reload") }}
            </AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
.kurz {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    color: var(--color-text);
    white-space: normal;
    text-align: left;
}

.kurz__kopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
}

.kurz__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.kurz__stand {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

.kurz__abschnitt {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.kurz--eingebettet .kurz__abschnitt:first-child {
    padding-top: 0;
    border-top: 0;
}

.kurz__ueber {
    margin: 0 0 var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kurz__punkte {
    margin: 0;
    padding-left: var(--space-12);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.kurz__punkte li + li {
    margin-top: var(--space-2);
}

.kurz__fuss {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-8);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

/* Ein Link, der im Haus bleibt (öffnet ein Fenster), trägt kein ↗ (Hausregel in `styles/canon.css`); deshalb ein Knopf in Linkgestalt. */
.kurz__alle {
    margin-right: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
    transition: color 120ms ease;
}

.kurz__alle:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.kurz__alle:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Nur die Titelzeile eines Commits, ohne `Neu:`: als solche erkennbar (Regel 2026-10-17, „sonst die Titelzeile als unredigiert“). */
.kurz__unredigiert {
    color: var(--color-text-muted);
    font-style: italic;
}

.kurz__marke {
    font-style: normal;
}

.kurz__mehr {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
