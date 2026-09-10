package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.*;
import java.util.*;

final class ServiceMetrics {
    record Query(Instant from, Instant to, String serviceId, String operationId, String outcome, int page) {
        static Query parse(Map<String,String> input) {
            try {
                Instant to = Instant.parse(input.getOrDefault("to", Instant.now().toString())), from = Instant.parse(input.getOrDefault("from", to.minus(Duration.ofDays(1)).toString()));
                int page = Integer.parseInt(input.getOrDefault("page", "1"));
                String outcome = input.getOrDefault("outcome", "");
                if (!from.isBefore(to) || Duration.between(from,to).compareTo(Duration.ofDays(31))>0 || page<1 || page>100000 || !Set.of("","success","error","cancelled","unknown").contains(outcome)) throw new IllegalArgumentException();
                return new Query(from,to,input.getOrDefault("serviceId",""),input.getOrDefault("operationId",""),outcome,page);
            } catch (RuntimeException error) { throw new ApiException(400, "请选择有效的时间范围（最多 31 天）和页码"); }
        }
    }
    static String outcome(JsonNode event) {
        String saved = event.path("outcome").asText();
        if (!saved.isEmpty()) return saved;
        // 旧记录的错误映射时机不确定，不能回填为已核验成功。
        return "unknown";
    }
    static final class Summary {
        long count, successful, failed, cancelled, unknown, duration, bytes, measured;
        void add(JsonNode event) {
            count++; duration += Math.max(0,event.path("durationMs").asLong());
            switch(outcome(event)) { case "success" -> successful++; case "error" -> failed++; case "cancelled" -> cancelled++; default -> unknown++; }
            if(event.path("responseBytes").isNumber()) { bytes+=Math.max(0,event.path("responseBytes").asLong()); measured++; }
        }
        ObjectNode json() {
            var result=Json.object().put("count",count).put("successful",successful).put("failed",failed).put("cancelled",cancelled).put("unknown",unknown).put("averageMs",count==0?0:(double)duration/count).put("measured",measured);
            if(measured==0) result.putNull("responseBytes"); else result.put("responseBytes",bytes);
            if(count==unknown) result.putNull("successRate"); else result.put("successRate",100.0*successful/(count-unknown));
            return result;
        }
    }
    static final class Accumulator {
        final Query query; final Set<String> allowed; final Summary summary=new Summary();
        final Map<String,Summary> groups=new LinkedHashMap<>(); final Map<Long,Summary> buckets=new TreeMap<>();
        final Map<String,ObjectNode> identities=new HashMap<>(); final ArrayNode logs=Json.MAPPER.createArrayNode();
        final long bucketSeconds; long matched;
        Accumulator(Query query,Set<String> allowed) { this.query=query;this.allowed=allowed;long hours=Duration.between(query.from(),query.to()).toHours();bucketSeconds=hours<=6?300:hours<=48?3600:86400; }
        void add(JsonNode event) {
            String service=event.path("serviceId").asText(),operation=event.path("operationId").asText();
            Instant at;try {at=Instant.parse(event.path("at").asText());} catch(RuntimeException e){return;}
            if(!allowed.contains(service)||at.isBefore(query.from())||!at.isBefore(query.to())||!query.serviceId().isEmpty()&&!query.serviceId().equals(service)||!query.operationId().isEmpty()&&!query.operationId().equals(operation))return;
            if(!query.outcome().isEmpty()&&!query.outcome().equals(outcome(event)))return;
            summary.add(event);
            String key=service+"/"+operation;
            groups.computeIfAbsent(key,k->new Summary()).add(event); identities.put(key,Json.object().put("serviceId",service).put("operationId",operation));
            buckets.computeIfAbsent(at.getEpochSecond()/bucketSeconds*bucketSeconds,k->new Summary()).add(event);
            if(matched>=(long)(query.page()-1)*50 && logs.size()<50) {var copy=(ObjectNode)event.deepCopy();copy.remove("actor");copy.put("outcome",outcome(event));logs.add(copy);}
            matched++;
        }
        ObjectNode finish(String coverage) {
            var result=Json.object().put("from",query.from().toString()).put("to",query.to().toString()).put("coverage",coverage).put("total",matched).put("page",query.page()).put("pageSize",50).put("bucketSeconds",bucketSeconds);
            result.set("summary",summary.json());result.set("logs",logs);var list=Json.MAPPER.createArrayNode();
            groups.forEach((key,value)->{var item=identities.get(key).deepCopy();item.setAll(value.json());list.add(item);});result.set("groups",list);
            var series=Json.MAPPER.createArrayNode();
            for(long at=Math.floorDiv(query.from().getEpochSecond(),bucketSeconds)*bucketSeconds;at<query.to().getEpochSecond();at+=bucketSeconds)series.add(buckets.getOrDefault(at,new Summary()).json().put("at",Instant.ofEpochSecond(at).toString()));
            result.set("series",series);
            return result;
        }
    }
}
