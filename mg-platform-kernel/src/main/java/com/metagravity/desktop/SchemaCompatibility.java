package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import java.util.function.BiPredicate;

/** 与前端 schema-compatibility.ts 一致的有界 JSON Schema 值集合包含证明。 */
public final class SchemaCompatibility {
    public record Issue(String path, String reason) {}
    public record Inclusion(boolean compatible, List<Issue> issues) {}

    private static final Set<String> ANNOTATIONS = Set.of("title", "description", "examples", "example", "deprecated", "$comment", "$schema");
    private static final Set<String> SUPPORTED = Set.of("type", "enum", "const", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "items", "properties", "required", "additionalProperties", "minProperties", "maxProperties");
    private static final List<String> ATOMS = List.of("null", "boolean", "string", "integer", "fraction", "array", "object");
    private static final Set<String> OPERATORS = Set.of("allOf", "anyOf", "oneOf", "not");

    private SchemaCompatibility() {}

    public static JsonNode expand(JsonNode document, JsonNode schema) {
        return new Expander(document).visit(schema == null || schema.isMissingNode() ? BooleanNode.TRUE : schema, new HashSet<>(), 0);
    }

    public static Inclusion prove(JsonNode source, JsonNode target) {
        return new Prover().prove(source, target);
    }

    private static final class Expander {
        private final JsonNode document;
        private int nodes;
        Expander(JsonNode document) { this.document = document; }

        JsonNode visit(JsonNode value, Set<String> seen, int depth) {
            if (++nodes > 12_000 || depth > 64) throw new IllegalStateException("Schema 展开超过比较上限");
            if (value != null && value.isBoolean()) return value.deepCopy();
            if (value == null || !value.isObject()) throw new IllegalStateException("Schema 格式无效");
            if (value.has("$ref")) {
                String ref = value.path("$ref").asText();
                if (!ref.matches("#/components/schemas/[A-Za-z0-9._-]+") || seen.contains(ref)) throw new IllegalStateException("Schema 引用循环或不受支持");
                JsonNode target = document.path("components").path("schemas").path(ref.substring(ref.lastIndexOf('/') + 1));
                if (target.isMissingNode()) throw new IllegalStateException("Schema 引用不存在");
                Set<String> next = new HashSet<>(seen); next.add(ref);
                JsonNode expanded = visit(target, next, depth + 1);
                ObjectNode siblings = Json.object();
                value.properties().forEach(entry -> { if (!entry.getKey().equals("$ref") && !ANNOTATIONS.contains(entry.getKey())) siblings.set(entry.getKey(), entry.getValue()); });
                if (siblings.isEmpty()) return expanded;
                return Json.object().set("allOf", Json.MAPPER.createArrayNode().add(expanded).add(visit(siblings, seen, depth + 1)));
            }
            ObjectNode result = Json.object();
            value.properties().forEach(entry -> {
                String key = entry.getKey(); JsonNode child = entry.getValue();
                if (ANNOTATIONS.contains(key)) return;
                if (Set.of("properties", "patternProperties", "$defs", "dependentSchemas").contains(key)) {
                    if (!child.isObject()) throw new IllegalStateException("Schema 格式无效");
                    ObjectNode map = Json.object(); child.properties().forEach(item -> map.set(item.getKey(), visit(item.getValue(), seen, depth + 1))); result.set(key, map);
                } else if (Set.of("items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedProperties", "unevaluatedItems").contains(key)) {
                    result.set(key, visit(child, seen, depth + 1));
                } else if (Set.of("allOf", "anyOf", "oneOf", "prefixItems").contains(key)) {
                    if (!child.isArray()) throw new IllegalStateException("Schema 格式无效");
                    ArrayNode list = Json.MAPPER.createArrayNode(); child.forEach(item -> list.add(visit(item, seen, depth + 1))); result.set(key, list);
                } else result.set(key, child.deepCopy());
            });
            return result;
        }
    }

