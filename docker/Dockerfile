FROM node:20-bookworm-slim
ENV NODE_ENV=production HOME=/home/superhelper DISABLE_AUTOUPDATER=1
RUN corepack enable && npm install --global @anthropic-ai/claude-code && useradd --create-home --shell /bin/bash superhelper
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
COPY docker/entrypoint.sh /usr/local/bin/super-helper-entrypoint
RUN chmod 0755 /usr/local/bin/super-helper-entrypoint && chown -R superhelper:superhelper /app /home/superhelper
USER superhelper
EXPOSE 4317
ENTRYPOINT ["super-helper-entrypoint"]
CMD ["node", "dist/cli.js", "dashboard", "--home", "/data/super-helper", "--no-open"]
