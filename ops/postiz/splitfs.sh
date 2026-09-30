#!/bin/bash
# Pack a filesystem tree into $SRC/L/bN dirs of <= ~280MB each, mirroring
# absolute paths (item $SRC/usr/share/foo -> $SRC/L/bK/usr/share/foo). Runs in
# a helper stage where the target tree is DATA — never move the running
# system's own dirs (moving /lib64 kills the exec-loader mid-run).
set -u
SRC="${1:-/fs}"
CAP=280
i=0
size=0

put() { # $1 = source path, $2 = interior dir ("" for top-level)
  local f="$1" rel="$2"
  local s
  s=$(du -sm -- "$f" 2>/dev/null | cut -f1); s=${s:-1}
  if [ $((size + s)) -gt "$CAP" ] && [ "$size" -gt 0 ]; then
    i=$((i + 1)); size=0
  fi
  local d="$SRC/L/b$i"
  [ -n "$rel" ] && d="$d/$rel"
  mkdir -p "$d"
  mv -- "$f" "$d/" 2>/dev/null && size=$((size + s)) || true
}

emit() { # $1 = path, $2 = interior dir prefix
  local f="$1" rel="$2" s sub b
  s=$(du -sm -- "$f" 2>/dev/null | cut -f1); s=${s:-0}
  if [ "$s" -ge "$CAP" ] && [ -d "$f" ] && [ ! -L "$f" ]; then
    b=$(basename "$f")
    for sub in "$f"/* "$f"/.[!.]*; do
      [ -e "$sub" ] || continue
      emit "$sub" "${rel:+$rel/}$b"
    done
    rmdir "$f" 2>/dev/null || true
  else
    put "$f" "$rel"
  fi
}

mkdir -p "$SRC/L"
for d in "$SRC"/*; do
  [ -e "$d" ] || continue
  [ "$d" = "$SRC/L" ] && continue
  emit "$d" ""
done

# Sweep: anything still outside $SRC/L (unmoved leftovers) must not be lost —
# force-place it into bands regardless of the cap.
for f in "$SRC"/* "$SRC"/.[!.]*; do
  [ -e "$f" ] || continue
  [ "$f" = "$SRC/L" ] && continue
  put "$f" ""
done

for n in $(seq 0 39); do mkdir -p "$SRC/L/b$n"; done
echo "=== band sizes (MB) ==="
du -sm "$SRC"/L/b* 2>/dev/null | sed "s|$SRC/L/||" | sort -V -k2 | tr '\n' ' '
echo
