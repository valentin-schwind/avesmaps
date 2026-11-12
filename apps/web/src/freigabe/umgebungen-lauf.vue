<script setup lang="ts">
import { computed, inject } from "vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { ZEIGE_VORGANG } from "../auth/verwaltung";
import { dauerText, laeuftGerade, schritte, uhrzeit, type Freigabe, type Schritt } from "./freigabe";

/**
 * Die Stationen einer Freigabe oder eines Rückwegs in der Ansicht „Umgebungen“ (WI-0204; der Betreiber wählte „Nur Stationen“): der
 * Auftrag, die Phasen, die Claudios Abholer meldet, und das Ende, je mit Zeit. Darunter ein Satz, was gerade geschieht oder wie es
 * ausging. Alles Weitere steht im Vorgang bei „Claudia & Claudio“.
 *
 * `jetzt` kommt von der Ansicht, die im Sekundentakt zählt; dieses Bauteil fragt selbst nichts nach.
 */
const props = defineProps<{ freigabe: Freigabe; jetzt: number }>();

const zeigeVorgang = inject(ZEIGE_VORGANG, null);
const lauf = computed(() => props.freigabe.lauf.value);
const laeuft = computed(() => laeuftGerade(lauf.value));
const stationen = computed(() => (lauf.value === null ? [] : schritte(lauf.value)));

const titel = computed(() => {
    const l = lauf.value;
    if (l === null) return "";
    return t(l.art === "rollback" ? "admin.umgebungen.lauf.rollback" : "admin.umgebungen.lauf.release", { ops: l.ops });
});

/** Wie lange der Lauf schon läuft oder lief, in ms; `null`: ohne Ende nicht bekannt. */
const dauer = computed<number | null>(() => {
    const l = lauf.value;
    if (l === null) return null;
    const beginn = Date.parse(l.fortschritt?.beginn ?? l.seit);
    const ende = laeuft.value ? props.jetzt : Date.parse(l.fortschritt?.ende ?? "");
    return Number.isFinite(beginn) && Number.isFinite(ende) ? Math.max(0, ende - beginn) : null;
});

const uhr = computed(() => {
    const ms = dauer.value;
    if (ms === null) return "";
    return t(laeuft.value ? "admin.umgebungen.lauf.seit" : "admin.umgebungen.lauf.dauer", { dauer: dauerText(ms) });
});

function schrittZeit(schritt: Schritt): string {
    if (schritt.id === "auftrag") return uhrzeit(schritt.seit, locale.value);
    if (schritt.zustand === "jetzt")
        return schritt.seit === null ? "" : dauerText(props.jetzt - Date.parse(schritt.seit));
    if (schritt.zustand === "unbekannt") return t("admin.umgebungen.nichtGemeldet");
    if (schritt.id === "live" || schritt.id === "fertig")
        return schritt.zustand === "fertig" ? uhrzeit(schritt.seit, locale.value) : "";
    return schritt.ms === null ? "" : dauerText(schritt.ms);
}

/** Der Satz unter den Stationen: was gerade geschieht, oder wie es ausging. */
const satz = computed<{ text: string; ton: "" | "gut" | "rot" }>(() => {
    const l = lauf.value;
    if (l === null) return { text: "", ton: "" };
    const f = l.fortschritt;
    if (laeuft.value) {
        if (f === null || f.phase === null) return { text: t("admin.umgebungen.jetzt.warten"), ton: "" };
        return { text: t(`admin.umgebungen.jetzt.${f.phase}` as MessageKey), ton: "" };
    }
    if (f === null) return { text: t("admin.umgebungen.ergebnis.ohneMeldung"), ton: "" };
    if (f.zustand === "gruen") {
        const key = l.art === "rollback" ? "admin.umgebungen.ergebnis.fertig" : "admin.umgebungen.ergebnis.live";
        return { text: t(key, { dauer: dauer.value === null ? "–" : dauerText(dauer.value) }), ton: "gut" };
    }
    return { text: f.fehler ?? t("admin.umgebungen.ergebnis.rot"), ton: "rot" };
});
</script>

