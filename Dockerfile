FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Create minimal directory structure
RUN mkdir -p src/api src/config



# Install basic utilities for troubleshooting
RUN apk add --no-cache bash curl netcat-openbsd

# Add a health check script
RUN echo '#!/bin/sh \n\
PORT=${PORT:-3000} \n\
echo "Testing connection to localhost:$PORT..." \n\
nc -z localhost $PORT \n\
if [ $? -eq 0 ]; then \n\
  echo "✅ Success! Port $PORT is open and accepting connections." \n\
else \n\
  echo "❌ Failed! Port $PORT is not responding." \n\
fi' > /app/check-port.sh && chmod +x /app/check-port.sh

# Expose the ports
EXPOSE 3000
EXPOSE 9229

# No NODE_OPTIONS environment variable
# Instead, use a direct command that works with WebStorm

# Install nodemon and ts-node globally
RUN npm install -g nodemon ts-node

# Copy the source code
COPY . .

# Use node in debug mode with nodemon for restarting
CMD ["node", "--inspect=0.0.0.0:9229", "/usr/local/bin/nodemon", "--exec", "/usr/local/bin/ts-node", "src/index.ts"]