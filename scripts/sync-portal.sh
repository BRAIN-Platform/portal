#!/usr/bin/env bash
# ==============================================================================
# sync-portal.sh — Configuration-driven synchronization of BRAIN development
# repositories into the public portal repository.
#
# Reads repository definitions, branch defaults, sync directories, and exclude
# rules from `sync-settings.yml` (overrideable via `--config` and CLI args).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default fallback constants (used when not specified via CLI or config file)
DEFAULT_CONFIG_FILENAME="sync-settings.yml"
DEFAULT_BRANCH="main"
DEFAULT_PR_BRANCH="sync/dev-repos"
DEFAULT_SYNC_DIR="docs/"

CONFIG_FILE=""
CLI_BRANCH=""
CLI_BASE_BRANCH=""
CLI_PR_BRANCH=""
SOURCE_MODE="remote"
PORTAL_DIR=""
LOCAL_ROOT=""
DRY_RUN=0
DO_COMMIT=0
CREATE_PR=0
ALLOW_DIRTY=0
REPORT_FILE=""
TITLE_FILE=""
SYNC_PATH_FILE=""
COMPONENTS_RAW=()

usage() {
  cat <<'EOF'
Usage: sync-portal.sh [OPTIONS]

Scan configured source repositories for changes on their target branch, sync
configured directories into the target repository, and optionally commit or
open a Pull Request. Default repository and directory mappings are loaded from
`sync-settings.yml`.

Options:
  -f, --config <path>      Path to YAML configuration file
                           (default: <script-dir>/sync-settings.yml or
                           ./sync-settings.yml).
  -c, --component <name>   Component alias (from sync-settings.yml, e.g.
                           all, homepage, leaderboard, guides) or repository
                           name. May be passed multiple times or
                           comma-separated (default: all).
  -s, --source <mode>      Source mode:
                             remote   Fetch branch from remote URL (default)
                             local    Fetch committed branch from sibling repos
                             worktree Copy tracked + untracked (non-ignored)
                                      files from sibling working trees
  -b, --branch <ref>       Override source branch for all selected components.
  -p, --portal-dir <dir>   Path to target repository checkout (default: pwd).
      --local-root <dir>   Parent directory of local source repos for
                           --source local|worktree (default: <portal-dir>/..).
  -n, --dry-run            Preview against the base branch in a temporary
                           clone without modifying the target checkout.
      --commit             Commit synced changes onto --pr-branch locally.
      --create-pr          Commit, push --pr-branch, and create/update a GitHub
                           Pull Request via `gh pr create`.
      --pr-branch <name>   Override PR branch name (default from config:
                           sync/dev-repos, or sync/<alias> for single component).
      --base-branch <name> Override target base branch (default from config).
      --report-file <path> Write Markdown sync summary report to <path>.
      --title-file <path>  Write generated commit/PR title line to <path>.
      --sync-path-file <p> Write normalized target sync git pathspec to <p>.
      --allow-dirty        Allow running even if target sync_dir has local edits.
  -h, --help               Show this help message and exit.

Environment Variables:
  BRAIN_DEV_REPO_TOKEN     Optional GitHub token (PAT or App token) with read
                           access to private source repos for --source remote.
                           Falls back to GH_TOKEN / GITHUB_TOKEN if set, or to
                           the user's configured git credential helper / SSH.

Examples:
  # Scan remote dev repos using sync-settings.yml and open/update a PR:
  ./scripts/sync-portal.sh --create-pr

  # Sync only leaderboard from remote branch and open/update a PR:
  ./scripts/sync-portal.sh --component leaderboard --create-pr

  # Dry-run scan against local sibling repositories:
  ./scripts/sync-portal.sh --source local --dry-run

  # Use a custom settings file:
  ./scripts/sync-portal.sh --config ./custom-sync-settings.yml --dry-run
EOF
}

exit_with_error() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

info() {
  printf '==> %s\n' "$*" >&2
}

