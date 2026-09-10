package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;

/** 服务目录离线管理入口。数据库连接只从环境变量读取，输出不包含连接信息。 */
public final class ServiceStorageAdmin {
    private static final long MAX_INPUT_BYTES = 8L * 1024 * 1024;

    private ServiceStorageAdmin() {}

    public static boolean requested(String[] args) {
        return args.length > 0 && "service-storage".equals(args[0]);
    }

    public static int run(String[] args) {
        try {
            execute(Arrays.copyOfRange(args, 1, args.length), new Settings());
            return 0;
        } catch (RuntimeException | IOException error) {
            System.err.println("服务数据库操作失败；请核对数据库状态、私密配置及迁移输入，未输出连接信息。");
            if ((error instanceof ApiException || error instanceof IllegalArgumentException || error instanceof IllegalStateException)
                && error.getCause() == null && error.getMessage() != null) System.err.println("原因：" + error.getMessage());
            return 1;
        }
    }

    static ObjectNode execute(String[] args, Settings settings) throws IOException {
        if (args.length < 1) throw usage();
        String database = settings.get("SERVICE_DATABASE_URL", "");
        String environment = settings.get("SERVICE_ENVIRONMENT", "");
        if (database.isEmpty() || environment.isEmpty()) throw new IllegalStateException("需要服务数据库连接与环境配置");
        try (var catalog = new AppCatalog(settings); var storage = new PostgresServiceRegistryStorage(database, environment)) {
            return switch (args[0]) {
                case "publications-import" -> {
                    var bundle=readObject(requiredFile(args));
                    if(bundle.path("schemaVersion").asInt()!=1||!bundle.path("publications").isArray()||!bundle.path("metadata").isArray())throw new IllegalArgumentException("服务批量登记包无效");
                    var registry=new ServiceRegistry(settings,catalog,storage);registry.initialize();
                    for(JsonNode item:bundle.path("publications")){var manifest=ServiceRules.manifest(item.path("manifest"),catalog.registeredIds());if(item.has("contract"))new ServiceContractValidator().validate(item.path("contract"),manifest);}
                    int inserted=0,duplicate=0;
                    for(JsonNode item:bundle.path("publications")){var result=registry.publish(item.path("manifest"),item.get("contract"),"storage-admin");if(result.path("duplicate").asBoolean())duplicate++;else inserted++;}
                    for(JsonNode item:bundle.path("metadata")){
                        var workspace=registry.workspace(catalog.registeredIds());String id=item.path("serviceId").asText();
                        if(workspace.at("/services/"+id+"/category").asText().equals(item.path("category").asText()))continue;
                        var input=Json.object().put("kind","service").put("serviceId",id).put("category",item.path("category").asText()).put("owner",workspace.at("/services/"+id+"/owner").asText("")).put("expectedRevision",workspace.path("revision").asLong());
                        registry.updateWorkspace(input,catalog.registeredIds(),"storage-admin");
                    }
                    var publications=registry.list(catalog.registeredIds());int operations=0;for(JsonNode item:publications)operations+=item.at("/manifest/operations").size();
                    var result=Json.object().put("inserted",inserted).put("duplicate",duplicate).put("services",publications.size()).put("operations",operations);print(result);yield result;
                }
                case "api-inventory-schema" -> {storage.applySchema(apiInventorySchema());var result=Json.object().put("apiInventorySchema",true);print(result);yield result;}
                case "api-inventory-import" -> {
                    var document=ServiceApiInventory.validate(readObject(requiredFile(args)));
                    var result=storage.apiInventoryTransaction((saved,context)->ServiceApiInventory.update(saved,Json.object().put("expectedRevision",saved.path("revision").asLong()).set("document",document),"storage-admin"));
                    var summary=Json.object().put("revision",result.path("revision").asLong()).put("entries",result.at("/document/entries").size()).put("digest",result.path("digest").asText()).put("duplicate",result.path("duplicate").asBoolean());print(summary);yield summary;
                }
                case "workspace-schema" -> { storage.applySchema(workspaceSchema());var result=Json.object().put("workspaceSchema",true);print(result);yield result; }
                case "migrate" -> migrateFile(storage, validator(settings, catalog), requiredFile(args));
                case "export" -> exportFile(storage, validator(settings, catalog), requiredFile(args));
                default -> throw usage();
            };
        }
    }

    private static ObjectNode migrateFile(PostgresServiceRegistryStorage storage, ServiceRegistry validator, Path file) throws IOException {
        ObjectNode state = validator.validateSnapshot(readObject(file));
        String digest = CanonicalJson.digest(state);
        storage.applySchema(schema());
        boolean duplicate = storage.importState(state, digest);
        ObjectNode persisted = validator.validateSnapshot(storage.read(false));
        if (!digest.equals(CanonicalJson.digest(persisted))) throw new IllegalStateException("迁移前后数据不一致");
        ObjectNode result = summary(storage, persisted, digest).put("migrated", true).put("duplicate", duplicate).put("verified", true);
        print(result); return result;
    }

    private static ObjectNode exportFile(PostgresServiceRegistryStorage storage, ServiceRegistry validator, Path file) throws IOException {
        ObjectNode state = validator.validateSnapshot(storage.read(false));
        Files.write(file, Json.bytes(state), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        ObjectNode result = summary(storage, state, CanonicalJson.digest(state)).put("exported", true);
        print(result);
        return result;
    }

    private static ServiceRegistry validator(Settings settings, AppCatalog catalog) {
        return new ServiceRegistry(settings, catalog, new JsonServiceRegistryStorage(settings.runtime().resolve("migration-validation"), "local"), false);
    }

    private static ObjectNode readObject(Path file) throws IOException {
        if (!Files.isRegularFile(file) || Files.size(file) > MAX_INPUT_BYTES) throw new IllegalStateException("迁移输入文件无效或过大");
        JsonNode value = Json.read(Files.readAllBytes(file));
        if (!value.isObject()) throw new IllegalStateException("迁移输入必须是 JSON 对象");
        return (ObjectNode) value;
    }

    private static Path requiredFile(String[] args) {
        if (args.length != 2 || args[1].isBlank()) throw usage();
        return Path.of(args[1]).toAbsolutePath().normalize();
    }

    private static ObjectNode summary(PostgresServiceRegistryStorage storage, ObjectNode state, String digest) {
        ObjectNode result = Json.object().put("environment", storage.status().path("environment").asText())
            .put("publications", state.withArray("publications").size()).put("digest", digest);
        result.set("active", state.with("active").deepCopy());
        return result;
    }

    private static String schema() throws IOException {
        try (InputStream input = ServiceStorageAdmin.class.getResourceAsStream("/db/migration/V1__service_registry.sql")) {
            if (input == null) throw new IOException("缺少服务数据库结构");
            return new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    private static void print(ObjectNode result) { System.out.println(Json.text(result)); }
    static String workspaceSchema() throws IOException {
        try(InputStream input=ServiceStorageAdmin.class.getResourceAsStream("/db/migration/V4__service_workspace.sql")) {
            if(input==null)throw new IOException("缺少服务工作区数据库结构");return new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
        }
    }
    static String apiInventorySchema() throws IOException {
        try(InputStream input=ServiceStorageAdmin.class.getResourceAsStream("/db/migration/V6__service_api_inventory.sql")) {
            if(input==null)throw new IOException("缺少 API 台账数据库结构");return new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
        }
    }
    private static IllegalArgumentException usage() { return new IllegalArgumentException("使用 service-storage migrate 旧目录文件、export 新文件或 workspace-schema"); }
}
