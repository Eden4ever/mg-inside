ALTER TABLE desktop_applications DROP CONSTRAINT IF EXISTS desktop_applications_icon_check;
ALTER TABLE desktop_applications ADD CONSTRAINT desktop_applications_icon_check
 CHECK(icon ~ '^[a-z][a-z0-9-]{0,63}$');
