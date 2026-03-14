/**
 * music/queue.js
 * Manages the song queue for each guild.
 *
 * Song object shape:
 * {
 *   title:         string   — display title
 *   artist:        string   — artist / channel name (optional)
 *   url:           string   — source URL (Spotify or SoundCloud)
 *   streamUrl:     string   — resolved SoundCloud audio URL
 *   thumbnail:     string   — artwork URL
 *   duration:      number   — duration in seconds
 *   requestedBy:   GuildMember | null
 *   source:        'spotify' | 'soundcloud'
 * }
 */

'use strict';

class MusicQueue {
    constructor() {
        this.songs    = [];
        this.loop     = false;
        this.loopMode = 'none';   // 'none' | 'song' | 'queue'
        this.volume   = 80;
    }

    /**
     * Add a song to the end of the queue.
     * @param {Object} song
     */
    add(song) {
        this.songs.push(song);
    }

    /**
     * Remove and return the first song.
     * @returns {Object|undefined}
     */
    shift() {
        return this.songs.shift();
    }

    /**
     * Peek at the first song without removing it.
     * @returns {Object|undefined}
     */
    peek() {
        return this.songs[0];
    }

    /**
     * Shuffle the queue in-place (Fisher-Yates).
     */
    shuffle() {
        for (let i = this.songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
        }
    }

    /** Remove all songs. */
    clear() {
        this.songs = [];
    }

    get length() {
        return this.songs.length;
    }

    get isEmpty() {
        return this.songs.length === 0;
    }
}

module.exports = { MusicQueue };
