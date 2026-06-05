const fs = require('fs');
let code = fs.readFileSync('client/src/components/ProviderManager.jsx', 'utf8');
code = code.replace(/\\s*<\\/div>\\n\\s*<\\/div>\\n\\s*<\\/div>\\n\\s*\\);\\n}/, '\n        </div>\n      </div>\n      </div>\n      </div>\n  );\n}');
fs.writeFileSync('client/src/components/ProviderManager.jsx', code);
