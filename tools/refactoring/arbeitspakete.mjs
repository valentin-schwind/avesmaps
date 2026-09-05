// Parser des Rueckgrats docs/refactoring-arbeitspakete.md -- EIN Leser fuer Waechter-Test,
// Frischelauf und Routine (Entwurf docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md §2/§4).
//
// Die Identitaet eines Pakets ist seine Kennung P-NNN; die seiner Zieldatei der Blob-Hash auf
// origin/master zum Zeitpunkt der Anlage (`Stand: <sha> · Blob: <hash>`). Zeilennummern im
// Block-Feld sind Orientierung; die Identitaet eines Blocks sind seine Funktionsnamen.
//
// Form eines Pakets (siehe Skelett des Dokuments):
//   ### P-001 · js/review/review-wiki-sync.js · Verfahren A
//   - Status: offen | GO nötig | in Arbeit (<datum>) | erledigt (<sha>) | verworfen (<grund>)
//   - Stand: <sha> · Blob: <blob>
//   - Block: „<Thema>“ — <erster> … <letzter> (...)
//   - Ziel: <pfad>[, Nachsatz]
//   - Messskript: tools/perf/<paket>.mjs|php        (nur Verfahren D)
//   - Verlauf: <eintrag> · <eintrag>

import fs from "node:fs";
import path from "node:path";

export const STATUS = ["offen", "GO nötig", "in Arbeit", "erledigt", "verworfen"];

export function parseArbeitspakete(markdown) {
	const zeilen = markdown.split(/\r?\n/);
	let sperre = null;
	const pakete = [];
	let akt = null;
	zeilen.forEach((z, idx) => {
		const sp = z.match(/^Sperre:\s*(\S+)\s*(.*)$/);
		if (sp) { sperre = { datum: sp[1], grund: sp[2].trim() }; return; }
		const kopf = z.match(/^###\s+(P-\d{3})\s+·\s+(\S+)\s+·\s+Verfahren\s+([A-D])\s*$/);
		if (kopf) {
			akt = { id: kopf[1], datei: kopf[2], verfahren: kopf[3], status: "", statusRoh: "", stand: "", blob: "", block: "", ziel: "", messskript: "", verlauf: [], zeile: idx + 1 };
			pakete.push(akt);
			return;
		}
		if (!akt) return;
		if (/^#/.test(z)) { akt = null; return; }
		const feld = z.match(/^-\s+([A-Za-zÄÖÜäöüß-]+)(?:\s*\([^)]*\))?:\s*(.*)$/);
		if (!feld) return;
		const [, k, w] = feld;
		const wert = w.trim();
		if (k === "Status") { akt.statusRoh = wert; akt.status = STATUS.find((s) => wert.startsWith(s)) || wert; }
		else if (k === "Stand") { const m = wert.match(/^([0-9a-f]+)\s*·\s*Blob:\s*([0-9a-f]+)/); if (m) { akt.stand = m[1]; akt.blob = m[2]; } }
		else if (k === "Block") akt.block = wert;
		else if (k === "Ziel") akt.ziel = wert.split(/[,\s]/)[0];
		else if (k === "Messskript") akt.messskript = wert;
		else if (k === "Verlauf") akt.verlauf = wert.split(" · ").map((s) => s.trim()).filter(Boolean);
	});
	return { sperre, pakete };
}

export function ladeArbeitspakete(wurzel) {
	return parseArbeitspakete(fs.readFileSync(path.join(wurzel, "docs", "refactoring-arbeitspakete.md"), "utf8"));
}
