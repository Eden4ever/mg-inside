CREATE TABLE IF NOT EXISTS desktop_applications (
 id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9-]{1,63}$'),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 description text NOT NULL CHECK(length(description) <= 200),
 entry_url text NOT NULL,
 upstream_url text NOT NULL,
 default_path text NOT NULL CHECK(default_path ~ '^/[A-Za-z0-9/_-]*$'),
 allowed_paths jsonb NOT NULL CHECK(jsonb_typeof(allowed_paths)='array'),
 allowed_api_paths jsonb CHECK(allowed_api_paths IS NULL OR jsonb_typeof(allowed_api_paths)='array'),
 icon text NOT NULL CHECK(icon IN ('knowledge','token','identity','personal')),
 kind text NOT NULL CHECK(kind IN ('default','system','internal')),
 authorization_app_id text,
 required_role text,
 min_width integer NOT NULL DEFAULT 760 CHECK(min_width BETWEEN 320 AND 4000),
 min_height integer NOT NULL DEFAULT 480 CHECK(min_height BETWEEN 240 AND 4000),
 default_maximized boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS desktop_applications_enabled_order ON desktop_applications(enabled,sort_order,id);
CREATE TABLE IF NOT EXISTS desktop_application_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 application_id text NOT NULL REFERENCES desktop_applications(id),
 action text NOT NULL CHECK(action IN ('create','update','enable','disable')),
 before_config jsonb,
 after_config jsonb NOT NULL,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
