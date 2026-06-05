const fs = require('fs');
const content = fs.readFileSync('client/src/components/ProviderManager.jsx', 'utf8');

const babel = require('./client/node_modules/@babel/parser');
try {
  babel.parse(content, {
    sourceType: "module",
    plugins: ["jsx"]
  });
  console.log("Babel parser passed!");
} catch(e) {
  console.error("Syntax Error:", e.message);
  if(e.loc) {
    const lines = content.split('\n');
    const errLine = e.loc.line;
    console.log('Error around:');
    for(let i=errLine-3; i<=errLine+3; i++) {
        console.log(`${i}: ${lines[i-1]}`);
    }
  }
}
