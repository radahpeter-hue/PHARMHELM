#!/usr/bin/env bash

set -euo pipefail

: "${FIREBASE_PROJECT_ID:?FIREBASE_PROJECT_ID is required}"
: "${FIRESTORE_DATABASE_ID:?FIRESTORE_DATABASE_ID is required}"

access_token=$(gcloud auth application-default print-access-token)
rules_api="https://firebaserules.googleapis.com/v1"
release_name="projects/${FIREBASE_PROJECT_ID}/releases/cloud.firestore/${FIRESTORE_DATABASE_ID}"

release_file=$(mktemp)
ruleset_file=$(mktemp)
active_rules_file=$(mktemp)
trap 'rm -f "$release_file" "$ruleset_file" "$active_rules_file"' EXIT

fetch_json() {
  local url="$1"
  local output_file="$2"
  local http_code
  local curl_status

  set +e
  http_code=$(curl \
    --retry 4 \
    --retry-all-errors \
    --retry-delay 10 \
    --silent \
    --show-error \
    --output "$output_file" \
    --write-out '%{http_code}' \
    -H "Authorization: Bearer ${access_token}" \
    "$url")
  curl_status=$?
  set -e

  if [ "$curl_status" -ne 0 ] || [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    if [ -s "$output_file" ]; then
      cat "$output_file"
    fi
    echo "::error title=Firestore rules verification unavailable::GET ${url} failed with curl status ${curl_status} and HTTP ${http_code}."
    return 10
  fi
}

fetch_json "${rules_api}/${release_name}" "$release_file"

active_ruleset=$(jq -r '.rulesetName // empty' "$release_file")
if [ -z "$active_ruleset" ]; then
  cat "$release_file"
  echo "::error title=Firestore rules verification failed::The named database release has no active ruleset."
  exit 11
fi

fetch_json "${rules_api}/${active_ruleset}" "$ruleset_file"

source_count=$(jq '[.source.files[]? | select(.name == "firestore.rules")] | length' "$ruleset_file")
if [ "$source_count" -ne 1 ]; then
  echo "::error title=Firestore rules verification failed::The active ruleset does not contain exactly one firestore.rules source file."
  exit 12
fi

jq -j '.source.files[] | select(.name == "firestore.rules") | .content' "$ruleset_file" > "$active_rules_file"

expected_hash=$(sha256sum firestore.rules | awk '{print $1}')
active_hash=$(sha256sum "$active_rules_file" | awk '{print $1}')

echo "database=${FIRESTORE_DATABASE_ID}"
echo "release=${release_name}"
echo "ruleset=${active_ruleset}"
echo "expected_sha256=${expected_hash}"
echo "active_sha256=${active_hash}"

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "ruleset=${active_ruleset}" >> "$GITHUB_OUTPUT"
  echo "expected_sha256=${expected_hash}" >> "$GITHUB_OUTPUT"
  echo "active_sha256=${active_hash}" >> "$GITHUB_OUTPUT"
fi

if [ "$active_hash" != "$expected_hash" ]; then
  echo "::error title=Firestore rules drift detected::The active named-database rules do not match firestore.rules at the deployment commit."
  exit 13
fi

echo "Active named-database Firestore rules exactly match the deployment commit."
