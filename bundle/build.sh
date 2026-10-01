#!/usr/bin/env sh
# Builds dist/feedback-memory.mcpb, the one-click Claude Desktop bundle (npm run bundle).
set -e
cd "$(dirname "$0")/.."
rm -rf dist/bundle && mkdir -p dist/bundle/mcp
cp bundle/manifest.json bundle/icon.png LICENSE schema.sql package.json package-lock.json dist/bundle/
cp mcp/server.mjs mcp/hash-embed.mjs dist/bundle/mcp/
(cd dist/bundle && npm ci --omit=dev --no-audit --no-fund)
npx -y @anthropic-ai/mcpb pack dist/bundle dist/feedback-memory.mcpb
