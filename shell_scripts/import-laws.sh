#!/bin/bash

# Copy the process-data/output_json_1 files to the Docker volume
#echo "Copying JSON files to Docker volume..."
#for file in /Users/nhanvu/Documents/AI\ engineer\ junior/process-data/output/*.json; do
#  docker cp "$file" ai-junior-app:/app/data/json/
#done

# Run the import script inside the Docker container
echo "Running import script in Docker container..."
docker exec ai-junior-app /usr/local/bin/ts-node src/graph/import-laws.ts

echo "Import process completed!"