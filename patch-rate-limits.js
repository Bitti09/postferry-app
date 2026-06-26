import fs from 'fs';
import path from 'path';

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walkDir(fullPath));
        } else {
            if (fullPath.endsWith('+server.ts')) {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const files = walkDir('./src/routes/api');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf-8');
    
    // Check if it has a fetch call
    if (content.includes('fetch(') && !content.includes('checkRateLimit()')) {
        // Add import
        if (!content.includes("import { checkRateLimit }")) {
            content = "import { checkRateLimit } from '$lib/server/rateLimiter';\n" + content;
        }
        
        // Add checkRateLimit before fetch
        content = content.replace(/(const|let|var)?\s*(res|response)\s*=\s*await\s+fetch\s*\(/g, "await checkRateLimit();\n\t\t$1 $2 = await fetch(");
        
        fs.writeFileSync(file, content);
        console.log(`Patched ${file}`);
    }
});
