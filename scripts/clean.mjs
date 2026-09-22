/** Remove the build output directory (the publishable extension folder). */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'extension'), { recursive: true, force: true });
console.log('cleaned extension/');
