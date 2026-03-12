#!/bin/bash
# Shortcut for self-hosted Firecrawl
#
# Usage:
#   ./selfhost.sh up --build -d       # start with local filesystem storage
#   ./selfhost.sh down                 # stop
#   ./selfhost.sh logs -f api          # follow API logs
#   ./selfhost.sh minio up --build -d  # start with MinIO storage instead
#   ./selfhost.sh minio down           # stop MinIO variant
#   ./selfhost.sh nuke                 # stop all, remove containers, volumes, and images

set -e
cd "$(dirname "$0")"

if [ "$1" = "nuke" ]; then
  echo "Stopping and removing all selfhost containers, volumes, and images..."
  docker compose -f docker-compose.yaml -f docker-compose.selfhost-local.yaml \
    --env-file .env.selfhost down -v --rmi local 2>/dev/null || true
  docker compose -f docker-compose.yaml -f docker-compose.selfhost.yaml \
    --env-file .env.selfhost down -v --rmi local 2>/dev/null || true
  echo "Done."
elif [ "$1" = "minio" ]; then
  shift
  exec docker compose -f docker-compose.yaml -f docker-compose.selfhost.yaml \
    --env-file .env.selfhost "$@"
else
  exec docker compose -f docker-compose.yaml -f docker-compose.selfhost-local.yaml \
    --env-file .env.selfhost "$@"
fi
