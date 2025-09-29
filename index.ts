import fs from 'node:fs/promises';
import path from 'node:path';

import ora from 'ora';
import semver from 'semver';
import { simpleGit } from 'simple-git';

const REPOSITORY_URL = 'https://github.com/e965/sheetjs-npm-publisher';
const README_FILE = 'README.md';
const LOCAL_README_PATH = path.join(process.cwd(), README_FILE);

const NPM_PACKAGE_NAME = '@e965/xlsx';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const NPM_PACKAGE_REGISTRY_URL = new URL(NPM_PACKAGE_NAME, NPM_REGISTRY_URL).href;

const SHEETJS_GIT_REPOSITORY_URL = 'https://git.sheetjs.com/sheetjs/sheetjs.git';
const SHEETJS_PATH = 'sheetjs';
const SHEETJS_PACKAGE_PATH = path.join(SHEETJS_PATH, 'package.json');
const SHEETJS_README_PATH = path.join(SHEETJS_PATH, README_FILE);

const git = simpleGit();

let latestTagName: string | null = null;
let taggedVersion: string | null = null;
let npmPackageVersion: string | null = null;

type Logger = (text: string) => void;
type Task = (context: { log: Logger; warn: Logger; fail: Logger }) => Promise<void>;
const asyncTask = async (title: string, task: Task) => {
	const spinner = ora(title).start();
	const stop: Logger = text => {
		spinner.isSpinning && spinner.succeed(`${title}: ${text}`);
	};
	const warn: Logger = text => {
		spinner.isSpinning && spinner.warn(`${title}: ${text}`);
	};
	const fail: Logger = text => {
		spinner.isSpinning && spinner.fail(`${title}: ${text}`);
	};

	await task({ log: stop, warn, fail });
	stop('Success');
};

await asyncTask('Get Latest tag', async ({ log, fail }) => {
	const listText = await git.listRemote(['--tags', '--sort=-v:refname', SHEETJS_GIT_REPOSITORY_URL]);
	const listTags = listText
		.match(/[^\r\n]+/g)
		?.map(s => s.replace(/^.*refs\/tags\//, ''))
		.filter(s => semver.valid(s.substring(1))) // check valid version
		.filter(s => /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(s)); // skip -a, -h, -i, +deno etc
	latestTagName = listTags?.[0] ?? null;
	taggedVersion = latestTagName?.substring(1) ?? null;

	if (!latestTagName) {
		fail('Invalid version');
		process.exit(1);
	}

	log(`Success, git effective latest tag name = ${latestTagName}, tagged version = ${taggedVersion}`);
});

await asyncTask('Getting a package version from the npm registry', async ({ log, fail }) => {
	try {
		const npmRegistryInfoResponse = await fetch(NPM_PACKAGE_REGISTRY_URL, {
			method: 'GET',
		});
		const npmRegistryInfo = await npmRegistryInfoResponse.json();
		npmPackageVersion = npmRegistryInfo?.['dist-tags']?.latest?.split('-')[0];
	} catch (error) {
		console.error(error);
	}

	if (!npmPackageVersion) {
		fail('Failed to get a version. The package may not have been published yet');
	} else {
		log(`Success, npm version = ${npmPackageVersion}`);
	}
});

await asyncTask('Checking versions', async ({ log, warn, fail }) => {
	if (taggedVersion === npmPackageVersion) {
		log('Versions are the same, no publishing required');
		process.exit(1);
	}
	if (!taggedVersion || !npmPackageVersion) {
		fail('One of the versions is invalid');
		process.exit(1);
	}
	if (semver.lt(taggedVersion, npmPackageVersion)) {
		warn('Version in the git repository is lower than the version in npm, no publishing required');
		process.exit(1);
	}
	log('Passed');
});

await asyncTask('Cloning the sheetjs repository', async ({ fail }) => {
	if (!latestTagName) {
		fail('Invalid latest tag name');
		process.exit(1);
	}
	await git.clone(SHEETJS_GIT_REPOSITORY_URL, SHEETJS_PATH, ['--branch', latestTagName], err => {
		if (err) {
			fail(`Failed to clone repository: ${err.message}`);
			process.exit(1);
		}
	});
});

await asyncTask('Replacing a README file in project', async () => {
	await fs.rm(SHEETJS_README_PATH, { force: true, recursive: true });
	await fs.copyFile(LOCAL_README_PATH, SHEETJS_README_PATH);
});

await asyncTask('Patching a package.json file in project', async () => {
	const gitPackageFileContent = await fs.readFile(SHEETJS_PACKAGE_PATH, 'utf-8');
	const gitPackage = JSON.parse(gitPackageFileContent);

	gitPackage.name = NPM_PACKAGE_NAME;
	gitPackage.repository.url = REPOSITORY_URL;

	const newFileContent = JSON.stringify(gitPackage, null, 2);
	await fs.rm(SHEETJS_PACKAGE_PATH, { force: true, recursive: true });
	await fs.writeFile(SHEETJS_PACKAGE_PATH, newFileContent, 'utf-8');
});
