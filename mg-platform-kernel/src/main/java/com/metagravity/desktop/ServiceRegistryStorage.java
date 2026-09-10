package com.metagravity.desktop;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 服务目录状态的事务边界。实现必须把读取、变更和提交置于同一一致性范围。 */
public interface ServiceRegistryStorage extends AutoCloseable {
    record Context(String environment, ArrayNode activeBindings) {}

    @FunctionalInterface
    interface Change<T> {
        T apply(ObjectNode state, Context context);
    }

    ObjectNode read(boolean allowCache);
    <T> T transaction(Change<T> change);
    ObjectNode status();
    default ObjectNode apiInventory() { var value=read(false).path("apiInventory");return value.isObject()?(ObjectNode)value.deepCopy():ServiceApiInventory.empty(); }
    default <T>T apiInventoryTransaction(Change<T> change) {
        return transaction((state,context)->{if(!state.path("apiInventory").isObject())state.set("apiInventory",ServiceApiInventory.empty());return change.apply((ObjectNode)state.path("apiInventory"),context);});
    }
    default ObjectNode workspace() { var state=read(false);return state.path("workspace").isObject() ? (ObjectNode)state.path("workspace").deepCopy() : ServiceWorkspace.empty(); }
    default <T> T workspaceTransaction(Change<T> change) {
        return transaction((state,context)-> { if(!state.path("workspace").isObject())state.set("workspace",ServiceWorkspace.empty());return change.apply((ObjectNode)state.path("workspace"),context); });
    }
    default void appendActivity(ObjectNode event) {
        transaction((state,context)->{var events=state.withArray("activity");events.add(event);while(events.size()>300)events.remove(0);return null;});
    }
    default void appendAudit(ObjectNode event) {
        transaction((state,context)->{var events=state.withArray("audit");events.add(event);while(events.size()>500)events.remove(0);return null;});
    }
    default ObjectNode insights(ServiceMetrics.Query query, java.util.Set<String> allowed) {
        var accumulator=new ServiceMetrics.Accumulator(query,allowed);var events=read(false).withArray("activity");
        for(int i=events.size()-1;i>=0;i--)accumulator.add(events.get(i));return accumulator.finish("recent-window");
    }
    @Override default void close() {}
}
