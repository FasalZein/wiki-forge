#!/bin/bash
# AlphaXiv Paper Lookup
# Fetches AI-generated structured summaries of arxiv papers
# Endpoints: /overview/{id}.md, /abs/{id}.md

set -euo pipefail

readonly BASE_URL="https://alphaxiv.org"
readonly MAX_RETRIES=2
readonly RETRY_DELAY=2

# Extract paper ID from various input formats
extract_paper_id() {
    local input="$1"

    # arxiv.org URL: https://arxiv.org/abs/2301.12345 or https://arxiv.org/pdf/2301.12345
    if [[ "$input" =~ arxiv\.org/(abs|pdf)/([0-9]+\.[0-9]+)(v[0-9]+)? ]]; then
        echo "${BASH_REMATCH[2]}"
        return
    fi

    # alphaxiv.org URL: https://alphaxiv.org/abs/2301.12345
    if [[ "$input" =~ alphaxiv\.org/(abs|overview)/([0-9]+\.[0-9]+) ]]; then
        echo "${BASH_REMATCH[2]}"
        return
    fi

    # Raw paper ID: 2301.12345 or 2301.12345v2
    if [[ "$input" =~ ^([0-9]+\.[0-9]+)(v[0-9]+)?$ ]]; then
        echo "${BASH_REMATCH[1]}"
        return
    fi

    echo ""
}

do_fetch() {
    local url="$1"
    local attempt=0

    while [[ $attempt -lt $MAX_RETRIES ]]; do
        local http_code response
        response=$(curl -sSL -w "%{http_code}" --max-time 30 "$url" 2>/dev/null) || true
        http_code="${response: -3}"
        response="${response%???}"

        case "$http_code" in
            200)
                if [[ -n "$response" && "$response" != "null" ]]; then
                    echo "$response"
                    return 0
                fi
                ;;
            404)
                return 1
                ;;
            429|500|502|503|504)
                attempt=$((attempt + 1))
                [[ $attempt -lt $MAX_RETRIES ]] && sleep "$RETRY_DELAY"
                ;;
            *)
                echo "ERROR: HTTP $http_code" >&2
                return 1
                ;;
        esac
    done

    echo "ERROR: Failed after $MAX_RETRIES retries" >&2
    return 1
}

# Get structured overview of a paper
cmd_overview() {
    local input="${1:-}"

    if [[ -z "$input" ]]; then
        echo "Usage: alphaxiv.sh overview <paper-id-or-url>"
        echo "Example: alphaxiv.sh overview 2301.12345"
        echo "Example: alphaxiv.sh overview https://arxiv.org/abs/2301.12345"
        exit 1
    fi

    local paper_id
    paper_id=$(extract_paper_id "$input")

    if [[ -z "$paper_id" ]]; then
        echo "ERROR: Could not extract paper ID from: $input" >&2
        echo "Accepted formats: 2301.12345, https://arxiv.org/abs/2301.12345, https://alphaxiv.org/abs/2301.12345" >&2
        exit 1
    fi

    # Try overview first (structured summary)
    local response
    if response=$(do_fetch "${BASE_URL}/overview/${paper_id}.md"); then
        echo "$response"
        return 0
    fi

    # Fall back to abs (full text)
    echo "Overview not available, trying full text..." >&2
    if response=$(do_fetch "${BASE_URL}/abs/${paper_id}.md"); then
        echo "$response"
        return 0
    fi

    echo "ERROR: Paper $paper_id not found on AlphaXiv." >&2
    echo "Try: https://arxiv.org/abs/$paper_id" >&2
    exit 1
}

# Search for papers (uses exa under the hood with research paper category)
cmd_search() {
    local query="${1:-}"
    local num_results="${2:-5}"

    if [[ -z "$query" ]]; then
        echo "Usage: alphaxiv.sh search <query> [numResults]"
        echo "Example: alphaxiv.sh search \"transformer attention mechanisms\" 5"
        exit 1
    fi

    # Delegate to exa with research paper category
    # Auto-detect exa script relative to this script's location
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local skills_dir
    skills_dir="$(dirname "$(dirname "$script_dir")")"
    local exa_script="$skills_dir/exa/scripts/exa.sh"

    # Fallback: try home directory convention
    if [[ ! -x "$exa_script" ]]; then
        exa_script="${HOME}/.claude/skills/exa/scripts/exa.sh"
    fi

    if [[ -x "$exa_script" ]]; then
        "$exa_script" search "$query" "$num_results" "research paper"
    else
        echo "ERROR: Exa script not found. Searched:" >&2
        echo "  - $skills_dir/exa/scripts/exa.sh" >&2
        echo "  - ${HOME}/.claude/skills/exa/scripts/exa.sh" >&2
        exit 1
    fi
}

# Main dispatch
case "${1:-}" in
    overview|read|get)
        shift
        cmd_overview "$@"
        ;;
    search|find)
        shift
        cmd_search "$@"
        ;;
    -h|--help|help)
        cat <<'EOF'
AlphaXiv Paper Lookup

Usage:
  alphaxiv.sh overview <paper-id-or-url>    Get structured AI summary of a paper
  alphaxiv.sh search <query> [numResults]   Search for research papers (via Exa)

Input formats (for overview):
  2301.12345                              Raw paper ID
  https://arxiv.org/abs/2301.12345        Arxiv URL
  https://arxiv.org/pdf/2301.12345        Arxiv PDF URL
  https://alphaxiv.org/abs/2301.12345     AlphaXiv URL

Examples:
  alphaxiv.sh overview 2301.12345
  alphaxiv.sh overview https://arxiv.org/abs/2410.05258
  alphaxiv.sh search "large language model reasoning" 10
  alphaxiv.sh search "Elliott Wave neural network" 5

Notes:
  - Overview endpoint returns AI-structured summaries optimized for LLMs
  - Falls back to full text if overview unavailable
  - Search uses Exa's "research paper" category for academic results
  - No API key required
EOF
        ;;
    *)
        echo "Usage: alphaxiv.sh {overview|search} [args...]"
        echo "Run 'alphaxiv.sh --help' for examples"
        exit 1
        ;;
esac
