FROM node:18-alpine AS build
WORKDIR /app

ARG VITE_API_URL=http://localhost:4000
ARG VITE_WS_URL=ws://localhost:4001

ENV NODE_ENV=production
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_WS_URL=${VITE_WS_URL}

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