    private static final class Prover {
        private final List<Issue> issues = new ArrayList<>();
        private int nodes;

        Inclusion prove(JsonNode source, JsonNode target) {
            try { return new Inclusion(visit(normalize(source), normalize(target), "", 0), List.copyOf(issues)); }
            catch (RuntimeException error) { return new Inclusion(false, List.of(new Issue("", "Schema 结构无法自动比较"))); }
        }

        private boolean visit(JsonNode originalA, JsonNode originalB, String path, int depth) {
            if (++nodes > 12_000 || depth > 64) return fail(path, "结构超过自动比较上限");
            JsonNode a = shape(originalA), b = shape(originalB);
            if (same(a, b) || isFalse(a) || isTrue(b) || b.isObject() && b.isEmpty()) return true;
            if (isTrue(a)) a = Json.object();
            if (hasComposition(a) || hasComposition(b)) {
                CompositionResult result = new CompositionProver(SUPPORTED, this::same, this::silentIncludes, this::step).prove(a, b);
                if (result.compatible()) return true;
                for (Issue issue : result.issues()) fail(path + issue.path(), issue.reason());
                return false;
            }
            if (isFalse(b)) return fail(path, "目标不再接受任何值");
            ObjectNode x = (ObjectNode) a, y = (ObjectNode) b;
            var unknown = new LinkedHashSet<String>(); x.fieldNames().forEachRemaining(unknown::add); y.fieldNames().forEachRemaining(unknown::add); unknown.removeAll(SUPPORTED);
            if (!unknown.isEmpty()) return fail(path, "涉及需审阅的约束：" + String.join("、", unknown));
            Set<String> tx = types(x), ty = types(y); boolean ok = true;
            for (String type : tx) if (!ty.contains(type)) ok = fail(path + "/type", "允许的数据类型未能证明被目标完整接受");
            List<JsonNode> valuesA = finite(x), valuesB = finite(y);
            if (valuesB != null && (valuesA == null || valuesA.stream().anyMatch(v -> valuesB.stream().noneMatch(w -> same(v, w))))) ok = fail(path + "/enum", "目标枚举或常量可能排除了原有值");
            if (tx.contains("integer") || tx.contains("fraction")) {
                Bound amin = lower(x), bmin = lower(y), amax = upper(x), bmax = upper(y);
                if (amin.value < bmin.value || amin.value == bmin.value && !amin.exclusive && bmin.exclusive) ok = fail(path + "/minimum", "下界可能收紧");
                if (amax.value > bmax.value || amax.value == bmax.value && !amax.exclusive && bmax.exclusive) ok = fail(path + "/maximum", "上界可能收紧");
                if (y.has("multipleOf") && (!x.has("multipleOf") || x.path("multipleOf").doubleValue() != y.path("multipleOf").doubleValue()) && !divisibleSafeIntegers(x.path("multipleOf"), y.path("multipleOf"))) ok = fail(path + "/multipleOf", "倍数约束未能证明兼容");
            }
            if (tx.contains("string")) {
                ok = lengths(x, y, path, "minLength", "maxLength", ok);
                if (y.has("pattern") && !Objects.equals(textOrNull(x, "pattern"), textOrNull(y, "pattern"))) ok = fail(path + "/pattern", "正则表达式的包含关系需审阅");
            }
            if (tx.contains("array")) {
                ok = lengths(x, y, path, "minItems", "maxItems", ok);
                if (y.path("uniqueItems").asBoolean(false) && !x.path("uniqueItems").asBoolean(false) && number(x, "maxItems", Double.POSITIVE_INFINITY) > 1) ok = fail(path + "/uniqueItems", "目标要求元素唯一");
                if (number(x, "maxItems", Double.POSITIVE_INFINITY) != 0 && !visit(schema(x, "items"), schema(y, "items"), path + "/items", depth + 1)) ok = false;
            }
            if (tx.contains("object")) {
                ok = lengths(x, y, path, "minProperties", "maxProperties", ok);
                for (JsonNode key : array(y, "required")) if (!containsText(array(x, "required"), key.asText())) ok = fail(path + "/required/" + pointer(key.asText()), "目标要求字段必填");
                ObjectNode xp = object(x, "properties"), yp = object(y, "properties");
                Set<String> keys = new LinkedHashSet<>(); xp.fieldNames().forEachRemaining(keys::add); yp.fieldNames().forEachRemaining(keys::add);
                for (String key : keys) {
                    JsonNode xs = xp.has(key) ? xp.get(key) : schema(x, "additionalProperties"), ys = yp.has(key) ? yp.get(key) : schema(y, "additionalProperties");
                    if (!visit(xs, ys, path + "/properties/" + pointer(key), depth + 1)) ok = false;
                }
                if (!visit(schema(x, "additionalProperties"), schema(y, "additionalProperties"), path + "/additionalProperties", depth + 1)) ok = false;
            }
            return ok;
        }

