import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import * as path from 'node:path';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: './',
    server: {
        port: 5174,
        strictPort: true,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // No source maps in the packaged renderer: dev uses the Vite HMR
        // server (its own maps), and shipping maps only bloats the installer
        // and exposes source in a distributed desktop app.
        sourcemap: false,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@refringence/design-tokens': path.resolve(__dirname, '..', 'packages', 'design-tokens', 'src'),
        },
    },
});
