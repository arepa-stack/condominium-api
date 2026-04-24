-- Add must_change_password flag to profiles.
-- When true, the user must change their temporary password before accessing the app.
-- Set to true when admin creates a Board Member or approves a Resident (credentials sent by email).

ALTER TABLE profiles
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