# Normalize a config directory path ("/", ".", "" -> ""; "/docs/" -> "docs")
normalize_rel_path() {
  local p="$1"
  p="${p#"${p%%[![:space:]]*}"}"
  p="${p%"${p##*[![:space:]]}"}"
  while [[ "$p" == /* ]]; do p="${p#/}"; done
  while [[ "$p" == */ ]]; do p="${p%/}"; done
  if [[ "$p" == "." ]]; then
    p=""
  fi
  printf '%s' "$p"
}

# Parse CLI arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--config)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      CONFIG_FILE="$2"
      shift 2
      ;;
    -c|--component)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      COMPONENTS_RAW+=("$2")
      shift 2
      ;;
    -s|--source)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      SOURCE_MODE="$2"
      shift 2
      ;;
    -b|--branch)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      CLI_BRANCH="$2"
      shift 2
      ;;
    -p|--portal-dir)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      PORTAL_DIR="$2"
      shift 2
      ;;
    --local-root)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      LOCAL_ROOT="$2"
      shift 2
      ;;
    -n|--dry-run)
      DRY_RUN=1
      shift
      ;;
    --commit)
      DO_COMMIT=1
      shift
      ;;
    --create-pr)
      DO_COMMIT=1
      CREATE_PR=1
      shift
      ;;
    --pr-branch)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      CLI_PR_BRANCH="$2"
      shift 2
      ;;
    --base-branch)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      CLI_BASE_BRANCH="$2"
      shift 2
      ;;
    --report-file)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      REPORT_FILE="$2"
      shift 2
      ;;
    --title-file)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      TITLE_FILE="$2"
      shift 2
      ;;
    --sync-path-file)
      [[ $# -ge 2 ]] || exit_with_error "Missing value for $1"
      SYNC_PATH_FILE="$2"
      shift 2
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      exit_with_error "Unknown argument: $1 (use --help for usage)"
      ;;
  esac
done

case "$SOURCE_MODE" in
  remote|local|worktree) ;;
  *) exit_with_error "Invalid --source '$SOURCE_MODE' (expected: remote, local, worktree)" ;;
esac

if [[ $DRY_RUN -eq 1 && ( $DO_COMMIT -eq 1 || $CREATE_PR -eq 1 ) ]]; then
  exit_with_error "--dry-run cannot be combined with --commit or --create-pr"
fi

# Resolve PORTAL_DIR first so we can also look for sync-settings.yml there
if [[ -z "$PORTAL_DIR" ]]; then
  PORTAL_DIR="$(pwd)"
fi
PORTAL_DIR="$(cd "$PORTAL_DIR" && pwd)"

# Locate configuration file
if [[ -z "$CONFIG_FILE" ]]; then
  if [[ -f "$SCRIPT_DIR/$DEFAULT_CONFIG_FILENAME" ]]; then
    CONFIG_FILE="$SCRIPT_DIR/$DEFAULT_CONFIG_FILENAME"
  elif [[ -f "$PORTAL_DIR/scripts/$DEFAULT_CONFIG_FILENAME" ]]; then
    CONFIG_FILE="$PORTAL_DIR/scripts/$DEFAULT_CONFIG_FILENAME"
  elif [[ -f "$PORTAL_DIR/$DEFAULT_CONFIG_FILENAME" ]]; then
    CONFIG_FILE="$PORTAL_DIR/$DEFAULT_CONFIG_FILENAME"
  else
    exit_with_error "Configuration file $DEFAULT_CONFIG_FILENAME not found (use --config <path>)"
  fi
fi
[[ -f "$CONFIG_FILE" ]] || exit_with_error "Configuration file not found: $CONFIG_FILE"

command -v yq >/dev/null 2>&1 \
  || exit_with_error "'yq' (https://github.com/mikefarah/yq) is required to parse $CONFIG_FILE"

# Load target settings via yq (with fallback constants applied)
TARGET_REPO="$(yq -r '.target.repo // ""' "$CONFIG_FILE")"
TARGET_BRANCH="$(yq -r '.target.branch // ""' "$CONFIG_FILE")"
TARGET_PR_BRANCH="$(yq -r '.target.pr_branch // ""' "$CONFIG_FILE")"
TARGET_SYNC_DIR="$(yq -r '.target.sync_dir // ""' "$CONFIG_FILE")"

TARGET_BRANCH="${TARGET_BRANCH:-$DEFAULT_BRANCH}"
TARGET_PR_BRANCH="${TARGET_PR_BRANCH:-$DEFAULT_PR_BRANCH}"
TARGET_SYNC_DIR="${TARGET_SYNC_DIR:-$DEFAULT_SYNC_DIR}"

# Load configured source component aliases
ALL_ALIASES=()
while IFS= read -r alias_name; do
  [[ -n "$alias_name" ]] && ALL_ALIASES+=("$alias_name")
done < <(yq -r '.sources[].alias // ""' "$CONFIG_FILE")

