// Small, unprivileged helper for a same-directory non-overwriting document move.
// Apple specifies RENAME_EXCL in bsd/man/man2/rename.2 and verifies case-only
// moves in tests/rename_excl.c (apple-oss-distributions/xnu). Never substitute
// plain rename(), or a copy/unlink fallback, if this operation is unsupported.
#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int fail(const char *code) {
    fputs(code, stderr);
    return 1;
}

static int fail_errno(int value) {
    switch (value) {
        case EEXIST: return fail("EEXIST");
        case ENOENT: return fail("ENOENT");
        case EACCES: return fail("EACCES");
        case EPERM: return fail("EPERM");
        case EBUSY: return fail("EBUSY");
        case ENOTSUP: return fail("ENOTSUP");
        default: return fail("EIO");
    }
}

static int same_version(const struct stat *left, const struct stat *right) {
    return left->st_dev == right->st_dev && left->st_ino == right->st_ino &&
        left->st_size == right->st_size &&
        left->st_mtimespec.tv_sec == right->st_mtimespec.tv_sec &&
        left->st_mtimespec.tv_nsec == right->st_mtimespec.tv_nsec &&
        left->st_ctimespec.tv_sec == right->st_ctimespec.tv_sec &&
        left->st_ctimespec.tv_nsec == right->st_ctimespec.tv_nsec;
}

int main(int argc, char *argv[]) {
    if (argc != 4 || argv[1][0] != '/' || argv[2][0] != '/' || strlen(argv[3]) != 64)
        return fail("EINVAL");
    for (int i = 0; i < 64; i++) {
        if (!((argv[3][i] >= '0' && argv[3][i] <= '9') ||
              (argv[3][i] >= 'a' && argv[3][i] <= 'f'))) return fail("EINVAL");
    }
    const char *source_name = strrchr(argv[1], '/');
    const char *target_name = strrchr(argv[2], '/');
    size_t parent_length = (size_t)(source_name - argv[1]);
    if (!source_name[1] || !target_name[1] ||
        parent_length != (size_t)(target_name - argv[2]) ||
        strncmp(argv[1], argv[2], parent_length) != 0) return fail("EINVAL");

    int fd = open(argv[1], O_RDONLY | O_CLOEXEC | O_NONBLOCK);
    if (fd == -1) return fail_errno(errno);
    struct stat before, after, current;
    if (fstat(fd, &before) == -1) { int error = errno; close(fd); return fail_errno(error); }
    if (!S_ISREG(before.st_mode) || before.st_size > 8 * 1024 * 1024) {
        close(fd);
        return fail("ECHANGED");
    }
    unsigned char digest[CC_SHA256_DIGEST_LENGTH], buffer[65536];
    CC_SHA256_CTX hash;
    CC_SHA256_Init(&hash);
    size_t total = 0;
    for (;;) {
        ssize_t count = read(fd, buffer, sizeof(buffer));
        if (count < 0) {
            if (errno == EINTR) continue;
            int error = errno; close(fd); return fail_errno(error);
        }
        if (count == 0) break;
        total += (size_t)count;
        if (total > 8 * 1024 * 1024) { close(fd); return fail("ECHANGED"); }
        CC_SHA256_Update(&hash, buffer, (CC_LONG)count);
    }
    CC_SHA256_Final(digest, &hash);
    char fingerprint[65];
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) snprintf(fingerprint + 2 * i, 3, "%02x", digest[i]);
    if (strcmp(fingerprint, argv[3]) != 0) { close(fd); return fail("ECHANGED"); }
    if (fstat(fd, &after) == -1 || stat(argv[1], &current) == -1) {
        int error = errno; close(fd); return fail_errno(error);
    }
    if (!same_version(&before, &after) || !same_version(&after, &current)) {
        close(fd);
        return fail("ECHANGED");
    }
    // Fingerprinting detects already-visible external edits. The exclusive
    // syscall independently guarantees that a concurrent destination creation
    // cannot be overwritten. It never removes the source on a failed move.
    int result = renamex_np(argv[1], argv[2], RENAME_EXCL);
    int error = errno;
    close(fd);
    return result == 0 ? 0 : fail_errno(error);
}
