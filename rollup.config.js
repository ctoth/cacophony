import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import glob from 'glob'; // Ensure you have the 'glob' package installed

const inputFiles = glob.sync('src/processors/**/*.ts').filter((file) => {
  // exclude tests and definitions
  return !file.endsWith('.test.ts') && !file.endsWith('.d.ts');
});

const configs = inputFiles.map(inputFile => {
  const fileName = inputFile.match(/\/([^\/]+)\.ts$/)[1];
  // Convert kebab-case to camelCase for valid JS identifier
  const bundleName = fileName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

  return {
    input: inputFile,
    output: {
      file: `src/bundles/${fileName}-bundle.js`,
      format: 'iife',
      name: bundleName,
      sourcemap: true,
    },
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      commonjs(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production'),
        preventAssignment: true,
      }),
      typescript({
        tsconfig: './tsconfig.worklets.json',
      }),
    ],
  };
});

export default configs;
