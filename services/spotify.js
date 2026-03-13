/**
 * services/spotify.js
 *
 * Full Spotify-First Music Engine.
 * Handles metadata fetching, playlist/album/artist resolution,
 * and converts them into YouTube search queries for playback.
 */

'use strict';

const SpotifyWebApi = require('spotify-web-api-node');
const play          = require('play-dl');
const { getYtDlpSearch } = require('../music/ytdlp');

const spotifyApi = new SpotifyWebApi({
    clientId:     process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('\x1b[31m%s\x1b[0m', '[Critical] Spotify credentials missing in .env! Searching by Spotify will fail.');
}

let tokenExpiresAt = 0;

/**
 * Ensure we have a valid access token.
 */
async function ensureToken() {
    if (Date.now() < tokenExpiresAt) return;

    try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        tokenExpiresAt = Date.now() + (data.body['expires_in'] - 60) * 1000;
        console.log('[Spotify] 🔑 Access token refreshed.');
    } catch (err) {
        console.error('[Spotify] ❌ Auth error:', err.message);
        throw new Error('Spotify Authentication Failed. Check your CLIENT_ID/SECRET.');
    }
}

/**
 * Main converter: Spotify Metadata -> YouTube Streamable Song
 */
async function spotifyTrackToSong(track, requestedBy = null) {
    console.log(`[Spotify] Fetching metadata`);
    
    const title  = track.name;
    const artist = track.artists.map(a => a.name).join(', ');
    const query  = `${artist} ${title} official audio`;
    
    const spotifyMs = track.duration_ms;
    const spotifyUrl = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;
    let best = null;

    console.log(`[Search] Searching YouTube`);

    // Try play-dl search first
    try {
        const results = await play.search(query, { limit: 5, source: { youtube: 'video' } });
        for (const r of results) {
            if (!r.url || !r.durationInSec) continue;
            const diffMs = Math.abs(r.durationInSec * 1000 - spotifyMs);
            const curr   = best ? Math.abs((best.durationInSec || 0) * 1000 - spotifyMs) : Infinity;
            if (diffMs < curr) best = r;
        }
    } catch (err) {
        console.warn(`[Search] play-dl search blocked. Falling back to yt-dlp search...`);
    }

    // Fallback search via yt-dlp
    if (!best) {
        try {
            best = await getYtDlpSearch(query);
        } catch (err) {
            console.error(`[Search] yt-dlp search also failed.`);
        }
    }

    if (!best) {
        throw new Error(`No YouTube results found for "${title}" by ${artist}`);
    }

    console.log(`[Player] Stream ready`);

    return {
        title:         `${title}`,
        artist,
        url:           spotifyUrl,       // Web Link
        streamUrl:     best.url,         // Audio Link
        duration:      best.durationRaw || '?',
        durationInSec: best.durationInSec || Math.floor(spotifyMs / 1000),
        thumbnail:     track.album?.images?.[0]?.url || best.thumbnail || best.thumbnails?.[0]?.url || '',
        requestedBy,
        source:        'spotify',
        spotifyId:     track.id,
    };
}

/**
 * Handle direct search queries via Spotify
 */
async function searchSpotify(query, requestedBy = null) {
    await ensureToken();
    const data = await spotifyApi.searchTracks(query, { limit: 1 });
    const track = data.body.tracks?.items[0];
    if (!track) throw new Error(`No results found on Spotify for "${query}"`);
    return spotifyTrackToSong(track, requestedBy);
}

/**
 * Resolve Spotify URLs (Track, Playlist, Album)
 */
async function resolveSpotifyLink(url, requestedBy = null) {
    await ensureToken();
    const isTrack    = url.includes('/track/');
    const isPlaylist = url.includes('/playlist/');
    const isAlbum    = url.includes('/album/');

    if (isTrack) {
        const id = url.split('/track/')[1].split('?')[0];
        const data = await spotifyApi.getTrack(id);
        return [await spotifyTrackToSong(data.body, requestedBy)];
    }

    if (isPlaylist) {
        console.log('[Spotify] Resolving playlist metadata...');
        const id = url.split('/playlist/')[1].split('?')[0];
        const data = await spotifyApi.getPlaylistTracks(id, { limit: 50 });
        const tracks = data.body.items.map(item => item.track).filter(t => t !== null);
        
        const results = [];
        for (const t of tracks) {
            // Lazy load YouTube links later or all at once? 
            // Better to load all at once for the queue object.
            results.push(await spotifyTrackToSong(t, requestedBy));
        }
        return results;
    }

    if (isAlbum) {
        console.log('[Spotify] Resolving album metadata...');
        const id = url.split('/album/')[1].split('?')[0];
        const data = await spotifyApi.getAlbumTracks(id, { limit: 50 });
        const tracks = data.body.items;

        const results = [];
        for (const t of tracks) {
            results.push(await spotifyTrackToSong(t, requestedBy));
        }
        return results;
    }

    throw new Error('Unsupported Spotify URL type.');
}

/**
 * Autoplay Recommendations
 */
async function getSpotifyRecommendations(seedId) {
    await ensureToken();
    try {
        const data = await spotifyApi.getRecommendations({
            seed_tracks: [seedId],
            limit: 5
        });
        const track = data.body.tracks[Math.floor(Math.random() * data.body.tracks.length)];
        if (!track) return null;
        return spotifyTrackToSong(track, null);
    } catch (err) {
        return null;
    }
}

module.exports = {
    searchSpotify,
    resolveSpotifyLink,
    getSpotifyRecommendations
};
