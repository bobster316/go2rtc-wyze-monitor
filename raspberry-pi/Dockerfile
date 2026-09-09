FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY scripts ./scripts
COPY src ./src
COPY raspberry-pi ./raspberry-pi
USER node
EXPOSE 8765
CMD ["node", "raspberry-pi/server.js"]
