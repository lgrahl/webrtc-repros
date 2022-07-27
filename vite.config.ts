import {type UserConfig} from 'vite';

export default function defineConfig(): UserConfig {
    return {
        root: process.env.VITE_ROOT,
        base: './',
        publicDir: false,
        clearScreen: false,
        build: {
            target: ['chrome104'],
            outDir: '../../build',
            emptyOutDir: true,
            assetsDir: '',
            assetsInlineLimit: 0,
            minify: false,
        },
        server: {
            port: 7844,
            force: true,
            fs: {
                strict: true,
                allow: ['.', '../node_modules'],
            },
        },
    };
}
