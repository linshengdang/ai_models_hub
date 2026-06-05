const parser = require('@babel/parser');
const code = require('fs').readFileSync('src/components/ProviderManager.jsx', 'utf8');

try {
  parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  console.log('Valid!');
} catch (e) {
  console.log(e);
}
