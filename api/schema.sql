-- Contact / demo-request submissions from stratagemengine.com
-- Apply once against the Coolify-managed Postgres:
--   psql "$DATABASE_URL" -f api/schema.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS contact_submissions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    audience     text        NOT NULL,
    name         text        NOT NULL,
    email        text        NOT NULL,
    institution  text        NOT NULL,
    role         text        NOT NULL,
    cohort_size  text,
    simulation   text,
    message      text,
    ip           text,
    user_agent   text
);

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
    ON contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS contact_submissions_email_idx
    ON contact_submissions (lower(email));
