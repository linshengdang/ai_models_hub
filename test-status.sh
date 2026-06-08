echo "Status check"
curl -s http://localhost:5173/api/providers/defaults | head -c 100
