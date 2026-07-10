-- Soft delete for account-deletion requests (Google Play Data Safety requirement).
-- When a user deletes their account from the app, we keep the row (financial
-- records must be retained) but mark it deleted and store the reason/comment.
-- The auth user is banned separately so the account can no longer log in.

ALTER TABLE profiles
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deletion_reason TEXT;
