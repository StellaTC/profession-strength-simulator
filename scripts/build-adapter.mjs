import {build} from 'esbuild';
await build({entryPoints:['adapter/main.mjs'],outfile:'resources/adapter.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
