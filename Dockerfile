# Use the Node.js 20 Alpine runtime to minimize attack surface and avoid high/critical vulnerabilities
FROM node:20-alpine

# Create and set the working directory
WORKDIR /usr/src/app

# Install dependencies securely
COPY package*.json ./
RUN npm ci --only=production

# Bundle application source code into the container
COPY . .

# Map the PORT environment variable strictly required by GCP Cloud Run
ENV PORT=8080
EXPOSE 8080

# Disable npm telemetry in production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# Launch the microservice stateless gateway
CMD ["node", "api/server.js"]