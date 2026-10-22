import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { rollupOptions: { input: { index: 'index.html', popup: 'popup.html', background: 'src/background.ts', content: 'src/content.ts' }, output: { entryFileNames: chunk => chunk.name === 'background' || chunk.name === 'content' ? '[name].js' : 'assets/[name]-[hash].js' } } } });
