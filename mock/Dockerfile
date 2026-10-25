# The mock collector. Build from the repo root: docker build -f mock/Dockerfile .
FROM node:22-alpine
WORKDIR /srv
COPY mock/server.mjs mock/server.mjs
COPY tracker/ tracker/
ENV PORT=4000
EXPOSE 4000
USER node
CMD ["node", "mock/server.mjs"]
