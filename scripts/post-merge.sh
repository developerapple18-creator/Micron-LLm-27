#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Schema changes are applied explicitly through the SQL migration runner.
pnpm --filter @workspace/db test
