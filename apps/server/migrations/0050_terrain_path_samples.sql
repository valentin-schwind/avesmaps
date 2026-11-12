-- Die Abtastwerte der Wegprofile (WI-0049 S5c): Reit- und Lasttier (EQUID) und Wagen (WHEEL) rechnen ihre
-- Steigung je Abtastschritt und nicht linear, und die Sternregel grenzt den Pfad in Gebirgsflaechen je
-- Abtastschritt ab. Die sieben Summen je Paar aus 0049 reichen dafuer nicht.
-- Derived Data aus `derive:terrain`, wie die Paare; ein Verlust kostet einen Lauf.
--
-- Je Stuetzpunktpaar in gespeicherter Punktreihenfolge, float32 (little-endian):
--   Zahl der Abtastpunkte n (0, wenn das Paar keine Hoehe hat), Laenge eines Abtastschritts (Schritt),
--   dann je Punkt die Hoehe (Schritt, NaN ohne Hoehe) und 1, wenn er in einer Gebirgsflaeche liegt, sonst 0.
--   Ein Paar ohne Hoehe traegt also nur [0, 0].
--
-- 🔴 Null bei einem Profil von vor S5c: Dann gehen alle Familien wie zu Fuss (S5a/S5b), und keine Sternregel
-- greift auf dem Weg. Der naechste `derive:terrain` rechnet jede Zeile neu, weil die Profilregeln in den
-- Fingerabdruck eingehen. Leser von vor S5c lesen nur `pairs` und bleiben unberuehrt.

ALTER TABLE terrain_path_profile ADD COLUMN IF NOT EXISTS samples BYTEA;

ALTER TABLE terrain_path_profile DROP CONSTRAINT IF EXISTS terrain_path_profile_samples_size;
ALTER TABLE terrain_path_profile
    ADD CONSTRAINT terrain_path_profile_samples_size
    CHECK (samples IS NULL OR octet_length(samples) >= pair_count * 8 AND octet_length(samples) % 4 = 0);
