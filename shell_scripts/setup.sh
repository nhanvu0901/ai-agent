#!/bin/bash

# Setup script for AI Junior project

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}AI Junior Setup Script${NC}"
echo "========================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed.${NC}"
    echo "Please install Docker before continuing."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Error: docker-compose is not installed.${NC}"
    echo "Please install docker-compose before continuing."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file from template...${NC}"
    cp .env.example .env
    echo -e "${GREEN}Created .env file. Please edit it to add your OpenAI API key.${NC}"
else
    echo -e "${GREEN}.env file already exists.${NC}"
fi

# Create necessary directories
echo -e "${YELLOW}Creating necessary directories...${NC}"
mkdir -p data/pdfs data/json data/uploads src/extractors src/api/routes src/graph src/vector src/agent src/config
echo -e "${GREEN}Directories created.${NC}"

# Start Neo4j and Qdrant services
echo -e "${YELLOW}Starting Neo4j and Qdrant services...${NC}"
docker-compose up -d neo4j qdrant
echo -e "${GREEN}Services started.${NC}"

# Check if services are running
echo -e "${YELLOW}Checking services...${NC}"
sleep 5
if docker-compose ps neo4j | grep -q "Up"; then
    echo -e "${GREEN}Neo4j is running.${NC}"
else
    echo -e "${RED}Error: Neo4j failed to start.${NC}"
fi

if docker-compose ps qdrant | grep -q "Up"; then
    echo -e "${GREEN}Qdrant is running.${NC}"
else
    echo -e "${RED}Error: Qdrant failed to start.${NC}"
fi

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Neo4j Browser: http://localhost:7474/browser/"
echo "Qdrant API: http://localhost:6333/"
echo ""
echo "Next steps:"
echo "1. Edit the .env file to add your OpenAI API key"
echo "2. Build and start the application with: docker-compose up --build app"
echo "3. Visit http://localhost:3000/documentation for the API documentation"
echo ""