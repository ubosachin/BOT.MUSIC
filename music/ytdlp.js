/**
 * music/ytdlp.js
 * 
 * Helper for interactng with yt-dlp binary.
 */

'use strict';

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// yt-dlp binary location (resolved at runtime)
// ─────────────────────────────────────────────────────────────────────────────
function getYT_DLP() {
    const local = path.join(__dirname, '..', 'yt-dlp');
    if (fs.existsSync(local)) return local;

    const paths = ['yt-dlp', './yt-dlp', '/usr/local/bin/yt-dlp'];
    
    for (const p of paths) {
        try {
            const found = execSync(`which ${p} 2>/dev/null || command -v ${p} 2>/dev/null`, { encoding: 'utf8' }).trim();
            if (found) return found;
        } catch {}
    }

    // Fallback: Check if python3 -m yt_dlp works
    try {
        execSync('python3 -m yt_dlp --version', { stdio: 'ignore' });
        return 'python3 -m yt_dlp';
    } catch {}

    throw new Error('yt-dlp not found. Install with: brew install yt-dlp (mac) or sudo apt install yt-dlp (linux)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cookie handling
// ─────────────────────────────────────────────────────────────────────────────
const COOKIES_FILE = (() => {
    const txtPath = path.join(__dirname, '..', 'cookies.txt');
    if (fs.existsSync(txtPath)) {
        console.log('[Player] ✅ cookies.txt found (Netscape format) — using directly.');
        return txtPath;
    }

    const jsonPath = path.join(__dirname, '..', 'cookies.json');
    if (!fs.existsSync(jsonPath)) {
        console.log('[Player] ⚠️  No cookies.txt or cookies.json found. You might get blocked.');
        return null;
    }

    // Convert cookies.json to Netscape txt format for yt-dlp
    try {
        console.log('[Player] 🔄 Converting cookies.json to cookies.txt (Netscape format)…');
        const cookies = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        let txt = '# Netscape HTTP Cookie File\n';
        for (const c of cookies) {
            const domain = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
            const secure = c.secure ? 'TRUE' : 'FALSE';
            const timestamp = Math.floor(c.expirationDate || (Date.now() / 1000 + 3600 * 24 * 365));
            txt += `${domain}\tTRUE\t${c.path}\t${secure}\t${timestamp}\t${c.name}\t${c.value}\n`;
        }
        fs.writeFileSync(txtPath, txt);
        return txtPath;
    } catch (e) {
        console.warn('[Player] ⚠️  Could not process cookies.json:', e.message);
        return null;
    }
})();

/**
 * Robust YouTube metadata fetcher using yt-dlp.
 */
async function getYtDlpInfo(url, forceNoCookies = false) {
    const binPath = getYT_DLP();
    const cmdParts = binPath.split(' ');
    const bin = cmdParts[0];

    const args = [
        ...cmdParts.slice(1),
        '--dump-json',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=ios,android,web_creator',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        '--force-ipv4',
    ];
    
    const useCookies = COOKIES_FILE && !forceNoCookies;
    if (useCookies) args.push('--cookies', COOKIES_FILE);
    args.push(url);

    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', async (code) => {
            const trimmedStdout = stdout.trim();
            const trimmedStderr = stderr.trim();

            if (!forceNoCookies && COOKIES_FILE && (code !== 0 || !trimmedStdout || trimmedStderr.includes('confirm you'))) {
                console.warn('[yt-dlp] Metadata fetch with cookies failed. Retrying WITHOUT cookies...');
                try {
                    const fallbackResult = await getYtDlpInfo(url, true);
                    return resolve(fallbackResult);
                } catch (err) {}
            }

            if (code !== 0 || !trimmedStdout) {
                return reject(new Error(trimmedStderr || `yt-dlp exited with code ${code}`));
            }

            try {
                const json = JSON.parse(trimmedStdout);
                resolve({
                    title:         json.title,
                    artist:        json.uploader || json.channel || '',
                    url:           json.webpage_url || url,
                    thumbnail:     json.thumbnail || '',
                    durationRaw:   json.duration_string || '',
                    durationInSec: json.duration || 0,
                    source:        'youtube',
                });
            } catch (err) {
                reject(new Error('Failed to parse yt-dlp JSON output.'));
            }
        });
    });
}

/**
 * Search YouTube using yt-dlp.
 */
async function getYtDlpSearch(query, forceNoCookies = false) {
    const binPath = getYT_DLP();
    const cmdParts = binPath.split(' ');
    const bin = cmdParts[0];

    const args = [
        ...cmdParts.slice(1),
        `ytsearch1:${query}`,
        '--dump-json',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        '--extractor-args', 'youtube:player_client=ios,android,web_creator',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        '--force-ipv4',
    ];
    
    const useCookies = COOKIES_FILE && !forceNoCookies;
    if (useCookies) args.push('--cookies', COOKIES_FILE);

    return new Promise((resolve, reject) => {
        const proc = spawn(bin, args);
        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', async (code) => {
            const trimmedStdout = stdout.trim();
            const trimmedStderr = stderr.trim();

            if (!forceNoCookies && COOKIES_FILE && (code !== 0 || !trimmedStdout || trimmedStderr.includes('confirm you'))) {
                console.warn('[yt-dlp] Search with cookies failed. Retrying WITHOUT cookies...');
                try {
                    const fallbackResult = await getYtDlpSearch(query, true);
                    return resolve(fallbackResult);
                } catch (err) {}
            }

            if (code !== 0 || !trimmedStdout) {
                return reject(new Error(trimmedStderr || `yt-dlp search exited with code ${code}`));
            }

            try {
                const json = JSON.parse(trimmedStdout);
                resolve({
                    title:         json.title,
                    artist:        json.uploader || json.channel || '',
                    url:           json.webpage_url,
                    thumbnail:     json.thumbnail || '',
                    durationRaw:   json.duration_string || '',
                    durationInSec: json.duration || 0,
                    source:        'youtube',
                });
            } catch (err) {
                reject(new Error('Failed to parse yt-dlp search result.'));
            }
        });
    });
}

module.exports = {
    getYT_DLP,
    COOKIES_FILE,
    getYtDlpInfo,
    getYtDlpSearch
};
