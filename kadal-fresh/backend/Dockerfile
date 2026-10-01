FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4000
ENV DATABASE_PATH=/data/kadalfresh.db
ENV UPLOAD_DIR=/data/uploads

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]