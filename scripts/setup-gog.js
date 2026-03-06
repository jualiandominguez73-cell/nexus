import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const VERSION = 'v0.11.0';
const BIN_DIR = join(process.cwd(), 'bin');

async function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = writeFileSync(dest, ''); // Just to touch it
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                writeFileSync(dest, Buffer.concat(chunks));
                resolve();
            });
        }).on('error', reject);
    });
}

async function setup() {
    if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR);

    const platform = process.platform;
    const arch = process.arch === 'x64' ? 'amd64' : process.arch;

    let filename = `gogcli_${VERSION.substring(1)}_${platform}_${arch}`;
    if (platform === 'win32') filename += '.zip';
    else filename += '.tar.gz';

    const gogBinary = platform === 'win32' ? 'gog.exe' : 'gog';
    const binaryPath = join(BIN_DIR, gogBinary);

    if (existsSync(binaryPath)) {
        console.log(`[Setup] gog binary already exists at ${binaryPath}`);
        return;
    }

    const url = `https://github.com/steipete/gogcli/releases/download/${VERSION}/gogcli_${VERSION.substring(1)}_${platform}_${arch}${platform === 'win32' ? '.zip' : '.tar.gz'}`;

    console.log(`[Setup] Downloading gog from ${url}...`);
    const zipPath = join(BIN_DIR, 'gog.zip');

    try {
        // Note: This is a simplified downloader for the demo. In a real scenario, use 'axios' if available or 'curl'.
        // Since we don't want to add more dependencies, we use what we have or 'curl' if on linux.
        if (platform !== 'win32') {
            execSync(`curl -L ${url} -o ${zipPath} && tar -xzf ${zipPath} -C ${BIN_DIR} && rm ${zipPath} && chmod +x ${binaryPath}`);
        } else {
            // On Windows, we already did it manually, but for a general setup:
            execSync(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'; Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force; Remove-Item '${zipPath}'"`);
        }
        console.log('[Setup] gog installed successfully.');
    } catch (err) {
        console.error('[Setup Error]:', err.message);
    }
}

setup();
