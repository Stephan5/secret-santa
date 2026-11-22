import {build} from 'esbuild'

// Bundles the Lambda, AWS SDK and all, into one file: dist-api/index.mjs,
// which Terraform zips and deploys (handler index.handler).
await build({
    entryPoints: ['src/api/lambda.ts'],
    outfile: 'dist-api/index.mjs',
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    // (some of the SDK's dependencies are CommonJS and require() Node's own
    // modules, which an ES module bundle has to be given a require for)
    banner: {js: "import {createRequire} from 'node:module'; const require = createRequire(import.meta.url);"},
})
