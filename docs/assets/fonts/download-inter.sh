#!/bin/bash
# Download Inter variable font woff2 files for self-hosting
# Run from the project root: bash docs/assets/fonts/download-inter.sh
#
# Expected SHA-256 checksums — update these when pinning a new Inter release.
# To regenerate: shasum -a 256 docs/assets/fonts/*.woff2

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

LATIN_URL='https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-opsz-normal.woff2'
LATIN_EXT_URL='https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-ext-opsz-normal.woff2'

echo "Downloading Inter variable font (latin, woff2)..."
curl -sL -o "$DIR/inter-latin-normal.woff2" "$LATIN_URL"

echo "Downloading Inter variable font (latin-ext, woff2)..."
curl -sL -o "$DIR/inter-latin-ext-normal.woff2" "$LATIN_EXT_URL"

echo "Verifying checksums..."
# Recompute hashes of the freshly downloaded files and store them.
LATIN_HASH=$(shasum -a 256 "$DIR/inter-latin-normal.woff2" | awk '{print $1}')
LATIN_EXT_HASH=$(shasum -a 256 "$DIR/inter-latin-ext-normal.woff2" | awk '{print $1}')

# Check whether a lock file with expected hashes already exists.
LOCK="$DIR/inter-checksums.sha256"
if [ -f "$LOCK" ]; then
  echo "Comparing against stored checksums in inter-checksums.sha256..."
  cd "$DIR"
  if shasum -a 256 --check inter-checksums.sha256; then
    echo "✓ Checksums match."
  else
    echo "✗ Checksum mismatch — the downloaded files differ from the stored hashes." >&2
    echo "  If this is a legitimate Inter update, delete inter-checksums.sha256 and re-run." >&2
    exit 1
  fi
else
  # First run: write the lock file so future downloads can be verified.
  echo "Writing inter-checksums.sha256 (first-time run — commit this file)..."
  {
    echo "$LATIN_HASH  inter-latin-normal.woff2"
    echo "$LATIN_EXT_HASH  inter-latin-ext-normal.woff2"
  } > "$LOCK"
  echo "✓ Checksums written. Please commit inter-checksums.sha256 alongside the woff2 files."
fi

echo "Done. Files:"
ls -lh "$DIR"/*.woff2
