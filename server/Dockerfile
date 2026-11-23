FROM node:22-alpine
WORKDIR /app
COPY package.json main.mjs server.mjs zip.mjs ./
ENV NODE_ENV=production PORT=8080 LUMEN_SERVER_DATA=/data
RUN mkdir -p /data && chown node:node /data
# starts as root only to give /data (often a bind mount created by root) to the node user, then drops to it (main.mjs)
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "main.mjs"]
