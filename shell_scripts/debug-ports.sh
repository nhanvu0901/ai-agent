#!/bin/bash

# Color definitions
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Port Debugging Script${NC}"
echo "========================================"

# Check if port 3000 is open on localhost
echo -e "${YELLOW}Checking if port 3000 is open on localhost...${NC}"
if command -v nc &> /dev/null; then
    nc -zv localhost 3000
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Success! Port 3000 is open on localhost.${NC}"
    else
        echo -e "${RED}Failed! Port 3000 is not responding on localhost.${NC}"
    fi
else
    echo -e "${YELLOW}netcat not found, trying with curl...${NC}"
    curl -s http://localhost:3000 > /dev/null
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Success! Port 3000 is accessible via HTTP.${NC}"
    else
        echo -e "${RED}Failed! Port 3000 is not accessible via HTTP.${NC}"
    fi
fi

# Check Docker container status
echo -e "\n${YELLOW}Checking Docker container status...${NC}"
docker ps | grep ai-junior-app

# Check Docker container logs
echo -e "\n${YELLOW}Last 10 lines of app container logs:${NC}"
docker logs ai-junior-app --tail 10

# Check if port 3000 is exposed in the container
echo -e "\n${YELLOW}Checking exposed ports in the container...${NC}"
docker inspect --format='{{range $p, $conf := .NetworkSettings.Ports}}{{$p}} -> {{(index $conf 0).HostPort}}{{println}}{{end}}' ai-junior-app

# Try to curl the service from inside the container
echo -e "\n${YELLOW}Testing connectivity from inside the container...${NC}"
docker exec ai-junior-app curl -s http://localhost:3000/health || echo -e "${RED}Failed to connect from inside container${NC}"

echo -e "\n${YELLOW}Testing Node.js debug port...${NC}"
if command -v nc &> /dev/null; then
    nc -zv localhost 9229
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Success! Debug port 9229 is open.${NC}"
    else
        echo -e "${RED}Failed! Debug port 9229 is not responding.${NC}"
    fi
fi

echo -e "\n${GREEN}Debugging complete!${NC}"
echo "If you're still having issues, try rebuilding with:"
echo "docker-compose down --volumes --remove-orphans"
echo "docker-compose up -d --build"