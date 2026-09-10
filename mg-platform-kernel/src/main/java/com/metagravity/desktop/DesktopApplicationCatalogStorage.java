package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

/** 从平台数据库读取桌面应用运行目录。运行时不允许回退到内置目录。 */
public final class DesktopApplicationCatalogStorage implements AutoCloseable {
    private final HikariDataSource dataSource;
    Connection connection() throws SQLException { return dataSource.getConnection(); }

    public DesktopApplicationCatalogStorage(String connectionString) {
        if (connectionString == null || connectionString.isBlank()) throw new IllegalStateException("SERVICE_DATABASE_URL 配置无效");
        var config = new HikariConfig();
        configureConnection(config, connectionString);
        config.setPoolName("mg-desktop-application-catalog");
        config.setMaximumPoolSize(2);
        config.setMinimumIdle(0);
        config.setConnectionTimeout(2_000);
        config.setInitializationFailTimeout(-1);
        config.setIdleTimeout(10_000);
        config.setMaxLifetime(300_000);
        config.addDataSourceProperty("ApplicationName", "mg-desktop-application-catalog");
        config.addDataSourceProperty("statement_timeout", "3000");
        dataSource = new HikariDataSource(config);
    }

    public List<Row> read() { return read(true); }
    public List<Row> readRegistered() { return read(false); }
    private List<Row> read(boolean enabledOnly) {
        try (Connection connection = dataSource.getConnection(); PreparedStatement statement = connection.prepareStatement("""
            SELECT id,name,description,entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,icon,kind,
                   authorization_app_id,required_role,min_width,min_height,default_maximized,sort_order,runtime_policy
              FROM desktop_applications WHERE runtime_ready=true AND (? = false OR enabled=true) ORDER BY sort_order,id
            """)) {
            statement.setBoolean(1, enabledOnly);
            var rows = new ArrayList<Row>();
            try (ResultSet result = statement.executeQuery()) {
                while (result.next()) rows.add(new Row(
                    result.getString("id"), result.getString("name"), result.getString("description"),
                    result.getString("entry_url"), result.getString("upstream_url"), result.getString("default_path"),
                    jsonArray(result.getString("allowed_paths")), nullableJsonArray(result.getString("allowed_api_paths")),
                    result.getString("icon"), result.getString("kind"), result.getString("authorization_app_id"),
                    result.getString("required_role"), result.getInt("min_width"), result.getInt("min_height"),
                    result.getBoolean("default_maximized"), Json.read(result.getString("runtime_policy"))));
            }
            return List.copyOf(rows);
        } catch (SQLException error) {
            throw new ApiException(503, "应用注册数据库暂不可用或数据无效");
        }
    }

    public record Row(String id, String name, String description, String entryUrl, String upstream, String defaultPath,
                      List<String> allowedPaths, List<String> allowedApiPaths, String icon, String kind,
                      String authorizationAppId, String requiredRole, int minWidth, int minHeight, boolean defaultMaximized, JsonNode runtimePolicy) {}

    public com.fasterxml.jackson.databind.node.ArrayNode directory() {
        try(var connection=dataSource.getConnection();var statement=connection.prepareStatement("""
            SELECT id,name,description,developer,registered_version,enabled,runtime_ready,kind,icon,
                   entry_url,default_path,min_width,min_height,default_maximized,revision,updated_at,authorization_app_id
            FROM desktop_applications ORDER BY sort_order,id
            """);var rows=statement.executeQuery()) {
            var result=Json.MAPPER.createArrayNode();
            while(rows.next())result.add(Json.object().put("id",rows.getString("id")).put("name",rows.getString("name"))
                .put("description",rows.getString("description")).put("developer",rows.getString("developer"))
                .put("registeredVersion",rows.getString("registered_version")).put("enabled",rows.getBoolean("enabled"))
                .put("runtimeReady",rows.getBoolean("runtime_ready")).put("kind",rows.getString("kind"))
                .put("icon",rows.getString("icon")).put("entryUrl",rows.getString("entry_url"))
                .put("defaultPath",rows.getString("default_path")).put("minWidth",rows.getInt("min_width"))
                .put("minHeight",rows.getInt("min_height")).put("defaultMaximized",rows.getBoolean("default_maximized"))
                .put("revision",rows.getInt("revision")).put("authorizationAppId",rows.getString("authorization_app_id"))
                .put("updatedAt",rows.getTimestamp("updated_at").toInstant().toString()));
            return result;
        }catch(SQLException error){throw new ApiException(503,"内核应用目录读取失败");}
    }

