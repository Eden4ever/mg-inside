package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;

/** PostgreSQL 多实例存储。所有变更使用同一连接和事务，并由全局 advisory lock 串行化。 */
public final class PostgresServiceRegistryStorage implements ServiceRegistryStorage {
    public static final long ADVISORY_LOCK = 741029L;
    private final HikariDataSource dataSource;
    private final String environment;

    public PostgresServiceRegistryStorage(String connectionString, String environment) {
        this.environment = validateEnvironment(environment);
        var config = new HikariConfig();
        configureConnection(config, connectionString);
        config.setPoolName("mg-service-registry");
        config.setMaximumPoolSize(4);
        config.setMinimumIdle(0);
        config.setConnectionTimeout(2_000);
        config.setInitializationFailTimeout(-1);
        config.setIdleTimeout(10_000);
        config.setMaxLifetime(300_000);
        config.setAutoCommit(true);
        config.addDataSourceProperty("ApplicationName", "mg-service-registry");
        config.addDataSourceProperty("statement_timeout", "5000");
        dataSource = new HikariDataSource(config);
    }

    @Override public ObjectNode read(boolean allowCache) {
        try (Connection connection = dataSource.getConnection()) {
            return readState(connection);
        } catch (SQLException error) {
            throw unavailable();
        }
    }

