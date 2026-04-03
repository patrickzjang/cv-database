#!/usr/bin/env bash

set -euo pipefail

REMOTE_NAME="${PHOTO_ARCHIVE_REMOTE_NAME:-b2-raw}"
BUCKET_NAME="${PHOTO_ARCHIVE_BUCKET:-}"

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone is required. Install it first."
  exit 1
fi

if [[ -z "${BUCKET_NAME}" ]]; then
  echo "Missing PHOTO_ARCHIVE_BUCKET"
  exit 1
fi

rclone lsd "${REMOTE_NAME}:"
rclone lsf "${REMOTE_NAME}:${BUCKET_NAME}" --max-depth 1
