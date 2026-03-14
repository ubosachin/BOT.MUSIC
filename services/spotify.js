/**
 * services/spotify.js
 *
 * Full Spotify-First Music Engine.
 * Handles metadata fetching, playlist/album/artist resolution,
 * and converts them into YouTube search queries for playback.
 */

'use strict';

const SpotifyWebApi = require('spotify-web-api-node');

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
 * Main converter: Spotify Track Object -> Metadata
 */
function spotifyTrackToMetadata(track) {
    return {
        title:         track.name,
        artist:        track.artists.map(a => a.name).join(', '),
        album:         track.album?.name || '',
        url:           track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
        thumbnail:     track.album?.images?.[0]?.url || '',
        duration:      Math.floor(track.duration_ms / 1000),
        spotifyId:     track.id,
        source:        'spotify'
    };
}

/**
 * Handle direct search queries via Spotify
 */
async function searchSpotify(query) {
    await ensureToken();
    const data = await spotifyApi.searchTracks(query, { limit: 1 });
    const track = data.body.tracks?.items[0];
    if (!track) throw new Error(`No results found on Spotify for "${query}"`);
    return spotifyTrackToMetadata(track);
}

/**
 * Resolve Spotify URLs (Track, Playlist, Album)
 */
async function resolveSpotifyLink(url) {
    await ensureToken();
    const isTrack    = url.includes('/track/');
    const isPlaylist = url.includes('/playlist/');
    const isAlbum    = url.includes('/album/');

    if (isTrack) {
        const id = url.split('/track/')[1].split('?')[0];
        const data = await spotifyApi.getTrack(id);
        return [spotifyTrackToMetadata(data.body)];
    }

    if (isPlaylist) {
        console.log('[Spotify] Resolving playlist metadata...');
        const id = url.split('/playlist/')[1].split('?')[0];
        const data = await spotifyApi.getPlaylistTracks(id, { limit: 50 });
        return data.body.items.map(item => item.track).filter(t => t !== null).map(spotifyTrackToMetadata);
    }

    if (isAlbum) {
        console.log('[Spotify] Resolving album metadata...');
        const id = url.split('/album/')[1].split('?')[0];
        const data = await spotifyApi.getAlbumTracks(id, { limit: 50 });
        return data.body.items.map(spotifyTrackToMetadata);
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
        return spotifyTrackToMetadata(track);
    } catch (err) {
        return null;
    }
}

module.exports = {
    searchSpotify,
    resolveSpotifyLink,
    getSpotifyRecommendations
};