    @Override public <T> T transaction(Change<T> change) {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement statement = connection.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
                    statement.setLong(1, ADVISORY_LOCK);
                    statement.execute();
                }
                ObjectNode before = readState(connection);
                ObjectNode after = before.deepCopy();
                ArrayNode activeBindings = readActiveBindings(connection);
                T result = change.apply(after, new Context(environment, activeBindings));
                insertChanges(connection, before, after);
                try (PreparedStatement statement = connection.prepareStatement("UPDATE service_environments SET generation=generation+1 WHERE name=?")) {
                    statement.setString(1, environment);
                    statement.executeUpdate();
                }
                connection.commit();
                return result;
            } catch (RuntimeException | SQLException error) {
                try { connection.rollback(); } catch (SQLException ignored) {}
                if (error instanceof ApiException api) throw api;
                if (error instanceof SQLException) throw unavailable();
                throw error;
            } finally {
                try { connection.setAutoCommit(true); } catch (SQLException ignored) {}
            }
        } catch (SQLException error) {
            throw unavailable();
        }
    }

    @Override public ObjectNode status() {
        return Json.object().put("backend", "postgresql").put("environment", environment).put("stale", false);
    }

    @Override public void close() { dataSource.close(); }

    @Override public ObjectNode apiInventory() {
        try(var connection=dataSource.getConnection();var statement=connection.prepareStatement("SELECT value FROM service_api_inventory WHERE id=1");var rows=statement.executeQuery()) {
            if(!rows.next())throw unavailable();return (ObjectNode)Json.read(rows.getString(1));
        }catch(SQLException error){throw new ApiException(503,"API 台账存储不可用，请核查 V6 数据迁移和运行账号权限");}
    }
    @Override public <T>T apiInventoryTransaction(Change<T> change) {
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                ObjectNode value;
                try(var statement=connection.prepareStatement("SELECT value FROM service_api_inventory WHERE id=1 FOR UPDATE");var rows=statement.executeQuery()){if(!rows.next())throw unavailable();value=(ObjectNode)Json.read(rows.getString(1));}
                long before=value.path("revision").asLong();T result=change.apply(value,new Context(environment,Json.MAPPER.createArrayNode()));
                if(value.path("revision").asLong()!=before){
                    try(var statement=connection.prepareStatement("INSERT INTO service_api_inventory_history(revision,value) VALUES(?,?::jsonb)")){statement.setLong(1,value.path("revision").asLong());statement.setString(2,Json.text(value));statement.executeUpdate();}
                    try(var statement=connection.prepareStatement("UPDATE service_api_inventory SET value=?::jsonb WHERE id=1")){statement.setString(1,Json.text(value));statement.executeUpdate();}
                }
                connection.commit();return result;
            }catch(RuntimeException|SQLException error){connection.rollback();if(error instanceof RuntimeException runtime)throw runtime;throw unavailable();}
        }catch(SQLException error){throw unavailable();}
    }

    @Override public ObjectNode workspace() {
        try(var connection=dataSource.getConnection();var statement=connection.prepareStatement("SELECT value FROM service_workspace WHERE id=1");var rows=statement.executeQuery()) {
            if(!rows.next())throw unavailable();return (ObjectNode)Json.read(rows.getString(1));
        }catch(SQLException error){throw new ApiException(503,"服务分类与标签存储不可用，请核查 V4 数据迁移和运行账号权限");}
    }
    @Override public <T>T workspaceTransaction(Change<T> change) {
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                ObjectNode value;
                try(var statement=connection.prepareStatement("SELECT value FROM service_workspace WHERE id=1 FOR UPDATE");var rows=statement.executeQuery()){if(!rows.next())throw unavailable();value=(ObjectNode)Json.read(rows.getString(1));}
                T result=change.apply(value,new Context(environment,Json.MAPPER.createArrayNode()));
                try(var statement=connection.prepareStatement("UPDATE service_workspace SET value=?::jsonb WHERE id=1")){statement.setString(1,Json.text(value));statement.executeUpdate();}
                connection.commit();return result;
            }catch(RuntimeException|SQLException error){connection.rollback();if(error instanceof RuntimeException runtime)throw runtime;throw unavailable();}
        }catch(SQLException error){throw unavailable();}
    }
    @Override public void appendActivity(ObjectNode event) {
        try(var connection=dataSource.getConnection();var statement=connection.prepareStatement("INSERT INTO service_activity(environment,id,event) VALUES(?,?,?::jsonb) ON CONFLICT DO NOTHING")) {
            statement.setString(1,environment);statement.setString(2,event.path("id").asText());statement.setString(3,Json.text(event));statement.executeUpdate();
        }catch(SQLException error){throw unavailable();}
    }
    @Override public ObjectNode insights(ServiceMetrics.Query query,Set<String> allowed) {
        var accumulator=new ServiceMetrics.Accumulator(query,allowed);
        if(allowed.isEmpty())return accumulator.finish("persisted");
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try(var statement=connection.prepareStatement("SELECT event FROM service_activity WHERE environment=? AND (event->>'at')::timestamptz>=? AND (event->>'at')::timestamptz<? AND event->>'serviceId'=ANY(?) ORDER BY sequence DESC")) {
                statement.setFetchSize(512);statement.setString(1,environment);statement.setObject(2,query.from().atOffset(java.time.ZoneOffset.UTC));statement.setObject(3,query.to().atOffset(java.time.ZoneOffset.UTC));statement.setArray(4,connection.createArrayOf("text",allowed.toArray(String[]::new)));
                try(var rows=statement.executeQuery()){while(rows.next())accumulator.add(Json.read(rows.getString(1)));}connection.commit();
            }
            return accumulator.finish("persisted");
        }catch(SQLException error){throw unavailable();}
    }

    @Override public void appendAudit(ObjectNode event) {
        try(var connection=dataSource.getConnection();var statement=connection.prepareStatement("INSERT INTO service_audit(environment,id,event) VALUES(?,?,?::jsonb) ON CONFLICT DO NOTHING")) {
            statement.setString(1,environment);statement.setString(2,event.path("id").asText());statement.setString(3,Json.text(event));statement.executeUpdate();
        }catch(SQLException error){throw unavailable();}
    }

    public void applySchema(String sql) {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException error) {
            throw unavailable();
        }
    }

    /** 只导入空环境；同摘要可安全重试，已有不同来源数据时拒绝覆盖。 */
    public boolean importState(ObjectNode imported, String digest) {
        if (digest == null || !digest.matches("[a-f0-9]{64}")) throw new IllegalStateException("迁移摘要无效");
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement statement = connection.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
                    statement.setLong(1, ADVISORY_LOCK);
                    statement.execute();
                }
                try (PreparedStatement statement = connection.prepareStatement("SELECT imported_digest FROM service_environments WHERE name=?")) {
                    statement.setString(1, environment);
                    try (ResultSet result = statement.executeQuery()) {
                        if (result.next()) {
                            if (!digest.equals(result.getString(1))) throw new IllegalStateException("目标环境已有不同来源数据，拒绝覆盖");
                            connection.commit();
                            return true;
                        }
                    }
                }
                try (PreparedStatement statement = connection.prepareStatement("INSERT INTO service_environments(name,imported_digest) VALUES(?,?)")) {
                    statement.setString(1, environment);
                    statement.setString(2, digest);
                    statement.executeUpdate();
                }
                ObjectNode previous = readState(connection);
                var lifecycles = imported.with("lifecycles").fields();
                while (lifecycles.hasNext()) {
                    var entry = lifecycles.next();
                    JsonNode existing = previous.with("lifecycles").get(entry.getKey());
                    if (existing != null && !CanonicalJson.write(existing).equals(CanonicalJson.write(entry.getValue()))) throw new IllegalStateException("其他环境已有不同生命周期，拒绝覆盖");
                }
                var active = imported.with("active").fields();
                while (active.hasNext()) {
                    var entry = active.next();
                    if (!entry.getValue().isTextual()) continue;
                    String key = entry.getKey() + "@" + entry.getValue().textValue();
                    String existingStatus = previous.with("lifecycles").path(key).path("status").asText();
                    String importedStatus = imported.with("lifecycles").path(key).path("status").asText(existingStatus);
                    if (Set.of("retired", "draft").contains(importedStatus) || "deprecated".equals(existingStatus)) throw new IllegalStateException("导入会重新绑定已弃用、退役或未发布版本，拒绝旧快照恢复");
                }
                insertChanges(connection, previous, imported);
                connection.commit();
                return false;
            } catch (RuntimeException | SQLException error) {
                try { connection.rollback(); } catch (SQLException ignored) {}
                if (error instanceof SQLException) throw unavailable();
                throw error;
            }
        } catch (SQLException error) {
            throw unavailable();
        }
    }

    ObjectNode readState(Connection connection) throws SQLException {
        String sql = """
            SELECT
             (SELECT jsonb_agg(jsonb_build_object('manifest',manifest,'digest',digest,'at',published_at,'actor',actor) || CASE WHEN contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('contract',contract,'contractDigest',contract_digest) END ORDER BY sequence) FROM service_publications) AS publications,
             (SELECT jsonb_object_agg(service_id,version) FROM service_bindings WHERE environment=?) AS active,
             (SELECT jsonb_object_agg(service_id,revision) FROM service_bindings WHERE environment=? AND revision<>0) AS revisions,
             (SELECT jsonb_object_agg(service_id,jsonb_build_object('environment',environment,'endpointRef',endpoint_ref,'deploymentId',deployment_id,'deploymentDigest',deployment_digest,'manifestDigest',manifest_digest,'contractDigest',contract_digest)) FROM service_bindings WHERE environment=? AND endpoint_ref IS NOT NULL) AS bindings,
             (SELECT jsonb_object_agg(service_id||'@'||version,value) FROM service_version_lifecycles) AS lifecycles,
             (SELECT jsonb_agg(event ORDER BY sequence) FROM (SELECT event,sequence FROM service_audit WHERE environment=? OR event->>'action'='lifecycle' ORDER BY sequence DESC LIMIT 500) events) AS audit,
             (SELECT jsonb_agg(event ORDER BY sequence) FROM (SELECT event,sequence FROM service_activity WHERE environment=? ORDER BY sequence DESC LIMIT 300) events) AS activity
            FROM service_environments WHERE name=?
            """;
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 1; index <= 6; index++) statement.setString(index, environment);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new IllegalStateException("服务运行环境尚未迁移");
                var state = Json.object().put("schemaVersion", 1);
                state.set("publications", jsonOr(result.getString("publications"), Json.MAPPER.createArrayNode()));
                state.set("active", jsonOr(result.getString("active"), Json.object()));
                state.set("revisions", jsonOr(result.getString("revisions"), Json.object()));
                state.set("bindings", jsonOr(result.getString("bindings"), Json.object()));
                state.set("lifecycles", jsonOr(result.getString("lifecycles"), Json.object()));
                state.set("audit", jsonOr(result.getString("audit"), Json.MAPPER.createArrayNode()));
                state.set("activity", jsonOr(result.getString("activity"), Json.MAPPER.createArrayNode()));
                return state;
            }
        }
    }

    private ArrayNode readActiveBindings(Connection connection) throws SQLException {
        var items = Json.MAPPER.createArrayNode();
        try (PreparedStatement statement = connection.prepareStatement("SELECT environment,service_id,version FROM service_bindings WHERE version IS NOT NULL"); ResultSet result = statement.executeQuery()) {
            while (result.next()) items.add(Json.object().put("environment", result.getString(1)).put("serviceId", result.getString(2)).put("version", result.getString(3)));
        }
        return items;
    }

    private void insertChanges(Connection connection, ObjectNode before, ObjectNode after) throws SQLException {
        Map<String, JsonNode> publications = new HashMap<>();
        before.withArray("publications").forEach(item -> publications.put(publicationKey(item), item));
        for (JsonNode item : after.withArray("publications")) {
            JsonNode previous = publications.get(publicationKey(item));
            if (previous != null) {
                if (!previous.path("digest").equals(item.path("digest")) || !previous.path("contractDigest").equals(item.path("contractDigest"))) throw new IllegalStateException("不可覆盖已登记版本");
                continue;
            }
            try (PreparedStatement statement = connection.prepareStatement("INSERT INTO service_publications(service_id,version,app_id,digest,contract_digest,manifest,contract,published_at,actor) VALUES(?,?,?,?,?,?::jsonb,?::jsonb,?,?)")) {
                JsonNode manifest = item.path("manifest");
                statement.setString(1, manifest.path("serviceId").asText());
                statement.setString(2, manifest.path("version").asText());
                statement.setString(3, manifest.path("appId").asText());
                statement.setString(4, item.path("digest").asText());
                nullable(statement, 5, item, "contractDigest");
                statement.setString(6, Json.text(manifest));
                if (item.has("contract")) statement.setString(7, Json.text(item.path("contract"))); else statement.setNull(7, Types.VARCHAR);
                statement.setString(8, item.path("at").asText());
                statement.setString(9, item.path("actor").asText());
                statement.executeUpdate();
            }
        }

        var active = after.with("active").fields();
        while (active.hasNext()) {
            var entry = active.next();
            String serviceId = entry.getKey();
            JsonNode version = entry.getValue();
            int revision = after.with("revisions").path(serviceId).asInt(0);
            JsonNode binding = after.with("bindings").path(serviceId);
            boolean unchanged = Objects.equals(nodeText(before.with("active").get(serviceId)), nodeText(version))
                && before.with("revisions").path(serviceId).asInt(0) == revision
                && CanonicalJson.write(before.with("bindings").path(serviceId)).equals(CanonicalJson.write(binding));
            if (unchanged) continue;
            try (PreparedStatement statement = connection.prepareStatement("INSERT INTO service_bindings(environment,service_id,version,revision,endpoint_ref,deployment_id,deployment_digest,manifest_digest,contract_digest) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(environment,service_id) DO UPDATE SET version=EXCLUDED.version,revision=EXCLUDED.revision,endpoint_ref=EXCLUDED.endpoint_ref,deployment_id=EXCLUDED.deployment_id,deployment_digest=EXCLUDED.deployment_digest,manifest_digest=EXCLUDED.manifest_digest,contract_digest=EXCLUDED.contract_digest")) {
                statement.setString(1, environment);
                statement.setString(2, serviceId);
                if (version.isTextual()) statement.setString(3, version.textValue()); else statement.setNull(3, Types.VARCHAR);
                statement.setInt(4, revision);
                nullable(statement, 5, binding, "endpointRef");
                nullable(statement, 6, binding, "deploymentId");
                nullable(statement, 7, binding, "deploymentDigest");
                nullable(statement, 8, binding, "manifestDigest");
                nullable(statement, 9, binding, "contractDigest");
                statement.executeUpdate();
            }
        }

        var lifecycles = after.with("lifecycles").fields();
        while (lifecycles.hasNext()) {
            var entry = lifecycles.next();
            if (entry.getValue().equals(before.with("lifecycles").get(entry.getKey()))) continue;
            int split = entry.getKey().lastIndexOf('@');
            try (PreparedStatement statement = connection.prepareStatement("INSERT INTO service_version_lifecycles(service_id,version,value) VALUES(?,?,?::jsonb) ON CONFLICT(service_id,version) DO UPDATE SET value=EXCLUDED.value")) {
                statement.setString(1, entry.getKey().substring(0, split));
                statement.setString(2, entry.getKey().substring(split + 1));
                statement.setString(3, Json.text(entry.getValue()));
                statement.executeUpdate();
            }
        }
        insertEvents(connection, "service_audit", before.withArray("audit"), after.withArray("audit"));
        insertEvents(connection, "service_activity", before.withArray("activity"), after.withArray("activity"));
    }

    private void insertEvents(Connection connection, String table, ArrayNode before, ArrayNode after) throws SQLException {
        Set<String> ids = new HashSet<>();
        before.forEach(item -> ids.add(item.path("id").asText()));
        String sql = "INSERT INTO " + table + "(id,environment,event) VALUES(?,?,?::jsonb) ON CONFLICT(environment,id) DO NOTHING";
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (JsonNode item : after) {
                if (ids.contains(item.path("id").asText())) continue;
                statement.setString(1, item.path("id").asText());
                statement.setString(2, environment);
                statement.setString(3, Json.text(item));
                statement.addBatch();
            }
            statement.executeBatch();
        }
    }

    public static String validateEnvironment(String value) {
        if (value == null || !value.matches("[a-z][a-z0-9-]{1,31}")) throw new IllegalStateException("服务运行环境标识无效");
        return value;
    }

    private static void configureConnection(HikariConfig config, String value) {
        if (value == null || value.isBlank()) throw new IllegalStateException("SERVICE_DATABASE_URL 配置无效");
        if (value.startsWith("jdbc:postgresql:")) {
            config.setJdbcUrl(value);
            return;
        }
        try {
            URI uri = URI.create(value);
            if (!Set.of("postgres", "postgresql").contains(uri.getScheme()) || uri.getHost() == null || uri.getPath().isBlank()) throw new IllegalArgumentException();
            String jdbc = "jdbc:postgresql://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort()) + uri.getRawPath() + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            config.setJdbcUrl(jdbc);
            if (uri.getRawUserInfo() != null) {
                String[] parts = uri.getRawUserInfo().split(":", 2);
                config.setUsername(URLDecoder.decode(parts[0], StandardCharsets.UTF_8));
                if (parts.length == 2) config.setPassword(URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
            }
        } catch (RuntimeException error) {
            throw new IllegalStateException("SERVICE_DATABASE_URL 配置无效");
        }
    }

    private static JsonNode jsonOr(String value, JsonNode fallback) { return value == null ? fallback : Json.read(value); }
    private static String publicationKey(JsonNode item) { return item.path("manifest").path("serviceId").asText() + "@" + item.path("manifest").path("version").asText(); }
    private static String nodeText(JsonNode value) { return value != null && value.isTextual() ? value.textValue() : null; }
    private static void nullable(PreparedStatement statement, int index, JsonNode value, String key) throws SQLException {
        if (value != null && value.path(key).isTextual()) statement.setString(index, value.path(key).textValue()); else statement.setNull(index, Types.VARCHAR);
    }
    private static ApiException unavailable() { return new ApiException(503, "服务目录数据库暂不可用，请稍后重试"); }
}