[[ ${#ALL_ALIASES[@]} -gt 0 ]] || exit_with_error "No sources defined in $CONFIG_FILE"
[[ -n "$TARGET_REPO" ]] || exit_with_error "Missing target.repo in $CONFIG_FILE"

# A scalar `excludes` would silently drop all protections from rsync --delete.
bad_excludes="$(yq -r '[.target] + .sources | .[] | select(.excludes != null and (.excludes | tag) != "!!seq") | .alias // "target"' "$CONFIG_FILE")"
[[ -z "$bad_excludes" ]] \
  || exit_with_error "'excludes' must be a YAML list (${bad_excludes//$'\n'/, }) in $CONFIG_FILE"

TARGET_EXCLUDES=()
while IFS= read -r ex; do
  [[ -n "$ex" ]] && TARGET_EXCLUDES+=("$ex")
done < <(yq -r '.target.excludes[]? // ""' "$CONFIG_FILE")

# Helper: query a source entry in CONFIG_FILE by component alias via strenv()
src_field() {
  local comp="$1"
  local expr="$2"
  COMP="$comp" yq -r ".sources[] | select(.alias == strenv(COMP)) | ${expr}" "$CONFIG_FILE"
}

src_excludes() {
  local comp="$1"
  COMP="$comp" yq -r '.sources[] | select(.alias == strenv(COMP)) | .excludes[]? // ""' "$CONFIG_FILE"
}

# Usage: require_branch_name <name> <description for error message>
require_branch_name() {
  if [[ "$1" == -* ]] || ! git check-ref-format --branch "$1" >/dev/null 2>&1; then
    exit_with_error "Invalid $2: '$1'"
  fi
}

BASE_BRANCH="${CLI_BASE_BRANCH:-$TARGET_BRANCH}"
require_branch_name "$BASE_BRANCH" "base branch name"

if [[ -n "$CLI_BRANCH" ]]; then
  require_branch_name "$CLI_BRANCH" "branch name"
fi

# Resolve selected component aliases (preserving config order)
SELECTED_COMPONENTS=()
if [[ ${#COMPONENTS_RAW[@]} -eq 0 ]]; then
  SELECTED_COMPONENTS=("${ALL_ALIASES[@]}")
else
  WANT_COMP=()
  for i in "${!ALL_ALIASES[@]}"; do
    WANT_COMP[i]=0
  done

  for raw in "${COMPONENTS_RAW[@]}"; do
    [[ -n "$raw" ]] || exit_with_error "Empty --component value"
    IFS=',' read -r -a parts <<< "$raw"
    [[ ${#parts[@]} -gt 0 ]] || exit_with_error "Empty --component value"
    for part in "${parts[@]}"; do
      part="$(printf '%s' "$part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
      [[ -n "$part" ]] || exit_with_error "Empty --component value"
      if [[ "$part" == "all" ]]; then
        for i in "${!ALL_ALIASES[@]}"; do
          WANT_COMP[i]=1
        done
      else
        resolved="$(PART="$part" yq -r \
          '.sources[] | select(.alias == strenv(PART) or .repo == strenv(PART) or (.repo | sub("^.*/", "")) == strenv(PART)) | .alias' \
          "$CONFIG_FILE")"
        if [[ -z "$resolved" ]]; then
          valid_aliases="$(printf '%s, ' "${ALL_ALIASES[@]}")"
          exit_with_error "Unknown component '$part' (expected: all, ${valid_aliases%, })"
        fi
        for i in "${!ALL_ALIASES[@]}"; do
          if [[ "${ALL_ALIASES[$i]}" == "$resolved" ]]; then
            WANT_COMP[i]=1
          fi
        done
      fi
    done
  done

  for i in "${!ALL_ALIASES[@]}"; do
    if [[ ${WANT_COMP[$i]} -eq 1 ]]; then
      SELECTED_COMPONENTS+=("${ALL_ALIASES[$i]}")
    fi
  done
fi

[[ ${#SELECTED_COMPONENTS[@]} -gt 0 ]] || exit_with_error "No components selected"

if [[ -n "$CLI_PR_BRANCH" ]]; then
  PR_BRANCH="$CLI_PR_BRANCH"
elif [[ ${#SELECTED_COMPONENTS[@]} -eq 1 ]]; then
  PR_BRANCH="sync/${SELECTED_COMPONENTS[0]}"
else
  PR_BRANCH="$TARGET_PR_BRANCH"
fi
require_branch_name "$PR_BRANCH" "PR branch name"

git -C "$PORTAL_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || exit_with_error "Target directory is not a Git repository: $PORTAL_DIR"

TARGET_SYNC_REL="$(normalize_rel_path "$TARGET_SYNC_DIR")"
TARGET_SYNC_GIT_PATH="${TARGET_SYNC_REL:-.}"

if [[ -n "$TARGET_SYNC_REL" ]]; then
  [[ -d "$PORTAL_DIR/$TARGET_SYNC_REL" ]] \
    || exit_with_error "Target repository has no '$TARGET_SYNC_REL/' directory: $PORTAL_DIR/$TARGET_SYNC_REL"
fi

# Normalized target_dir per configured alias (parallel to ALL_ALIASES). Every
# target_dir must live under target.sync_dir, which bounds staging and commits.
COMP_DST_RELS=()
for alias_name in "${ALL_ALIASES[@]}"; do
  cfg_dst_dir="$(src_field "$alias_name" '.target_dir // ""')"
  dst_rel="$(normalize_rel_path "${cfg_dst_dir:-$DEFAULT_SYNC_DIR}")"
  if [[ -n "$TARGET_SYNC_REL" && "$dst_rel" != "$TARGET_SYNC_REL" && "$dst_rel" != "$TARGET_SYNC_REL"/* ]]; then
    exit_with_error "Component '$alias_name' target_dir '${dst_rel:-/}' is outside target.sync_dir '$TARGET_SYNC_REL'"
  fi
  COMP_DST_RELS+=("$dst_rel")
done

component_dst_rel() {
  local i
  for i in "${!ALL_ALIASES[@]}"; do
    if [[ "${ALL_ALIASES[$i]}" == "$1" ]]; then
      printf '%s' "${COMP_DST_RELS[$i]}"
      return 0
    fi
  done
  return 1
}

# Git pathspecs bounding staging, commits, and resets to selected components.
SELECTED_DST_PATHS=()
for comp in "${SELECTED_COMPONENTS[@]}"; do
  dst_rel="$(component_dst_rel "$comp")"
  SELECTED_DST_PATHS+=("${dst_rel:-.}")
done
for other in "${COMP_DST_RELS[@]}"; do
  [[ -n "$other" ]] || continue
  for sel in "${SELECTED_DST_PATHS[@]}"; do
    [[ "$sel" == "$other" ]] && continue 2
  done
  for sel in "${SELECTED_DST_PATHS[@]}"; do
    if [[ "$sel" == "." || "$other" == "$sel"/* ]]; then
      SELECTED_DST_PATHS+=(":(exclude)$other")
      break
    fi
  done
done

if [[ -z "$LOCAL_ROOT" ]]; then
  LOCAL_ROOT="$(cd "$PORTAL_DIR/.." && pwd)"
else
  LOCAL_ROOT="$(cd "$LOCAL_ROOT" && pwd)"
fi

if [[ $ALLOW_DIRTY -eq 0 && $DRY_RUN -eq 0 ]]; then
  dirty_status="$(git -C "$PORTAL_DIR" status --porcelain -- "$TARGET_SYNC_GIT_PATH")"
  if [[ -n "$dirty_status" ]]; then
    exit_with_error "Target '$TARGET_SYNC_GIT_PATH' has uncommitted changes. Commit, stash, or pass --allow-dirty."
  fi
fi

# Resolve the base commit for --commit/--create-pr and --dry-run. Prefer a
# freshly fetched origin/BASE_BRANCH so results never build on a stale local
# branch; fall back to the local branch when origin is unavailable.
BASE_COMMIT=""
if [[ $DO_COMMIT -eq 1 || $DRY_RUN -eq 1 ]]; then
  if git -C "$PORTAL_DIR" remote get-url origin >/dev/null 2>&1 \
     && git -C "$PORTAL_DIR" fetch --quiet origin \
          "+refs/heads/$BASE_BRANCH:refs/remotes/origin/$BASE_BRANCH" 2>/dev/null; then
    BASE_COMMIT="$(git -C "$PORTAL_DIR" rev-parse "refs/remotes/origin/$BASE_BRANCH^{commit}")"
  elif BASE_COMMIT="$(git -C "$PORTAL_DIR" rev-parse --verify --quiet "refs/heads/$BASE_BRANCH^{commit}" \
                   || git -C "$PORTAL_DIR" rev-parse --verify --quiet "refs/remotes/origin/$BASE_BRANCH^{commit}")"; then
    info "Could not fetch origin/$BASE_BRANCH; using local '$BASE_BRANCH'."
  else
    exit_with_error "Base branch '$BASE_BRANCH' not found on origin or locally in $PORTAL_DIR"
  fi
fi

if [[ $DO_COMMIT -eq 1 ]]; then
  info "Resetting branch '$PR_BRANCH' to base '$BASE_BRANCH' (${BASE_COMMIT:0:7}) in $PORTAL_DIR..."
  git -C "$PORTAL_DIR" checkout --quiet -B "$PR_BRANCH" "$BASE_COMMIT"
fi

# Create isolated temporary workspace
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/brain-portal-sync.XXXXXX")"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

# In dry-run mode, preview in a temporary clone checked out at the base commit
# so the real checkout is never modified while still producing exact git diffs.
WORK_PORTAL="$PORTAL_DIR"
if [[ $DRY_RUN -eq 1 ]]; then
  WORK_PORTAL="$TMP_ROOT/portal-preview"
  git clone --quiet --shared --no-checkout "$PORTAL_DIR" "$WORK_PORTAL"
  git -C "$WORK_PORTAL" checkout --quiet --detach "$BASE_COMMIT"
fi

# Helper: run git fetch with optional token auth header (never persisted).
# The header is passed via GIT_CONFIG_* environment variables (Git >= 2.31)
# rather than `-c` so the token does not appear in process listings.
git_fetch_source() {
  local bare_repo="$1"
  local remote_ref="$2"
  local branch="$3"
  local token="${BRAIN_DEV_REPO_TOKEN:-${GH_TOKEN:-${GITHUB_TOKEN:-}}}"

  if [[ "$SOURCE_MODE" == "remote" && -n "$token" && "$remote_ref" == https://github.com/* ]]; then
    local basic_auth
    basic_auth="$(printf 'x-access-token:%s' "$token" | base64 | tr -d '\r\n')"
    GIT_CONFIG_COUNT=1 \
      GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
      GIT_CONFIG_VALUE_0="AUTHORIZATION: basic ${basic_auth}" \
      git --git-dir="$bare_repo" fetch --quiet --depth=1 "$remote_ref" "$branch"
  else
    git --git-dir="$bare_repo" fetch --quiet --depth=1 "$remote_ref" "$branch"
  fi
}

# Sync a staged component directory into WORK_PORTAL based on config
sync_component_files() {
  local comp="$1"
  local stage_dir="$2"
  local dst_rel="$3"
  local cfg_src_dir
  local src_rel
  cfg_src_dir="$(src_field "$comp" '.source_dir // ""')"
  src_rel="$(normalize_rel_path "${cfg_src_dir:-$DEFAULT_SYNC_DIR}")"

  local src_dir="$stage_dir${src_rel:+/$src_rel}"
  local dst_dir="$WORK_PORTAL${dst_rel:+/$dst_rel}"

  [[ -d "$src_dir" ]] \
    || exit_with_error "Component '$comp' source does not contain '${src_rel:-/}'"
  mkdir -p "$dst_dir"

  # Build rsync exclude flags from target.excludes + source.excludes (+ /.git)
  local rsync_excludes=("--exclude=/.git")
  local ex
  if [[ ${#TARGET_EXCLUDES[@]} -gt 0 ]]; then
    for ex in "${TARGET_EXCLUDES[@]}"; do
      [[ -n "$ex" ]] && rsync_excludes+=("--exclude=$ex")
    done
  fi
  while IFS= read -r ex; do
    [[ -n "$ex" ]] && rsync_excludes+=("--exclude=$ex")
  done < <(src_excludes "$comp")

  # Protect other components' target_dirs nested under this one from --delete.
  local other
  for other in "${COMP_DST_RELS[@]}"; do
    if [[ -z "$dst_rel" && -n "$other" ]]; then
      rsync_excludes+=("--exclude=/$other")
    elif [[ -n "$dst_rel" && "$other" == "$dst_rel"/* ]]; then
      rsync_excludes+=("--exclude=/${other#"$dst_rel"/}")
    fi
  done

  # Use -rpt (no -l) so symlinks are skipped on both macOS openrsync and
  # GNU rsync. Excluded paths are protected from deletion on the destination.
  rsync -rpt --delete "${rsync_excludes[@]}" "$src_dir/" "$dst_dir/"
}

# Resolve local sibling path for a component
resolve_local_repo_path() {
  local comp="$1"
  local cfg_local
  local repo_full
  cfg_local="$(src_field "$comp" '.local_path // ""')"
  repo_full="$(src_field "$comp" '.repo // ""')"
  local repo_short="${repo_full##*/}"

  if [[ -z "$cfg_local" ]]; then
    printf '%s/%s' "$LOCAL_ROOT" "$repo_short"
  elif [[ "$cfg_local" == /* ]]; then
    printf '%s' "$cfg_local"
  elif [[ "$cfg_local" == ../* ]]; then
    printf '%s/%s' "$LOCAL_ROOT" "${cfg_local#../}"
  else
    printf '%s/%s' "$PORTAL_DIR" "$cfg_local"
  fi
}

# Per-component tracking arrays
COMP_NAMES=()
COMP_REPOS=()
COMP_BRANCHES=()
COMP_SHAS=()
COMP_SHORT_SHAS=()
COMP_CHANGED=()
COMP_DIFF_STATS=()
CHANGED_COMPONENTS=()

for comp in "${SELECTED_COMPONENTS[@]}"; do
  repo_full="$(src_field "$comp" '.repo // ""')"
  cfg_branch="$(src_field "$comp" '.branch // ""')"
  cfg_src_dir="$(src_field "$comp" '.source_dir // ""')"
  src_branch="${CLI_BRANCH:-${cfg_branch:-$DEFAULT_BRANCH}}"
  src_rel="$(normalize_rel_path "${cfg_src_dir:-$DEFAULT_SYNC_DIR}")"
  comp_dst_rel="$(component_dst_rel "$comp")"
  stage_dir="$TMP_ROOT/stage-$comp"
  mkdir -p "$stage_dir"

  require_branch_name "$src_branch" "source branch for component '$comp'"

  full_sha="worktree"
  short_sha="worktree"
  prev_tree="$(git -C "$WORK_PORTAL" write-tree)"

  if [[ "$SOURCE_MODE" == "worktree" ]]; then
    src_repo="$(resolve_local_repo_path "$comp")"
    [[ -d "$src_repo" ]] || exit_with_error "Local sibling repository not found: $src_repo"
    git -C "$src_repo" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      || exit_with_error "Local sibling directory is not a Git repository: $src_repo"
    info "Scanning $comp ($repo_full worktree: $src_repo/${src_rel:-.})..."
    if git -C "$src_repo" rev-parse HEAD >/dev/null 2>&1; then
      full_sha="$(git -C "$src_repo" rev-parse HEAD)"
      short_sha="$(git -C "$src_repo" rev-parse --short=7 HEAD)"
    fi
    # Copy only tracked and untracked-but-not-ignored regular files so that
    # git-ignored local artifacts and symlinks are never published.
    files_list="$TMP_ROOT/files-$comp.lst"
    git -C "$src_repo" ls-files -z -c -o --exclude-standard -- "${src_rel:-.}" > "$files_list"
    while IFS= read -r -d '' f; do
      [[ -f "$src_repo/$f" && ! -L "$src_repo/$f" ]] || continue
      mkdir -p "$stage_dir/$(dirname "$f")"
      cp -p "$src_repo/$f" "$stage_dir/$f"
    done < "$files_list"
    sync_component_files "$comp" "$stage_dir" "$comp_dst_rel"
  else
    bare_dir="$TMP_ROOT/bare-$comp.git"
    git init --bare --quiet "$bare_dir"

    if [[ "$SOURCE_MODE" == "local" ]]; then
      remote_url="$(resolve_local_repo_path "$comp")"
      [[ -d "$remote_url" ]] \
        || exit_with_error "Local sibling repository not found: $remote_url"
      info "Fetching $comp ($src_branch) from local repo $remote_url..."
    else
      remote_url="https://github.com/${repo_full}.git"
      info "Fetching $comp ($src_branch) from ${repo_full}..."
    fi

    git_fetch_source "$bare_dir" "$remote_url" "$src_branch"

    full_sha="$(git --git-dir="$bare_dir" rev-parse FETCH_HEAD)"
    short_sha="$(git --git-dir="$bare_dir" rev-parse --short=7 FETCH_HEAD)"

    if [[ -n "$src_rel" ]]; then
      git --git-dir="$bare_dir" archive FETCH_HEAD "$src_rel" | tar -x -C "$stage_dir"
    else
      git --git-dir="$bare_dir" archive FETCH_HEAD | tar -x -C "$stage_dir"
    fi
    sync_component_files "$comp" "$stage_dir" "$comp_dst_rel"
  fi

  # Stage this component's target_dir (excluding nested components) and compare
  # against the pre-component index snapshot so each component reports only its
  # own changes.
  git_add_specs=("${comp_dst_rel:-.}")
  for other in "${COMP_DST_RELS[@]}"; do
    if [[ -z "$comp_dst_rel" && -n "$other" ]] || [[ -n "$comp_dst_rel" && "$other" == "$comp_dst_rel"/* ]]; then
      git_add_specs+=(":(exclude)$other")
    fi
  done
  git -C "$WORK_PORTAL" add -A -- "${git_add_specs[@]}"
  comp_status="$(git -C "$WORK_PORTAL" diff-index --cached --name-status "$prev_tree")"

  COMP_NAMES+=("$comp")
  COMP_REPOS+=("$repo_full")
  COMP_BRANCHES+=("$src_branch")
  COMP_SHAS+=("$full_sha")
  COMP_SHORT_SHAS+=("$short_sha")

  if [[ -n "$comp_status" ]]; then
    COMP_CHANGED+=("1")
    COMP_DIFF_STATS+=("$comp_status")
    CHANGED_COMPONENTS+=("$comp")
    info "Detected changes in $comp ($repo_full@$short_sha)."
  else
    COMP_CHANGED+=("0")
    COMP_DIFF_STATS+=("")
    info "No changes in $comp ($repo_full@$short_sha)."
  fi
done

TOTAL_CHANGED="${#CHANGED_COMPONENTS[@]}"

# Build commit title & Markdown report
if [[ ${#SELECTED_COMPONENTS[@]} -eq 1 ]]; then
  comp_name="${COMP_NAMES[0]}"
  repo_full="${COMP_REPOS[0]}"
  COMMIT_TITLE="chore(sync): update ${comp_name} from ${repo_full}"
else
  COMMIT_TITLE="chore(sync): update ${TARGET_REPO##*/} from dev repositories"
fi

REPORT_TMP="$TMP_ROOT/sync-report.md"
# Backticks in the printf formats below are literal Markdown code spans.
# shellcheck disable=SC2016
{
  printf '## BRAIN Portal Synchronization\n\n'
  if [[ $TOTAL_CHANGED -eq 0 ]]; then
    printf 'All scanned component repositories are already in sync with `%s` (`%s`).\n\n' \
      "$TARGET_REPO" "$TARGET_SYNC_DIR"
  else
    printf 'Automated synchronization of publishable assets from the BRAIN dev repositories into `%s` (`%s`).\n\n' \
      "$TARGET_REPO" "$TARGET_SYNC_DIR"
  fi

  printf '| Component | Source Repository | Branch | Upstream Commit | Status |\n'
  printf '|:---|:---|:---|:---|:---|\n'
  for i in "${!COMP_NAMES[@]}"; do
    comp="${COMP_NAMES[$i]}"
    repo_full="${COMP_REPOS[$i]}"
    branch_name="${COMP_BRANCHES[$i]}"
    sha="${COMP_SHAS[$i]}"
    short="${COMP_SHORT_SHAS[$i]}"
    if [[ "${COMP_CHANGED[$i]}" == "1" ]]; then
      status_label="**Changed**"
    else
      status_label="Up to date"
    fi
    if [[ "$SOURCE_MODE" == "remote" && "$sha" != "worktree" ]]; then
      sha_cell="[\`${short}\`](https://github.com/${repo_full}/commit/${sha})"
    else
      sha_cell="\`${short}\`"
    fi
    printf '| `%s` | `%s` | `%s` | %s | %s |\n' \
      "$comp" "$repo_full" "$branch_name" "$sha_cell" "$status_label"
  done

  if [[ $TOTAL_CHANGED -gt 0 ]]; then
    printf '\n### Changed Files by Component\n'
    for i in "${!COMP_NAMES[@]}"; do
      if [[ "${COMP_CHANGED[$i]}" == "1" ]]; then
        printf '\n#### `%s` (`%s@%s`)\n\n```text\n%s\n```\n' \
          "${COMP_NAMES[$i]}" "${COMP_REPOS[$i]}" \
          "${COMP_SHORT_SHAS[$i]}" "${COMP_DIFF_STATS[$i]}"
      fi
    done
  fi
} > "$REPORT_TMP"

if [[ -n "$REPORT_FILE" ]]; then
  mkdir -p "$(dirname "$REPORT_FILE")"
  cp "$REPORT_TMP" "$REPORT_FILE"
  info "Wrote sync report to $REPORT_FILE"
fi

if [[ -n "$TITLE_FILE" ]]; then
  mkdir -p "$(dirname "$TITLE_FILE")"
  printf '%s\n' "$COMMIT_TITLE" > "$TITLE_FILE"
  info "Wrote commit/PR title to $TITLE_FILE"
fi

if [[ -n "$SYNC_PATH_FILE" ]]; then
  mkdir -p "$(dirname "$SYNC_PATH_FILE")"
  printf '%s\n' "$TARGET_SYNC_GIT_PATH" > "$SYNC_PATH_FILE"
fi

printf '\n'
cat "$REPORT_TMP"
printf '\n'

# If not dry-run and not committing, leave changes unstaged in the working tree
# so `git diff` works naturally for interactive inspection (and GitHub Actions
# steps like peter-evans/create-pull-request@v8).
if [[ $DRY_RUN -eq 0 && $DO_COMMIT -eq 0 && $TOTAL_CHANGED -gt 0 ]]; then
  git -C "$PORTAL_DIR" reset --quiet HEAD -- "${SELECTED_DST_PATHS[@]}"
fi

if [[ $DRY_RUN -eq 1 ]]; then
  info "Dry-run complete ($TOTAL_CHANGED component(s) have pending changes)."
  exit 0
fi

if [[ $TOTAL_CHANGED -eq 0 ]]; then
  info "Target '$TARGET_SYNC_DIR' is already up to date. Nothing to commit or open a PR for."
  exit 0
fi

if [[ $DO_COMMIT -eq 1 ]]; then
  # Selected components' target_dirs were already staged during the scan.
  git -C "$PORTAL_DIR" commit --quiet \
    -m "$COMMIT_TITLE" -m "$(cat "$REPORT_TMP")" -- "${SELECTED_DST_PATHS[@]}"
  info "Committed changes on branch '$PR_BRANCH': $COMMIT_TITLE"

  if [[ $CREATE_PR -eq 1 ]]; then
    command -v gh >/dev/null 2>&1 \
      || exit_with_error "GitHub CLI ('gh') is required for --create-pr"
    info "Pushing '$PR_BRANCH' to origin..."
    # The PR branch is rebuilt from BASE_BRANCH on every run, so compare trees
    # to avoid force-pushing a new commit when the content is unchanged.
    pr_tracking_ref="refs/remotes/origin/$PR_BRANCH"
    if git -C "$PORTAL_DIR" fetch --quiet origin "+refs/heads/$PR_BRANCH:$pr_tracking_ref" 2>/dev/null; then
      if [[ "$(git -C "$PORTAL_DIR" rev-parse "$pr_tracking_ref^{tree}")" \
            == "$(git -C "$PORTAL_DIR" rev-parse "HEAD^{tree}")" ]]; then
        info "origin/$PR_BRANCH already has identical content; skipping push."
      else
        git -C "$PORTAL_DIR" push --force-with-lease -u origin "$PR_BRANCH"
      fi
    else
      git -C "$PORTAL_DIR" update-ref -d "$pr_tracking_ref" 2>/dev/null || true
      git -C "$PORTAL_DIR" push --force-with-lease -u origin "$PR_BRANCH"
    fi

    existing_pr="$(gh pr list \
      --repo "$TARGET_REPO" \
      --head "$PR_BRANCH" \
      --base "$BASE_BRANCH" \
      --state open \
      --json url \
      --jq '.[0].url // empty' 2>/dev/null || true)"

    if [[ -n "$existing_pr" ]]; then
      gh pr edit "$existing_pr" \
        --title "$COMMIT_TITLE" \
        --body-file "$REPORT_TMP" >/dev/null
      info "Updated existing Pull Request: $existing_pr"
    else
      pr_url="$(gh pr create \
        --repo "$TARGET_REPO" \
        --head "$PR_BRANCH" \
        --base "$BASE_BRANCH" \
        --title "$COMMIT_TITLE" \
        --body-file "$REPORT_TMP")"
      info "Created Pull Request: $pr_url"
    fi
  fi
fi
