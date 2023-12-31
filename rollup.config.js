import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import replace from '@rollup/plugin-replace'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/processors/phase-vocoder.ts',

  output: {
    file: 'src/bundles/phase-vocoder-bundle.js',
    format: 'iife',
  },

  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    replace({
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    typescript(),
  ],
}