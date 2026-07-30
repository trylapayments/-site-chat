#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="${SITE_CHAT_TEST_DB:-site_chat_test}"
PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1)

recreate_database() {
  "${PSQL[@]}" <<EOF
DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);
CREATE DATABASE ${DB_NAME};
EOF
}

apply_migrations() {
  "${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT_DIR}/scripts/bootstrap-standalone.sql"
  "${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT_DIR}/supabase/migrations/20260730120000_create_workspace_foundation.sql"
  "${PSQL[@]}" -d "${DB_NAME}" -f "${ROOT_DIR}/supabase/seed.sql"
}

run_tests() {
  for file in "${ROOT_DIR}"/supabase/tests/database/*.sql; do
    echo "Running ${file}"
    "${PSQL[@]}" -d "${DB_NAME}" -f "${file}"
  done
}

main() {
  recreate_database
  apply_migrations
  run_tests
}

main "$@"
