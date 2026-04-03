import typescript from '@rollup/plugin-typescript'

const external = ['pdfjs-dist', '@chenglou/pretext']

export default [
  // ESM build + declarations
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/esm',
      format: 'es',
      sourcemap: true,
      preserveModules: true,
      entryFileNames: '[name].js',
    },
    external,
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        outDir: 'dist/esm',
        declaration: true,
        declarationDir: 'dist/esm',
      }),
    ],
  },
  // CJS build (no declarations needed — shared from ESM)
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      sourcemap: true,
      preserveModules: true,
      entryFileNames: '[name].cjs',
    },
    external,
    plugins: [
      typescript({
        tsconfig: './tsconfig.json',
        outDir: 'dist/cjs',
        declaration: false,
      }),
    ],
  },
]
