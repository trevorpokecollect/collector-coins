FROM public.ecr.aws/docker/library/node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && npm cache clean --force
RUN npm remove @shopify/cli

COPY . .

RUN npm run build

# DATABASE_URL comes from the Railway Postgres service (see README)
CMD ["npm", "run", "docker-start"]
