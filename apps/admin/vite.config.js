import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    base: '/admin/',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@vibress/studio-core': path.resolve(__dirname, '../../packages/studio-core/src/index.ts'),
            '@vibress/studio-utils': path.resolve(__dirname, '../../packages/studio-utils/src/index.ts'),
            '@vibress/studio-nodes': path.resolve(__dirname, '../../packages/studio-nodes/src/index.ts'),
            '@vibress/studio-transforms': path.resolve(__dirname, '../../packages/studio-transforms/src/index.ts'),
            '@vibress/studio-cards': path.resolve(__dirname, '../../packages/studio-cards/src/index.ts'),
            '@vibress/studio-serializer': path.resolve(__dirname, '../../packages/studio-serializer/src/index.ts'),
            '@vibress/studio-renderer': path.resolve(__dirname, '../../packages/studio-renderer/src/index.ts'),
            '@vibress/studio-html': path.resolve(__dirname, '../../packages/studio-html/src/index.ts'),
            '@vibress/studio-markdown': path.resolve(__dirname, '../../packages/studio-markdown/src/index.ts'),
            '@vibress/studio-plugin-sdk': path.resolve(__dirname, '../../packages/studio-plugin-sdk/src/index.ts'),
            '@vibress/studio-react': path.resolve(__dirname, '../../packages/studio-react/src/index.ts'),
        },
    },
    server: {
        port: process.env.ADMIN_PORT ? parseInt(process.env.ADMIN_PORT) : 7779,
        host: '0.0.0.0'
    }
});
