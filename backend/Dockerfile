FROM node:20-alpine
WORKDIR /app

# Install netcat (wait-for-postgres) + openssl (Prisma requirement on Alpine)
RUN apk add --no-cache netcat-openbsd openssl

# Install semua deps (termasuk devDependencies untuk prisma generate)
COPY package.json ./
RUN npm install

COPY . .
RUN npx prisma generate

# Entrypoint script — tunggu DB siap, jalankan migrate, lalu start app
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]
