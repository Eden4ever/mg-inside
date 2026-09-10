package com.metagravity.desktop;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;

final class PrivateFiles {
    private PrivateFiles() {}
    static void create(Path path,byte[] bytes) throws IOException {
        boolean posix=Files.getFileStore(path.getParent()).supportsFileAttributeView("posix");
        if(posix) Files.createFile(path,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
        else Files.createFile(path);
        Files.write(path,bytes,StandardOpenOption.WRITE);
    }
    static void replace(Path path,byte[] bytes) throws IOException {
        Files.createDirectories(path.getParent());
        Path temporary=path.resolveSibling(path.getFileName()+"."+java.util.UUID.randomUUID()+".tmp");
        try {
            create(temporary,bytes);
            Files.move(temporary,path,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        } finally { Files.deleteIfExists(temporary); }
    }
}
