<script setup lang="ts">
/**
 * Die Warteschlange im Kopf (WI-0230; Betreiber 2026-10-19 zur Probierseite: „die warteschlange im kopf is cool … uneingeloggte besucher
 * sehen keine leiste! rechner lösung und telefonlösung super! klick öffnet warteschlagen -> perfekt … kopf-warteschlange -> bauen“).
 *
 * Solange eigene Speicherungen Aufträge in der Warteschlange haben, steht in der Mitte der Kopfleiste ein Knopf: was berechnet wird (die
 * Art im Klartext), in welcher Phase, wie lange noch; unten ein dünner Balken (gestrichelt, solange der Anteil unbekannt ist), „+n“ für die
 * übrigen. Am Telefon nur eine Uhr (gesammelt, wartet) oder ein Ring (läuft) mit der Restzeit. Ein Klick öffnet die Warteschlange.
 *
 * Nur angemeldete Konten: Die Kopfleiste bindet die Leiste nur mit Person ein, ohne eigenen Auftrag steht nichts da, auch kein leerer
 * Platz. Die Daten kommen aus `eigene-quelle.ts`, derselben Quelle wie das „wird berechnet“ im Fenster eines Objekts.
 */
import { computed, onBeforeUnmount } from "vue";
import { authState } from "../auth/session-state";
import { openAuthWindow } from "../auth/auth-windows";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { dataLabel, formatDuration } from "../status/format";
import { phaseName } from "../status/phase-name";
import { vorderster, weitere, type EigenerAuftrag } from "./eigene-auftraege";
import { beziehe } from "./eigene-quelle";

const { quelle, abmelden } = beziehe();
onBeforeUnmount(abmelden);

const vorne = computed(() => vorderster(quelle.liste.value));
const mehr = computed(() => weitere(quelle.liste.value, vorne.value));

/** Restzeit als „1:16“, ab einer Stunde „1:12:05“ (der Release-Test läuft Stunden), nie negativ. */
function uhrzeit(sekunden: number): string {
    const ganz = Math.max(0, Math.ceil(sekunden));
    const sek = String(ganz % 60).padStart(2, "0");
    if (ganz < 3600) return `${String(Math.floor(ganz / 60))}:${sek}`;
    return `${String(Math.floor(ganz / 3600))}:${String(Math.floor((ganz % 3600) / 60)).padStart(2, "0")}:${sek}`;
}

/**
 * Die Art im Klartext, im Verlauf („Gebiete werden berechnet“); ohne eigene Form die Nennform der Warteschlange. Ein Etikett, das mit
 * dieser Nennform beginnt, sagt mehr und steht an ihrer Stelle: „Gelände voll rechnen (Fassung 19 (Test))“ (Hauptorchestrierung
 * 2026-10-19).
 */
function artText(auftrag: EigenerAuftrag): string {
    const form =
        auftrag.stand.stand === "fertig" ? "fertig" : auftrag.stand.stand === "fehlgeschlagen" ? "fehler" : "aktiv";
    const { etikett } = auftrag;
    if (form === "aktiv" && etikett?.startsWith(dataLabel("status.kind", auftrag.auftrag.art))) return etikett;
    return artName(auftrag.auftrag.art, form);
}

function artName(art: string, form: "aktiv" | "fertig" | "fehler"): string {
    const key = `kopfschlange.art.${art}.${form}`;
    if (isMessageKey(key)) return t(key as MessageKey);
    return t(`kopfschlange.art.allgemein.${form}` as MessageKey, { art: dataLabel("status.kind", art) });
}

function dauerText(dauerS: number | null): string {
    if (dauerS === null) return t("kopfschlange.dauerUnbekannt");
    return dauerS < 1 ? t("kopfschlange.dauerKurz") : t("kopfschlange.dauer", { zeit: formatDuration(dauerS) });
}

/**
 * Der Start eines Wartenden: in etwa, gleich, nach seinem Vorgänger, sonst unbekannt. Eine Art, die auf etwas außerhalb der Warteschlange wartet,
 * sagt das selbst (`kopfschlange.art.<art>.wartet`: die Freigabe wartet auf Prüfung und Abholung, WI-0248).
 */
function wartetText(auftrag: EigenerAuftrag): string {
    const eigen = `kopfschlange.art.${auftrag.auftrag.art}.wartet`;
    if (isMessageKey(eigen)) return t(eigen as MessageKey);
    const { rest, nach } = auftrag.stand;
    if (rest !== undefined)
        return rest < 1 ? t("kopfschlange.wartetGleich") : t("kopfschlange.wartet", { zeit: uhrzeit(rest) });
    return nach === undefined
        ? t("kopfschlange.wartetUnbekannt")
        : t("kopfschlange.wartetNach", { art: artName(nach, "aktiv") });
}

