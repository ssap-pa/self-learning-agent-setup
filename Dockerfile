# feedback-memory MCP server over stdio. The database lives in /data (mount a volume to keep it).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY schema.sql ./
COPY mcp/server.mjs mcp/hash-embed.mjs ./mcp/
ENV FEEDBACK_MEMORY_DIR=/data
ENTRYPOINT ["node", "mcp/server.mjs"]
