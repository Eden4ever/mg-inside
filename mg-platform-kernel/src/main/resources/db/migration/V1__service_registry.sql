CREATE TABLE IF NOT EXISTS service_schema (id integer PRIMARY KEY CHECK(id=1),version integer NOT NULL CHECK(version=1));
INSERT INTO service_schema VALUES(1,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS service_environments (
 name text PRIMARY KEY CHECK(name ~ '^[a-z][a-z0-9-]{1,31}$'),
 generation bigint NOT NULL DEFAULT 0, imported_digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS service_publications (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 service_id text NOT NULL, version text NOT NULL, app_id text NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 contract_digest text CHECK(contract_digest ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL, contract jsonb, published_at text NOT NULL, actor text NOT NULL,
 PRIMARY KEY(service_id,version),
 CHECK(manifest->>'serviceId'=service_id AND manifest->>'version'=version AND manifest->>'appId'=app_id),
 CHECK((contract IS NULL)=(contract_digest IS NULL))
);
CREATE TABLE IF NOT EXISTS service_bindings (
 environment text NOT NULL REFERENCES service_environments(name),
 service_id text NOT NULL, version text, revision integer NOT NULL CHECK(revision>=0),
 endpoint_ref text, deployment_id text, deployment_digest text, manifest_digest text, contract_digest text,
 PRIMARY KEY(environment,service_id),
 FOREIGN KEY(service_id,version) REFERENCES service_publications(service_id,version)
);
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS endpoint_ref text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS deployment_id text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS deployment_digest text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS manifest_digest text;
ALTER TABLE service_bindings ADD COLUMN IF NOT EXISTS contract_digest text;
CREATE TABLE IF NOT EXISTS service_audit (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id text NOT NULL, environment text NOT NULL REFERENCES service_environments(name),
 event jsonb NOT NULL, PRIMARY KEY(environment,id)
);
CREATE INDEX IF NOT EXISTS service_audit_environment ON service_audit(environment,sequence DESC);
CREATE TABLE IF NOT EXISTS service_activity (
 sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 id text NOT NULL, environment text NOT NULL REFERENCES service_environments(name),
 event jsonb NOT NULL, PRIMARY KEY(environment,id)
);
CREATE INDEX IF NOT EXISTS service_activity_environment ON service_activity(environment,sequence DESC);
CREATE TABLE IF NOT EXISTS service_version_lifecycles (
 service_id text NOT NULL,version text NOT NULL,value jsonb NOT NULL,
 PRIMARY KEY(service_id,version),
 FOREIGN KEY(service_id,version) REFERENCES service_publications(service_id,version),
 CHECK(value->>'status' IN ('draft','published','deprecated','retired'))
);
