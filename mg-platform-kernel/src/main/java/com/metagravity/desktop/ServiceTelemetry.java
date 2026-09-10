package com.metagravity.desktop;

import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Component;

/** 有界异步落盘，不让数据库延迟阻塞响应线程。 */
@Component
public final class ServiceTelemetry {
    private final ServiceRegistry registry;
    private final AtomicLong dropped=new AtomicLong();
    private final ThreadPoolExecutor executor=new ThreadPoolExecutor(1,1,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(1024),task->{Thread thread=new Thread(task,"service-observations");thread.setDaemon(true);return thread;},new ThreadPoolExecutor.AbortPolicy());
    public ServiceTelemetry(ServiceRegistry registry){this.registry=registry;}
    public void record(ObjectNode event) {
        enqueue(()->registry.recordObservation(event));
    }
    public void audit(ObjectNode event) { enqueue(()->registry.recordGatewayAudit(event)); }
    private void enqueue(Runnable write) {
        try {executor.execute(()->{try{write.run();}catch(RuntimeException error){dropped.incrementAndGet();}});}catch(RejectedExecutionException error){dropped.incrementAndGet();}
    }
    public ObjectNode status(){return Json.object().put("pending",executor.getQueue().size()).put("droppedSinceStart",dropped.get());}
    @PreDestroy public void close() throws InterruptedException {executor.shutdown();if(!executor.awaitTermination(5,TimeUnit.SECONDS))executor.shutdownNow();}
}
