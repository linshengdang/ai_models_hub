async function test() {
  const API_BASE = 'http://localhost:5173/api';
  const res = await fetch(`${API_BASE}/providers/openai_codex/verify-models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': 'dddd'
    }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
test();