<template>
    <section
        v-if="lauf !== null"
        class="lauf"
        :class="{ 'lauf--gut': satz.ton === 'gut', 'lauf--rot': satz.ton === 'rot' }"
        aria-live="polite"
        data-testid="production-laeuft"
    >
        <div class="lauf__kopf">
            <span class="lauf__titel">{{ titel }}</span>
            <span class="lauf__uhr">{{ uhr }}</span>
        </div>
        <ol class="schritte">
            <li
                v-for="schritt in stationen"
                :key="schritt.id"
                class="schritt"
                :class="`schritt--${schritt.zustand}`"
                :data-schritt="schritt.id"
                :data-zustand="schritt.zustand"
            >
                <span v-if="schritt.zustand === 'fehler'" class="schritt__fehler" aria-hidden="true">✕</span>
                <span v-else :class="{ 'umgebungen-puls': schritt.zustand === 'jetzt' }">
                    <AvmKreis
                        :fuellung="
                            schritt.zustand === 'fertig' ? 'voll' : schritt.zustand === 'jetzt' ? 'halb' : 'leer'
                        "
                        :name="t(`admin.umgebungen.schritt.${schritt.id}` as MessageKey)"
                    />
                </span>
                <span class="schritt__name">{{ t(`admin.umgebungen.schritt.${schritt.id}` as MessageKey) }}</span>
                <span class="schritt__zeit">{{ schrittZeit(schritt) }}</span>
            </li>
        </ol>
        <p class="lauf__satz" :class="satz.ton === '' ? '' : `lauf__satz--${satz.ton}`">{{ satz.text }}</p>
        <div class="lauf__wege">
            <button v-if="zeigeVorgang !== null" type="button" class="verweis" @click="zeigeVorgang(lauf.ops)">
                {{ t("admin.umgebungen.vorgang", { ops: lauf.ops }) }}
            </button>
            <span v-else class="lauf__ops">{{ lauf.ops }}</span>
            <button
                v-if="!lauf.offen"
                type="button"
                class="verweis"
                data-testid="umgebungen-ausblenden"
                @click="props.freigabe.ausblenden()"
            >
                {{ t("admin.umgebungen.ausblenden") }}
            </button>
        </div>
    </section>
</template>

<style scoped>
.lauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: var(--space-12);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.lauf--gut {
    border-color: var(--color-success-soft-border);
}

.lauf--rot {
    border-color: var(--color-danger-soft-border);
}

.lauf__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4) var(--space-12);
}

.lauf__titel {
    color: var(--color-text-strong);
}

.lauf__uhr {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

/* Die Stationen auf einer Linie: bis zur laufenden durchgezogen, danach gestrichelt. */
.schritte {
    display: flex;
    margin: 0;
    padding: 0;
    list-style: none;
}

.schritt {
    position: relative;
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    text-align: center;
}

.schritt::before {
    position: absolute;
    top: calc(var(--avm-kreis) / 2 - 1px);
    right: 50%;
    width: 100%;
    height: 2px;
    background: repeating-linear-gradient(
        90deg,
        var(--color-border-strong) 0 var(--space-2),
        transparent var(--space-2) var(--space-6)
    );
    content: "";
}

.schritt:first-child::before {
    content: none;
}

.schritt--fertig::before,
.schritt--jetzt::before,
.schritt--fehler::before {
    background: var(--color-map-presence);
}

.schritt > :first-child {
    position: relative;
    display: inline-flex;
}

.schritt__fehler {
    color: var(--color-danger);
    font-size: var(--font-size-small);
    line-height: 1;
}

.schritt__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.schritt--fertig .schritt__name {
    color: var(--color-text);
}

.schritt--jetzt .schritt__name {
    color: var(--color-text-strong);
}

.schritt--fehler .schritt__name {
    color: var(--color-danger-soft-text);
}

.schritt__zeit {
    min-height: 1lh;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.lauf__satz {
    margin: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.lauf__satz--gut {
    color: var(--color-success-soft-text);
}

.lauf__satz--rot {
    color: var(--color-danger-soft-text);
}

.lauf__wege {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6) var(--space-12);
}

.lauf__ops {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition: color 120ms ease;
}

.verweis:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Schmal: die Stationen untereinander, die Zeit am Zeilenende. */
@media (max-width: 640px) {
    .schritte {
        flex-direction: column;
        gap: var(--space-4);
    }

    .schritt {
        flex-direction: row;
        gap: var(--space-8);
        text-align: left;
    }

    .schritt::before {
        content: none;
    }

    .schritt__zeit {
        margin-left: auto;
    }
}
</style>
