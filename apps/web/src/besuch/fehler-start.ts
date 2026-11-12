import { installiereFehlerfaenger } from "./fehler-faenger";

// Der erste Import von `main.ts` (WI-0202): Die Fänger am Fenster stehen, bevor `app.vue` und alles andere ausgewertet wird.
installiereFehlerfaenger();
