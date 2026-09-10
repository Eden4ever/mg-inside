package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class ApplicationPolicyTest {
    @Test void websocketRequiresExplicitRegisteredPaths() {
        assertTrue(ApplicationPolicy.parse("sample-app", null).websocketPaths().isEmpty());
        assertEquals(java.util.List.of("/api/v1/collaboration"), ApplicationPolicy.parse("sample-app", Json.read("{\"websocketPaths\":[\"/api/v1/collaboration\"]}")).websocketPaths());
        for (String invalid : new String[]{"{\"websocketPaths\":[\"//outside\"]}", "{\"websocketPaths\":[\"/../admin\"]}", "{\"websocketPaths\":[\"/socket\"],\"apiMode\":\"compatibility\"}"}) {
            assertThrows(IllegalStateException.class, () -> ApplicationPolicy.parse("sample-app", Json.read(invalid)));
        }
    }
    @Test void defaultsAreStrictAndIdentifiersDoNotImplyPrivileges() {
        for (String id : new String[]{"fresh-app", "token-one-docs", "identity"}) {
            var policy = ApplicationPolicy.parse(id, null);
            assertEquals("registered", policy.apiMode());
            assertEquals(id, policy.versionOwnerAppId());
            assertEquals("/role", policy.rolePointer());
        }
    }
    @Test void explicitPolicySupportsNewApplicationsAndRejectsUnsafeValues() {
        var policy = ApplicationPolicy.parse("another-app", Json.read("""
            {"apiMode":"compatibility","versionOwnerAppId":"shared-package","rolePath":"/account/permissions",
             "rolePointer":"/user/access/role","allowedApiMethods":["GET","HEAD"]}
            """));
        assertEquals("shared-package",policy.versionOwnerAppId());
        assertFalse(policy.allowedApiMethods().contains("POST"));
        for (String invalid : new String[]{"{\"apiMode\":\"open\"}","{\"rolePath\":\"//evil.example\"}",
            "{\"rolePath\":\"/../admin\"}","{\"rolePointer\":1}","{\"allowedApiMethods\":[\"TRACE\"]}","{\"unknown\":true}"})
            assertThrows(IllegalStateException.class,()->ApplicationPolicy.parse("another-app",Json.read(invalid)));
    }
}
