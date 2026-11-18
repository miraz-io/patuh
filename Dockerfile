# Patuh needs Node 24+ (built-in SQLite). tsx runs the TypeScript server, so dev dependencies stay installed.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Inside a container the app must listen on all interfaces; publish the port only to localhost or behind an HTTPS proxy.
ENV PATUH_HOST=0.0.0.0 PATUH_PORT=8080 PATUH_DB=/data/patuh.db
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
