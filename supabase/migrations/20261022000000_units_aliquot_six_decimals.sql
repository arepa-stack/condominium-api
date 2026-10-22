-- Aliquots are published with 6 decimals (e.g. 3.683168%); NUMERIC(10,4) rounded them.
-- NUMERIC(12,6) keeps the 6 integer digits of NUMERIC(10,4), so every existing value fits unchanged.
ALTER TABLE units ALTER COLUMN aliquot TYPE NUMERIC(12,6);
