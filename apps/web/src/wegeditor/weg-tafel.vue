<script setup lang="ts">
import { computed, ref } from "vue";
import {
    AVENTURIA_TRAVEL_MODEL,
    CALENDAR_MONTHS,
    CLOSURE_REASONS,
    PATH_EDIT_SUBTYPES,
    type ClosureReason,
    type EditorPathSaison,
    type EditorPathStreet,
    type EditorPathWeiterer,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { TRANSPORT_ICONS } from "../route-planner/planner-model";
import {
    fahrtage,
    reisemittelZeilen,
    reisenDes,
    TAGE_IM_JAHR,
    uebernahme,
    type ReisemittelZeile,
    type Uebernahme,
} from "./reisemittel";
import AvmKnopf from "../controls/avm-knopf.vue";
import { istFluss, WEGART_BACH, WEGART_GEMISCHT, wegartWaehlbar } from "./weg-art";
import { richtungsUebernahme, richtungsZustand, type FlussnetzLage } from "./weg-fliessrichtung";
import WegWeitere from "./weg-weitere.vue";
import type { WeitereJeAbschnitt } from "./weg-weitere";

/**
 * Die Tafel unter der Leiste (W) (1) (2) … im Kasten „Abschnitte“ (WI-0177, Vorschlag 3; Betreiber 2026-10-19: „variante 3 ist genau die
 * richtung die ich wollte“): für die gewählten Abschnitte die Orte an den Enden, Wegtyp, Tunnel und die Reisemittel, je Reisemittel eine
 * Zeile (Haken, Bild, Name, Zeitfenster, Grund), darüber die Monatsleiste über die volle Breite.
 *
 * - Ein Abschnitt hat keinen eigenen Namen (Betreiber: „wegabschnitte können keinen anderen namen als den namen des wegs haben“): Die
 *   gedrückte Nummer zeigt die Wahl, darunter stehen nur die Orte („(3) ist angklickt und drunter Calmir – Rossol“).
 * - Die Reisemittel rechnet `reisemittel.ts` mit den Funktionen der Wegfindung. Sind sich die gewählten Abschnitte nicht einig, steht „–“.
 * - Zeigt man auf eine Zeile, liegt unter den Monaten eine Spur, auf den Tag genau gelb, wann das Mittel fährt, und rot, wann es gesperrt
 *   ist (Betreiber: „das gelb im verhältnis zum tag … gesperrte zeiten können rot sein“). Ein Klick hält sie fest, auch am Finger; ein
 *   zweiter Klick auf dieselbe Zeile löst sie.
 * - „ganzjährig“ steht allein: Tag und „bis“ bleiben leer (Hauptorchestrierung 2026-10-19 am Bild des Betreibers: „ganzjährig“ neben
 *   „1 bis Praios 30“ las sich widersprüchlich).
 * - **Ändern** (Schritt 3, Betreiber 2026-10-19 „Reisemittel zuerst“): Wer schreiben darf, hat je Zeile einen Haken, „ganzjährig“ oder
 *   Monat und Tag, „bis“, Monat und Tag, und den Grund (`CLOSURE_REASONS`), wie die Zeile in Legacys Dialog. Eine Änderung gilt allen
 *   gewählten Abschnitten (`mittel`, `fenster`; das Fenster rechnet `mitMittel`, `mitFenster`). Ein Feld, das nichts bedeuten kann, ist
 *   gesperrt: ohne Haken alles, bei „ganzjährig“ Tag, „bis“ und Grund. Wählt man aus „ganzjährig“ einen Monat, steht „bis“ ein halbes
 *   Jahr später am 30. (wie die Probierseite P7). Sind sich die gewählten Abschnitte uneins, steht „–“.
 * - **Auf alle Abschnitte übernehmen** (OPS-000112, Entwurf Fassung 2, Vali 2026-11-11 „ja bauen“): Ist nur ein Teil der Abschnitte
 *   gewählt, gibt der Knopf unter der Liste ihre Reisemittel allen Abschnitten, der kleine ⇉ am Ende einer Zeile nur diese Zeile (`alle`,
 *   gerechnet von `uebernahme`). Gesperrt sind sie, wenn die gewählten verschieden fahren oder alle schon so fahren.
 * - **Fließrichtung** (Plan Fluss/Bach, Schritt 4): Sind alle gewählten Abschnitte Fluss oder Bach, steht sie da, „in Zeichenrichtung“,
 *   „gegen die Zeichenrichtung“ oder „offen“ (`richtung`). „Umkehren“ dreht sie (`umkehren`), wie Legacys „Richtung umdrehen“: das
 *   Feld, nie die Linie. Die Pfeile auf der Karte zeigen sie. Bei (W) gibt es keinen Wert für alle (OPS-000112: kopiert drehte er am Mhanadi
 *   27 Pfeile gegen den Strom), nur den Zustand des Flusses („durchgehend“, „offen bei …“, „Pfeile zeigen gegeneinander bei …“) und
 *   „Umkehren“ für den ganzen Fluss. Ist ein Teil gewählt, gibt „Auf alle Abschnitte übernehmen“ die Richtung des EINEN gewählten dem Lauf
 *   nach weiter (`richtungAlle`, gerechnet von `richtungsUebernahme`), gesperrt mit Grund.
 * - **Wegtyp** (Schritt 3): Wer schreiben darf, wählt ihn für die gewählten Abschnitte (`wegtyp`), unter den Landwegen, Fluss und Bach; sind sie
 *   uneins, steht „gemischt“ davor. Liegt unter ihnen ein Flussweg, bleibt der Wegtyp Text (ein Flussweg bleibt Flussweg).
 * - **Weitere Straßennamen** (WI-0302, `weg-weitere.vue`): neben Wegtyp und Tunnel, für die gewählten Abschnitte wie der Wegtyp. Bei (W)
 *   sagt ein Satz, dass geteilte Abschnitte anderer Straßen mitzählen, bearbeitet aber bei ihrer Straße werden (Vali 2026-11-10, „Ja, mitzählen“).
 */
const props = defineProps<{
    strasse: EditorPathStreet;
    /** Die gewählten Abschnitte in ihrer Folge; bei (W) alle. */
    gewaehlt: readonly string[];
    /** Steht die Leiste auf (W), dem ganzen Weg? */
    alle: boolean;
    /** Darf hier geschrieben werden (die Bearbeitung läuft oder kann beginnen)? */
    schreibt: boolean;
    /** Der Tunnel eines Abschnitts, im Entwurf oder wie gelesen. */
    tunnelVon: (abschnitt: { id: string; tunnel?: true | undefined }) => boolean;
    /** Der Name eines Wegtyps in der Sprache der Oberfläche. */
    artName: (art: string) => string;
    /** Die weiteren Straßennamen je Abschnitt, wie gelesen (für „ungespeichert“); die des Entwurfs tragen die Abschnitte von `strasse`. */
    weitereGelesen: WeitereJeAbschnitt;
    /** Das Flussnetz der Straße, wie die Wegfindung ihre Flussabschnitte verbindet (OPS-000112). */
    flussnetz: FlussnetzLage;
    /** Ändert der Entwurf eine Kurve? Dann gilt das Netz der gespeicherten Linie nicht mehr. */
    kurveImEntwurf: boolean;
    /** Die Nummern einiger Abschnitte als Text („Abschnitt 3 und 4“, „Abschnitt 4 bis 7“). */
    nummernText: (ids: readonly string[]) => string;
    kennung: string;
}>();
const emit = defineEmits<{
    /** Der Tunnel an ALLEN gewählten Abschnitten. */
    tunnel: [an: boolean];
    /** Ein Reisemittel an allen gewählten Abschnitten an- oder abwählen. */
    mittel: [mittel: string, an: boolean];
    /** Das Zeitfenster eines Reisemittels an allen gewählten Abschnitten, wo es fährt; `null`: ganzjährig. */
    fenster: [mittel: string, fenster: EditorPathSaison | null];
    /** Der Wegtyp der gewählten Abschnitte (Landwege, Fluss, Bach). */
    wegtyp: [wert: string];
    /** Die Fließrichtung der gewählten Flüsse; `null` offen. */
    richtung: [wert: "forward" | "reverse" | null];
    /** Die Fließrichtung der gewählten Flüsse umkehren. */
    umkehren: [];
    /** Die Fließrichtung des EINEN gewählten Abschnitts dem Lauf nach allen Abschnitten geben (OPS-000112). */
    richtungAlle: [];
    /** Einen weiteren Straßennamen allen gewählten Abschnitten geben. */
    weitererDazu: [weiterer: EditorPathWeiterer];
    /** Einen weiteren Straßennamen von allen gewählten Abschnitten lösen. */
    weitererWeg: [key: string];
    /** Die Reisemittel der gewählten Abschnitte allen Abschnitten geben, alle Zeilen oder nur eine (`nur`). */
    alle: [nur: string | undefined];
}>();

const abschnitte = computed(() => props.strasse.segments.filter((a) => props.gewaehlt.includes(a.id)));
const titel = computed(() => {
    const [erster] = abschnitte.value;
    if (props.alle) return t("wegeditor.tafel.ganzerWeg");
    // Ein Ende ohne Ort heißt wie im Untermenü der Abschnitte „Abzweig“ (T49), nicht „…“ (Hauptorchestrierung auf der Stage 2026-10-19).
    const abzweig = t("wegeditor.abschnitte.abzweig");
    if (abschnitte.value.length === 1 && erster !== undefined)
        return `${erster.von ?? abzweig} – ${erster.bis ?? abzweig}`;
    return t("wegeditor.tafel.mehrere", { n: formatNumber(abschnitte.value.length, 0) });
});
/** Die Wahl je Abschnitt: sein Wegtyp, ein Bach als „Bach“ (Plan Fluss/Bach). */
const arten = computed(() => [
    ...new Set(
        abschnitte.value.map((a) => {
            const r = reisenDes(a, props.strasse);
            return r.art === "Flussweg" && r.bach ? WEGART_BACH : r.art;
        }),
    ),
]);
/** Der Wegtyp zur Wahl: nur unter Landwegen; uneins steht „gemischt“ davor, bis einer gewählt ist. */
const wegtypWaehlbar = computed(() => props.schreibt && arten.value.length > 0 && arten.value.every(wegartWaehlbar));
const wegtypen = computed(() => [
    ...(arten.value.length > 1
        ? [
              {
                  wert: WEGART_GEMISCHT,
                  text: t("wegeditor.fenster.gemischt", { arten: arten.value.map(props.artName).join(", ") }),
              },
          ]
        : []),
    ...[...PATH_EDIT_SUBTYPES, WEGART_BACH].map((wert) => ({ wert, text: props.artName(wert) })),
]);
/** Die Fließrichtung der gewählten Abschnitte, wenn alle Fluss oder Bach sind (Schritt 4). */
const RICHTUNG_OFFEN = "offen";
const fluesse = computed(() => arten.value.length > 0 && arten.value.every(istFluss));
const richtungen = computed(() => [...new Set(abschnitte.value.map((a) => a.flowDirection ?? null))]);
const richtungText = (r: "forward" | "reverse" | null): string =>
    t(`wegeditor.tafel.richtung.${r ?? RICHTUNG_OFFEN}` as never);
const richtungWert = computed(() =>
    richtungen.value.length === 1 ? (richtungen.value[0] ?? RICHTUNG_OFFEN) : WEGART_GEMISCHT,
);
const richtungOptionen = computed(() => [
    ...(richtungen.value.length > 1 ? [{ wert: WEGART_GEMISCHT, text: t("wegeditor.tafel.richtung.gemischt") }] : []),
    ...(["forward", "reverse", null] as const).map((r) => ({ wert: r ?? RICHTUNG_OFFEN, text: richtungText(r) })),
]);
function waehleRichtung(wert: string): void {
    if (wert === WEGART_GEMISCHT) return;
    emit("richtung", wert === "forward" || wert === "reverse" ? wert : null);
}
/** „Umkehren“ geht, sobald einer der gewählten eine Richtung hat; eine offene bleibt offen. */
const umkehrbar = computed(() => richtungen.value.some((r) => r !== null));
/** Bei (W) an einem Fluss aus mehreren Abschnitten: kein Wert für alle, nur der Zustand. */
const ganzerFluss = computed(() => props.alle && props.strasse.segments.length > 1);
const richtungJe = computed(() =>
    Object.fromEntries(props.strasse.segments.map((a) => [a.id, a.flowDirection ?? null] as const)),
);
const zustandText = computed((): string | undefined => {
    if (!ganzerFluss.value || props.flussnetz.art !== "da") return undefined;
    const z = richtungsZustand(props.flussnetz.netz, props.strasse.segments, richtungJe.value);
    if (z.art === "gegeneinander")
        return t("wegeditor.tafel.richtung.gegeneinander", {
            stellen: z.paare.map((paar) => props.nummernText(paar)).join(", "),
        });
    if (z.art === "offen") return t("wegeditor.tafel.richtung.offenBei", { nummern: props.nummernText(z.ids) });
    return t("wegeditor.tafel.richtung.durchgehend");
});
const richtungAnzeige = computed(
    () =>
        zustandText.value ??
        (richtungen.value.length === 1
            ? richtungText(richtungen.value[0] ?? null)
            : t("wegeditor.tafel.richtung.gemischt")),
);
function waehleWegtyp(wert: string): void {
    if (wert !== WEGART_GEMISCHT) emit("wegtyp", wert);
}
const tunnelZahl = computed(() => abschnitte.value.filter((a) => props.tunnelVon(a)).length);

/** Die weiteren Straßennamen je Abschnitt im Entwurf (WI-0302) und die Nummern der gewählten in der Leiste. */
const weitere = computed((): WeitereJeAbschnitt =>
    Object.fromEntries(props.strasse.segments.map((a) => [a.id, a.weitere ?? []])),
);
const nummern = computed(() =>
    props.strasse.segments.flatMap((a, i) => (props.gewaehlt.includes(a.id) ? [i + 1] : [])),
);
/** Bei (W): Geteilte Abschnitte anderer Straßen zählen mit, bearbeitet werden sie dort (Vali 2026-11-10, „Ja, mitzählen“). */
const geteiltSatz = computed(() => {
    const n = props.strasse.geteilt?.length ?? 0;
    return props.alle && n > 0 ? tPlural("wegeditor.tafel.geteilt", n, { n: formatNumber(n, 0) }) : undefined;
});

const zeilen = computed(() => reisemittelZeilen(abschnitte.value, props.strasse));
/** Die Knöpfe „Auf alle Abschnitte übernehmen“ (OPS-000112): nur bei einem Teil der Abschnitte, und nur wer schreiben darf. */
const teilGewaehlt = computed(
    () => props.schreibt && props.gewaehlt.length > 0 && props.gewaehlt.length < props.strasse.segments.length,
);
const sperrSatz = (u: Uebernahme, zeile: boolean): string | undefined =>
    u.art === "geht" ? undefined : t(`wegeditor.reisemittel.alle.${u.art}${zeile ? "Zeile" : ""}` as never);
/** „Auf alle Abschnitte übernehmen“ der Fließrichtung: nur bei einem Teil der Abschnitte, gesperrt mit Grund. */
const sperreRichtungAlle = computed((): string | undefined => {
    const u = richtungsUebernahme(props.flussnetz, props.gewaehlt, richtungJe.value, props.kurveImEntwurf);
    return u.art === "geht" ? undefined : t(`wegeditor.tafel.richtung.alle.${u.art}` as never);
});
const sperreAlle = computed(() =>
    teilGewaehlt.value
        ? sperrSatz(uebernahme(props.strasse.segments, props.gewaehlt, props.strasse), false)
        : undefined,
);
const sperreZeile = computed((): Readonly<Record<string, string | undefined>> =>
    teilGewaehlt.value
        ? Object.fromEntries(
              zeilen.value.map((z) => [
                  z.mittel,
                  sperrSatz(uebernahme(props.strasse.segments, props.gewaehlt, props.strasse, z.mittel), true),
              ]),
          )
        : {},
);
const monatsName = (monat: string): string => t(`calendar.month.${monat}` as never);
const JAHRESZEIT_JE_MONAT = [
    "sommer",
    "sommer",
    "sommer",
    "herbst",
    "herbst",
    "herbst",
    "winter",
    "winter",
    "winter",
    "fruehling",
    "fruehling",
    "fruehling",
] as const;
const jahreszeiten = computed(() => {
    const raus: { art: string; n: number }[] = [];
    for (const art of JAHRESZEIT_JE_MONAT) {
        const letzte = raus.at(-1);
        if (letzte?.art === art) letzte.n += 1;
        else raus.push({ art, n: 1 });
    }
    return raus;
});

/** Das Reisemittel unter dem Zeiger und das festgehaltene (Klick). */
const zeigt = ref<string | undefined>(undefined);
const fest = ref<string | undefined>(undefined);
/** Die Zeile, auf die gezeigt wird, sonst die festgehaltene: Ihre Fahrtage liegen als Spur unter den Monaten. */
const hell = computed<ReisemittelZeile | undefined>(() => {
    const mittel = zeigt.value ?? fest.value;
    return mittel === undefined ? undefined : zeilen.value.find((z) => z.mittel === mittel);
});
const halteFest = (mittel: string): void => {
    fest.value = fest.value === mittel ? undefined : mittel;
};
const spur = computed(() => {
    const z = hell.value;
    if (z === undefined || z.faehrt === null || z.fenster === undefined) return undefined;
    return fahrtage(z.mittel, z.faehrt, z.fenster ?? null);
});
/** Die Spur eines Monats (Index 0 bis 11, 12 die Namenlosen Tage) als Verlauf aus gelb und rot, auf den Tag genau. */
function spurVon(monat: number): string | undefined {
    const tage = spur.value;
    if (tage === undefined) return undefined;
    const start = monat * 30;
    const laenge = monat === 12 ? TAGE_IM_JAHR - 360 : 30;
    const teile: { farbe: string; von: number; bis: number }[] = [];
    for (let i = 0; i < laenge; i++) {
        const farbe = tage[start + i] ? "var(--color-accent-strong)" : "var(--color-danger)";
        const letzte = teile.at(-1);
        if (letzte?.farbe === farbe) letzte.bis = i + 1;
        else teile.push({ farbe, von: i, bis: i + 1 });
    }
    const prozent = (x: number): string => `${((x / laenge) * 100).toFixed(2)}%`;
    return `linear-gradient(90deg, ${teile.map((x) => `${x.farbe} ${prozent(x.von)} ${prozent(x.bis)}`).join(", ")})`;
}
const monatAn = (monat: number): boolean => {
    const tage = spur.value;
    if (tage === undefined) return false;
    const start = monat * 30;
    return tage.slice(start, start + (monat === 12 ? TAGE_IM_JAHR - 360 : 30)).some(Boolean);
};
const schnee = computed(
    () =>
        hell.value !== undefined &&
        hell.value.faehrt === true &&
        AVENTURIA_TRAVEL_MODEL.bodenPflicht.wert[hell.value.mittel] !== undefined,
);

/** Die Wahl der Monate, Tage und Gründe für die Auswahlfelder einer Zeile. */
const MONATE = computed(() => CALENDAR_MONTHS.map((monat) => ({ wert: monat, text: monatsName(monat) })));
const TAGE = Array.from({ length: 30 }, (_, i) => ({ wert: String(i + 1), text: String(i + 1) }));
const UNEINS = { wert: "–", text: "–", gesperrt: true };
const LEER = { wert: "", text: "" };
const vonMonate = (z: ReisemittelZeile) => [
    ...(z.fenster === undefined ? [UNEINS] : []),
    { wert: "", text: t("wegeditor.reisemittel.ganzjaehrig") },
    ...MONATE.value,
];
const mitLeer = <T,>(z: ReisemittelZeile, liste: readonly T[]) => (z.fenster ? liste : [LEER, ...liste]);
const gruende = computed(() => [
    { wert: "", text: "–" },
    ...CLOSURE_REASONS.map((grund) => ({ wert: grund, text: t(`wegeditor.reisemittel.grundWort.${grund}` as never) })),
]);
/** Gesperrt ohne Satz (die Zeile sagt, warum): ohne Haken alles, ohne Fenster Tag, „bis“ und Grund. */
const gesperrtWenn = (an: boolean): string | undefined => (an ? "" : undefined);
const mittelName = (mittel: string): string => t(`planner.transport.opt.${mittel}` as never);

/** „von“-Monat: „ganzjährig“ nimmt das Fenster weg; aus „ganzjährig“ steht „bis“ ein halbes Jahr später am 30. */
function setzeVonMonat(z: ReisemittelZeile, wert: string): void {
    if (wert === "–") return;
    if (wert === "") return emit("fenster", z.mittel, null);
    if (z.fenster) return emit("fenster", z.mittel, { ...z.fenster, from_month: wert });
    const halb = CALENDAR_MONTHS[(CALENDAR_MONTHS.indexOf(wert as never) + 6) % 12] ?? "praios";
    emit("fenster", z.mittel, { from_month: wert, from_day: 1, to_month: halb, to_day: 30 });
}
function setzeFensterFeld(
    z: ReisemittelZeile,
    feld: "from_day" | "to_month" | "to_day" | "reason",
    wert: string,
): void {
    if (!z.fenster || wert === "") {
        if (z.fenster && feld === "reason") {
            const ohne: EditorPathSaison = { ...z.fenster };
            delete ohne.reason;
            emit("fenster", z.mittel, ohne);
        }
        return;
    }
    const neu: EditorPathSaison = { ...z.fenster };
    if (feld === "to_month") neu.to_month = wert;
    else if (feld === "reason") neu.reason = wert as ClosureReason;
    else neu[feld] = Number(wert);
    emit("fenster", z.mittel, neu);
}

const fensterText = (f: EditorPathSaison | null | undefined, seite: "von" | "bis"): { monat: string; tag: string } => {
    if (f === undefined) return { monat: "–", tag: "–" };
    if (f === null)
        return seite === "von" ? { monat: t("wegeditor.reisemittel.ganzjaehrig"), tag: "" } : { monat: "", tag: "" };
    return seite === "von"
        ? { monat: monatsName(f.from_month), tag: String(f.from_day) }
        : { monat: monatsName(f.to_month), tag: String(f.to_day) };
};
</script>

<template>
    <div class="weg-tafel" :data-testid="`${kennung}-tafel`">
        <p class="weg-tafel__kopf">
            <span class="weg-tafel__titel" :data-testid="`${kennung}-tafel-titel`">{{ titel }}</span>
            <span v-if="!(abschnitte.length === 1 && !alle)" class="weg-tafel__arten">{{
                arten.map(artName).join(", ")
            }}</span>
        </p>
        <p v-if="geteiltSatz" class="weg-tafel__satz" :data-testid="`${kennung}-tafel-geteilt`">{{ geteiltSatz }}</p>
        <div class="weg-tafel__felder">
            <span v-if="wegtypWaehlbar" class="weg-tafel__feld weg-tafel__feld--wahl">
                <span class="weg-tafel__name">{{ t("wegeditor.fenster.feld.wegtyp") }}</span>
                <AvmAuswahl
                    groesse="zeile"
                    :optionen="wegtypen"
                    :model-value="arten.length === 1 ? (arten[0] ?? WEGART_GEMISCHT) : WEGART_GEMISCHT"
                    :aria-label="t('wegeditor.fenster.feld.wegtyp')"
                    :testid="`${kennung}-tafel-wegtyp`"
                    @update:model-value="waehleWegtyp"
                />
            </span>
            <span v-else class="weg-tafel__feld">
                <span class="weg-tafel__name">{{ t("wegeditor.fenster.feld.wegtyp") }}</span>
                <span class="weg-tafel__wert">{{
                    arten.length === 1
                        ? artName(arten[0] ?? "")
                        : t("wegeditor.fenster.gemischt", { arten: arten.map(artName).join(", ") })
                }}</span>
            </span>
            <span v-if="fluesse" class="weg-tafel__feld weg-tafel__feld--wahl">
                <span class="weg-tafel__name">{{ t("wegeditor.tafel.richtung") }}</span>
                <!-- Bei (W) kein Wert für alle (OPS-000112), nur der Zustand des Flusses; lesend der Wert. -->
                <AvmAuswahl
                    v-if="schreibt && !ganzerFluss"
                    groesse="zeile"
                    :optionen="richtungOptionen"
                    :model-value="richtungWert"
                    :aria-label="t('wegeditor.tafel.richtung')"
                    :testid="`${kennung}-tafel-richtung`"
                    @update:model-value="waehleRichtung"
                />
                <span v-else class="weg-tafel__wert" :data-testid="`${kennung}-tafel-richtung-text`">{{
                    richtungAnzeige
                }}</span>
                <template v-if="schreibt">
                    <AvmKnopf
                        art="weich"
                        groesse="zeile"
                        :gesperrt="umkehrbar ? undefined : t('wegeditor.tafel.richtung.ohne')"
                        :title="t('wegeditor.tafel.richtung.satz')"
                        :testid="`${kennung}-tafel-richtung-umkehren`"
                        @click="emit('umkehren')"
                    >
                        ⇄ {{ t("wegeditor.tafel.richtung.umkehren") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="teilGewaehlt"
                        groesse="zeile"
                        :gesperrt="sperreRichtungAlle"
                        :title="t('wegeditor.tafel.richtung.alle.zettel')"
                        :aria-label="t('wegeditor.tafel.richtung.alle.name')"
                        :testid="`${kennung}-tafel-richtung-alle`"
                        @click="emit('richtungAlle')"
                    >
                        <template #zeichen>⇉</template>
                        {{ t("wegeditor.reisemittel.alle.knopf") }}
                    </AvmKnopf>
                </template>
            </span>
            <!-- Bei (W) steht hier kein Tunnel (Betreiber 2026-11-09, „unten nur bei Auswahl“): Oben unter Identität stehen die Abschnitte
                 im Tunnel. Ein Weg aus einem Abschnitt hat keine Leiste und damit nie (W): Sein Haken steht gleich hier. -->
            <AvmKaestchen
                v-if="schreibt && !alle"
                art="checkbox"
                :checked="tunnelZahl === abschnitte.length && abschnitte.length > 0"
                :hinweis="
                    tunnelZahl > 0 && tunnelZahl < abschnitte.length
                        ? t('wegeditor.tafel.tunnelTeils', {
                              n: formatNumber(tunnelZahl, 0),
                              m: formatNumber(abschnitte.length, 0),
                          })
                        : t('wegeditor.fenster.tunnelSatz')
                "
                :testid="`${kennung}-tafel-tunnel`"
                @change="(an) => emit('tunnel', an)"
            >
                {{ t("wegeditor.fenster.feld.tunnel") }}
            </AvmKaestchen>
            <span v-else-if="!alle" class="weg-tafel__feld">
                <span class="weg-tafel__name">{{ t("wegeditor.fenster.feld.tunnel") }}</span>
                <span class="weg-tafel__wert">{{
                    tunnelZahl === 0
                        ? "–"
                        : t("wegeditor.tafel.tunnelTeils", {
                              n: formatNumber(tunnelZahl, 0),
                              m: formatNumber(abschnitte.length, 0),
                          })
                }}</span>
            </span>
            <WegWeitere
                :weitere="weitere"
                :gelesen="weitereGelesen"
                :ids="gewaehlt"
                :nummern="nummern"
                :alle="alle"
                :gesamt="strasse.segments.length"
                :haupt-key="strasse.artikel?.key"
                :suche-id="strasse.id"
                :schreibt="schreibt"
                :kennung="kennung"
                @dazu="(w: EditorPathWeiterer) => emit('weitererDazu', w)"
                @weg="(key: string) => emit('weitererWeg', key)"
            />
        </div>
        <section class="weg-rm" :aria-label="t('wegeditor.reisemittel.titel')" :data-testid="`${kennung}-reisemittel`">
            <div class="weg-rm__kopf">
                <h5 class="weg-rm__titel">{{ t("wegeditor.reisemittel.titel") }}</h5>
                <span class="weg-rm__leise">{{ t("wegeditor.reisemittel.gangbar") }}</span>
                <span class="weg-rm__leise">{{ t("wegeditor.reisemittel.grund") }}</span>
            </div>
            <div
                class="weg-rm__jahr"
                role="img"
                :aria-label="t('wegeditor.reisemittel.jahr')"
                :data-testid="`${kennung}-monatsleiste`"
            >
                <span
                    v-for="(z, i) in jahreszeiten"
                    :key="`jz-${i}`"
                    class="weg-rm__jz"
                    :data-jz="z.art"
                    :style="{ gridColumn: `span ${z.n}` }"
                    >{{ t(`wegeditor.jahreszeit.${z.art}` as never) }}</span
                >
                <span class="weg-rm__jz" data-jz="namenlos"></span>
                <span
                    v-for="(monat, i) in CALENDAR_MONTHS"
                    :key="monat"
                    class="weg-rm__mo"
                    :class="{ 'weg-rm__mo--an': monatAn(i) }"
                    :data-jz="JAHRESZEIT_JE_MONAT[i]"
                    :data-monat="monat"
                    :title="monatsName(monat)"
                >
                    {{ monatsName(monat).slice(0, 3) }}<i class="weg-rm__spur" :style="{ background: spurVon(i) }"></i>
                </span>
                <span
                    class="weg-rm__mo"
                    :class="{ 'weg-rm__mo--an': monatAn(12) }"
                    data-jz="namenlos"
                    data-monat="namenlos"
                    :title="t('wegeditor.reisemittel.namenlos')"
                >
                    {{ t("wegeditor.reisemittel.nt") }}<i class="weg-rm__spur" :style="{ background: spurVon(12) }"></i>
                </span>
            </div>
            <p class="weg-rm__leise weg-rm__hinweis">
                {{ schnee ? t("wegeditor.reisemittel.schnee") : t("wegeditor.reisemittel.hinweis") }}
            </p>
            <div class="weg-rm__liste" :class="{ 'weg-rm__liste--mit': teilGewaehlt }" role="list">
                <div
                    v-for="z in zeilen"
                    :key="z.mittel"
                    class="weg-rm__zeile"
                    :class="{
                        'weg-rm__zeile--aus': z.faehrt === false,
                        'weg-rm__zeile--hell': hell?.mittel === z.mittel,
                    }"
                    role="listitem"
                    :data-mittel="z.mittel"
                    @mouseenter="zeigt = z.mittel"
                    @mouseleave="zeigt = undefined"
                    @click="halteFest(z.mittel)"
                >
                    <span class="weg-rm__name">
                        <button
                            v-if="schreibt"
                            type="button"
                            role="checkbox"
                            class="weg-rm__haken weg-rm__haken--knopf"
                            :class="{
                                'weg-rm__haken--an': z.faehrt === true,
                                'weg-rm__haken--teils': z.faehrt === null,
                            }"
                            :aria-checked="z.faehrt === null ? 'mixed' : z.faehrt"
                            :aria-label="t('wegeditor.reisemittel.faehrtHier', { mittel: mittelName(z.mittel) })"
                            :data-testid="`${kennung}-rm-haken-${z.mittel}`"
                            @click.stop="emit('mittel', z.mittel, z.faehrt !== true)"
                        ></button>
                        <span
                            v-else
                            class="weg-rm__haken"
                            :class="{
                                'weg-rm__haken--an': z.faehrt === true,
                                'weg-rm__haken--teils': z.faehrt === null,
                            }"
                            role="img"
                            :aria-label="z.faehrt === true ? '✓' : z.faehrt === null ? '–' : ''"
                        ></span>
                        <img
                            v-if="TRANSPORT_ICONS[z.mittel]"
                            class="weg-rm__bild"
                            :src="TRANSPORT_ICONS[z.mittel]"
                            alt=""
                        />
                        <span class="einzeilig">{{ t(`planner.transport.opt.${z.mittel}` as never) }}</span>
                        <small
                            v-if="z.angeboten < z.von"
                            class="weg-rm__marke"
                            :title="
                                t('wegeditor.reisemittel.teils', {
                                    n: formatNumber(z.angeboten, 0),
                                    m: formatNumber(z.von, 0),
                                })
                            "
                            >{{ z.angeboten }}/{{ z.von }}</small
                        >
                        <small v-if="z.erbt" class="weg-rm__marke" :title="t('wegeditor.reisemittel.erbtHinweis')">{{
                            t("wegeditor.reisemittel.erbt")
                        }}</small>
                    </span>
                    <template v-if="schreibt">
                        <AvmAuswahl
                            class="weg-rm__vm"
                            groesse="zeile"
                            :optionen="vonMonate(z)"
                            :model-value="z.fenster === undefined ? '–' : (z.fenster?.from_month ?? '')"
                            :gesperrt="gesperrtWenn(z.faehrt === false)"
                            :aria-label="t('wegeditor.reisemittel.vonMonat', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-von-${z.mittel}`"
                            @click.stop
                            @update:model-value="(wert: string) => setzeVonMonat(z, wert)"
                        />
                        <AvmAuswahl
                            class="weg-rm__vt"
                            groesse="zeile"
                            :optionen="mitLeer(z, TAGE)"
                            :model-value="z.fenster ? String(z.fenster.from_day) : ''"
                            :gesperrt="gesperrtWenn(z.faehrt === false || !z.fenster)"
                            :aria-label="t('wegeditor.reisemittel.vonTag', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-vontag-${z.mittel}`"
                            @click.stop
                            @update:model-value="(wert: string) => setzeFensterFeld(z, 'from_day', wert)"
                        />
                        <span class="weg-rm__leise weg-rm__bis">{{ t("wegeditor.reisemittel.bis") }}</span>
                        <AvmAuswahl
                            class="weg-rm__bm"
                            groesse="zeile"
                            :optionen="mitLeer(z, MONATE)"
                            :model-value="z.fenster ? z.fenster.to_month : ''"
                            :gesperrt="gesperrtWenn(z.faehrt === false || !z.fenster)"
                            :aria-label="t('wegeditor.reisemittel.bisMonat', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-bis-${z.mittel}`"
                            @click.stop
                            @update:model-value="(wert: string) => setzeFensterFeld(z, 'to_month', wert)"
                        />
                        <AvmAuswahl
                            class="weg-rm__bt"
                            groesse="zeile"
                            :optionen="mitLeer(z, TAGE)"
                            :model-value="z.fenster ? String(z.fenster.to_day) : ''"
                            :gesperrt="gesperrtWenn(z.faehrt === false || !z.fenster)"
                            :aria-label="t('wegeditor.reisemittel.bisTag', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-bistag-${z.mittel}`"
                            @click.stop
                            @update:model-value="(wert: string) => setzeFensterFeld(z, 'to_day', wert)"
                        />
                        <AvmAuswahl
                            class="weg-rm__gr"
                            groesse="zeile"
                            :optionen="gruende"
                            :model-value="z.fenster?.reason ?? ''"
                            :gesperrt="gesperrtWenn(z.faehrt === false || !z.fenster)"
                            :aria-label="t('wegeditor.reisemittel.grundVon', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-grund-${z.mittel}`"
                            @click.stop
                            @update:model-value="(wert: string) => setzeFensterFeld(z, 'reason', wert)"
                        />
                    </template>
                    <template v-else>
                        <span class="weg-rm__feld weg-rm__vm" :class="{ 'weg-rm__feld--blass': z.faehrt === false }">{{
                            fensterText(z.fenster, "von").monat
                        }}</span>
                        <span
                            class="weg-rm__feld weg-rm__feld--tag weg-rm__vt"
                            :class="{ 'weg-rm__feld--blass': z.faehrt === false || z.fenster === null }"
                            >{{ fensterText(z.fenster, "von").tag }}</span
                        >
                        <span class="weg-rm__leise weg-rm__bis">{{ t("wegeditor.reisemittel.bis") }}</span>
                        <span
                            class="weg-rm__feld weg-rm__bm"
                            :class="{ 'weg-rm__feld--blass': z.faehrt === false || z.fenster === null }"
                            >{{ fensterText(z.fenster, "bis").monat }}</span
                        >
                        <span
                            class="weg-rm__feld weg-rm__feld--tag weg-rm__bt"
                            :class="{ 'weg-rm__feld--blass': z.faehrt === false || z.fenster === null }"
                            >{{ fensterText(z.fenster, "bis").tag }}</span
                        >
                        <span class="weg-rm__feld weg-rm__feld--grund weg-rm__feld--blass">{{
                            z.fenster?.reason ? t(`wegeditor.reisemittel.grundWort.${z.fenster.reason}` as never) : "–"
                        }}</span>
                    </template>
                    <span v-if="teilGewaehlt" class="weg-rm__ubern">
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="sperreZeile[z.mittel]"
                            :grund-bei="
                                sperreZeile[z.mittel] === undefined ? undefined : `${kennung}-rm-alle-grund-${z.mittel}`
                            "
                            :title="t('wegeditor.reisemittel.alle.zeileZettel', { mittel: mittelName(z.mittel) })"
                            :aria-label="t('wegeditor.reisemittel.alle.zeileZettel', { mittel: mittelName(z.mittel) })"
                            :testid="`${kennung}-rm-alle-${z.mittel}`"
                            @click.stop="emit('alle', z.mittel)"
                            >⇉</AvmKnopf
                        >
                        <span
                            v-if="sperreZeile[z.mittel] !== undefined"
                            :id="`${kennung}-rm-alle-grund-${z.mittel}`"
                            class="weg-rm__vorlesen"
                            >{{ sperreZeile[z.mittel] }}</span
                        >
                    </span>
                </div>
            </div>
            <div class="weg-rm__fuss">
                <p class="weg-rm__leise">
                    {{ schreibt ? t("wegeditor.reisemittel.schreibend") : t("wegeditor.reisemittel.lesend") }}
                </p>
                <AvmKnopf
                    v-if="teilGewaehlt"
                    groesse="zeile"
                    :gesperrt="sperreAlle"
                    :title="t('wegeditor.reisemittel.alle.zettel')"
                    :testid="`${kennung}-rm-alle`"
                    @click="emit('alle', undefined)"
                >
                    <template #zeichen>⇉</template>
                    {{ t("wegeditor.reisemittel.alle.knopf") }}
                </AvmKnopf>
            </div>
        </section>
    </div>
