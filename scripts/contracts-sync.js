const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'packages', 'contracts', 'src');
const target = path.join(root, 'supabase', 'functions', '_shared', 'contracts');

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

console.log('[contracts:sync] packages/contracts/src -> supabase/functions/_shared/contracts');
