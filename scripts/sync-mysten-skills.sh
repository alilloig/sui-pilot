#!/usr/bin/env bash
# sync-mysten-skills.sh — Materialize MystenLabs/skills as symlinks under skills/.
#
# The MystenLabs/skills repo is vendored as a submodule at .mysten-skills/.
# Claude Code auto-discovers plugin skills at skills/<name>/SKILL.md, so each
# upstream skill needs its own entry there. Symlinks let the working tree
# always reflect whatever the submodule currently points at — no copy step.
#
# Idempotent. Safe to re-run after `git submodule update --remote --merge`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_ROOT="${PLUGIN_ROOT}/.mysten-skills"
DST_ROOT="${PLUGIN_ROOT}/skills"

# Skills in .mysten-skills/ to skip (templates, examples, anything that
# would pollute the active skill list).
SKIP=(template)

skip_contains() {
  local needle="$1"
  for s in "${SKIP[@]}"; do [[ "$s" == "$needle" ]] && return 0; done
  return 1
}

if [[ ! -d "$SRC_ROOT" ]]; then
  echo "ERROR: ${SRC_ROOT} not found. Run 'git submodule update --init --recursive'." >&2
  exit 1
fi

# Fail fast if the submodule directory exists but is empty / un-checked-out.
# Without this guard, the cleanup loop below would interpret "no upstream
# SKILL.md" as "upstream removed every skill" and wipe every committed symlink.
shopt -s nullglob
upstream_skills=("$SRC_ROOT"/*/SKILL.md)
shopt -u nullglob
if [[ ${#upstream_skills[@]} -eq 0 ]]; then
  echo "ERROR: ${SRC_ROOT} contains no */SKILL.md — submodule not initialized?" >&2
  echo "       Run 'git submodule update --init --recursive' first." >&2
  exit 1
fi

mkdir -p "$DST_ROOT"

linked=0
skipped=0
conflicts=0
removed=0

# 1) Create / refresh symlinks for every upstream skill with a SKILL.md.
for src in "$SRC_ROOT"/*/; do
  name="$(basename "$src")"
  skip_contains "$name" && { echo "  [skip ] $name (excluded)"; skipped=$((skipped + 1)); continue; }
  [[ -f "$src/SKILL.md" ]] || { echo "  [skip ] $name (no SKILL.md)"; skipped=$((skipped + 1)); continue; }

  dst="$DST_ROOT/$name"
  expected="../.mysten-skills/$name"

  if [[ -L "$dst" ]]; then
    actual="$(readlink "$dst")"
    if [[ "$actual" == "$expected" ]]; then
      echo "  [ok   ] $name"
    else
      ln -sfn "$expected" "$dst"
      echo "  [retgt] $name (was: $actual)"
    fi
  elif [[ -e "$dst" ]]; then
    echo "  [CONFL] $name — real dir/file at $dst; refusing to overwrite" >&2
    conflicts=$((conflicts + 1))
    continue
  else
    ln -s "$expected" "$dst"
    echo "  [link ] $name"
  fi
  linked=$((linked + 1))
done

# 2) Remove stale symlinks in skills/ that point into .mysten-skills/ but whose
#    upstream source has been deleted, renamed, or excluded.
for dst in "$DST_ROOT"/*; do
  [[ -L "$dst" ]] || continue
  target="$(readlink "$dst")"
  [[ "$target" == ../.mysten-skills/* ]] || continue

  name="$(basename "$dst")"
  if skip_contains "$name" || [[ ! -f "$SRC_ROOT/$name/SKILL.md" ]]; then
    rm "$dst"
    echo "  [unlnk] $name"
    removed=$((removed + 1))
  fi
done

echo ""
echo "==> sync-mysten-skills: linked=${linked} skipped=${skipped} removed=${removed} conflicts=${conflicts}"
[[ $conflicts -eq 0 ]]
