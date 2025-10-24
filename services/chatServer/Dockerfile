FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4001
EXPOSE 4001

CMD ["npm", "start"]
