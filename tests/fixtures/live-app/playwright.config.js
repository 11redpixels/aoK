module.exports = {
  testDir: './tests',
  timeout: 15000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: {
      executablePath: process.env.AOK_CHROME_PATH,
    },
  },
  webServer: {
    command: 'node server.js',
    port: 3100,
    reuseExistingServer: false,
    timeout: 15000,
  },
};
