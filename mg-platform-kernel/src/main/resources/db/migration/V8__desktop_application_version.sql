ALTER TABLE desktop_applications ADD COLUMN IF NOT EXISTS registered_version text NOT NULL DEFAULT '' CHECK(length(registered_version) <= 64);
