import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function workletRegistry() {
  const registryUrl = new URL('./src/worklets.ts', import.meta.url);
  const sourceFile = ts.createSourceFile(
    registryUrl.pathname,
    readFileSync(registryUrl, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'WORKLETS' || !declaration.initializer) {
        continue;
      }

      const initializer = ts.isSatisfiesExpression(declaration.initializer)
        ? declaration.initializer.expression
        : declaration.initializer;
      if (!ts.isObjectLiteralExpression(initializer)) {
        throw new Error('WORKLETS must be an object literal so Rollup can use it as the build manifest');
      }

      return initializer.properties.map((entry) => {
        if (!ts.isPropertyAssignment(entry) || !ts.isObjectLiteralExpression(entry.initializer)) {
          throw new Error('Every WORKLETS entry must be an object literal');
        }

        const nameProperty = entry.initializer.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === 'name') ||
              (ts.isStringLiteral(property.name) && property.name.text === 'name')),
        );
        if (!nameProperty || !ts.isPropertyAssignment(nameProperty) || !ts.isStringLiteral(nameProperty.initializer)) {
          throw new Error(`WORKLETS.${entry.name.getText(sourceFile)} must have a literal name`);
        }

        return nameProperty.initializer.text;
      });
    }
  }

  throw new Error('Unable to find the WORKLETS registry in src/worklets.ts');
}

const inputFiles = workletRegistry().map((name) => `src/processors/${name}.ts`);

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
