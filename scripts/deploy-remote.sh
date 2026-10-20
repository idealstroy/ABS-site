#!/bin/sh
set -eu

mode=$1
target=$2
stage=$3
release=$4
sha=$5

case "$target" in
  /*) ;;
  *) echo 'Target must be absolute' >&2; exit 1 ;;
esac
case "$target" in
  /|/var|/var/www|*..*|*' '*) echo 'Unsafe target' >&2; exit 1 ;;
esac
case "$release" in
  *[!0-9a-f]*|'') echo 'Invalid release ID' >&2; exit 1 ;;
esac
[ "${#release}" -eq 32 ] || { echo 'Invalid release ID length' >&2; exit 1; }
[ "$stage" = "${target}.__deploy_${release}" ] || { echo 'Invalid staging path' >&2; exit 1; }
parent=$(dirname "$target")
backup="$parent/Backup ABS $(date +%Y-%m-%d)"

required_files='index.html robots.txt sitemap.xml assets/css/site.css assets/js/site.js actions/send-request.php actions/form-lib.php voditel-spetstehnika/index.html mashinisty-spetstehniki/index.html o-kompanii/index.html kontakty/index.html'
check_release() {
  root=$1
  for item in $required_files; do
    [ -f "$root/$item" ] || { echo "Missing $item in $root" >&2; return 1; }
  done
}

restore_files() {
  saved=$(cat "$stage/backup-path")
  [ -d "$saved" ] || { echo 'Backup missing; refusing rollback' >&2; return 1; }
  find "$stage/site" -type f -print | while IFS= read -r source; do
    relative=${source#"$stage/site/"}
    destination="$target/$relative"
    if [ -f "$saved/$relative" ]; then
      cp --preserve=mode "$saved/$relative" "$destination.restore_$release"
      mv -f "$destination.restore_$release" "$destination"
    else
      rm -f "$destination"
    fi
  done
  check_release "$target"
}

case "$mode" in
  backup)
    [ -d "$stage" ] && [ -d "$target" ] || { echo 'Stage or live site missing' >&2; exit 1; }
    check_release "$target"
    needed=$(du -sk "$target" | awk '{print $1}')
    available=$(df -Pk "$parent" | awk 'END {print $4}')
    [ "$available" -gt "$((needed + 102400))" ] || { echo 'Insufficient space for backup' >&2; exit 1; }
    mkdir "$stage/current-backup"
    cp -a "$target/." "$stage/current-backup/"
    check_release "$stage/current-backup"
    if [ -e "$backup" ]; then mv "$backup" "$stage/previous-backup"; fi
    if ! mv "$stage/current-backup" "$backup"; then
      if [ -d "$stage/previous-backup" ]; then mv "$stage/previous-backup" "$backup"; fi
      echo 'Could not replace the backup; previous backup restored' >&2
      exit 1
    fi
    printf '%s\n' "$backup" > "$stage/backup-path"
    echo "Backup copied to $backup"
    ;;
  prepare|prepare-test)
    if [ "$mode" = prepare ]; then
      [ -f "$stage/backup-path" ] || { echo 'Backup missing' >&2; exit 1; }
    else
      [ ! -e "$stage/backup-path" ] || { echo 'Refusing test mode in a deploy stage' >&2; exit 1; }
      printf '%s\n' "$release" > "$stage/upload-only"
    fi
    [ -f "$stage/site.tar.gz" ] || { echo 'Archive missing' >&2; exit 1; }
    printf '%s  %s\n' "$sha" "$stage/site.tar.gz" | sha256sum -c -
    mkdir "$stage/site"
    tar -xzf "$stage/site.tar.gz" -C "$stage/site"
    [ -z "$(find "$stage/site" -type l -print -quit)" ] || { echo 'Symlinks are not allowed in release' >&2; exit 1; }
    printf '%s\n' "$release" > "$stage/site/abs-deploy-version.txt"
    check_release "$stage/site"
    [ -f "$stage/site/release-manifest.sha256" ] || { echo 'File manifest missing' >&2; exit 1; }
    (cd "$stage/site" && sha256sum -c release-manifest.sha256 > "$stage/manifest-check.log")
    needed=$(du -sk "$stage/site" | awk '{print $1}')
    available=$(df -Pk "$parent" | awk 'END {print $4}')
    [ "$available" -gt "$((needed + 102400))" ] || { echo 'Insufficient space for activation' >&2; exit 1; }
    find "$stage/site" -type d -exec chmod 755 {} +
    find "$stage/site" -type f -exec chmod 644 {} +
    ;;
  cleanup-test)
    [ ! -e "$stage/backup-path" ] && [ -f "$stage/upload-only" ] || { echo 'Not an upload-only stage' >&2; exit 1; }
    [ "$(cat "$stage/upload-only")" = "$release" ] || { echo 'Test marker mismatch' >&2; exit 1; }
    [ ! -L "$stage" ] || { echo 'Stage must not be a symlink' >&2; exit 1; }
    rm -rf -- "$stage"
    ;;
  activate)
    [ -f "$stage/backup-path" ] && [ -d "$stage/site" ] || { echo 'Release is not prepared' >&2; exit 1; }
    check_release "$stage/site"
    trap 'restore_files || true' EXIT
    find "$stage/site" -type d -print | while IFS= read -r source; do
      relative=${source#"$stage/site"}
      mkdir -p "$target$relative"
    done
    for kind in other html; do
      find "$stage/site" -type f -print | while IFS= read -r source; do
        relative=${source#"$stage/site/"}
        case "$relative" in
          *.html) [ "$kind" = html ] || continue ;;
          *) [ "$kind" = other ] || continue ;;
        esac
        destination="$target/$relative"
        cp --no-preserve=mode "$source" "$destination.next_$release"
        mv -f "$destination.next_$release" "$destination"
      done
    done
    check_release "$target"
    [ "$(cat "$target/abs-deploy-version.txt")" = "$release" ]
    (cd "$target" && sha256sum -c release-manifest.sha256 > "$stage/live-manifest-check.log")
    trap - EXIT
    ;;
  rollback)
    restore_files
    echo 'Live files restored from backup.'
    ;;
  finalize)
    [ "$(cat "$target/abs-deploy-version.txt")" = "$release" ] || { echo 'Release marker mismatch' >&2; exit 1; }
    check_release "$target"
    saved=$(cat "$stage/backup-path")
    [ -d "$saved" ] || { echo 'Backup missing' >&2; exit 1; }
    find "$parent" -mindepth 1 -maxdepth 1 -type d -name 'Backup ABS *' ! -path "$saved" -exec rm -rf -- {} +
    rm -rf -- "$stage"
    ;;
  *) echo "Unknown mode: $mode" >&2; exit 1 ;;
esac