</template>

<style scoped>
.weg-tafel {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin-top: var(--space-8);
}

.weg-tafel__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4) var(--space-8);
    margin: 0;
}

.weg-tafel__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
}

.weg-tafel__arten,
.weg-tafel__name,
.weg-rm__leise {
    color: var(--color-text-muted);
}

.weg-tafel__felder {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8) var(--space-24);
}

.weg-tafel__feld {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-6);
    font-size: var(--font-size-reading);
}

.weg-tafel__feld--wahl {
    align-items: center;
}

.weg-tafel__wert {
    color: var(--color-text-strong);
}

.weg-tafel__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.weg-rm {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.weg-rm__kopf {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: var(--space-10);
}

.weg-rm__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.weg-rm__leise {
    margin: 0;
    font-size: var(--font-size-small);
}

/* Die Monatsleiste: zwölf Monate zu 30 Tagen, darüber ihre Jahreszeit, am Ende die Namenlosen Tage (schmal). */
.weg-rm__jahr {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr)) 0.45fr;
    gap: 1px;
    font-size: var(--font-size-caption);
    line-height: 1;
}

.weg-rm__jz,
.weg-rm__mo {
    color: var(--color-season-text);
    background: var(--jz);
    text-align: center;
}

.weg-rm__jz {
    padding: 2px 0 1px;
    overflow: hidden;
    white-space: nowrap;
}

