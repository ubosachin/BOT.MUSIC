FROM node:20-slim

# Install system dependencies for voice support and building native modules
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies (only production if needed, but we need dev for build steps sometimes)
RUN npm install

# Copy the rest of the application
COPY . .

# Expose the port used by the dashboard
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