        private boolean silentIncludes(JsonNode a, JsonNode b) {
            int at = issues.size(); boolean result = visit(a, b, "", 1); while (issues.size() > at) issues.removeLast(); return result;
        }
        private void step() { if (++nodes > 12_000) throw new IllegalStateException("组合结构超过自动比较上限"); }
        private boolean fail(String path, String reason) { if (issues.size() < 80) issues.add(new Issue(path, reason)); return false; }
        private boolean lengths(ObjectNode x, ObjectNode y, String path, String min, String max, boolean ok) {
            if (number(x, min, 0) < number(y, min, 0)) ok = fail(path + "/" + min, "最小数量或长度可能增加");
            if (number(x, max, Double.POSITIVE_INFINITY) > number(y, max, Double.POSITIVE_INFINITY)) ok = fail(path + "/" + max, "最大数量或长度可能减少");
            return ok;
        }
        private boolean same(JsonNode a, JsonNode b) { return CanonicalJson.write(a).equals(CanonicalJson.write(b)); }
    }

    private record Bound(double value, boolean exclusive) {}
    private record Literal(JsonNode schema, boolean negative, String path) {}
    private record CompositionResult(boolean compatible, List<Issue> issues) {}

    private static final class CompositionProver {
        private final Set<String> basicKeys;
        private final BiPredicate<JsonNode, JsonNode> same;
        private final BiPredicate<JsonNode, JsonNode> includes;
        private final Runnable step;

        CompositionProver(Set<String> basicKeys, BiPredicate<JsonNode, JsonNode> same, BiPredicate<JsonNode, JsonNode> includes, Runnable step) {
            this.basicKeys = basicKeys; this.same = same; this.includes = includes; this.step = step;
        }

        CompositionResult prove(JsonNode source, JsonNode target) {
            try {
                List<List<Literal>> left = normalizeComposition(source, false, "", 0), right = normalizeComposition(target, false, "", 0);
                for (List<Literal> clause : left) {
                    if (dead(clause)) continue;
                    List<Literal> nearest = null; boolean found = false;
                    for (List<Literal> candidate : right) {
                        List<Literal> missing = candidate.stream().filter(literal -> !entails(clause, literal)).toList();
                        if (nearest == null || missing.size() < nearest.size()) nearest = missing;
                        if (missing.isEmpty()) { found = true; break; }
                    }
                    if (!found) {
                        List<Literal> selected = nearest != null && !nearest.isEmpty() ? nearest : List.of(new Literal(BooleanNode.TRUE, false, ""));
                        List<Issue> result = new ArrayList<>();
                        selected.stream().limit(8).forEach(item -> result.add(new Issue(item.path(), item.negative() ? "无法证明组合分支的排他或否定条件" : "无法证明所有原有值均被目标组合结构接受")));
                        return new CompositionResult(false, result);
                    }
                }
                return new CompositionResult(true, List.of());
            } catch (RuntimeException error) {
                return new CompositionResult(false, List.of(new Issue("", Objects.toString(error.getMessage(), "组合结构无法自动比较"))));
            }
        }

