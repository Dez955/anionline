# For hosting platforms that build from a Dockerfile (Koyeb, Render, Fly ...). Build context: this folder.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
USER node
ENV HOST=0.0.0.0
EXPOSE 8000
# Set PORT on the platform if it expects a port other than 8000; set ACCESS_KEY to a long random secret.
ENV PORT=8000
CMD ["node", "server.mjs"]
