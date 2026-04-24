-- Add building_code (permanent QR identifier) and max_residents_per_unit to buildings

ALTER TABLE buildings
    ADD COLUMN building_code TEXT,
    ADD COLUMN max_residents_per_unit INT NOT NULL DEFAULT 2;

-- Backfill existing buildings with a unique code: COND-XXXXXXXX
DO $$
DECLARE
    rec RECORD;
    new_code TEXT;
    attempt INT;
BEGIN
    FOR rec IN SELECT id FROM buildings WHERE building_code IS NULL LOOP
        attempt := 0;
        LOOP
            new_code := 'COND-' || upper(substring(md5(random()::text || rec.id::text) FROM 1 FOR 8));
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM buildings WHERE building_code = new_code
            );
            attempt := attempt + 1;
            IF attempt > 10 THEN
                RAISE EXCEPTION 'Could not generate unique building_code after 10 attempts';
            END IF;
        END LOOP;
        UPDATE buildings SET building_code = new_code WHERE id = rec.id;
    END LOOP;
END;
$$;

-- Now enforce NOT NULL + UNIQUE
ALTER TABLE buildings
    ALTER COLUMN building_code SET NOT NULL,
    ADD CONSTRAINT buildings_building_code_key UNIQUE (building_code);
