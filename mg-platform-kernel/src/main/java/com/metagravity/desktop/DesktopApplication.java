package com.metagravity.desktop;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DesktopApplication {
    public static void main(String[] args) {
        if (DesktopApplicationCatalogAdmin.requested(args)) {
            int code = DesktopApplicationCatalogAdmin.run(args);
            if (code != 0) System.exit(code);
            return;
        }
        if (ServiceStorageAdmin.requested(args)) {
            int code = ServiceStorageAdmin.run(args);
            if (code != 0) System.exit(code);
            return;
        }
        SpringApplication.run(DesktopApplication.class, args);
    }
}
