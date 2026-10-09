import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import semver from 'semver';

const REPOSITORY_URL = 'https://github.com/e965/sheetjs-npm-publisher';
const LOCAL_README_PATH = path.join(process.cwd(), 'README.md');

const NPM_PACKAGE_NAME = '@e965/xlsx';
const NPM_PACKAGE_REGISTRY_URL = `https://registry.npmjs.org/${NPM_PACKAGE_NAME}`;

const SHEETJS_CDN_URL = 'https://cdn.sheetjs.com';
const SHEETJS_PATH = 'sheetjs';

const exec = promisify(execFile);

const fetchOk = async (url: string) => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} responded with HTTP ${response.status}`);
	return response;
};

const list = await (await fetchOk(`${SHEETJS_CDN_URL}/xlsx.lst`)).text();
const cdnVersion = list
	.split('\n')
	.filter(version => /^\d+\.\d+\.\d+$/.test(version)) // skip prereleases
	.sort(semver.compare)
	.at(-1);
if (!cdnVersion) throw new Error('The CDN version list is empty');
console.log(`Latest version on the SheetJS CDN: ${cdnVersion}`);

const info = await (await fetchOk(NPM_PACKAGE_REGISTRY_URL)).json();
const npmVersion: string = info['dist-tags'].latest;
console.log(`Latest version on npm: ${npmVersion}`);

if (!semver.gt(cdnVersion, npmVersion)) {
	console.log(`::notice title=No action required::npm already has SheetJS ${npmVersion}`);
	process.exit(1); // the workflow treats a non-zero exit as "nothing to publish" and skips the publish step
}

console.log(`Downloading SheetJS ${cdnVersion} from the CDN`);
const response = await fetchOk(`${SHEETJS_CDN_URL}/xlsx-${cdnVersion}/xlsx-${cdnVersion}.tgz`);
const tarballPath = path.join(os.tmpdir(), `xlsx-${cdnVersion}.tgz`);
await fs.writeFile(tarballPath, Buffer.from(await response.arrayBuffer()));
await fs.mkdir(SHEETJS_PATH, { recursive: true });
await exec('tar', ['-xzf', tarballPath, '-C', SHEETJS_PATH, '--strip-components=1']);

console.log('Patching the package');
await fs.copyFile(LOCAL_README_PATH, path.join(SHEETJS_PATH, 'README.md'));
await exec('npm', ['pkg', 'set', `name=${NPM_PACKAGE_NAME}`, `repository.url=${REPOSITORY_URL}`], { cwd: SHEETJS_PATH });

console.log(`${NPM_PACKAGE_NAME}@${cdnVersion} is ready in ${SHEETJS_PATH}/`);
