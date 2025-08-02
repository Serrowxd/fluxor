const nextJest = require('next/jest')

/** @type {import('jest').Config} */
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/backend/'],
  transformIgnorePatterns: [
    'node_modules/(?!(.*\\.mjs$|react-markdown|remark|remark-.*|micromark|micromark-.*|decode-named-character-reference|character-entities|property-information|hast-.*|unist-.*|unified|bail|is-plain-obj|trough|vfile|vfile-.*|trim-lines|mdast-.*|ccount|escape-string-regexp|markdown-table|zwitch|longest-streak|comma-separated-tokens|space-separated-tokens|stringify-entities|character-entities-html4|character-entities-legacy|estree-util-attach-comments|estree-util-is-identifier-name))'
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(config)