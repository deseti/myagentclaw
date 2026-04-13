FROM node:24-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV HOME=/home/node

RUN mkdir -p /home/node/.openclaw && chown -R node:node /app /home/node

USER node

EXPOSE 4000

CMD ["node", "src/gateway-manager.js"]
