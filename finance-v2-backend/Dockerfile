FROM node:22-bookworm-slim
WORKDIR /app
COPY finance-v2-backend/package*.json ./finance-v2-backend/
RUN cd finance-v2-backend && npm ci --omit=dev
COPY finance-v2-backend ./finance-v2-backend
COPY src/services ./src/services
COPY src/utils ./src/utils
WORKDIR /app/finance-v2-backend
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
