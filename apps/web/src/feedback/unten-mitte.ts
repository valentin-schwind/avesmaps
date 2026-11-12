import { ref } from "vue";

/**
 * Wie viel Höhe die Hinweise zur Bitte um Freigabe unten in der Mitte belegen (WI-0262, Vali 2026-10-30: „zentriert am unteren
 * bildschirmrand“), samt Abstand, in Pixeln; ohne Hinweis dort 0. Der Toast hat denselben Platz und steigt um diese Höhe darüber, damit
 * keiner den anderen verdeckt. Die Maßstabsleiste misst die Hinweise selbst (`scale-bar.vue`) und hört nur auf die Änderung.
 */
export const hinweiseUnten = ref(0);

/**
 * Wie hoch die Leiste der Reisebilder unten über die ganze Breite steht (WI-0272 S4), in Pixeln; zu, in einer anderen Ansicht oder verdeckt 0. Der Toast steigt um diese Höhe, die
 * Maßstabsleiste misst die Leiste selbst; Panels und Eckbund lesen dieselbe Zahl als `--avm-reisebilder-leiste` am Dokument. Gesetzt wird sie vom Host der Leiste.
 */
export const leisteUnten = ref(0);