        private void budget(int depth) { step.run(); if (depth > 64) throw new IllegalStateException("组合结构嵌套超过比较上限"); }
        private List<List<Literal>> bounded(List<List<Literal>> clauses) {
            budget(0); int literals = clauses.stream().mapToInt(List::size).sum(); if (clauses.size() > 256 || literals > 8192) throw new IllegalStateException("组合分支超过比较上限"); return clauses;
        }
        private List<List<Literal>> and(List<List<Literal>> a, List<List<Literal>> b) {
            List<List<Literal>> result = new ArrayList<>();
            for (List<Literal> left : a) for (List<Literal> right : b) {
                budget(0); List<Literal> clause = new ArrayList<>(left); boolean contradictory = false;
                for (Literal item : right) {
                    Literal existing = clause.stream().filter(other -> same.test(other.schema(), item.schema())).findFirst().orElse(null);
                    if (existing != null) { if (existing.negative() != item.negative()) { contradictory = true; break; } }
                    else clause.add(item);
                }
                if (!contradictory) result.add(clause); bounded(result);
            }
            return result;
        }
        private List<List<Literal>> every(List<List<List<Literal>>> parts) {
            List<List<Literal>> result = new ArrayList<>(); result.add(new ArrayList<>()); for (var part : parts) result = and(result, part); return result;
        }
        private List<List<Literal>> some(List<List<List<Literal>>> parts) { List<List<Literal>> result = new ArrayList<>(); parts.forEach(result::addAll); return bounded(result); }
        private List<List<Literal>> atom(JsonNode schema, boolean negative, String path) {
            if (isTrue(schema) || schema.isObject() && schema.isEmpty()) return negative ? new ArrayList<>() : new ArrayList<>(List.of(new ArrayList<>()));
            if (isFalse(schema)) return negative ? new ArrayList<>(List.of(new ArrayList<>())) : new ArrayList<>();
            return new ArrayList<>(List.of(new ArrayList<>(List.of(new Literal(schema, negative, path)))));
        }
        private List<Map.Entry<JsonNode, String>> assertions(ObjectNode base, String path) {
            for (String key : iterable(base.fieldNames())) if (!basicKeys.contains(key)) return List.of(Map.entry(base, path));
            List<Map.Entry<JsonNode, String>> result = new ArrayList<>();
            base.properties().forEach(entry -> {
                String key = entry.getKey(); JsonNode value = entry.getValue();
                if (key.equals("properties")) value.properties().forEach(property -> result.add(Map.entry(Json.object().set("properties", Json.object().set(property.getKey(), property.getValue())), path + "/properties/" + pointer(property.getKey()))));
                else if (key.equals("required")) value.forEach(name -> result.add(Map.entry(Json.object().set("required", Json.MAPPER.createArrayNode().add(name.asText())), path + "/required/" + pointer(name.asText()))));
                else if (key.equals("additionalProperties")) {
                    ObjectNode known = Json.object(); object(base, "properties").fieldNames().forEachRemaining(name -> known.put(name, true));
                    ObjectNode assertion = Json.object();
                    assertion.set("properties", known);
                    assertion.set("additionalProperties", value);
                    result.add(Map.entry(assertion, path + "/" + key));
                } else result.add(Map.entry(Json.object().set(key, value), path + "/" + key));
            });
            return result;
        }
        private List<List<Literal>> normalizeComposition(JsonNode schema, boolean negative, String path, int depth) {
            budget(depth); if (schema.isBoolean()) return atom(schema, negative, path);
            ObjectNode base = Json.object(); schema.properties().forEach(entry -> { if (!OPERATORS.contains(entry.getKey())) base.set(entry.getKey(), entry.getValue()); });
            List<List<List<Literal>>> pieces = new ArrayList<>(); assertions(base, path).forEach(item -> pieces.add(atom(item.getKey(), negative, item.getValue())));
            for (String op : List.of("allOf", "anyOf", "oneOf", "not")) {
                if (!schema.has(op)) continue; JsonNode value = schema.get(op); String location = path + "/" + op;
                if (op.equals("not")) { pieces.add(normalizeComposition(value, !negative, location, depth + 1)); continue; }
                if (!value.isArray() || value.isEmpty()) throw new IllegalStateException("组合分支格式无效");
                if (op.equals("allOf") || op.equals("anyOf")) {
                    List<List<List<Literal>>> children = new ArrayList<>(); for (int i = 0; i < value.size(); i++) children.add(normalizeComposition(value.get(i), negative, location + "/" + i, depth + 1));
                    pieces.add(op.equals("allOf") != negative ? every(children) : some(children));
                } else if (!negative) {
                    List<List<List<Literal>>> choices = new ArrayList<>();
                    for (int i = 0; i < value.size(); i++) { List<List<List<Literal>>> children = new ArrayList<>(); for (int j = 0; j < value.size(); j++) children.add(normalizeComposition(value.get(j), i != j, location + "/" + j, depth + 1)); choices.add(every(children)); }
                    pieces.add(some(choices));
                } else {
                    List<List<List<Literal>>> choices = new ArrayList<>(); List<List<List<Literal>>> none = new ArrayList<>();
                    for (int i = 0; i < value.size(); i++) none.add(normalizeComposition(value.get(i), true, location + "/" + i, depth + 1)); choices.add(every(none));
                    for (int i = 0; i < value.size(); i++) for (int j = i + 1; j < value.size(); j++) choices.add(and(normalizeComposition(value.get(i), false, location + "/" + i, depth + 1), normalizeComposition(value.get(j), false, location + "/" + j, depth + 1)));
                    pieces.add(some(choices));
                }
            }
            return negative ? some(pieces) : every(pieces);
        }
        private Set<String> allowedTypes(JsonNode schema) {
            if (isFalse(schema)) return new HashSet<>(); if (isTrue(schema)) return new HashSet<>(ATOMS);
            Set<String> result = types((ObjectNode) schema); JsonNode finite = schema.has("const") ? Json.MAPPER.createArrayNode().add(schema.get("const")) : schema.get("enum");
            if (finite != null) result.removeIf(type -> stream(finite).noneMatch(value -> valueType(value).equals(type))); return result;
        }
        private boolean emptyPositive(List<JsonNode> schemas, int depth) {
            budget(depth); if (schemas.stream().anyMatch(SchemaCompatibility::isFalse)) return true;
            List<ObjectNode> objects = schemas.stream().filter(s -> !isTrue(s)).map(s -> (ObjectNode) s).toList(); Set<String> types = new HashSet<>(ATOMS);
            for (ObjectNode schema : objects) types.retainAll(allowedTypes(schema)); if (types.isEmpty()) return true;
            List<JsonNode> finite = null;
            for (ObjectNode schema : objects) for (JsonNode values : List.of(schema.has("const") ? Json.MAPPER.createArrayNode().add(schema.get("const")) : null, schema.get("enum"))) if (values != null) {
                if (finite == null) finite = new ArrayList<>();
                if (finite.isEmpty() && schema.has("const")) finite.add(schema.get("const"));
                else if (finite.isEmpty() && values.isArray()) values.forEach(finite::add);
                else { List<JsonNode> accepted = stream(values).toList(); finite.removeIf(v -> accepted.stream().noneMatch(w -> same.test(v, w))); }
            }
            if (finite != null && finite.stream().noneMatch(value -> types.contains(valueType(value)))) return true;
            for (String type : types) {
                if (type.equals("integer") || type.equals("fraction")) {
                    double lo = Double.NEGATIVE_INFINITY, hi = Double.POSITIVE_INFINITY; boolean exclusive = false;
                    for (ObjectNode s : objects) for (String key : List.of("minimum", "exclusiveMinimum")) if (s.has(key)) { double value = s.path(key).doubleValue(); if (value > lo) { lo = value; exclusive = key.startsWith("exclusive"); } else if (value == lo && key.startsWith("exclusive")) exclusive = true; }
                    for (ObjectNode s : objects) for (String key : List.of("maximum", "exclusiveMaximum")) if (s.has(key)) { double value = s.path(key).doubleValue(); if (value < hi) { hi = value; exclusive = key.startsWith("exclusive"); } else if (value == hi && key.startsWith("exclusive")) exclusive = true; }
                    if (lo > hi || lo == hi && exclusive) continue;
                } else if (type.equals("string") && lower(objects, "minLength") > upper(objects, "maxLength")) continue;
                else if (type.equals("array")) {
                    if (lower(objects, "minItems") > upper(objects, "maxItems")) continue;
                    if (lower(objects, "minItems") > 0 && objects.stream().noneMatch(s -> s.path("prefixItems").isArray() && !s.path("prefixItems").isEmpty()) && emptyPositive(objects.stream().map(s -> schema(s, "items")).toList(), depth + 1)) continue;
                } else if (type.equals("object")) {
                    Set<String> required = new HashSet<>(); objects.forEach(s -> array(s, "required").forEach(item -> required.add(item.asText())));
                    if (Math.max(lower(objects, "minProperties"), required.size()) > upper(objects, "maxProperties")) continue;
                    boolean impossible = false;
                    for (String name : required) {
                        List<JsonNode> rules = new ArrayList<>();
                        for (ObjectNode s : objects) { ObjectNode properties = object(s, "properties"); rules.add(properties.has(name) ? properties.get(name) : object(s, "patternProperties").isEmpty() ? schema(s, "additionalProperties") : BooleanNode.TRUE); }
                        if (emptyPositive(rules, depth + 1)) { impossible = true; break; }
                    }
                    if (impossible) continue;
                }
                return false;
            }
            return true;
        }
        private boolean dead(List<Literal> clause) {
            List<JsonNode> positive = clause.stream().filter(l -> !l.negative()).map(Literal::schema).toList(), negative = clause.stream().filter(Literal::negative).map(Literal::schema).toList();
            return emptyPositive(positive, 0) || positive.stream().anyMatch(a -> negative.stream().anyMatch(b -> includes.test(a, b)));
        }
        private boolean entails(List<Literal> clause, Literal literal) {
            budget(0); if (clause.stream().anyMatch(other -> other.negative() == literal.negative() && same.test(other.schema(), literal.schema()))) return true;
            List<JsonNode> positive = clause.stream().filter(l -> !l.negative()).map(Literal::schema).toList();
            if (!literal.negative()) return positive.stream().anyMatch(schema -> includes.test(schema, literal.schema()));
            if (clause.stream().anyMatch(other -> other.negative() && includes.test(literal.schema(), other.schema()))) return true;
            List<JsonNode> combined = new ArrayList<>(positive); combined.add(literal.schema()); return emptyPositive(combined, 0);
        }
    }

