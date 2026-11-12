// Einstieg des Commit-Wächters (WI-0185) für den pre-commit-Hook; die Regel steht in `commit-waechter.ts`.
import { meldung, pruefe } from "./commit-waechter.ts";

const pruefung = pruefe();
if (pruefung.veraltet.length > 0) {
    process.stderr.write(meldung(pruefung) + "\n");
    process.exit(1);
}
