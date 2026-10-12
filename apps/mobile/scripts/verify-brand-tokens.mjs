import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const tailwind = readFileSync(join(root, 'tailwind.config.js'), 'utf-8');
const theme = readFileSync(join(root, 'constants/theme.ts'), 'utf-8');

const failures = [];
if (!tailwind.includes('700: "#C02A16"')) failures.push('tailwind coral-700 mismatch');
if (!tailwind.includes('500: "#FF5233"')) failures.push('tailwind coral-500 mismatch');
if (!theme.includes("main: '#C02A16'")) failures.push('theme primary main mismatch');
if (!theme.includes("light: '#FF5233'")) failures.push('theme primary light mismatch');

if (failures.length) {
  console.error('Brand token verification failed:', failures.join(', '));
  process.exit(1);
}
console.log('Brand tokens verified for EAS build');
