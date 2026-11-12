<script setup lang="ts">
import { computed } from "vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { gleise, zeitpunkt, type Freigabe, type GleisStand } from "./freigabe";

/**
 * Die Gleise der Ansicht „Umgebungen“ (WI-0204; der Betreiber wählte „Gleise je Release“): je Freigabe und Rückweg eine Zeile, in der
 * Spalte jeder Umgebung ein Kreis (● erreicht, ◐ unterwegs, ○ noch nicht, ↺ zurückgenommen), verbunden wie die Stationen darüber. Sie
 * ersetzen „Frühere Freigaben“. Welche Zeilen es gibt, rechnet `gleise()` in `freigabe.ts`.
 *
 * 🔴 Das Raster ist das der Leiste (`umgebungen-leiste.vue`): drei gleich breite Spalten (Lokal, Stage, Production) mit der Fuge `--fuge`, die die
 * Ansicht setzt. Die erste trägt das Etikett (Lokal hat keine Releases); nur so stehen die Kreise unter ihrer Station.
 */
const props = defineProps<{ freigabe: Freigabe }>();

const zeilen = computed(() => gleise(props.freigabe.sicht.value));
const zeit = (iso: string | null): string => zeitpunkt(iso, locale.value);

const KREIS: Record<GleisStand, "voll" | "halb" | "leer" | null> = {
    voll: "voll",
    halb: "halb",
    leer: "leer",
    zurueck: "leer",
    rueckweg: null,
    keiner: null,
};
const KREISNAME: Record<GleisStand, MessageKey> = {
    voll: "admin.umgebungen.kreis.voll",
    halb: "admin.umgebungen.kreis.halb",
    leer: "admin.umgebungen.kreis.leer",
    zurueck: "admin.umgebungen.kreis.zurueck",
    rueckweg: "admin.umgebungen.kreis.zurueck",
    keiner: "admin.umgebungen.kreis.leer",
};

/** Die Linie von Stage nach Production in einer Zeile. */
function linie(stage: GleisStand, production: GleisStand): "voll" | "offen" | "lauf" | "keine" {
    if (stage === "keiner" || production === "rueckweg") return "keine";
    if (production === "halb") return "lauf";
    return stage === "voll" && production === "voll" ? "voll" : "offen";
}
</script>

<template>
    <section class="gleise" :aria-label="t('admin.umgebungen.gleise')" data-testid="umgebungen-gleise">
        <div class="raster gleise__kopf">
            <span>{{ t("admin.umgebungen.gleise.release") }}</span>
            <span>{{ t("admin.production.stage") }}</span>
            <span>{{ t("admin.production.production") }}</span>
        </div>
        <p v-if="zeilen.length === 0" class="gleise__leer">{{ t("admin.umgebungen.gleise.leer") }}</p>
        <div
            v-for="zeile in zeilen"
            :key="zeile.schluessel"
            class="raster gleis"
            :data-art="zeile.art"
            data-testid="umgebungen-gleis"
        >
            <div class="gleis__etikett">
                <span class="gleis__stand"
                    >{{
                        zeile.art === "rollback"
                            ? t("admin.umgebungen.gleise.rueckweg", { stand: zeile.stand })
                            : zeile.stand
                    }}
                    <small>{{ zeit(zeile.at) }}</small></span
                >
                <span class="gleis__unter einzeilig">{{
                    zeile.art === "wartet"
                        ? t(
                              zeile.production === "halb"
                                  ? "admin.umgebungen.gleise.unterwegs"
                                  : "admin.umgebungen.gleise.wartet",
                          )
                        : [zeile.ops, zeile.wer].filter((teil) => teil !== null).join(" · ")
                }}</span>
            </div>
            <div class="zelle">
                <AvmKreis
                    v-if="KREIS[zeile.stage] !== null"
                    :fuellung="KREIS[zeile.stage]!"
                    :name="t(KREISNAME[zeile.stage])"
                />
                <span v-if="zeile.aktuell.stage" class="zelle__notiz einzeilig">{{
                    t("admin.umgebungen.gleise.aktuell")
                }}</span>
            </div>
            <div class="zelle" :data-linie="linie(zeile.stage, zeile.production)">
                <span v-if="zeile.production === 'rueckweg'" class="zelle__zeichen" :title="t(KREISNAME.rueckweg)"
                    >↺</span
                >
                <span v-else :class="{ 'umgebungen-puls': zeile.production === 'halb' }">
                    <AvmKreis :fuellung="KREIS[zeile.production]!" :name="t(KREISNAME[zeile.production])" />
                </span>
                <span v-if="zeile.zurueckAm !== null" class="zelle__notiz zelle__notiz--warn einzeilig"
                    >↺ {{ t("admin.umgebungen.gleise.zurueckAm", { zeit: zeit(zeile.zurueckAm) }) }}</span
                >
                <span v-else-if="zeile.aktuell.production" class="zelle__notiz einzeilig">{{
                    t("admin.umgebungen.gleise.aktuell")
                }}</span>
            </div>
        </div>
        <p class="legende">
            <span
                >{{ t("admin.umgebungen.kreis.voll") }}
                <AvmKreis fuellung="voll" :name="t('admin.umgebungen.kreis.voll')"
            /></span>
            <span
                >{{ t("admin.umgebungen.kreis.halb") }}
                <AvmKreis fuellung="halb" :name="t('admin.umgebungen.kreis.halb')"
            /></span>
            <span
                >{{ t("admin.umgebungen.kreis.leer") }}
                <AvmKreis fuellung="leer" :name="t('admin.umgebungen.kreis.leer')"
            /></span>
            <span>{{ t("admin.umgebungen.kreis.zurueck") }} ↺</span>
        </p>
    </section>