    private static JsonNode normalize(JsonNode value) { return value == null || value.isMissingNode() ? BooleanNode.TRUE : value; }
    private static boolean isTrue(JsonNode value) { return value != null && value.isBoolean() && value.booleanValue(); }
    private static boolean isFalse(JsonNode value) { return value != null && value.isBoolean() && !value.booleanValue(); }
    private static boolean hasComposition(JsonNode schema) { return schema != null && schema.isObject() && OPERATORS.stream().anyMatch(schema::has); }
    private static JsonNode shape(JsonNode value) { if (!value.isObject()) return value; ObjectNode result = Json.object(); value.properties().forEach(entry -> { if (!ANNOTATIONS.contains(entry.getKey())) result.set(entry.getKey(), entry.getValue()); }); return result; }
    private static Set<String> types(ObjectNode schema) {
        List<String> declared = new ArrayList<>(); JsonNode type = schema.get("type");
        if (type == null) declared.addAll(ATOMS); else if (type.isArray()) type.forEach(item -> declared.add(item.asText())); else declared.add(type.asText());
        Set<String> result = new LinkedHashSet<>(); for (String item : declared) if (item.equals("number")) { result.add("integer"); result.add("fraction"); } else result.add(item); return result;
    }
    private static List<JsonNode> finite(ObjectNode schema) {
        if (schema.has("const")) { if (schema.has("enum") && stream(schema.path("enum")).noneMatch(value -> CanonicalJson.write(value).equals(CanonicalJson.write(schema.get("const"))))) return List.of(); return List.of(schema.get("const")); }
        return schema.path("enum").isArray() ? stream(schema.path("enum")).toList() : null;
    }
    private static Bound lower(ObjectNode schema) { double value = Double.NEGATIVE_INFINITY; boolean exclusive = false; if (schema.has("minimum")) value = schema.path("minimum").doubleValue(); if (schema.has("exclusiveMinimum") && schema.path("exclusiveMinimum").doubleValue() >= value) { value = schema.path("exclusiveMinimum").doubleValue(); exclusive = true; } return new Bound(value, exclusive); }
    private static Bound upper(ObjectNode schema) { double value = Double.POSITIVE_INFINITY; boolean exclusive = false; if (schema.has("maximum")) value = schema.path("maximum").doubleValue(); if (schema.has("exclusiveMaximum") && schema.path("exclusiveMaximum").doubleValue() <= value) { value = schema.path("exclusiveMaximum").doubleValue(); exclusive = true; } return new Bound(value, exclusive); }
    private static boolean divisibleSafeIntegers(JsonNode a, JsonNode b) { return a != null && b != null && a.isIntegralNumber() && b.isIntegralNumber() && a.canConvertToLong() && b.canConvertToLong() && a.longValue() > 0 && b.longValue() > 0 && a.longValue() % b.longValue() == 0; }
    private static String textOrNull(ObjectNode value, String key) { return value.path(key).isTextual() ? value.path(key).asText() : null; }
    private static double number(ObjectNode value, String key, double fallback) { return value.has(key) && value.path(key).isNumber() ? value.path(key).doubleValue() : fallback; }
    private static JsonNode schema(ObjectNode value, String key) { return value.has(key) ? value.get(key) : BooleanNode.TRUE; }
    private static ObjectNode object(ObjectNode value, String key) { return value.path(key).isObject() ? (ObjectNode) value.path(key) : Json.object(); }
    private static ArrayNode array(ObjectNode value, String key) { return value.path(key).isArray() ? (ArrayNode) value.path(key) : Json.MAPPER.createArrayNode(); }
    private static boolean containsText(ArrayNode values, String expected) { for (JsonNode value : values) if (expected.equals(value.asText())) return true; return false; }
    private static String pointer(String value) { return value.replace("~", "~0").replace("/", "~1"); }
    private static String valueType(JsonNode value) { if (value.isNull()) return "null"; if (value.isArray()) return "array"; if (value.isIntegralNumber()) return "integer"; if (value.isNumber()) return "fraction"; if (value.isBoolean()) return "boolean"; if (value.isTextual()) return "string"; return value.isObject() ? "object" : "undefined"; }
    private static double lower(List<ObjectNode> schemas, String key) { return schemas.stream().mapToDouble(s -> number(s, key, 0)).max().orElse(0); }
    private static double upper(List<ObjectNode> schemas, String key) { return schemas.stream().mapToDouble(s -> number(s, key, Double.POSITIVE_INFINITY)).min().orElse(Double.POSITIVE_INFINITY); }
    private static java.util.stream.Stream<JsonNode> stream(JsonNode value) { return value != null && value.isArray() ? java.util.stream.StreamSupport.stream(value.spliterator(), false) : java.util.stream.Stream.empty(); }
    private static <T> Iterable<T> iterable(Iterator<T> iterator) { return () -> iterator; }
}
