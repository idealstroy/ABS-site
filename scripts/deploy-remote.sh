# POSIX shell; sent through SSH stdin. No installation and no server Python.
set -eu
export LC_ALL=C

fail() { printf '%s\n' "$*" >&2; exit 1; }
record() { printf 'ABS_DEPLOY|%s\n' "$*"; }
hash() { sha256sum "$1" | awk '{print $1}'; }
metadata() { stat -c '%u:%g:%a' "$1"; getfacl -c -p -n "$1"; }
reverse() { awk '{a[NR]=$0} END {for(i=NR;i>0;i--) print a[i]}' "$1"; }

safe_path() {
    case "$1" in ''|/*|*..*|*//*|*[!a-zA-Z0-9_./-]*) fail 'Unsafe website path';; esac
    case "/$1/" in */skills/*|*/var/*|*/logs/*|*/uploads/*|*/_prototype/*|*/node_modules/*|*/.git/*) fail 'Protected website path';; esac
    item="$root/$1"
    while [ "$item" != / ]; do
        [ ! -L "$item" ] || fail "Symlink not allowed: $item"
        item=${item%/*}; [ -n "$item" ] || item=/
    done
}

check_remote() {
    [ -d "$root" ] && [ "${root##*/}" = public_html ] || fail 'Existing public_html required'
    safe_path index.html
    for tool in sh base64 sha256sum tar getfacl stat cat mkdir cp awk sort cmp date df rm rmdir grep dirname; do
        command -v "$tool" >/dev/null 2>&1 || fail "Required existing hosting command not found: $tool"
    done
    tar --version | grep 'GNU tar' >/dev/null || fail 'GNU tar required on hosting'
    [ -r "$root" ] && [ -x "$root" ] || fail 'Website is not readable'
    stat -c '%u:%g:%a' "$root" >/dev/null
    getfacl -c -p -n "$root" >/dev/null
    [ -w "$(dirname "$root")" ] || fail 'Cannot create staging/backup beside the site'
    record 'CHECK|OK|sh,sha256sum,tar,getfacl,stat; no Python required'
}

preview() {
    manifest | while read -r expected size previous relative; do
        safe_path "$relative"
        file="$root/$relative"
        [ ! -e "$file" ] || [ -f "$file" ] || fail "Target is not a regular file: $relative"
        [ ! -f "$file" ] || [ "$(stat -c %h "$file")" = 1 ] || fail "Hard-linked target: $relative"
        if [ -e "$file" ]; then
            [ -f "$file" ] && [ -r "$file" ] || fail "Unreadable/non-file target: $relative"
            actual=$(hash "$file")
        else actual=-; fi
        record "FILE|$relative|$actual"
    done
    record 'OK|plan'
}

check_old() {
    manifest | while read -r expected size previous relative; do
        safe_path "$relative"
        file="$root/$relative"
        [ ! -e "$file" ] || [ -f "$file" ] || fail "Target is not a regular file: $relative"
        [ ! -f "$file" ] || [ "$(stat -c %h "$file")" = 1 ] || fail "Hard-linked target: $relative"
        actual=-; [ ! -f "$file" ] || actual=$(hash "$file")
        [ "$actual" = "$previous" ] || fail "File changed since preview: $relative"
        [ ! -e "$file" ] || [ -w "$file" ] || fail "File is not writable: $relative"
    done
}

locked() {
    [ -d "$state/lock" ] && [ ! -L "$state/lock" ] && [ "$(cat "$state/lock/run")" = "$run_id" ] || fail 'Another deployment owns the lock'
    manifest | cmp - "$stage/manifest" || fail 'Saved run differs from requested changes'
}

unlock() { rm "$state/lock/run" && rmdir "$state/lock"; }

