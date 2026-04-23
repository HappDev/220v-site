FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY api/ ./
EXPOSE 3001
CMD ["node", "index.mjs"]