    public void register(JsonNode input,String actor) {
        var fields=Set.of("id","name","description","developer","registeredVersion");
        if(input==null || !input.isObject() || !input.path("id").asText().matches("[a-z][a-z0-9-]{1,63}"))throw new ApiException(400,"应用标识无效");
        input.fieldNames().forEachRemaining(key->{if(!fields.contains(key) || !input.path(key).isTextual())throw new ApiException(400,"注册字段无效");});
        var metadata=Json.object().put("name",Json.string(input,"name")).put("description",Json.string(input,"description"))
            .put("developer",Json.string(input,"developer")).put("registeredVersion",Json.string(input,"registeredVersion"))
            .put("icon","knowledge").put("minWidth",760).put("minHeight",480).put("defaultMaximized",false).put("expectedRevision",1);
        validateMetadata(metadata);
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                try(var statement=connection.prepareStatement("""
                    INSERT INTO desktop_applications(id,name,description,developer,registered_version,entry_url,upstream_url,
                      default_path,allowed_paths,allowed_api_paths,icon,kind,runtime_ready)
                    VALUES(?,?,?,?,?,'','','/','["/"]','[]','knowledge','internal',false)
                    """)) {
                    statement.setString(1,input.path("id").asText());statement.setString(2,metadata.path("name").asText().strip());
                    statement.setString(3,metadata.path("description").asText().strip());statement.setString(4,metadata.path("developer").asText().strip());
                    statement.setString(5,metadata.path("registeredVersion").asText().strip());statement.executeUpdate();
                }
                try(var statement=connection.prepareStatement("INSERT INTO desktop_application_audit(application_id,action,after_config,actor) SELECT id,'create',to_jsonb(a),? FROM desktop_applications a WHERE id=?")) {
                    statement.setString(1,actor);statement.setString(2,input.path("id").asText());statement.executeUpdate();
                }
                connection.commit();
            }catch(SQLException error){connection.rollback();if("23505".equals(error.getSQLState()))throw new ApiException(409,"应用标识已登记");throw error;}
        }catch(SQLException error){throw new ApiException(503,"内核应用注册失败");}
    }

    public void configureRuntime(AppCatalog.App app,long revision,String actor) {
        Row row=row(app);
        try(var connection=dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                JsonNode before;
                try(var statement=connection.prepareStatement("SELECT to_jsonb(a) FROM desktop_applications a WHERE id=? FOR UPDATE")) {
                    statement.setString(1,row.id());try(var result=statement.executeQuery()){if(!result.next())throw new ApiException(404,"应用不存在");before=Json.read(result.getString(1));}
                }
                if(before.path("revision").asLong()!=revision)throw new ApiException(409,"应用已更新，请刷新后再配置");
                try(var statement=connection.prepareStatement("""
                    UPDATE desktop_applications SET entry_url=?,upstream_url=?,default_path=?,allowed_paths=?::jsonb,allowed_api_paths=?::jsonb,
                    icon=?,kind=?,authorization_app_id=?,required_role=?,min_width=?,min_height=?,default_maximized=?,runtime_policy=?::jsonb,
                    runtime_ready=true,revision=revision+1,updated_at=now() WHERE id=?
                    """)) {
                    statement.setString(1,row.entryUrl());statement.setString(2,row.upstream());statement.setString(3,row.defaultPath());
                    statement.setString(4,Json.text(row.allowedPaths()));statement.setString(5,row.allowedApiPaths()==null?null:Json.text(row.allowedApiPaths()));
                    statement.setString(6,row.icon());statement.setString(7,row.kind());nullable(statement,8,row.authorizationAppId());nullable(statement,9,row.requiredRole());
                    statement.setInt(10,row.minWidth());statement.setInt(11,row.minHeight());statement.setBoolean(12,row.defaultMaximized());statement.setString(13,Json.text(row.runtimePolicy()));statement.setString(14,row.id());statement.executeUpdate();
                }
                try(var statement=connection.prepareStatement("INSERT INTO desktop_application_audit(application_id,action,before_config,after_config,actor) SELECT id,'update',?::jsonb,to_jsonb(a),? FROM desktop_applications a WHERE id=?")) {
                    statement.setString(1,before.toString());statement.setString(2,actor);statement.setString(3,row.id());statement.executeUpdate();
                }
                connection.commit();
            }catch(RuntimeException|SQLException error){connection.rollback();throw error;}
        }catch(SQLException error){throw new ApiException(503,"应用入口配置保存失败");}
    }

    public com.fasterxml.jackson.databind.node.ObjectNode metadata(String id) {
        try (var connection = dataSource.getConnection(); var statement = connection.prepareStatement("""
            SELECT name,description,developer,registered_version,enabled,icon,min_width,min_height,default_maximized,revision,created_at,updated_at
            FROM desktop_applications WHERE id=?
            """)) {
            statement.setString(1, id);
            try (var result = statement.executeQuery()) {
                if (!result.next()) throw new ApiException(404, "应用不存在");
                return Json.object().put("name", result.getString("name")).put("description", result.getString("description"))
                    .put("developer", result.getString("developer")).put("registeredVersion", result.getString("registered_version")).put("enabled", result.getBoolean("enabled"))
                    .put("icon", result.getString("icon")).put("minWidth", result.getInt("min_width"))
                    .put("minHeight", result.getInt("min_height")).put("defaultMaximized", result.getBoolean("default_maximized"))
                    .put("revision", result.getInt("revision")).put("createdAt", result.getTimestamp("created_at").toInstant().toString())
                    .put("updatedAt", result.getTimestamp("updated_at").toInstant().toString());
            }
        } catch (SQLException error) { throw new ApiException(503, "应用元数据读取失败"); }
    }

    public void updateMetadata(String id, JsonNode input, String actor) {
        boolean statusOnly = input != null && input.isObject() && input.has("enabled");
        if (statusOnly) {
            if (input.size()!=2 || !input.path("enabled").isBoolean() || !input.path("expectedRevision").isIntegralNumber()
                || !input.path("expectedRevision").canConvertToInt() || input.path("expectedRevision").intValue()<1)
                throw new ApiException(400,"应用启停参数无效");
        } else validateMetadata(input);
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                JsonNode before;
                try (var statement = connection.prepareStatement("SELECT to_jsonb(a) FROM desktop_applications a WHERE id=? FOR UPDATE")) {
                    statement.setString(1, id);
                    try (var result = statement.executeQuery()) {
                        if (!result.next()) throw new ApiException(404, "应用不存在");
                        before = Json.read(result.getString(1));
                    }
                }
                if (before.path("revision").intValue() != input.path("expectedRevision").intValue())
                    throw new ApiException(409, "应用信息已被更新，请重新打开编辑后再保存");
                if (statusOnly && !"internal".equals(before.path("kind").asText()))
                    throw new ApiException(403,"系统应用和默认应用不支持启停");
                JsonNode after;
                if (statusOnly) {
                    try (var statement = connection.prepareStatement("UPDATE desktop_applications a SET enabled=?,revision=revision+1,updated_at=now() WHERE id=? RETURNING to_jsonb(a)")) {
                        statement.setBoolean(1,input.path("enabled").booleanValue()); statement.setString(2,id);
                        try (var result = statement.executeQuery()) { result.next(); after = Json.read(result.getString(1)); }
                    }
                } else {
                try (var statement = connection.prepareStatement("""
                    UPDATE desktop_applications a SET name=?,description=?,developer=?,icon=?,min_width=?,min_height=?,default_maximized=?,
                    revision=revision+1,updated_at=now(),registered_version=COALESCE(?,registered_version) WHERE id=? RETURNING to_jsonb(a)
                    """)) {
                    statement.setString(1, input.path("name").textValue().strip());
                    statement.setString(2, input.path("description").textValue().strip());
                    statement.setString(3, input.path("developer").textValue().strip()); statement.setString(4, input.path("icon").textValue());
                    statement.setInt(5, input.path("minWidth").intValue()); statement.setInt(6, input.path("minHeight").intValue());
                    statement.setBoolean(7, input.path("defaultMaximized").booleanValue());
                    statement.setString(8, input.has("registeredVersion") ? input.path("registeredVersion").textValue().strip() : null);
                    statement.setString(9, id);
                    try (var result = statement.executeQuery()) { result.next(); after = Json.read(result.getString(1)); }
                }
                }
                try (var statement = connection.prepareStatement("""
                    INSERT INTO desktop_application_audit(application_id,action,before_config,after_config,actor)
                    VALUES(?,?,?::jsonb,?::jsonb,?)
                    """)) {
                    statement.setString(1, id); statement.setString(2,statusOnly ? input.path("enabled").asBoolean() ? "enable" : "disable" : "update");
                    statement.setString(3, before.toString()); statement.setString(4, after.toString()); statement.setString(5, actor); statement.executeUpdate();
                }
                connection.commit();
            } catch (RuntimeException | SQLException error) {
                connection.rollback();
                if (error instanceof RuntimeException runtime) throw runtime;
                throw new ApiException(503, "应用元数据保存失败，请检查数据库写入权限");
            }
        } catch (SQLException error) { throw new ApiException(503, "应用元数据保存失败"); }
    }

    static void validateMetadata(JsonNode input) {
        var fields = Set.of("name", "description", "developer", "icon", "minWidth", "minHeight", "defaultMaximized", "expectedRevision", "registeredVersion");
        if (input == null || !input.isObject() || input.size() != fields.size() - (input.has("registeredVersion") ? 0 : 1)) throw new ApiException(400, "应用元数据字段不完整");
        if (input.has("registeredVersion") && (!input.path("registeredVersion").isTextual() || input.path("registeredVersion").textValue().length() > 64 || input.path("registeredVersion").textValue().chars().anyMatch(Character::isISOControl)))
            throw new ApiException(400, "当前版本不能超过 64 个字符或包含控制字符");
        input.fieldNames().forEachRemaining(field -> { if (!fields.contains(field)) throw new ApiException(400, "不支持修改此应用字段"); });
        if (!input.path("name").isTextual() || input.path("name").textValue().isBlank() || input.path("name").textValue().length() > 80)
            throw new ApiException(400, "应用名称应为 1 至 80 个字符");
        if (!input.path("description").isTextual() || input.path("description").textValue().length() > 200)
            throw new ApiException(400, "应用说明不能超过 200 个字符");
        if (!input.path("developer").isTextual() || input.path("developer").textValue().length() > 120)
            throw new ApiException(400, "开发者名称不能超过 120 个字符");
        if (!input.path("icon").isTextual() || !input.path("icon").textValue().matches("[a-z][a-z0-9-]{0,63}"))
            throw new ApiException(400, "应用图标资源键无效");
        for (String field : List.of("minWidth", "minHeight", "expectedRevision")) {
            var value = input.path(field);
            int min = field.equals("minWidth") ? 320 : field.equals("minHeight") ? 240 : 1;
            int max = field.equals("expectedRevision") ? Integer.MAX_VALUE - 1 : 4000;
            if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max)
                throw new ApiException(400, "应用窗口尺寸或修订号无效");
        }
        if (!input.path("defaultMaximized").isBoolean()) throw new ApiException(400, "默认最大化设置无效");
    }

    public int seed(List<AppCatalog.App> applications, String actor) {
        if (actor == null || !actor.matches("[A-Za-z0-9@._-]{1,100}")) throw new IllegalStateException("应用目录迁移执行人无效");
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement lock = connection.prepareStatement("SELECT pg_advisory_xact_lock(?)")) {
                    lock.setLong(1, 741030L); lock.execute();
                }
                int inserted = 0;
                for (int index = 0; index < applications.size(); index++) {
                    AppCatalog.App app = applications.get(index);
                    Row expected = row(app);
                    Row existing = find(connection, app.id());
                    if (existing != null) {
                        if (!existing.equals(expected)) throw new IllegalStateException("应用目录已有不同配置，拒绝覆盖：" + app.id());
                        continue;
                    }
                    insert(connection, expected, index * 10);
                    audit(connection, expected, actor);
                    inserted++;
                }
                connection.commit();
                return inserted;
            } catch (RuntimeException | SQLException error) {
                try { connection.rollback(); } catch (SQLException ignored) {}
                if (error instanceof RuntimeException runtime) throw runtime;
                throw new IllegalStateException("应用目录迁移失败");
            }
        } catch (SQLException error) { throw new IllegalStateException("应用目录数据库暂不可用"); }
    }

    public void applySchema(String sql) {
        try (Connection connection = dataSource.getConnection(); Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException error) { throw new IllegalStateException("应用目录结构迁移失败"); }
    }

    @Override public void close() { dataSource.close(); }

    private static List<String> jsonArray(String value) throws SQLException {
        if (value == null) throw new SQLException("应用路径配置缺失");
        try {
            JsonNode node = Json.MAPPER.readTree(value);
            if (!node.isArray()) throw new SQLException("应用路径配置不是数组");
            var result = new ArrayList<String>();
            for (JsonNode item : node) {
                if (!item.isTextual()) throw new SQLException("应用路径配置无效");
                result.add(item.textValue());
            }
            return List.copyOf(result);
        } catch (Exception error) { throw new SQLException("应用路径配置无效", error); }
    }

    private static List<String> nullableJsonArray(String value) throws SQLException { return value == null ? null : jsonArray(value); }

    private static Row row(AppCatalog.App app) {
        JsonNode data = app.publicData();
        var paths = new ArrayList<String>(); data.path("allowedPaths").forEach(item -> paths.add(item.asText()));
        return new Row(app.id(), data.path("name").asText(), data.path("description").asText(), app.entryUrl(), app.upstream(),
            data.path("defaultPath").asText(), List.copyOf(paths), app.allowedApiPaths(), data.path("icon").asText(),
            data.path("kind").asText(), app.authorizationAppId(), app.requiredRole(), data.path("minWidth").asInt(),
            data.path("minHeight").asInt(), data.path("defaultMaximized").asBoolean(false), Json.MAPPER.valueToTree(app.policy()));
    }

    private static Row find(Connection connection, String id) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
            SELECT id,name,description,entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,icon,kind,
                   authorization_app_id,required_role,min_width,min_height,default_maximized,runtime_policy
              FROM desktop_applications WHERE id=?
            """)) {
            statement.setString(1, id);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) return null;
                return new Row(result.getString(1), result.getString(2), result.getString(3), result.getString(4), result.getString(5), result.getString(6),
                    jsonArray(result.getString(7)), nullableJsonArray(result.getString(8)), result.getString(9), result.getString(10), result.getString(11),
                    result.getString(12), result.getInt(13), result.getInt(14), result.getBoolean(15),
                    Json.MAPPER.valueToTree(ApplicationPolicy.parse(result.getString(1), Json.read(result.getString(16)))));
            }
        }
    }

    private static void insert(Connection connection, Row row, int order) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
            INSERT INTO desktop_applications(id,name,description,entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,
              icon,kind,authorization_app_id,required_role,min_width,min_height,default_maximized,sort_order,runtime_policy)
            VALUES(?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?,?,?,?,?,?::jsonb)
            """)) {
            statement.setString(1,row.id()); statement.setString(2,row.name()); statement.setString(3,row.description());
            statement.setString(4,row.entryUrl()); statement.setString(5,row.upstream()); statement.setString(6,row.defaultPath());
            statement.setString(7,Json.text(row.allowedPaths()));
            if (row.allowedApiPaths()==null) statement.setNull(8,Types.VARCHAR); else statement.setString(8,Json.text(row.allowedApiPaths()));
            statement.setString(9,row.icon()); statement.setString(10,row.kind()); nullable(statement,11,row.authorizationAppId());
            nullable(statement,12,row.requiredRole()); statement.setInt(13,row.minWidth()); statement.setInt(14,row.minHeight());
            statement.setBoolean(15,row.defaultMaximized()); statement.setInt(16,order); statement.setString(17,Json.text(row.runtimePolicy())); statement.executeUpdate();
        }
    }

    private static void audit(Connection connection, Row row, String actor) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("INSERT INTO desktop_application_audit(application_id,action,after_config,actor) VALUES(?,'create',?::jsonb,?)")) {
            statement.setString(1,row.id()); statement.setString(2,Json.text(row)); statement.setString(3,actor); statement.executeUpdate();
        }
    }

    private static void nullable(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR); else statement.setString(index, value);
    }

    private static void configureConnection(HikariConfig config, String value) {
        if (value.startsWith("jdbc:postgresql:")) { config.setJdbcUrl(value); return; }
        try {
            URI uri = URI.create(value);
            if (!Set.of("postgres", "postgresql").contains(uri.getScheme()) || uri.getHost() == null || uri.getPath().isBlank()) throw new IllegalArgumentException();
            String jdbc = "jdbc:postgresql://" + uri.getHost() + (uri.getPort() < 0 ? "" : ":" + uri.getPort()) + uri.getRawPath()
                + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            config.setJdbcUrl(jdbc);
            if (uri.getRawUserInfo() != null) {
                String[] parts = uri.getRawUserInfo().split(":", 2);
                config.setUsername(URLDecoder.decode(parts[0], StandardCharsets.UTF_8));
                if (parts.length == 2) config.setPassword(URLDecoder.decode(parts[1], StandardCharsets.UTF_8));
            }
        } catch (RuntimeException error) { throw new IllegalStateException("SERVICE_DATABASE_URL 配置无效"); }
    }
}