make_stage() {
    check_old
    needed=$(manifest | while read -r expected size previous relative; do
        old_size=0; [ "$previous" = - ] || old_size=$(stat -c %s "$root/$relative")
        printf '%s\n' "$((size * 3 + old_size * 2))"
    done | awk '{n+=$1} END {printf "%.0f", n+33554432}')
    available=$(df -Pk "$root" | awk 'END {printf "%.0f", $4*1024}')
    [ "$available" -gt "$needed" ] || fail 'Not enough filesystem space for upload and backup (account quota must also be checked)'
    mkdir -p "$state"
    [ ! -L "$state" ] || fail 'Unsafe staging directory'
    mkdir "$state/lock" || fail 'Another deployment is active; inspect its status first'
    printf '%s\n' "$run_id" > "$state/lock/run"
    mkdir "$stage"
    manifest > "$stage/manifest"
    printf 'staged\n' > "$stage/status"
    record "STAGE|$stage"
    record 'OK|stage'
}

ensure_parent() {
    parent_path=${1%/*}
    [ "$parent_path" != "$1" ] || return 0
    current="$root"
    saved_ifs=$IFS; IFS=/; set -- $parent_path; IFS=$saved_ifs
    for component do
        next="$current/$component"
        if [ ! -d "$next" ]; then
            getfacl -c -p -n -d "$current" | grep '^default:' >/dev/null || fail "No inherited ACL for new directory: $next"
            printf '%s\n' "${next#"$root"/}" >> "$stage/new-dirs"
            mkdir "$next"
        fi
        current=$next
    done
}

restore_run() {
    # Content is restored into the same inode: UID/GID/mode/ACL remain intact.
    if [ -f "$stage/applied" ]; then
        reverse "$stage/applied" | while read -r relative; do
            safe_path "$relative"
            target="$root/$relative"
            previous=$(awk -v p="$relative" '$4==p {print $3}' "$stage/manifest")
            if [ "$previous" = - ]; then
                [ ! -e "$target" ] || rm "$target" || exit 1
            else
                [ -f "$target" ] && [ -f "$stage/restore/$relative" ] || exit 1
                [ "$(hash "$stage/restore/$relative")" = "$previous" ] || exit 1
                metadata "$target" | cmp - "$stage/meta/$relative" || exit 1
                cat "$stage/restore/$relative" > "$target" || exit 1
                [ "$(hash "$target")" = "$previous" ] || exit 1
                metadata "$target" | cmp - "$stage/meta/$relative" || exit 1
            fi
        done || return 1
    fi
    if [ -f "$stage/new-dirs" ]; then
        reverse "$stage/new-dirs" | while read -r relative; do
            safe_path "$relative"
            [ ! -d "$root/$relative" ] || rmdir "$root/$relative" || exit 1
        done || return 1
    fi
    printf 'rolled_back\n' > "$stage/status" || return 1
    unlock || return 1
}

on_exit() {
    code=$?
    trap - 0 HUP INT TERM
    if [ "$code" -ne 0 ] && [ "$action" = activate ] && [ -f "$stage/backup-ready" ]; then
        if restore_run; then record 'RESTORED|previous files restored';
        else printf 'recovery_required\n' > "$stage/status"; record 'RECOVERY_REQUIRED|lock retained'; fi
    fi
    exit "$code"
}

prepare() {
    locked
    [ "$(cat "$stage/status")" = staged ] || fail 'Run is not ready for publication'
    check_old
    [ "$(hash "$stage/payload.tar")" = "$archive_sha" ] || fail 'Uploaded archive SHA-256 differs'
    mkdir "$stage/payload" "$stage/restore" "$stage/meta"
    awk '{print $4}' "$stage/manifest" | sort > "$stage/expected-files"
    tar -tf "$stage/payload.tar" | sort > "$stage/archive-files"
    cmp "$stage/expected-files" "$stage/archive-files" || fail 'Archive file list differs from approved changes'
    tar -tvf "$stage/payload.tar" | awk 'substr($0,1,1)!="-" {bad=1} END {exit bad}' || fail 'Archive contains a non-regular file'
    tar --no-same-owner --no-same-permissions -xf "$stage/payload.tar" -C "$stage/payload"
    : > "$stage/old-files"; : > "$stage/new-dirs"; : > "$stage/applied"
    manifest | while read -r expected size previous relative; do
        [ "$(hash "$stage/payload/$relative")" = "$expected" ] && [ "$(stat -c %s "$stage/payload/$relative")" = "$size" ] || fail "Damaged upload: $relative"
        if [ "$previous" != - ]; then
            printf '%s\n' "$relative" >> "$stage/old-files"
            mkdir -p "$stage/meta/$(dirname "$relative")"
            metadata "$root/$relative" > "$stage/meta/$relative"
        fi
    done
    backup="$root/../backup-served-$(date -u +%Y%m%d-%H%M%S)-$run_id.tgz"
    [ ! -e "$backup" ] || fail 'Backup already exists'
    tar -czf "$backup" -C "$root" -T "$stage/old-files"
    printf '%s\n' "$backup" > "$stage/backup-path"
    : > "$backup.acl"
    while read -r relative; do getfacl -p -n "$root/$relative" >> "$backup.acl"; done < "$stage/old-files"
    cp "$stage/manifest" "$backup.manifest"
    tar -tzf "$backup" | sort > "$stage/backup-files"
    sort "$stage/old-files" | cmp - "$stage/backup-files" || fail 'Backup file list differs'
    tar --no-same-owner --no-same-permissions -xzf "$backup" -C "$stage/restore"
    while read -r relative; do
        previous=$(awk -v p="$relative" '$4==p {print $3}' "$stage/manifest")
        [ "$(hash "$stage/restore/$relative")" = "$previous" ] || fail "Backup damaged: $relative"
    done < "$stage/old-files"
    metadata "$root" > "$stage/root-meta"
    : > "$stage/backup-ready"
    record "BACKUP|$backup"
    check_old
    printf 'prepared\n' > "$stage/status"
    record 'OK|prepare'
}

activate() {
    locked
    [ "$(cat "$stage/status")" = prepared ] && [ -f "$stage/backup-ready" ] || fail 'Release and backup are not prepared'
    check_old
    printf 'publishing\n' > "$stage/status"
    # Resources first; HTML last, as in PTO. Existing directories are not replaced.
    manifest | awk '$4 !~ /\.html$/ {print}' > "$stage/activation-list"
    manifest | awk '$4 ~ /\.html$/ {print}' >> "$stage/activation-list"
    while read -r expected size previous relative; do
        ensure_parent "$relative"
        if [ "$previous" = - ]; then
            getfacl -c -p -n -d "$(dirname "$root/$relative")" | grep '^default:' >/dev/null || fail "No inherited ACL for new file: $relative"
        else metadata "$root/$relative" | cmp - "$stage/meta/$relative" || fail "Access changed: $relative"; fi
        printf '%s\n' "$relative" >> "$stage/applied"
        cat "$stage/payload/$relative" > "$root/$relative"
        [ "$(hash "$root/$relative")" = "$expected" ] || fail "Published hash differs: $relative"
        [ "$previous" = - ] || metadata "$root/$relative" | cmp - "$stage/meta/$relative" || fail "Access changed after write: $relative"
    done < "$stage/activation-list"
    metadata "$root" | cmp - "$stage/root-meta" || fail 'Root directory permissions changed'
    printf 'published\n' > "$stage/status"
    record 'OK|activate'
}

main() {
    # Variables and manifest() are prepended by the local script, never read from the web root.
    state="$root/../.abs-deploy-simple"
    stage="$state/$run_id"
    [ ! -L "$state" ] && [ ! -L "$stage" ] || fail 'Unsafe staging path'
    case "$run_id" in *[!a-f0-9]*|'') fail 'Invalid run ID';; esac
    [ "${#run_id}" = 32 ] || fail 'Invalid run ID length'
    check_remote
    case "$action" in
        check) record 'OK|check';;
        plan) preview;;
        stage) make_stage;;
        prepare) prepare;;
        activate) activate;;
        status) [ -f "$stage/status" ] || fail 'Run not found'; record "STATUS|$(cat "$stage/status")"; record 'OK|status';;
        recover) locked; [ "$(cat "$stage/status")" != complete ] || fail 'Completed release cannot be recovered as interrupted'; restore_run || fail 'Recovery failed; lock retained'; record 'OK|recover';;
        finish) locked; [ "$(cat "$stage/status")" = published ] || fail 'Publication not finished'; printf 'complete\n' > "$stage/status"; unlock; record 'OK|finish';;
        *) fail 'Unknown deployment action';;
    esac
}
trap on_exit 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
main
