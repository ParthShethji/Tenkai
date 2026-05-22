import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/test/**/*.test.ts',
    '!**/test/AgentFiLending.test.ts'
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    '*.ts',
    'services/**/*.ts',
    'routes/**/*.ts'
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/test/',
    'hardhat.config.ts',
    'jest.config.ts'
  ]
};

export default config;
