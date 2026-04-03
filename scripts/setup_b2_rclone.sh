#!/usr/bin/env bash

set -euo pipefail

REMOTE_NAME="${PHOTO_ARCHIVE_REMOTE_NAME:-b2-raw}"
BUCKET_NAME="${PHOTO_ARCHIVE_BUCKET:-}"
ACCOUNT_ID="${B2_ACCOUNT_ID:-}"
APPLICATION_KEY="${B2_APPLICATION_KEY:-}"
HARD_DELETE="${B2_HARD_DELETE:-false}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required. Install it first."
  exit 1
fi

if [[ -z "${ACCOUNT_ID}" ]]; then
  echo "Missing B2_ACCOUNT_ID"
  exit 1
fi

if [[ -z "${APPLICATION_KEY}" ]]; then
  echo "Missing B2_APPLICATION_KEY"
  exit 1
fi

rclone config create "${REMOTE_NAME}" b2 \
  account "${ACCOUNT_ID}" \
  key "${APPLICATION_KEY}" \
  hard_delete "${HARD_DELETE}" \
  --obscure \
  --non-interactive

if [[ -n "${BUCKET_NAME}" ]]; then
  rclone mkdir "${REMOTE_NAME}:${BUCKET_NAME}"
fi

echo "Configured rclone remote '${REMOTE_NAME}'."
if [[ -n "${BUCKET_NAME}" ]]; then
  echo "Bucket ready at ${REMOTE_NAME}:${BUCKET_NAME}"
  echo "Example upload:"
  echo "npm run photo:ingest -- --sku SKU123 --source /absolute/path/to/raws --upload --remote ${REMOTE_NAME} --bucket ${BUCKET_NAME} --prefix \${PHOTO_ARCHIVE_PREFIX:-raw}"
else
  echo "Set PHOTO_ARCHIVE_BUCKET to auto-create the bucket."
fi
