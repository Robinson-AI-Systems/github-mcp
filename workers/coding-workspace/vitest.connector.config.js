import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'/tmp/playground-vite-cache',test:{include:['workers/coding-workspace/connector.test.js'],environment:'node',maxWorkers:1,testTimeout:15000}});
