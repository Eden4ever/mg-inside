package com.metagravity.desktop;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<byte[]> api(ApiException e) { return PlatformController.json(e.status(),Map.of("message",e.getMessage())); }
    @ExceptionHandler(org.springframework.core.io.buffer.DataBufferLimitException.class)
    public ResponseEntity<byte[]> large() { return PlatformController.json(413,Map.of("message","请求过大")); }
}
