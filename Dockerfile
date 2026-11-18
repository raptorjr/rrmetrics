FROM node:22-alpine

RUN apk add --no-cache python3 make g++ libstdc++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8459
ENV DATA_DIR=/app/data

EXPOSE 8459

CMD ["npm", "start"]
