echo Running Test Script for chatServer Service
docker-compose -f docker-compose.test.yml up --build -d 
docker-compose -f docker-compose.test.yml logs -f tests
EXIT_CODE=$(docker inspect tests --format='{{.State.ExitCode}}')
docker-compose -f docker-compose.test.yml down