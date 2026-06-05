echo "Status check"
curl -s http://localhost:3001/api/providers/defaults | head -c 100
