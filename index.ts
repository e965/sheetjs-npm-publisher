import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import ora from 'ora';
import semver from 'semver';

const REPOSITORY_URL = 'https://github.com/e965/sheetjs-npm-publisher';
const LOCAL_README_PATH = path.join(process.cwd(), 'README.md');

const NPM_PACKAGE_NAME = '@e965/xlsx';
const NPM_PACKAGE_REGISTRY_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}`;

const SHEETJS_CDN_URL = 'https://cdn.sheetjs.com';
const SHEETJS_PATH = 'sheetjs';

const exec = promisify(execFile);

type Logger = (text: string) => void;
const asyncTask = async (title: string, task: (log: Logger) => Promise<void>) => {
	const spinner = ora(title).start();
	let result = 'Success';
	try {
		await task(text => {
			result = text;
		});
		spinner.succeed(`${title}: ${result}`);
	} catch (error) {
		spinner.fail(`${title}: ${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
};

const fetchOk = async (url: string) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}`);
	return response;
};

let cdnVersion = '';
await asyncTask('Getting the latest version from the SheetJS CDN', async log => {
	const list = await (await fetchOk(`${SHEETJS_CDN_URL}/xlsx.lst`)).text();
	const versions = list
		.split('\n')
		.filter(version => /^\d+\.\d+\.\d+$/.test(version)) // skip prereleases
		.sort(semver.compare);
	cdnVersion = versions.at(-1) ?? '';
	if (!cdnVersion) throw new Error('The version list is empty');
	log(cdnVersion);
});

let npmVersion = '';
await asyncTask('Getting the latest version from the npm registry', async log => {
	const info = await (await fetchOk(NPM_PACKAGE_REGISTRY_URL)).json();
	npmVersion = info['dist-tags'].latest;
	log(npmVersion);
});

if (!semver.gt(cdnVersion, npmVersion)) {
	console.log(`::notice title=No action required::npm already has SheetJS ${npmVersion}`);
	process.exit(1); // the workflow treats a non-zero exit as "nothing to publish" and skips the publish step
}

await asyncTask(`Downloading SheetJS ${cdnVersion} from the CDN`, async () => {
	const response = await fetchOk(`${SHEETJS_CDN_URL}/xlsx-${cdnVersion}/xlsx-${cdnVersion}.tgz`);
	const tarballPath = path.join(os.tmpdir(), `xlsx-${cdnVersion}.tgz`);
	await fs.writeFile(tarballPath, Buffer.from(await response.arrayBuffer()));
	await fs.mkdir(SHEETJS_PATH, { recursive: true });
	await exec('tar', ['-xzf', tarballPath, '-C', SHEETJS_PATH, '--strip-components=1']);
});

await asyncTask('Patching the package', async () => {
	await fs.copyFile(LOCAL_README_PATH, path.join(SHEETJS_PATH, 'README.md'));
	await exec('npm', ['pkg', 'set', `name=${NPM_PACKAGE_NAME}`, `repository.url=${REPOSITORY_URL}`], { cwd: SHEETJS_PATH });
});
