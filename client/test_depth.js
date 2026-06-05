const code = require('fs').readFileSync('src/components/ProviderManager.jsx', 'utf8');
const lines = code.split('\n');
let depth = 0;
for (let i = 237; i < 415; i++) {
  let line = lines[i];
  let opens = (line.match(/<div\\b/g) || []).length;
  let closes = (line.match(/<\\/div>/g) || []).length;
  
  if (opens > 0 || closes > 0) {
    console.log(
      String(i+1).padEnd(5), 
      String(depth).padEnd(4), 
      line.trim().slice(0, 40)
    );
  }
  depth += opens - closes;
}
