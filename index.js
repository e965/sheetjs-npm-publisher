import fs from 'node:fs/promises';
import path from 'node:path';

import ora from 'ora';
import { simpleGit } from 'simple-git';

const REPOSITORY_URL = 'https://github.com/e965/sheetjs-npm-publisher';
const README_FILE = 'README.md';
const LOCAL_README_PATH = path.join(process.cwd(), README_FILE);

const NPM_PACKAGE_NAME = '@e965/xlsx';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const NPM_PACKAGE_REGISTRY_URL = new URL(NPM_PACKAGE_NAME, NPM_REGISTRY_URL)
  .href;

const SHEETJS_GIT_REPOSITORY_URL =
  'https://git.sheetjs.com/sheetjs/sheetjs.git';
const SHEETJS_PATH = 'sheetjs';
const SHEETJS_PACKAGE_PATH = path.join(SHEETJS_PATH, 'package.json');
const SHEETJS_README_PATH = path.join(SHEETJS_PATH, README_FILE);

const git = simpleGit();

let gitPackageVersion = null;
let npmPackageVersion = null;

const asyncTask = async (title, task) => {
  const spinner = ora(title).start();
  const stop = text => spinner.isSpinning && spinner.succeed(text);
  const warn = text => spinner.isSpinning && spinner.warn(text);

  await task({ log: stop, warn });
  stop('Success');
};

await asyncTask('Cloning the sheetjs repository', async () => {
  await git.clone(SHEETJS_GIT_REPOSITORY_URL, SHEETJS_PATH);
});

await asyncTask('Getting a package version from the repository', async ({ log }) => {
  const gitPackageFileContent = await fs.readFile(SHEETJS_PACKAGE_PATH);
  const gitPackage = JSON.parse(gitPackageFileContent);
  gitPackageVersion = gitPackage.version;

  log(`Success, git version = ${gitPackageVersion}`);
});

await asyncTask(
  'Getting a package version from the npm registry',
  async ({ log, warn }) => {
    try {
      const npmRegistryInfoResponse = await fetch(NPM_PACKAGE_REGISTRY_URL, {
        method: 'GET',
      });
      const npmRegistryInfo = await npmRegistryInfoResponse.json();
      npmPackageVersion = npmRegistryInfo?.['dist-tags']?.latest;
    } catch (error) {
      console.error(error);
    }

    if (!npmPackageVersion) {
      warn(
        'Failed to get a version. The package may not have been published yet',
      );
    } else {
      log(`Success, npm version = ${npmPackageVersion}`);
    }
  },
);

await asyncTask('Check versions', async ({ log }) => {
  if (gitPackageVersion === npmPackageVersion) {
    log('Versions are the same, no publishing required');
    process.exit(1);
  }
  log('Passed');
});

await asyncTask('Replacing a README file in project', async () => {
  await fs.rm(SHEETJS_README_PATH, { force: true, recursive: true });
  await fs.copyFile(LOCAL_README_PATH, SHEETJS_README_PATH);
});

await asyncTask('Patching a package.json file in project', async () => {
  const gitPackageFileContent = await fs.readFile(SHEETJS_PACKAGE_PATH);
  const gitPackage = JSON.parse(gitPackageFileContent);

  gitPackage.name = NPM_PACKAGE_NAME;
  gitPackage.repository.url = REPOSITORY_URL;

  const newFileContent = JSON.stringify(gitPackage, null, 2);
  await fs.rm(SHEETJS_PACKAGE_PATH, { force: true, recursive: true });
  await fs.writeFile(SHEETJS_PACKAGE_PATH, newFileContent, 'utf-8');
});