.weg-rm__mo {
    position: relative;
    padding: 3px 0 6px;
    color: color-mix(in srgb, var(--color-season-text) 62%, var(--color-panel));
    background: color-mix(in srgb, var(--jz) 62%, var(--color-panel));
}

.weg-rm__mo--an {
    color: var(--color-season-text);
    background: var(--jz);
}

.weg-rm__spur {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 4px;
}

[data-jz="sommer"] {
    --jz: var(--color-season-summer);
}
[data-jz="herbst"] {
    --jz: var(--color-season-autumn);
}
[data-jz="winter"] {
    --jz: var(--color-season-winter);
}
[data-jz="fruehling"] {
    --jz: var(--color-season-spring);
}
[data-jz="namenlos"] {
    --jz: var(--color-season-nameless);
}

.weg-rm__hinweis {
    padding-top: 2px;
}

.weg-rm__liste {
    display: flex;
    flex-direction: column;
}

/* Eine Zeile je Reisemittel: Haken, Bild, Name, von Monat und Tag, bis, Monat und Tag, Grund. */
.weg-rm__zeile {
    display: grid;
    /* Tag und Grund breit genug für „30“ und „Schneemassen“ samt Pfeil des Auswahlfelds. */
    grid-template-columns: minmax(0, 1fr) 6.5rem 3.5rem auto 6.5rem 3.5rem 6.5rem;
    align-items: center;
    gap: var(--space-4);
    padding: 3px 0;
    border-top: 1px solid var(--color-border);
    cursor: pointer;
}

