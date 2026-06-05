const fs = require('fs');
let code = fs.readFileSync('generate_pm_main.cjs', 'utf8');
code = code.replace(/const suffix = '\\n  \);\\n}\\n\\n\/\* ===== Custom Provider Form ===== \*\/' \+ suffixParts\[1\];/, "const suffix = '\\n      </div>\\n    </div>\\n  );\\n}\\n\\n/* ===== Custom Provider Form ===== */' + suffixParts[1];");
fs.writeFileSync('generate_pm_main.cjs', code);
