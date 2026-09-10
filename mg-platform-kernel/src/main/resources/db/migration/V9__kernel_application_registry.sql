ALTER TABLE desktop_applications ADD COLUMN IF NOT EXISTS runtime_ready boolean NOT NULL DEFAULT true;