/** Die Phase: gesammelt mit Restzeit, wartet mit Start, läuft mit Restzeit; dazu die Dauer, wo sie hilft. */
function phaseText(auftrag: EigenerAuftrag): string {
    const { stand, rest } = auftrag.stand;
    if (stand === "gesammelt")
        return `${t("kopfschlange.gesammelt", { zeit: uhrzeit(rest ?? 0) })} · ${dauerText(auftrag.dauerS)}`;
    if (stand === "wartet") return `${wartetText(auftrag)} · ${dauerText(auftrag.dauerS)}`;
    if (stand === "laeuft") {
        // Mit benannter Phase steht sie statt „läuft“ da (der Schritt des Release-Tests, die Phase der Freigabe, WI-0248).
        const phase = auftrag.phase === undefined ? null : phaseName(auftrag.auftrag.art, auftrag.phase);
        if (phase !== null)
            return rest === undefined ? phase : t("kopfschlange.phaseRest", { phase, zeit: uhrzeit(rest) });
        return rest === undefined
            ? `${t("kopfschlange.laeuft")} · ${t("kopfschlange.dauerUnbekannt")}`
            : t("kopfschlange.laeuftRest", { zeit: uhrzeit(rest) });
    }
    if (stand === "fehlgeschlagen") return t("kopfschlange.fehlerHinweis");
    return "";
}

const titel = computed(() => {
    const a = vorne.value;
    if (a === null) return "";
    const teile = [artText(a)];
    const phase = phaseText(a);
    if (phase !== "") teile.push(phase);
    if (mehr.value > 0) teile.push(t("kopfschlange.weitere", { n: mehr.value }));
    teile.push(t("kopfschlange.oeffnen"));
    return teile.join(" · ");
});

/** Was am Telefon neben dem Zeichen steht: die Restzeit, ✓, ! oder … */
const zahl = computed(() => {
    const a = vorne.value;
    if (a === null) return "";
    if (a.stand.stand === "fertig") return "✓";
    if (a.stand.stand === "fehlgeschlagen") return "!";
    return a.stand.rest === undefined ? "…" : uhrzeit(a.stand.rest);
});

const ton = computed(() =>
    vorne.value?.stand.stand === "fertig" ? "fertig" : vorne.value?.stand.stand === "fehlgeschlagen" ? "fehler" : "",
);
/** Der Balken: der Anteil eines laufenden, sonst gestrichelt über die ganze Breite; fertig und Fehler ohne Balken. */
const balken = computed(() => {
    const a = vorne.value;
    if (a === null || a.stand.stand === "fertig" || a.stand.stand === "fehlgeschlagen") return null;
    return a.stand.stand === "laeuft" && a.anteil !== null
        ? { breite: Math.round(a.anteil * 100), warte: false }
        : { breite: 100, warte: true };
});

const UMFANG = 2 * Math.PI * 8;
/** Der Zeiger der Uhr dreht sich mit der Zeit (eine Umdrehung je Minute), damit man sieht, dass es weitergeht. */
const zeiger = computed(() => ((quelle.nowMs.value / 1000) * 6) % 360);
const ring = computed(() => {
    const anteil = vorne.value?.anteil ?? null;
    return anteil === null
        ? { offset: UMFANG * 0.7, drehung: ((quelle.nowMs.value / 1000) * 40) % 360 }
        : { offset: UMFANG * (1 - anteil), drehung: 0 };
});

function oeffnen(): void {
    quelle.quittieren();
    // Admins und Betreiber haben die Warteschlange als Fenster der Systemsteuerung; wer nur eigene Aufträge sieht, die Statusseite.
    if (authState.value.capabilities.includes("view_operations"))
        openAuthWindow({ name: "systemsteuerung", eintrag: "statusseite" });
    else globalThis.open("/status.html", "_blank", "noopener");
}
</script>

<template>
    <button
        v-if="vorne !== null"
        type="button"
        class="kopfschlange"
        :class="ton === '' ? '' : `kopfschlange--${ton}`"
        :title="titel"
        :aria-label="titel"
        data-testid="kopfschlange"
        :data-stand="vorne.stand.stand"
        @click="oeffnen"
    >
        <svg class="kopfschlange__zeichen" viewBox="0 0 20 20" aria-hidden="true">
            <template v-if="vorne.stand.stand === 'fertig'">
                <circle class="bahn" cx="10" cy="10" r="8" />
                <path class="haken" d="M6 10.2l2.7 2.7L14.2 7.4" />
            </template>
            <template v-else-if="vorne.stand.stand === 'fehlgeschlagen'">
                <path class="warn" d="M10 2.2 18.4 17H1.6z" />
                <path class="warn-strich" d="M10 7.5v4.6M10 14.3v.4" />
            </template>
            <template v-else-if="vorne.stand.stand === 'laeuft'">
                <circle class="bahn" cx="10" cy="10" r="8" />
                <circle
                    class="wert"
                    cx="10"
                    cy="10"
                    r="8"
                    :stroke-dasharray="UMFANG"
                    :stroke-dashoffset="ring.offset"
                    :transform="`rotate(${ring.drehung - 90} 10 10)`"
                />
            </template>
            <template v-else>
                <circle class="rand" cx="10" cy="10" r="8" />
                <path class="hand" d="M10 10V5.4" :transform="`rotate(${zeiger} 10 10)`" />
                <path class="hand" d="M10 10h3" />
            </template>
        </svg>
        <span class="kopfschlange__art einzeilig">{{ artText(vorne) }}</span>
        <span v-if="vorne.stand.stand !== 'fertig'" class="kopfschlange__phase einzeilig">{{ phaseText(vorne) }}</span>
        <span class="kopfschlange__zahl" aria-hidden="true">{{ zahl }}</span>
        <span v-if="mehr > 0" class="kopfschlange__mehr" aria-hidden="true">+{{ mehr }}</span>
        <span v-if="balken !== null" class="kopfschlange__balken" :class="{ warte: balken.warte }" aria-hidden="true"
            ><i :style="{ width: `${balken.breite}%` }"></i
        ></span>
    </button>