.weg-rm__zeile--hell {
    background: var(--color-hover-wash);
}

.weg-rm__name {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.weg-rm__zeile--aus .weg-rm__name {
    color: var(--color-text-muted);
}

.weg-rm__haken {
    flex: none;
    box-sizing: border-box;
    width: var(--space-12);
    height: var(--space-12);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
}

/* Als Knopf (wer schreiben darf): dieselbe Gestalt, mit Zeiger und Fokusring. */
.weg-rm__haken--knopf {
    padding: 0;
    background: var(--color-panel);
    cursor: pointer;
}

.weg-rm__haken--knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.weg-rm__haken--an {
    border-color: var(--color-accent);
    background: var(--color-accent);
}

.weg-rm__haken--teils {
    border-color: var(--color-accent);
    background: linear-gradient(var(--color-accent), var(--color-accent)) center / 8px 2px no-repeat;
}

.weg-rm__bild {
    flex: none;
    width: 24px;
    height: 24px;
    object-fit: contain;
}

.weg-rm__zeile--aus .weg-rm__bild {
    opacity: 0.45;
    filter: grayscale(1);
}

.weg-rm__marke {
    flex: none;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--space-12);
}

/* Lesend wie die Auswahlfelder (AvmAuswahl zeile, 26 px), ohne Pfeil: Ändern kommt mit dem Schreibweg. */
.weg-rm__feld {
    box-sizing: border-box;
    min-width: 0;
    height: var(--space-24);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: calc(var(--space-24) - 2px);
    overflow: hidden;
    white-space: nowrap;
}

