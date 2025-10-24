FROM node:18-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
