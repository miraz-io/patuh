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
CMD ["npm", "start"]