</template>

<style scoped>
/* Am Rechner: ein Knopf in der Mitte der Kopfleiste, Bedienhöhe, Panel weich; kürzt zuerst die Phase, dann die Art. */
.kopfschlange {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    max-width: min(600px, 100%);
    min-width: 0;
    height: var(--avm-control-h);
    box-sizing: border-box;
    padding: 0 var(--space-12) 0 var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.kopfschlange:hover {
    background: var(--color-hover-wash);
    border-color: var(--color-border-strong);
}

.kopfschlange:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--color-focus);
}

.kopfschlange__art {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.kopfschlange__phase {
    flex: 0 2 auto;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kopfschlange__mehr {
    flex: none;
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Zahl gehört nur dem Telefon. */
.kopfschlange__zahl {
    display: none;
}

.kopfschlange__balken {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 3px;
}

.kopfschlange__balken > i {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 900ms linear;
}

.kopfschlange__balken.warte > i {
    background: repeating-linear-gradient(90deg, var(--color-accent) 0 6px, transparent 6px 10px);
    opacity: 0.75;
}

.kopfschlange--fertig {
    border-color: var(--color-success);
    background: var(--color-success-soft);
}

.kopfschlange--fertig .kopfschlange__art {
    color: var(--color-success);
}

.kopfschlange--fehler {
    border-color: var(--color-danger);
    background: var(--color-danger-soft);
}

.kopfschlange--fehler .kopfschlange__art {
    color: var(--color-danger);
}

.kopfschlange__zeichen {
    flex: none;
    width: 20px;
    height: 20px;
}

.bahn {
    fill: none;
    stroke: var(--color-border-strong);
    stroke-width: 3;
}

.wert {
    fill: none;
    stroke: var(--color-accent);
    stroke-width: 3;
    stroke-linecap: round;
    transition: stroke-dashoffset 900ms linear;
}

.rand {
    fill: var(--color-panel);
    stroke: var(--color-text-strong);
    stroke-width: 1.4;
}

.hand {
    stroke: var(--color-text-strong);
    stroke-width: 1.6;
    stroke-linecap: round;
}

.haken {
    fill: none;
    stroke: var(--color-success);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.warn {
    fill: var(--color-danger);
}

.warn-strich {
    stroke: var(--color-panel);
    stroke-width: 1.8;
    stroke-linecap: round;
}

@media (prefers-reduced-motion: reduce) {
    .kopfschlange__balken > i,
    .wert {
        transition: none;
    }
}

/* Am Telefon: nur die Uhr oder der Ring mit der Restzeit, rund, neben der Glocke; der Wortlaut steht im Titel und in der Warteschlange. */
@media (max-width: 600px) {
    /* Die Uhr behält ihre Breite: Restzeit und „+n“ werden nie abgeschnitten; Platz macht der Titel der Leiste. */
    .kopfschlange {
        flex: none;
        max-width: none;
        gap: var(--space-4);
        padding: 0 var(--space-8) 0 var(--space-4);
        border-radius: calc(var(--avm-control-h) / 2);
    }

    .kopfschlange__art,
    .kopfschlange__phase,
    .kopfschlange__balken {
        display: none;
    }

    .kopfschlange__zahl {
        display: inline;
        color: var(--color-text-strong);
        font-size: var(--font-size-small);
    }

    .kopfschlange__zeichen {
        width: 22px;
        height: 22px;
    }

    .kopfschlange--fertig .kopfschlange__zahl {
        color: var(--color-success);
    }

    .kopfschlange--fehler .kopfschlange__zahl {
        color: var(--color-danger);
    }

    .kopfschlange__mehr {
        display: inline-grid;
        place-items: center;
        min-width: 16px;
        height: 16px;
        padding: 0 3px;
        box-sizing: border-box;
        border: 0;
        border-radius: 8px;
        background: var(--color-accent-strong);
        color: var(--color-panel);
        font-size: var(--font-size-caption);
    }
}
</style>
