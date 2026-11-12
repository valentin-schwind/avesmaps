<script setup lang="ts">
/**
 * Eine der zwei Sperren im Eintrag „Betriebszustand“ (WI-0127 SYS-5; SYS-0001 §3.3, §6.2; Blatt WI-0119 A1): Kartensperre und
 * Systemsperre, getrennt (E4). Je Karte der Schalter Offen · Gesperrt, darunter „Sperrt“ und „Offen bleibt“ (die Texte des Blatts) und,
 * wenn gesetzt, seit wann, von wem und warum. Umgeschaltet wird über dieselbe Bestätigung wie der Hauptschalter: Setzen mit Grund,
 * Lösen ohne Pflicht; beides fragt den Passkey (Stufe S).
 *
 * 🔴 Weiß der Server seinen Zustand nicht, steht keine Stellung gewählt da: „unbekannt“ ist nie „offen“.
 */
import { computed } from "vue";
import type { SystemLock } from "@avesmaps3d/shared";
import AvmSegmente from "../controls/avm-segmente.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import type { Operations } from "./betriebszustand";
import { grundPflicht, seitText } from "./betriebszustand";
import VerwaltungBetriebFrage from "./verwaltung-betrieb-frage.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    betrieb: Operations;
    lock: SystemLock;
    /** Der eingestellte Stand; `null`, wenn er unbekannt ist. */
    locked: boolean | null;
    setting: {
        since: string | null;
        by: { displayName: string } | null;
        byLabel: string | null;
        reason: string | null;
    } | null;
    /** Warum sich gerade nichts umschalten lässt (Recht fehlt, Zustand unbekannt); sperrt beide Segmente. */
    sperrSatz?: string | undefined;
    /** Die Kennung des Satzes, auf den die gesperrten Segmente zeigen. */
    sperrId?: string | undefined;
    jetzt: number;
}>();

const offen = computed(() => {
    const frage = props.betrieb.frage.value;
    return frage !== null && frage.art === "lock" && frage.lock === props.lock ? frage : null;
});
const gesperrt = computed(() => props.sperrSatz !== undefined || props.betrieb.busy.value);
const wert = computed(() => (props.locked === null ? "" : props.locked ? "gesperrt" : "offen"));
const optionen = computed(() =>
    (["offen", "gesperrt"] as const).map((value) => ({
        value,
        label: t(value === "offen" ? "admin.system.lock.open" : "admin.system.lock.locked"),
        gesperrt: gesperrt.value,
        beschrieben: props.sperrSatz === undefined ? undefined : props.sperrId,
    })),
);
const ergebnis = computed(() => {
    const letzte = props.betrieb.ergebnis.value;
    return letzte !== null && letzte.ort === props.lock ? letzte.result : undefined;
});

function waehlen(value: string): void {
    const ziel = value === "gesperrt";
    if (props.locked === null || ziel === props.locked) return;
    props.betrieb.ask({ art: "lock", lock: props.lock, ziel });
}
</script>

<template>
    <FensterKarte :titel="t(`admin.system.lock.${props.lock}.title`)" :data-testid="`betrieb-sperre-${props.lock}`">
        <AvmSegmente
            class="sperre__schalter"
            :model-value="wert"
            :options="optionen"
            :label="t(`admin.system.lock.${props.lock}.label`)"
            :testid="`betrieb-sperre-${props.lock}-schalter`"
            @update:model-value="waehlen"
        />
        <p
            v-if="props.locked === true && props.setting !== null"
            class="sperre__seit"
            data-testid="betrieb-sperre-seit"
        >
            <span class="sperre__stark">{{ t("admin.system.lock.locked") }}</span>
            {{ seitText(props.setting, new Date(props.jetzt)) }}
        </p>
        <VerwaltungBetriebFrage
            v-if="offen !== null"
            :grund="props.betrieb.grund.value"
            :frage="t(offen.ziel ? `admin.system.lock.${props.lock}.ask` : `admin.system.lock.${props.lock}.release`)"
            :folge="
                t(
                    offen.ziel
                        ? `admin.system.lock.${props.lock}.askFollows`
                        : `admin.system.lock.${props.lock}.releaseFollows`,
                )
            "
            :bestaetigen="t(offen.ziel ? 'admin.system.lock.action.set' : 'admin.system.lock.action.release')"
            :pflicht="grundPflicht(offen)"
            :busy="props.betrieb.busy.value"
            :testid="`betrieb-frage-${props.lock}`"
            @update:grund="props.betrieb.setGrund"
            @bestaetigen="props.betrieb.confirm()"
            @abbrechen="props.betrieb.cancel()"
        />
        <VerwaltungMeldung :ergebnis="ergebnis" :testid="`betrieb-meldung-${props.lock}`" />
        <dl class="sperre__bedeutung">
            <dt>{{ t("admin.system.lock.blocks") }}</dt>
            <dd>{{ t(`admin.system.lock.${props.lock}.blocks`) }}</dd>
            <dt>{{ t("admin.system.lock.staysOpen") }}</dt>
            <dd>{{ t(`admin.system.lock.${props.lock}.staysOpen`) }}</dd>
        </dl>
    </FensterKarte>
</template>

<style scoped>
/* Die Mulde liegt auf der Karte (`panel-soft`) und braucht deshalb die hellere Fläche (Blatt `.fenster-karte .segmente`). Halb so
   breit wie der Hauptschalter (Blatt: 220 zu 440). */
.sperre__schalter {
    width: var(--avm-fenster-spalte);
    max-width: 100%;
    background: var(--color-panel);
}

.sperre__seit {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.sperre__stark {
    color: var(--color-text-strong);
}

.sperre__bedeutung {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.sperre__bedeutung > dt {
    color: var(--color-text-strong);
}

.sperre__bedeutung > dd {
    margin: 0;
}
</style>
