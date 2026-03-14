/**
 * services/soundcloud.js
 *
 * Handles SoundCloud searching and streaming.
 */

'use strict';

const scdl = require('soundcloud-downloader').default;

/**
 * Search SoundCloud for a track and return metadata
 */
async function searchSoundCloud(query) {
    console.log(`[SoundCloud] Searching track: "${query}"`);
    try {
        const results = await scdl.search({
            query,
            resourceType: 'tracks',
            limit: 5
        });

        if (!results.collection || results.collection.length === 0) {
            return null;
        }

        const best = results.collection[0];
        return {
            title:         best.title,
            artist:        best.user?.username || 'Unknown Artist',
            url:           best.permalink_url,
            duration:      Math.floor(best.duration / 1000), // seconds
            thumbnail:     best.artwork_url || '',
            source:        'soundcloud'
        };
    } catch (err) {
        console.error(`[SoundCloud] Search failed for "${query}":`, err.message);
        return null;
    }
}

/**
 * Get a readable stream from a SoundCloud URL
 */
async function getSoundCloudStream(url) {
    console.log(`[SoundCloud] Stream ready`);
    try {
        return await scdl.download(url);
    } catch (err) {
        console.error(`[SoundCloud] Download failed for "${url}":`, err.message);
        throw err;
    }
}

module.exports = {
    searchSoundCloud,
    getSoundCloudStream
};