</template>

<style scoped>
.raster {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: var(--fuge);
}

.gleise {
    display: flex;
    flex-direction: column;
    margin-top: var(--space-16);
}

.gleise__kopf {
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gleise__kopf span:not(:first-child) {
    text-align: center;
}

.gleise__leer {
    margin: var(--space-6) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.gleis {
    align-items: center;
    min-height: calc(var(--avm-control-h) + var(--space-4));
    border-bottom: 1px solid var(--color-divider);
}

.gleis__etikett {
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
    padding-block: var(--space-4);
}

.gleis__stand {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
}

.gleis__stand small {
    margin-left: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.gleis__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.zelle {
    position: relative;
    display: flex;
    align-items: center;
    align-self: stretch;
    justify-content: center;
    min-width: 0;
}

.zelle > :first-child {
    position: relative;
    z-index: 1;
    display: inline-flex;
}

/* Die Linie von der Mitte der Stage-Zelle zur Mitte der Production-Zelle: halbe Zelle, Fuge, halbe Zelle. */
.zelle[data-linie]::before {
    position: absolute;
    top: calc(50% - 1px);
    left: calc(-50% - var(--fuge));
    width: calc(100% + var(--fuge));
    height: 2px;
    content: "";
}

.zelle[data-linie="voll"]::before {
    background: var(--color-map-presence);
    opacity: 0.55;
}

.zelle[data-linie="offen"]::before {
    background: repeating-linear-gradient(
        90deg,
        var(--color-border-strong) 0 var(--space-2),
        transparent var(--space-2) var(--space-6)
    );
}

.zelle[data-linie="lauf"]::before {
    background: repeating-linear-gradient(
        90deg,
        var(--color-success) 0 var(--space-4),
        transparent var(--space-4) var(--space-10)
    );
    background-size: var(--space-10) 2px;
    animation: gleis-fliessen 0.5s linear infinite;
}

@keyframes gleis-fliessen {
    to {
        background-position: var(--space-10) 0;
    }
}

.zelle__zeichen {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-body);
    line-height: 1;
}

.zelle__notiz {
    position: absolute;
    top: 50%;
    left: calc(50% + var(--space-10));
    z-index: 1;
    max-width: calc(50% - var(--space-12));
    padding-inline: var(--space-2);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    transform: translateY(-50%);
}

.zelle__notiz--warn {
    color: var(--color-warning-soft-text);
}

.legende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-10);
    margin: 0;
    padding-top: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.legende span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

/* Schmal: das Etikett in eigener Zeile, darunter die Kreise; Notizen fallen weg. */
@media (max-width: 640px) {
    .raster {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .gleise__kopf span:first-child {
        display: none;
    }

    .gleis__etikett {
        grid-column: 1 / -1;
    }

    .zelle {
        min-height: var(--space-20);
    }

    .zelle__notiz {
        display: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .zelle[data-linie="lauf"]::before {
        animation: none;
    }
}
</style>