.weg-rm__feld--tag {
    text-align: center;
}

/* Die Auswahlfelder (wer schreiben darf) füllen ihre Spalte. */
.weg-rm__vm,
.weg-rm__vt,
.weg-rm__bm,
.weg-rm__bt,
.weg-rm__gr {
    width: 100%;
}

.weg-rm__feld--blass {
    opacity: 0.45;
}

/* Auf alle Abschnitte übernehmen (OPS-000112): je Zeile der kleine ⇉ in einer eigenen Spalte, darunter der große Knopf rechts. */
.weg-rm__liste--mit .weg-rm__zeile {
    grid-template-columns: minmax(0, 1fr) 6.2rem 3.5rem auto 5rem 3.5rem 5rem var(--space-24);
}

.weg-rm__ubern {
    justify-self: end;
    min-width: var(--space-24);
}

.weg-rm__ubern :deep(.knopf) {
    min-width: var(--space-24);
    padding-inline: 0;
    font-size: var(--font-size-body);
}

/* Der Grund einer Sperre des kleinen Knopfs: vorgelesen und als Zettel, ohne eigene Zeile in der Liste. */
.weg-rm__vorlesen {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

.weg-rm__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.weg-rm__fuss > p {
    flex: 1 1 200px;
    min-width: 0;
}

.weg-rm__fuss > .knopf-huelle {
    flex: none;
    margin-left: auto;
}

@media (max-width: 900px) {
    .weg-rm__zeile {
        grid-template-columns: minmax(0, 1fr) 3.5rem auto minmax(0, 1fr) 3.5rem;
        grid-template-areas: "name name name grund grund" "vm vt bis bm bt";
        row-gap: 3px;
    }
    .weg-rm__name {
        grid-area: name;
    }
    .weg-rm__vm {
        grid-area: vm;
    }
    .weg-rm__vt {
        grid-area: vt;
    }
    .weg-rm__bis {
        grid-area: bis;
    }
    .weg-rm__bm {
        grid-area: bm;
    }
    .weg-rm__bt {
        grid-area: bt;
    }
    .weg-rm__feld--grund,
    .weg-rm__gr {
        grid-area: grund;
    }
    .weg-rm__liste--mit .weg-rm__zeile {
        grid-template-columns: minmax(0, 1fr) 3.5rem auto minmax(0, 1fr) 3.5rem var(--space-24);
        grid-template-areas: "name name name grund grund ubern" "vm vt bis bm bt .";
    }
    .weg-rm__ubern {
        grid-area: ubern;
    }
}
</style>
