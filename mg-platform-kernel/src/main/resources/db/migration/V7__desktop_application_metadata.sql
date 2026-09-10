ALTER TABLE desktop_applications ADD COLUMN IF NOT EXISTS developer text NOT NULL DEFAULT '' CHECK(length(developer) <= 120);
